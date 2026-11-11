import Foundation
import Observation
import PingFront
import UIKit

/// The Swift side of the Turbo Module: maps JavaScript values to the pingfront iOS SDK and back.
///
/// It owns no product state. The SDK does (sessions, Keychain, outbox, the chat), and this class only
/// forwards calls, streams `PingFront.shared.events` and observes the facade's state for the hooks. Every
/// method runs on the main actor: the Objective-C++ module sets its method queue to the main queue.
@objc(PingfrontBridge)
@MainActor
public final class PingfrontBridge: NSObject {
    /// Emits one value on a Codegen event emitter (`onEvent`, `onState`, `onOfferRequest`, `onLinkRequest`).
    public typealias Emitter = (String, [String: Any]) -> Void

    private let emit: Emitter
    private var eventTask: Task<Void, Never>?
    private var observing = false
    private var lastState: [String: Any] = [:]
    /// Chat links waiting for JavaScript's answer (`answerLink`), by request id.
    private let linkAnswers = PendingAnswers()
    private var teamActionTask: Task<Void, Never>?
    /// Team actions delivered to JavaScript and not answered yet, by run id.
    private var teamActions: [String: TeamAction] = [:]
    /// Screen link taps waiting for JavaScript's answer (`answerScreen`), by request id.
    private let screenAnswers = PendingAnswers()
    private var conversationObserved = false
    private var conversationTracking = false
    /// What JavaScript last got, so unchanged messages and pending sends aren't serialized again.
    private var sentMessages: [Message]?
    private var sentPending: [PendingMessage]?
    /// Forwards native log lines to JavaScript, in order, while `configure` had a `logHandler`.
    private var logTask: Task<Void, Never>?

    @objc public init(emitter: @escaping Emitter) {
        self.emit = emitter
        super.init()
    }

    /// Stops the event stream and state observation (the React instance is going away).
    @objc public func invalidate() {
        eventTask?.cancel()
        eventTask = nil
        teamActionTask?.cancel()
        teamActionTask = nil
        logTask?.cancel()
        logTask = nil
        teamActions = [:]
        observing = false
        conversationObserved = false
        PingFront.shared.onOffer = nil
        PingFront.shared.onLink = nil
        PingFront.shared.onScreen = nil
        screenAnswers.finishAll()
        linkAnswers.finishAll()
    }

    private var pf: PingFront { PingFront.shared }

    // MARK: Configure

    @objc public func configure(_ appKey: String?, options: [String: Any]) {
        let topics = (options["topics"] as? [[String: Any]])?.compactMap(Self.topic(from:))
        let modules = options["modules"] as? [String: Any] ?? [:]
        let wanted = Self.modules(from: modules)
        PingFront.configure(appKey) { config in
            if let base = options["baseUrl"] as? String, let url = URL(string: base) { config.baseURL = url }
            if let level = options["logLevel"] as? String, let parsed = Self.logLevel(level) { config.logLevel = parsed }
            if let language = options["language"] as? String { config.language = language }
            logTask?.cancel()
            logTask = nil
            if options["logHandler"] as? Bool == true {
                // Called from any thread with a line the SDK already redacted. One stream keeps the lines in the order
                // the SDK logged them; one task forwards them to JavaScript on the main actor.
                let (lines, continuation) = AsyncStream.makeStream(of: PingFrontLogEntry.self, bufferingPolicy: .bufferingNewest(500))
                config.logHandler = { entry in continuation.yield(entry) }
                logTask = Task { [weak self] in
                    for await entry in lines {
                        self?.emit(
                            "onLog",
                            ["level": Self.name(of: entry.level), "message": entry.message, "category": entry.category])
                    }
                }
            }
            if let presents = options["presentsChatForMoments"] as? Bool { config.presentsChatForMoments = presents }
            if let env = options["pushEnvironment"] as? String, let parsed = PushEnvironment(rawValue: env) {
                config.pushEnvironment = parsed
            }
            if let topics { config.topics = topics }
            if let look = options["look"] as? [String: Any] { Self.apply(look: look, to: &config.appearance) }
            for module in wanted { config.use(module) }
            // PF-Wrapper: the JS layer always passes {name: 'react-native', version}.
            if let wrapper = options["wrapper"] as? [String: Any],
               let name = wrapper["name"] as? String, let version = wrapper["version"] as? String {
                config.wrapper = PingFrontWrapper(name: name, version: version)
            }
        }
        startStreaming()
        emitState(force: true)
    }

