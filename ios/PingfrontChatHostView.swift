import Foundation
import PingFront
import SwiftUI
import UIKit

/// The UIKit side of `<PingfrontChatView />`: hosts the SDK's SwiftUI `PingFrontChatView` in a
/// `UIHostingController` that is a proper child of the view controller the React view lives in.
///
/// Being a child view controller is what makes the chat behave like a native screen: the safe area, the
/// keyboard, trait changes, and `onAppear`/`onDisappear` (the SDK's "chat is visible" state, which drives live
/// updates, read receipts and the unread count) all follow the React view. The controller is added when the view
/// enters a window and removed when it leaves one, so a hidden tab or a popped screen counts as not visible.
@objc(PingfrontChatHostView)
@MainActor
public final class PingfrontChatHostView: UIView {
    private var host: UIHostingController<AnyView>?
    private var topicJSON = ""

    override public init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) { fatalError("PingfrontChatHostView is created in code") }

    /// The `topic` prop: the topic as JSON in the shape `openChat` sends, or empty for none.
    @objc public func setTopicJSON(_ json: String) {
        guard json != topicJSON else { return }
        topicJSON = json
        host?.rootView = rootView()
    }

    private func rootView() -> AnyView {
        let topic = Self.topic(from: topicJSON)
        // A new identity per topic, so a different topic inserts its prefill as a fresh presentation would.
        return AnyView(PingFrontChatView(topic: topic).id(topicJSON))
    }

    private static func topic(from json: String) -> ChatTopic? {
        guard !json.isEmpty, let data = json.data(using: .utf8),
            let value = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
        else { return nil }
        return PingfrontBridge.topic(from: value)
    }

    override public func didMoveToWindow() {
        super.didMoveToWindow()
        if window != nil { attach() } else { detach() }
    }

    private func attach() {
        let host = host ?? makeHost()
        guard host.parent == nil else { return }
        guard let parent = enclosingViewController() else {
            // No controller above us (unusual in React Native): the view still renders, without containment.
            return
        }
        parent.addChild(host)
        host.didMove(toParent: parent)
    }

    private func makeHost() -> UIHostingController<AnyView> {
        let host = UIHostingController(rootView: rootView())
        host.view.backgroundColor = .clear
        host.view.frame = bounds
        host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        addSubview(host.view)
        self.host = host
        return host
    }

    private func detach() {
        guard let host, host.parent != nil else { return }
        host.willMove(toParent: nil)
        host.removeFromParent()
    }

    private func enclosingViewController() -> UIViewController? {
        var responder: UIResponder? = next
        while let current = responder {
            if let controller = current as? UIViewController { return controller }
            responder = current.next
        }
        return nil
    }
}