    private static func modules(from options: [String: Any]) -> [PingFrontModule] {
        var modules: [PingFrontModule] = []
        if options["push"] as? Bool == true { modules.append(.push) }
        if let storeKit = options["storeKit"] as? [String: Any] {
            let products = storeKit["products"] as? [String] ?? []
            modules.append(products.isEmpty ? .storeKit : .storeKit(products: products))
        }
        if let reports = options["reports"] as? [String: Any] {
            var set: ReportOptions = []
            if reports["shakeToReport"] as? Bool != false { set.insert(.shakeToReport) }
            if reports["logTail"] as? Bool != false { set.insert(.logTail) }
            modules.append(.reports(set))
        }
        for id in options["vendors"] as? [String] ?? [] {
            if let module = PingfrontReactNative.registeredModule(id: id) {
                modules.append(module)
            } else {
                PingfrontReactNative.reportMissingVendor(id)
            }
        }
        return modules
    }

    private static func logLevel(_ name: String) -> PingFrontLogLevel? {
        switch name {
        case "off": .off
        case "error": .error
        case "info": .info
        case "debug": .debug
        default: nil
        }
    }

    nonisolated private static func name(of level: PingFrontLogLevel) -> String {
        switch level {
        case .off: "off"
        case .error: "error"
        case .info: "info"
        case .debug: "debug"
        @unknown default: "info"
        }
    }

    private static func text(_ value: Any?) -> LocalizedText? {
        if let string = value as? String { return LocalizedText(default: string) }
        if let values = value as? [String: String] { return LocalizedText(values) }
        return nil
    }

    private static let presets: [String: ChatTopic] = [
        "billing": .billing, "bug": .bug, "idea": .idea, "question": .question, "account": .account,
        "feedback": .feedback, "restore": .restore, "gift": .gift, "privacy": .privacy,
    ]

    static func topic(from value: [String: Any]) -> ChatTopic? {
        guard let id = value["id"] as? String else { return nil }
        guard value["label"] != nil else { return presets[id] ?? ChatTopic(id: id, label: nil, symbol: .other) }
        let symbol = (value["symbol"] as? String).flatMap(TopicSymbol.init(rawValue:)) ?? .other
        return ChatTopic(id: id, label: text(value["label"]), symbol: symbol, prefill: text(value["prefill"]))
    }

    private static func color(_ value: Any?) -> PingFrontColor? {
        guard let pair = value as? [String: String], let light = pair["light"], let dark = pair["dark"],
            let l = PingFrontColor(hex: light), let d = PingFrontColor(hex: dark)
        else { return nil }
        return PingFrontColor(light: l.light, dark: d.dark)
    }

    private static func apply(look: [String: Any], to appearance: inout ChatAppearance) {
        if let value = color(look["accent"]) { appearance.accent = value }
        if let value = color(look["background"]) { appearance.background = value }
        if let value = color(look["teamBubble"]) { appearance.teamBubble = value }
        if let value = (look["scheme"] as? String).flatMap(ChatLook.Scheme.init(rawValue:)) { appearance.scheme = value }
        if let value = (look["font"] as? String).flatMap(ChatLook.FontStyle.init(rawValue:)) { appearance.font = value }
        if let value = (look["corners"] as? String).flatMap(ChatLook.Corners.init(rawValue:)) { appearance.corners = value }
        if let value = (look["density"] as? String).flatMap(ChatLook.Density.init(rawValue:)) { appearance.density = value }
        if let value = (look["headerStyle"] as? String).flatMap(ChatLook.HeaderStyle.init(rawValue:)) {
            appearance.headerStyle = value
        }
        if let value = (look["timestamps"] as? String).flatMap(ChatLook.Timestamps.init(rawValue:)) {
            appearance.timestamps = value
        }
        if let value = look["headerMemberId"] as? String { appearance.headerMemberId = value }
        if let value = look["headerTitle"] as? String { appearance.headerTitle = value }
        if let value = look["replyExpectation"] as? String { appearance.replyExpectation = value }
        if let value = look["welcomeTitle"] as? String { appearance.welcomeTitle = value }
        if let value = look["welcomeBody"] as? String { appearance.welcomeBody = value }
        if let value = look["composerPlaceholder"] as? String { appearance.composerPlaceholder = value }
        if let value = look["aiName"] as? String { appearance.aiName = value }
        if let value = look["showsReplyExpectation"] as? Bool { appearance.showsReplyExpectation = value }
        if let value = look["showsLocalTime"] as? Bool { appearance.showsLocalTime = value }
        if let value = look["showsWelcomeFaces"] as? Bool { appearance.showsWelcomeFaces = value }
        if let value = look["allowsPhotos"] as? Bool { appearance.allowsPhotos = value }
        if let value = look["allowsReports"] as? Bool { appearance.allowsReports = value }
        if let value = look["showsNames"] as? Bool { appearance.showsNames = value }
        if let value = look["showsAvatars"] as? Bool { appearance.showsAvatars = value }
    }

    // MARK: Language

    /// The native language override; an invalid tag is ignored and logged by the SDK (the snapshot keeps the old one).
    @objc public func setLanguage(_ tag: String?) {
        pf.language = tag
        emitState(force: false)
    }

    // MARK: Identity

    @objc public func identify(_ userId: String, name: String?, email: String?) {
        pf.identify(userId: userId, name: name, email: email)
    }

    @objc public func identify(token: String) { pf.identify(token: token) }

    @objc public func setTraits(_ traits: [String: Any]) {
        pf.setTraits(traits.compactMapValues { $0 as? String })
    }

    @objc public func setEntitlement(_ entitlement: [String: Any]) {
        guard let value = Wire.decode(Entitlement.self, from: entitlement) else {
            PingfrontReactNative.reportBadInput("setEntitlement: the entitlement is not in the wire format.")
            return
        }
        pf.setEntitlement(value)
    }

    @objc public func logout() {
        pf.logout()
        emitState(force: false)
    }

    @objc public func eraseMyData(resolve: @escaping (Any?) -> Void, reject: @escaping Reject) {
        Task {
            do throws(PingFrontError) {
                try await pf.eraseMyData()
                resolve(nil)
            } catch {
                Self.reject(error, reject)
            }
        }
    }

    /// The person's data export as the JSON text the server sent.
    @objc public func exportMyData(resolve: @escaping (Any?) -> Void, reject: @escaping Reject) {
        Task {
            do throws(PingFrontError) {
                let data = try await pf.exportMyData()
                resolve(String(decoding: data, as: UTF8.self))
            } catch {
                Self.reject(error, reject)
            }
        }
    }

    @objc public func prepare(resolve: @escaping (Any?) -> Void, reject: @escaping Reject) {
        Task {
            do throws(PingFrontError) {
                try await pf.prepare()
                resolve(nil)
            } catch {
                Self.reject(error, reject)
            }
        }
    }

    // MARK: Chat

    @objc public func openChat(_ topic: [String: Any]?) {
        pf.openChat(topic: topic.flatMap(Self.topic(from:)))
    }

    /// Closes the SDK-presented chat and resolves once it is gone, so a React Native `<Modal>` (presented
    /// from the root view controller) can present right after.
    @objc public func closeChat(resolve: @escaping (Any?) -> Void) {
        Task {
            await pf.closeChat()
            resolve(nil)
        }
    }

    @objc public func openReport(_ prefill: String?) { pf.openReport(prefill: prefill) }

    /// A chat link: the native SDK decides (https://pingfront.sh/docs/chat-links); a string that isn't a URL is false.
    @objc public func handleUrl(_ url: String) -> Bool {
        guard let parsed = URL(string: url) else { return false }
        return pf.handle(parsed)
    }

    @objc public func reportBug(_ text: String, screenshotBase64: String?, resolve: @escaping (Any?) -> Void, reject: @escaping Reject) {
        // Not base64 (a data: URI, say): the report goes without the screenshot, as on Android.
        let screenshot = screenshotBase64.flatMap { Data(base64Encoded: $0) }
        if screenshotBase64 != nil, screenshot == nil {
            PingfrontReactNative.reportBadInput("reportBug: screenshotBase64 is not base64; the report is sent without it.")
        }
        Task {
            do throws(PingFrontError) {
                try await pf.reportBug(text: text, screenshot: screenshot)
                resolve(nil)
            } catch {
                Self.reject(error, reject)
            }
        }
    }

    // MARK: Moments and offers

    @objc public func moment(_ name: String, props: [String: Any], resolve: @escaping (Any?) -> Void) {
        let values = props.compactMapValues(Self.momentValue(_:))
        Task {
            let result = await pf.moment(name, props: values)
            resolve(Self.encode(result))
        }
    }

    private static func momentValue(_ value: Any) -> MomentValue? {
        if let number = value as? NSNumber {
            if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
            return .number(number.doubleValue)
        }
        if let string = value as? String { return .string(string) }
        return nil
    }

    @objc public func setOffers(_ offers: [Any]) {
        let slots = offers.compactMap { ($0 as? [String: Any]).flatMap { Wire.decode(OfferSlot.self, from: $0) } }
        if slots.count != offers.count {
            PingfrontReactNative.reportBadInput("setOffers: \(offers.count - slots.count) slot(s) are not valid OfferSlots.")
        }
        pf.setOffers(slots)
    }

    @objc public func setOfferHandlerEnabled(_ enabled: Bool) {
        guard enabled else {
            pf.onOffer = nil
            return
        }
        pf.onOffer = { [weak self] request in
            self?.emit("onOfferRequest", Self.encode(request))
        }
    }

    /// Every link (the SDK already applied the link card URL rule) waits for JavaScript's answer (`answerLink`). The
    /// SDK caps the wait at 10 seconds and cancels this handler then, opens a declined link the way the chat opens it,
    /// and replaces a message link still waiting when a newer one is tapped: the waiting entry is dropped, so a late
    /// answer neither counts nor closes the chat. A timely `true` closes the chat when `closesChat`.
    @objc public func setLinkHandlerEnabled(_ enabled: Bool, closesChat: Bool) {
        guard enabled else {
            pf.onLink = nil
            linkAnswers.finishAll()
            return
        }
        pf.onLink = { [weak self] url in
            guard let self else { return false }
            let requestId = UUID().uuidString
            let handled = await self.linkAnswers.wait(for: requestId) {
                self.emit("onLinkRequest", ["requestId": requestId, "url": url.absoluteString])
            }
            if handled, closesChat, !Task.isCancelled { await self.pf.closeChat() }
            return handled
        }
    }

    @objc public func answerLink(_ requestId: String, handled: Bool) {
        linkAnswers.answer(requestId, handled)
    }

    // MARK: Saved links (https://pingfront.sh/docs/offers#saved-links)

    @objc public func registerScreens(_ screens: [Any]) {
        let list = screens.compactMap { item -> AppScreen? in
            guard let screen = item as? [String: Any], let id = screen["id"] as? String else { return nil }
            return AppScreen(id: id, title: screen["title"] as? String)
        }
        pf.registerScreens(list)
    }

    /// The tap waits for JavaScript's answer (`answerScreen`). The SDK caps the wait at 10 seconds and cancels this
    /// handler then: the waiting entry is dropped, so a late answer neither counts nor closes the chat.
    @objc public func setScreenHandlerEnabled(_ enabled: Bool, closesChat: Bool) {
        guard enabled else {
            pf.onScreen = nil
            screenAnswers.finishAll()
            return
        }
        pf.onScreen = { [weak self] screen in
            guard let self else { return false }
            let requestId = UUID().uuidString
            let opened = await self.screenAnswers.wait(for: requestId) {
                self.emit("onScreenRequest", ["requestId": requestId, "id": screen.id, "params": screen.params])
            }
            if opened, closesChat, !Task.isCancelled { await self.pf.closeChat() }
            return opened
        }
    }

    @objc public func answerScreen(_ requestId: String, opened: Bool) {
        screenAnswers.answer(requestId, opened)
    }

    // MARK: Push

    /// A hex APNs token registers it; `nil` unregisters this install's token (as on Android and in Flutter).
    @objc public func setPushToken(_ token: String?) {
        guard let token else { return pf.setPushToken(nil) }
        guard let data = Data(hex: token) else {
            return PingfrontReactNative.reportBadInput("setPushToken: the APNs token must be hex.")
        }
        pf.setPushToken(data)
    }

    @objc public func handlePush(_ payload: [String: Any], opened: Bool) -> Bool {
        let userInfo = payload.reduce(into: [AnyHashable: Any]()) { $0[$1.key] = $1.value }
        guard pf.isPingFrontPush(userInfo: userInfo) else { return false }
        if opened {
            return pf.handlePush(userInfo: userInfo)
        }
        pf.pushReceived(userInfo: userInfo)
        return true
    }

    @objc public func isPingFrontPush(_ payload: [String: Any]) -> Bool {
        pf.isPingFrontPush(userInfo: payload.reduce(into: [AnyHashable: Any]()) { $0[$1.key] = $1.value })
    }

    @objc public func requestPushAuthorization(resolve: @escaping (Any?) -> Void) {
        Task { resolve(await pf.requestPushAuthorization()) }
    }

    /// A silent push in the background: `newData`, `noData` or `failed`, or null when it is not pingfront's.
    @objc public func handleBackgroundPush(_ payload: [String: Any], resolve: @escaping (Any?) -> Void) {
        let userInfo = payload.reduce(into: [AnyHashable: Any]()) { $0[$1.key] = $1.value }
        Task {
            let result = await pf.handleBackgroundPush(userInfo: userInfo)
            switch result {
            case .newData: resolve("newData")
            case .noData: resolve("noData")
            case .failed: resolve("failed")
            case nil: resolve(nil)
            @unknown default: resolve("noData")
            }
        }
    }

    @objc public func usesAppBadge() -> Bool { pf.usesAppBadge }

    // MARK: Team actions

    @objc public func setTeamActionsEnabled(_ enabled: Bool) {
        teamActionTask?.cancel()
        teamActionTask = nil
        guard enabled else { return }
        // Unanswered actions are replayed to every new stream, so turning it off and on again loses nothing.
        let actions = pf.teamActions
        teamActionTask = Task { [weak self] in
            for await action in actions {
                guard let self else { return }
                self.teamActions[action.id] = action
                self.emit("onTeamAction", Self.encode(action))
            }
        }
    }

    @objc public func completeTeamAction(_ id: String, resolve: @escaping (Any?) -> Void) {
        guard let action = teamActions.removeValue(forKey: id) else { return resolve(nil) }
        Task {
            await action.complete()
            resolve(nil)
        }
    }

    @objc public func failTeamAction(_ id: String, message: String, resolve: @escaping (Any?) -> Void) {
        guard let action = teamActions.removeValue(forKey: id) else { return resolve(nil) }
        Task {
            await action.fail(message: message)
            resolve(nil)
        }
    }

    private static func encode(_ action: TeamAction) -> [String: Any] {
        var value: [String: Any] = [
            "id": action.id, "actionId": action.actionId, "name": action.name, "fields": action.fields,
            "ackRequired": action.ackRequired, "createdAt": action.createdAt.formatted(.iso8601),
            "expiresAt": action.expiresAt.formatted(.iso8601),
        ]
        if let days = action.days { value["days"] = days }
        if let until = action.until { value["until"] = until.formatted(.iso8601) }
        return value
    }

    // MARK: Conversation (build your own UI)

    private var conversation: Conversation { pf.conversation }

    @objc public func setConversationObserved(_ observed: Bool) {
        conversationObserved = observed
        sentMessages = nil
        sentPending = nil
        if observed { emitConversation() }
    }

    private func emitConversation() {
        guard conversationObserved else { return }
        // Messages and pending sends cross only when they changed: typing, phase and read updates stay small.
        let c = conversation
        let messages = c.messages != sentMessages
        let pending = c.pending != sentPending
        sentMessages = c.messages
        sentPending = c.pending
        emit("onConversation", conversationState(messages: messages, pending: pending))
        trackConversation()
    }

    private func trackConversation() {
        guard !conversationTracking else { return }
        conversationTracking = true
        withObservationTracking {
            // Reads what the state is made of (registering it) without serializing the thread.
            let c = conversation
            _ = (c.phase, c.messages, c.pending, c.hasOlder, c.isLoadingOlder, c.typing)
            _ = (c.replyExpectation, c.policy, c.status, c.teamReadSeq, c.isOffline, c.isServerUnreachable)
        } onChange: { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                self.conversationTracking = false
                self.emitConversation()
            }
        }
    }

    private func conversationState(messages includeMessages: Bool, pending includePending: Bool) -> [String: Any] {
        let c = conversation
        let phase: String =
            switch c.phase {
            case .idle: "idle"
            case .loading: "loading"
            case .ready: "ready"
            case .failed: "failed"
            @unknown default: "idle"
            }
        let pending: [[String: Any]] = (includePending ? c.pending : []).map { message in
            var value: [String: Any] = [
                "clientId": message.clientId, "photoCount": message.photos.count, "state": message.state.rawValue,
            ]
            if let text = message.text { value["text"] = text }
            if let failure = message.failure { value["failure"] = failure }
            value["heldFor"] = message.heldFor?.code ?? NSNull()
            return value
        }
        let policy: String =
            switch c.policy {
            case .open: "open"
            case .closed(let reason): reason.rawValue
            @unknown default: c.policy.canSend ? "open" : "unknown"
            }
        var state: [String: Any] = [
            "phase": phase,
            "hasOlder": c.hasOlder,
            "isLoadingOlder": c.isLoadingOlder,
            "typing": c.typing.map { typing -> [String: Any] in
                var value: [String: Any] = ["isAI": typing.isAI]
                if let name = typing.name { value["name"] = name }
                return value
            } ?? NSNull(),
            "replyExpectation": c.replyExpectation ?? NSNull(),
            "policy": policy,
            "status": c.status.rawValue,
            "teamReadSeq": c.teamReadSeq,
            "isOffline": c.isOffline,
            "isServerUnreachable": c.isServerUnreachable,
        ]
        if includeMessages { state["messages"] = c.messages.compactMap { Wire.encode($0) } }
        if includePending { state["pending"] = pending }
        return state
    }

    @objc public func conversationSend(_ text: String) { conversation.send(text: text) }

    @objc public func conversationRetry(_ clientId: String) {
        if let message = conversation.pending.first(where: { $0.clientId == clientId }) { conversation.retry(message) }
    }

    @objc public func conversationDiscard(_ clientId: String) {
        if let message = conversation.pending.first(where: { $0.clientId == clientId }) { conversation.discard(message) }
    }

    @objc public func conversationLoadOlder() { conversation.loadOlder() }

    /// Resolves when the reload has finished: loaded, or failed (the phase says why when there is nothing to show).
    @objc public func conversationReload(resolve: @escaping (Any?) -> Void) {
        Task {
            await conversation.reload()
            resolve(nil)
        }
    }

    @objc public func conversationMarkRead() { conversation.markRead() }

    @objc public func conversationSetTyping(_ typing: Bool) { conversation.setTyping(typing) }

    private func card(_ messageId: String, _ cardId: String) -> (Card, Message)? {
        guard let message = conversation.messages.first(where: { $0.id == messageId }) else { return nil }
        for part in message.parts {
            if case .card(let cardPart) = part, cardPart.card.id == cardId { return (cardPart.card, message) }
        }
        return nil
    }

    @objc public func conversationOpenCard(_ messageId: String, cardId: String) {
        guard let (card, message) = card(messageId, cardId) else { return }
        conversation.open(card, in: message)
    }

    @objc public func conversationChoose(_ messageId: String, cardId: String, optionId: String) {
        guard let (card, message) = card(messageId, cardId), case .choices(let choices) = card,
            let option = choices.options.first(where: { $0.id == optionId })
        else { return }
        conversation.choose(option, on: choices, in: message)
    }

    @objc public func conversationRate(_ messageId: String, cardId: String, rating: Double) {
        // `Int(_:)` traps on NaN, infinities and values out of range: refuse those, clamp the rest.
        guard rating.isFinite else { return }
        guard let (card, message) = card(messageId, cardId), case .rating(let ratingCard) = card else { return }
        let value = Int(min(max(rating.rounded(), 1), 100))
        conversation.rate(value, on: ratingCard, in: message)
    }

    // MARK: State and events

    @objc public func snapshot() -> [String: Any] { state() }

    private func state() -> [String: Any] {
        [
            "isConfigured": pf.isConfigured,
            "unreadCount": pf.unreadCount,
            "person": pf.person.flatMap { Wire.encode($0) } ?? NSNull(),
            "isChatVisible": pf.isChatVisible,
            "isTestDevice": pf.isTestDevice,
            "configurationProblem": pf.configurationProblem.map(Self.encode) ?? NSNull(),
            "storeAccountToken": pf.storeAccountToken?.uuidString.lowercased() ?? NSNull(),
            "language": pf.language ?? NSNull(),
            "look": pf.isConfigured ? Self.encode(pf.look) : NSNull(),
        ]
    }

    private static func encode(_ look: ResolvedLook) -> [String: Any] {
        func color(_ value: PingFrontColor) -> [String: String] { ["light": value.light.hex, "dark": value.dark.hex] }
        return [
            "appName": look.appName,
            "accent": color(look.accent), "onAccent": color(look.onAccent), "background": color(look.background),
            "teamBubble": color(look.teamBubble), "text": color(look.text), "muted": color(look.muted),
            "scheme": look.scheme.rawValue, "font": look.font.rawValue, "corners": look.corners.rawValue,
            "density": look.density.rawValue, "headerStyle": look.headerStyle.rawValue,
            "topics": look.topics.map(\.id),
        ]
    }

    /// Emits the fields that changed since the last emit, then waits for the next change.
    private func emitState(force: Bool) {
        let current = state()
        var changed: [String: Any] = [:]
        for (key, value) in current where force || !Self.same(lastState[key], value) { changed[key] = value }
        lastState = current
        if !changed.isEmpty { emit("onState", changed) }
        observe()
    }

    private func observe() {
        guard !observing else { return }
        observing = true
        withObservationTracking {
            _ = state()
        } onChange: { [weak self] in
            // onChange runs before the new value is stored: read it on the next main-actor turn.
            Task { @MainActor in
                guard let self else { return }
                self.observing = false
                self.emitState(force: false)
            }
        }
    }

    private static func same(_ a: Any?, _ b: Any) -> Bool {
        guard let a else { return false }
        return (a as AnyObject).isEqual(b as AnyObject)
    }

    private func startStreaming() {
        eventTask?.cancel()
        let events = pf.events
        eventTask = Task { [weak self] in
            for await event in events {
                guard let self else { return }
                self.emit("onEvent", Self.encode(event))
            }
        }
    }

    // MARK: Self-check

    /// The native SDK's setup check: sends "Setup check from <app>" and resolves with its one line.
    @objc public func selfCheck(resolve: @escaping (Any?) -> Void) {
        Task {
            resolve(await pf.selfCheck().line)
        }
    }

    // MARK: Encoding

    public typealias Reject = (String?, String?, (any Error)?) -> Void

    private static func reject(_ error: PingFrontError, _ reject: Reject) {
        let (code, message) = describe(error)
        var info: [String: Any] = [:]
        if case .server(let server) = error { info["serverCode"] = server.code.rawValue }
        reject(code, message, NSError(domain: "pingfront", code: 0, userInfo: info))
    }

    static func describe(_ error: PingFrontError) -> (String, String) {
        let message = error.errorDescription ?? String(describing: error)
        switch error {
        case .cancelled: return ("cancelled", message)
        case .coolingDown: return ("cooling_down", message)
        case .invalidInput: return ("invalid_input", message)
        case .invalidKey: return ("key_invalid", message)
        case .invalidResponse: return ("invalid_response", message)
        case .network: return ("network", message)
        case .notConfigured: return ("not_configured", message)
        case .protectedDataUnavailable: return ("protected_data_unavailable", message)
        case .server(let server):
            switch server.code.rawValue {
            case "invalid_app_key": return ("key_unknown", message)
            case "app_paused": return ("app_paused", message)
            case "blocked": return ("blocked", message)
            default: return ("server", message)
            }
        @unknown default: return ("unexpected", message)
        }
    }

    private static func code(for problem: ConfigurationProblem) -> String {
        switch problem.kind {
        case .invalidKey: "key_invalid"
        case .missingKey: "missing_key"
        case .unknownKey: "key_unknown"
        case .appPaused: "app_paused"
        case .option: "option"
        case .keychain: "keychain"
        case .offerHandler: "offer_handler"
        @unknown default: "unexpected"
        }
    }

    private static func encode(_ problem: ConfigurationProblem) -> [String: Any] {
        let kind = code(for: problem).replacingOccurrences(of: "key_invalid", with: "invalid_key")
            .replacingOccurrences(of: "key_unknown", with: "unknown_key")
        return ["kind": kind, "message": problem.message, "disablesSDK": problem.disablesSDK]
    }

    private static func identity(_ problem: IdentityProblem) -> String {
        switch problem {
        case .tokenExpired: "token_expired"
        case .tokenInvalid: "token_invalid"
        case .userMismatch: "user_mismatch"
        case .unknown: "unknown"
        @unknown default: "unknown"
        }
    }

    static func encode(_ request: OfferRequest) -> [String: Any] {
        var value: [String: Any] = ["offerId": request.offerId, "cardId": request.cardId, "messageId": request.messageId]
        if let slot = request.slot, let encoded = Wire.encode(slot) { value["slot"] = encoded }
        if let offer = request.storeOffer, let encoded = Wire.encode(offer) { value["storeOffer"] = encoded }
        return value
    }

    private static func encode(_ outcome: OfferOutcome) -> [String: Any] {
        switch outcome {
        case .purchased: return ["type": "purchased"]
        case .pending: return ["type": "pending"]
        case .cancelled: return ["type": "cancelled"]
        case .unavailable: return ["type": "unavailable"]
        case .failed(let error):
            let reason: String =
                switch error {
                case .network: "network"
                case .notAllowed: "not_allowed"
                case .notVerified: "not_verified"
                case .productNotFound: "product_not_found"
                case .store: "store_error"
                @unknown default: "store_error"
                }
            return ["type": "failed", "reason": reason]
        @unknown default: return ["type": "unknown"]
        }
    }

    private static func encode(_ result: MomentResult) -> [String: Any] {
        switch result {
        case .delivered: return ["type": "delivered"]
        case .scheduled: return ["type": "scheduled"]
        case .heldOut: return ["type": "heldOut"]
        case .ignored: return ["type": "ignored"]
        case .invalidName: return ["type": "invalidName"]
        case .notListened: return ["type": "notListened"]
        case .openRequested(let presented): return ["type": "openRequested", "presented": presented]
        case .failed(let error):
            let (code, message) = describe(error)
            return ["type": "failed", "error": ["code": code, "message": message]]
        @unknown default: return ["type": "unknown"]
        }
    }

    static func encode(_ event: PingFrontEvent) -> [String: Any] {
        switch event {
        case .chatOpened: return ["type": "chatOpened"]
        case .chatClosed: return ["type": "chatClosed"]
        case .reportSent: return ["type": "reportSent"]
        case .sessionRevoked: return ["type": "sessionRevoked"]
        case .unreadChanged(let count): return ["type": "unreadChanged", "count": count]
        case .messageReceived(let message):
            var value: [String: Any] = [
                "id": message.id, "preview": message.preview, "isPing": message.isPing, "isAI": message.isAI,
            ]
            if let author = message.authorName { value["authorName"] = author }
            return ["type": "messageReceived", "message": value]
        case .sessionStarted(let person):
            return ["type": "sessionStarted", "person": Wire.encode(person) ?? [:]]
        case .identityProblem(let problem):
            return ["type": "identityProblem", "problem": identity(problem)]
        case .offerRequested(let request):
            return ["type": "offerRequested", "request": encode(request)]
        case .offerCompleted(let request, let outcome):
            return ["type": "offerCompleted", "request": encode(request), "outcome": encode(outcome)]
        case .lookChanged(let revision, let draft):
            return ["type": "lookChanged", "revision": revision, "draft": draft]
        case .configurationProblem(let problem):
            return ["type": "configurationProblem", "problem": encode(problem)]
        case .messageSent(let message):
            return [
                "type": "messageSent",
                "message": [
                    "id": message.id, "textLength": message.textLength, "photoCount": message.photoCount,
                    "repliesToPing": message.repliesToPing,
                ],
            ]
        case .cardOpened(let card):
            return [
                "type": "cardOpened",
                "card": ["kind": card.kind.rawValue, "cardId": card.cardId, "messageId": card.messageId],
            ]
        @unknown default:
            return ["type": "unknown", "name": String(describing: event)]
        }
    }
}

/// Requests waiting for JavaScript's answer, by request id.
///
/// An entry lives only while its task waits: an answer, a cancelled wait (the SDK's cap, a newer tap) or
/// ``finishAll()`` resumes it and drops it, so no continuation leaks and a late answer finds nothing.
@MainActor
final class PendingAnswers {
    private var waiting: [String: CheckedContinuation<Bool, Never>] = [:]

    /// Registers `requestId`, calls `send`, and waits for ``answer(_:_:)``; false when the task is cancelled first.
    func wait(for requestId: String, send: () -> Void) async -> Bool {
        await withTaskCancellationHandler {
            await withCheckedContinuation { (continuation: CheckedContinuation<Bool, Never>) in
                guard !Task.isCancelled else { return continuation.resume(returning: false) }
                waiting[requestId] = continuation
                send()
            }
        } onCancel: {
            Task { @MainActor [weak self] in self?.answer(requestId, false) }
        }
    }

    /// Resumes the request's wait with `value`. Unknown or late ids do nothing.
    func answer(_ requestId: String, _ value: Bool) {
        waiting.removeValue(forKey: requestId)?.resume(returning: value)
    }

    /// Answers every waiting request with false (the handler went away, or the bridge did).
    func finishAll() {
        let all = waiting.values
        waiting = [:]
        for continuation in all { continuation.resume(returning: false) }
    }
}

/// JSON in the wire format (camelCase, ISO-8601 dates), through the SDK's own `Codable` models.
enum Wire {
    static func decode<T: Decodable>(_ type: T.Type, from value: [String: Any]) -> T? {
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value)
        else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let text = try container.decode(String.self)
            if let date = try? Date(text, strategy: Date.ISO8601FormatStyle(includingFractionalSeconds: true)) { return date }
            if let date = try? Date(text, strategy: .iso8601) { return date }
            throw DecodingError.dataCorruptedError(in: container, debugDescription: "Not an ISO-8601 date")
        }
        return try? decoder.decode(type, from: data)
    }

    static func encode(_ value: some Encodable) -> [String: Any]? {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(date.formatted(.iso8601))
        }
        guard let data = try? encoder.encode(value) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
    }
}

extension Data {
    /// Bytes from a hex string (an APNs device token as JavaScript libraries report it).
    init?(hex: String) {
        let clean = hex.filter { !$0.isWhitespace && $0 != "<" && $0 != ">" }
        guard clean.count.isMultiple(of: 2), !clean.isEmpty else { return nil }
        var bytes = [UInt8]()
        bytes.reserveCapacity(clean.count / 2)
        var index = clean.startIndex
        while index < clean.endIndex {
            let next = clean.index(index, offsetBy: 2)
            guard let byte = UInt8(clean[index..<next], radix: 16) else { return nil }
            bytes.append(byte)
            index = next
        }
        self.init(bytes)
    }
}
