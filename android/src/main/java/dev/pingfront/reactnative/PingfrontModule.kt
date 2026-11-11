package dev.pingfront.reactnative

import androidx.core.net.toUri
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReadableArray
import com.facebook.react.bridge.ReadableMap
import com.facebook.react.bridge.ReadableType
import com.facebook.react.bridge.WritableArray
import com.facebook.react.bridge.WritableMap
import dev.pingfront.ConfigurationProblem
import dev.pingfront.IdentityToken
import dev.pingfront.LogEntry
import dev.pingfront.LogHandler
import dev.pingfront.MomentResult
import dev.pingfront.OfferOutcome
import dev.pingfront.OfferRequest
import dev.pingfront.PingFront
import dev.pingfront.PingFrontEvent
import dev.pingfront.PingFrontException
import dev.pingfront.PingFrontModule
import dev.pingfront.TeamAction
import dev.pingfront.conversation.ConversationPhase
import dev.pingfront.conversation.ConversationState
import dev.pingfront.look.ChatAppearance
import dev.pingfront.look.ResolvedLook
import dev.pingfront.model.Card
import dev.pingfront.model.Message
import dev.pingfront.model.MessagePart
import dev.pingfront.model.SendPolicy
import dev.pingfront.model.ThreadStatus
import dev.pingfront.look.ChatTopic
import dev.pingfront.model.ColorScheme
import dev.pingfront.model.Corners
import dev.pingfront.model.Density
import dev.pingfront.model.Entitlement
import dev.pingfront.model.FontStyle
import dev.pingfront.model.HeaderStyle
import dev.pingfront.model.IdentityProblem
import dev.pingfront.model.LocalizedText
import dev.pingfront.model.OfferSlot
import dev.pingfront.model.PersonSummary
import dev.pingfront.model.PingFrontColor
import dev.pingfront.model.StoreOffer
import dev.pingfront.model.Timestamps
import dev.pingfront.model.TopicSymbol
import dev.pingfront.reports.Reports
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull

/**
 * The pingfront Turbo Module on Android: maps JavaScript values to the pingfront Android SDK and back.
 *
 * It owns no product state (the SDK does: sessions, Keystore, outbox, the chat). It forwards calls,
 * collects `PingFront.events` and the SDK's `StateFlow`s for the hooks, and runs suspend calls in a
 * scope it cancels when the React instance goes away.
 */
class PingfrontModule(reactContext: ReactApplicationContext) : NativePingfrontSpec(reactContext) {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
  private var collectors: Job? = null
  private var configured = false
  private var teamActionJob: Job? = null
  private var conversationJob: Job? = null

  /** Team actions delivered to JavaScript and not answered yet, by run id. */
  private val teamActions = java.util.concurrent.ConcurrentHashMap<String, TeamAction>()

  /** Screen link taps waiting for JavaScript's answer (`answerScreen`), by request id. */
  private val screenAnswers = java.util.concurrent.ConcurrentHashMap<String, kotlinx.coroutines.CompletableDeferred<Boolean>>()

  /** Chat links waiting for JavaScript's answer (`answerLink`), by request id. */
  private val linkAnswers = java.util.concurrent.ConcurrentHashMap<String, kotlinx.coroutines.CompletableDeferred<Boolean>>()

  override fun invalidate() {
    // The SDK keeps the configured log handler for the process; it must not keep this module alive.
    logSink.module = null
    teamActions.clear()
    PingFront.onOffer = null
    PingFront.onLink = null
    PingFront.onScreen = null
    screenAnswers.values.forEach { it.complete(false) }
    screenAnswers.clear()
    linkAnswers.values.forEach { it.complete(false) }
    linkAnswers.clear()
    scope.cancel()
    super.invalidate()
  }

  // Configure

  override fun configure(appKey: String?, options: ReadableMap) {
    val modules = options.map("modules")
    PingFront.configure(reactApplicationContext.applicationContext, appKey) {
      options.string("baseUrl")?.let { baseUrl = it }
      options.string("logLevel")?.let { level ->
        dev.pingfront.LogLevel.entries.firstOrNull { it.name.equals(level, ignoreCase = true) }?.let { logLevel = it }
      }
      options.string("language")?.let { language = it }
      // Called on any thread with a line the SDK already redacted; the Codegen emitter is thread-safe.
      if (options.bool("logHandler") == true) logHandler = logSink
      if (options.hasKey("presentsChatForMoments") && !options.isNull("presentsChatForMoments")) {
        presentsChatForMoments = options.getBoolean("presentsChatForMoments")
      }
      options.array("topics")?.let { list -> topics(list.maps().mapNotNull(::topic)) }
      options.map("look")?.let { look -> appearance { apply(look, this) } }
      val wanted = modules?.let(::modules).orEmpty()
      if (wanted.isNotEmpty()) use(*wanted.toTypedArray())
      // PF-Wrapper: the JS layer always passes {name: 'react-native', version}.
      options.map("wrapper")?.let { w ->
        val name = w.string("name")
        val version = w.string("version")
        @OptIn(dev.pingfront.InternalPingFrontApi::class)
        if (name != null && version != null) wrapper(name, version)
      }
    }
    configured = true
    startCollecting()
  }

  /** What the SDK holds as its log handler: a reference to this module that `invalidate()` clears (iOS: WeakBridge). */
  private class LogSink(@Volatile var module: PingfrontModule?) : LogHandler {
    override fun log(entry: LogEntry) {
      module?.emitLog(entry)
    }
  }

  private val logSink = LogSink(this)

  private fun emitLog(entry: LogEntry) {
    emitOnLog(
      Arguments.createMap().apply {
        putString("level", entry.level.name.lowercase())
        putString("message", entry.message)
        putString("category", entry.category)
      },
    )
  }

  private fun modules(options: ReadableMap): List<PingFrontModule> {
    val list = mutableListOf<PingFrontModule>()
    if (options.bool("push") == true) optional("dev.pingfront.push.Push", "pingfront.push")?.let(list::add)
    options.map("billing")?.let { billing ->
      val products = billing.array("products")?.strings().orEmpty()
      optional("dev.pingfront.billing.Billing", "pingfront.billing", products)?.let(list::add)
    }
    options.map("reports")?.let { reports ->
      list += Reports(shake = reports.bool("shakeToReport") != false, logTail = reports.bool("logTail") != false)
    }
    options.array("vendors")?.strings()?.forEach { id ->
      val module = PingfrontReactNative.registered(id)
      if (module != null) list += module else PingfrontReactNative.missingVendor(id)
    }
    return list
  }

  /** Push and Billing are separate artifacts (Firebase, Play Billing): load them only when the app added them. */
  private fun optional(className: String, property: String, products: List<String>? = null): PingFrontModule? = try {
    val instance = Class.forName(className).getField("INSTANCE").get(null)
    if (products.isNullOrEmpty()) {
      instance as PingFrontModule
    } else {
      instance.javaClass.getMethod("invoke", List::class.java).invoke(instance, products) as PingFrontModule
    }
  } catch (_: ReflectiveOperationException) {
    Log.e(TAG, "modules: $className is not in this build. Set $property=true in android/gradle.properties (or the Expo plugin option) and rebuild.")
    null
  }

  private fun text(value: Any?): LocalizedText? = when (value) {
    is String -> LocalizedText.of(value)
    is Map<*, *> -> LocalizedText(value.entries.associate { it.key.toString() to it.value.toString() })
    else -> null
  }

  private fun topic(value: ReadableMap): ChatTopic? {
    val id = value.string("id") ?: return null
    if (!value.hasKey("label") || value.isNull("label")) {
      return PRESETS[id] ?: ChatTopic(id, null as LocalizedText?, TopicSymbol.Other)
    }
    val all = value.toHashMap()
    val symbol = TopicSymbol.entries.firstOrNull { it.name.equals(value.string("symbol"), ignoreCase = true) } ?: TopicSymbol.Other
    return ChatTopic(id, text(all["label"]), symbol, text(all["prefill"]))
  }

  private fun color(value: ReadableMap?): PingFrontColor? {
    val light = value?.string("light") ?: return null
    return PingFrontColor(light, value.string("dark") ?: light)
  }

  private inline fun <reified T : Enum<T>> enumOf(value: String?): T? = value?.let { name -> enumValues<T>().firstOrNull { it.name.equals(name, ignoreCase = true) } }

  private fun apply(look: ReadableMap, appearance: ChatAppearance) {
    color(look.map("accent"))?.let { appearance.accent = it }
    color(look.map("background"))?.let { appearance.background = it }
    color(look.map("teamBubble"))?.let { appearance.teamBubble = it }
    enumOf<ColorScheme>(look.string("scheme"))?.let { appearance.scheme = it }
    enumOf<FontStyle>(look.string("font"))?.let { appearance.font = it }
    enumOf<Corners>(look.string("corners"))?.let { appearance.corners = it }
    enumOf<Density>(look.string("density"))?.let { appearance.density = it }
    enumOf<HeaderStyle>(look.string("headerStyle"))?.let { appearance.headerStyle = it }
    enumOf<Timestamps>(look.string("timestamps"))?.let { appearance.timestamps = it }
    look.string("headerMemberId")?.let { appearance.headerMemberId = it }
    look.string("headerTitle")?.let { appearance.headerTitle = it }
    look.string("replyExpectation")?.let { appearance.replyExpectation = it }
    look.string("welcomeTitle")?.let { appearance.welcomeTitle = it }
    look.string("welcomeBody")?.let { appearance.welcomeBody = it }
    look.string("composerPlaceholder")?.let { appearance.composerPlaceholder = it }
    look.string("aiName")?.let { appearance.aiName = it }
    look.bool("showsReplyExpectation")?.let { appearance.showReplyExpectation = it }
    look.bool("showsLocalTime")?.let { appearance.showLocalTime = it }
    look.bool("showsWelcomeFaces")?.let { appearance.showWelcomeFaces = it }
    look.bool("allowsPhotos")?.let { appearance.photos = it }
    look.bool("allowsReports")?.let { appearance.reports = it }
    look.bool("showsNames")?.let { appearance.showNames = it }
    look.bool("showsAvatars")?.let { appearance.showAvatars = it }
    look.bool("useDynamicColor")?.let { appearance.useDynamicColor = it }
  }

  // Language

  /** The native language override; an invalid tag is ignored and logged by the SDK, and the snapshot keeps the old one. */
  override fun setLanguage(tag: String?) {
    PingFront.language = tag
    emitOnState(Arguments.createMap().apply { putLanguage(this) })
  }

  private fun putLanguage(map: WritableMap) {
    val language = PingFront.language
    if (language != null) map.putString("language", language) else map.putNull("language")
  }

  // Identity

  override fun identify(userId: String, name: String?, email: String?) = PingFront.identify(userId, name, email)

  override fun identifyWithToken(token: String) = PingFront.identify(IdentityToken(token))

  override fun setTraits(traits: ReadableMap) {
    PingFront.setTraits(traits.toHashMap().mapNotNull { (k, v) -> (v as? String)?.let { k to it } }.toMap())
  }

  override fun setEntitlement(entitlement: ReadableMap) {
    val value = decode(Entitlement.serializer(), entitlement.toHashMap())
    if (value == null) Log.e(TAG, "setEntitlement: the entitlement is not in the wire format.") else PingFront.setEntitlement(value)
  }

  override fun logout() = PingFront.logout()

  override fun eraseMyData(promise: Promise) = run(promise) { PingFront.eraseMyData() }

  override fun prepare(promise: Promise) = run(promise) { PingFront.prepare() }

  override fun exportMyData(promise: Promise) {
    scope.launch {
      try {
        promise.resolve(PingFront.exportMyData())
      } catch (e: PingFrontException) {
        val (code, message) = describe(e)
        val info = Arguments.createMap()
        e.code?.let { info.putString("serverCode", it.raw) }
        promise.reject(code, message, e, info)
      }
    }
  }

  private fun run(promise: Promise, block: suspend () -> Unit) {
    scope.launch {
      try {
        block()
        promise.resolve(null)
      } catch (e: PingFrontException) {
        val (code, message) = describe(e)
        val info = Arguments.createMap()
        e.code?.let { info.putString("serverCode", it.raw) }
        promise.reject(code, message, e, info)
      }
    }
  }

  // Chat

  override fun openChat(topic: ReadableMap?) {
    val chosen = topic?.let(::topic)
    if (chosen != null) PingFront.openChat(chosen) else PingFront.openChat()
  }

  /**
   * Closes the SDK-presented chat (from openChat, a chat link or a notification) and resolves once it is off screen,
   * at once when none is: an embedded `<PingfrontChatView />` stays and is never waited for.
   */
  override fun closeChat(promise: Promise) {
    scope.launch {
      PingFront.closeChatAndWait()
      promise.resolve(null)
    }
  }

  override fun openReport(prefill: String?) = if (prefill != null) PingFront.openReport(prefill) else PingFront.openReport()

  /** A chat link: the native SDK decides (https://pingfront.sh/docs/chat-links). */
  override fun handleUrl(url: String, promise: Promise) {
    promise.resolve(PingFront.handle(url.toUri()))
  }

  override fun reportBug(text: String, screenshotBase64: String?, promise: Promise) {
    // Not base64 (a data: URI, say): the report goes without the screenshot, as on iOS.
    val bytes = screenshotBase64?.let {
      try {
        android.util.Base64.decode(it, android.util.Base64.DEFAULT)
      } catch (_: IllegalArgumentException) {
        Log.e(TAG, "reportBug: screenshotBase64 is not base64; the report is sent without it.")
        null
      }
    }
    run(promise) { PingFront.reportBug(text, bytes) }
  }

  // Moments and offers

  override fun moment(name: String, props: ReadableMap, promise: Promise) {
    val values = props.toHashMap().mapNotNull { (k, v) ->
      when (v) {
        is String, is Boolean, is Number -> k to v
        else -> null
      }
    }.toMap()
    scope.launch { promise.resolve(encode(PingFront.moment(name, values))) }
  }

  override fun setOffers(offers: ReadableArray) {
    val slots = offers.maps().mapNotNull { decode(OfferSlot.serializer(), it.toHashMap()) }
    if (slots.size != offers.size()) Log.e(TAG, "setOffers: ${offers.size() - slots.size} slot(s) are not valid OfferSlots.")
    PingFront.setOffers(slots)
  }

  override fun setOfferHandlerEnabled(enabled: Boolean) {
    PingFront.onOffer = if (enabled) { request -> emitOnOfferRequest(encode(request)) } else null
  }

  /**
   * Every link (the SDK already applied the link card URL rule) waits for JavaScript's answer (`answerLink`; a promise
   * there is awaited). The SDK caps the wait at 10 seconds and cancels this handler then, opens a declined link the way
   * the chat opens it, and replaces a message link still waiting when a newer one is tapped: the waiting entry is
   * dropped, so a late answer neither counts nor closes the chat. A timely `true` closes the chat when [closesChat].
   */
  override fun setLinkHandlerEnabled(enabled: Boolean, closesChat: Boolean) {
    if (!enabled) {
      PingFront.onLink = null
      linkAnswers.values.forEach { it.complete(false) }
      linkAnswers.clear()
      return
    }
    PingFront.onLink = { url ->
      val handled = askJavaScript(linkAnswers) { requestId ->
        emitOnLinkRequest(
          Arguments.createMap().apply {
            putString("requestId", requestId)
            putString("url", url)
          },
        )
      }
      if (handled && closesChat) PingFront.closeChat()
      handled
    }
  }

  override fun answerLink(requestId: String, handled: Boolean) {
    linkAnswers.remove(requestId)?.complete(handled)
  }

  /**
   * Sends a request to JavaScript with a new id and waits for its answer. The entry is dropped however the wait ends
   * (answered, or cancelled by a timeout), so a late answer finds nothing.
   */
  private suspend fun askJavaScript(
    waiting: java.util.concurrent.ConcurrentHashMap<String, kotlinx.coroutines.CompletableDeferred<Boolean>>,
    send: (String) -> Unit,
  ): Boolean {
    val requestId = java.util.UUID.randomUUID().toString()
    val answer = kotlinx.coroutines.CompletableDeferred<Boolean>()
    waiting[requestId] = answer
    return try {
      send(requestId)
      answer.await()
    } finally {
      waiting.remove(requestId)
    }
  }

  // Saved links (https://pingfront.sh/docs/offers#saved-links)

  override fun registerScreens(screens: ReadableArray) {
    val list = (0 until screens.size()).mapNotNull { index ->
      val screen = screens.getMap(index) ?: return@mapNotNull null
      val id = screen.string("id") ?: return@mapNotNull null
      dev.pingfront.AppScreen(id, screen.string("title"))
    }
    PingFront.registerScreens(list)
  }

  override fun setScreenHandlerEnabled(enabled: Boolean, closesChat: Boolean) {
    if (!enabled) {
      PingFront.onScreen = null
      screenAnswers.values.forEach { it.complete(false) }
      screenAnswers.clear()
      return
    }
    // The tap waits for JavaScript's answer (a promise there is awaited). The SDK caps the wait at 10 seconds and
    // cancels this handler then, so a late answer neither counts nor closes the chat.
    PingFront.onScreen = { screen ->
      val opened = askJavaScript(screenAnswers) { requestId ->
        emitOnScreenRequest(
          Arguments.createMap().apply {
            putString("requestId", requestId)
            putString("id", screen.id)
            putMap("params", Arguments.createMap().apply { screen.params.forEach { (key, value) -> putString(key, value) } })
          },
        )
      }
      if (opened && closesChat) PingFront.closeChat()
      opened
    }
  }

  override fun answerScreen(requestId: String, opened: Boolean) {
    screenAnswers.remove(requestId)?.complete(opened)
  }

  // Push

  override fun setPushToken(token: String?) = PingFront.setPushToken(token)

  override fun handlePush(payload: ReadableMap, opened: Boolean, promise: Promise) {
    val data = strings(payload)
    // A tap takes the SDK's own tap path: nothing opens for a person who logged out since (review AN-18).
    val ours = if (opened) PingFront.openPush(data) else PingFront.handlePush(data)
    promise.resolve(ours)
  }

  override fun isPingFrontPush(payload: ReadableMap, promise: Promise) {
    promise.resolve(PingFront.isPingFrontPush(strings(payload)))
  }

  private fun strings(payload: ReadableMap): Map<String, String> = payload.toHashMap().mapNotNull { (k, v) -> v?.let { k to it.toString() } }.toMap()

  /** Android has no separate background path: a pingfront payload is handled as a received push. */
  override fun handleBackgroundPush(payload: ReadableMap, promise: Promise) {
    val data = strings(payload)
    promise.resolve(if (PingFront.handlePush(data)) "noData" else null)
  }

  /** True when the dashboard turned on the launcher badge (`features.appBadge`). */
  override fun usesAppBadge(promise: Promise) {
    promise.resolve(PingFront.usesAppBadge)
  }

  // Team actions

  override fun setTeamActionsEnabled(enabled: Boolean) {
    teamActionJob?.cancel()
    teamActionJob = null
    if (!enabled) return
    // Unanswered actions are replayed to every new collector, so turning it off and on again loses nothing.
    teamActionJob = scope.launch {
      PingFront.teamActions.collect { action ->
        teamActions[action.id] = action
        emitOnTeamAction(encode(action))
      }
    }
  }

  override fun completeTeamAction(actionRunId: String, promise: Promise) {
    teamActions.remove(actionRunId)?.complete()
    promise.resolve(null)
  }

  override fun failTeamAction(actionRunId: String, message: String, promise: Promise) {
    teamActions.remove(actionRunId)?.fail(message)
    promise.resolve(null)
  }

  private fun encode(action: TeamAction): WritableMap = Arguments.createMap().apply {
    putString("id", action.id)
    putString("actionId", action.actionId)
    putString("name", action.name)
    putMap("fields", Arguments.createMap().apply { action.fields.forEach { (k, v) -> putString(k, v) } })
    action.days?.let { putInt("days", it) }
    action.until?.let { putString("until", it.toString()) }
    putBoolean("ackRequired", action.ackRequired)
    putString("createdAt", action.createdAt.toString())
    putString("expiresAt", action.expiresAt.toString())
  }

  // Conversation (build your own UI)

  private val conversation get() = PingFront.conversation

  override fun setConversationObserved(enabled: Boolean) {
    conversationJob?.cancel()
    conversationJob = null
    if (!enabled) return
    conversationJob = scope.launch {
      // Messages and pending sends cross only when they changed: typing, phase and read updates stay small.
      var lastMessages: List<Message>? = null
      var lastPending: List<dev.pingfront.conversation.PendingMessage>? = null
      conversation.state.collect { state ->
        emitOnConversation(encode(state, messages = state.messages != lastMessages, pending = state.pending != lastPending))
        lastMessages = state.messages
        lastPending = state.pending
      }
    }
  }

  override fun conversationSend(text: String) = conversation.send(text)

  override fun conversationRetry(clientId: String) {
    conversation.state.value.pending.firstOrNull { it.clientId == clientId }?.let(conversation::retry)
  }

  override fun conversationDiscard(clientId: String) {
    conversation.state.value.pending.firstOrNull { it.clientId == clientId }?.let(conversation::discard)
  }

  override fun conversationLoadOlder() = conversation.loadOlder()

  /** Resolves when the reload has finished: loaded, or failed (the phase says why when there is nothing to show). */
  override fun conversationReload(promise: Promise) {
    scope.launch {
      conversation.reload()
      promise.resolve(null)
    }
  }

  override fun conversationMarkRead() = conversation.markRead()

  override fun conversationSetTyping(typing: Boolean) = conversation.setTyping(typing)

  private fun card(messageId: String, cardId: String): Pair<Card, Message>? {
    val message = conversation.state.value.messages.firstOrNull { it.id == messageId } ?: return null
    val card = message.parts.filterIsInstance<MessagePart.CardPart>().firstOrNull { it.card.id == cardId }?.card ?: return null
    return card to message
  }

  override fun conversationOpenCard(messageId: String, cardId: String) {
    val (card, message) = card(messageId, cardId) ?: return
    conversation.open(card, message)
  }

  override fun conversationChoose(messageId: String, cardId: String, optionId: String) {
    val (card, message) = card(messageId, cardId) ?: return
    val choices = card as? Card.Choices ?: return
    val option = choices.options.firstOrNull { it.id == optionId } ?: return
    conversation.choose(option, choices, message)
  }

  override fun conversationRate(messageId: String, cardId: String, rating: Double) {
    val (card, message) = card(messageId, cardId) ?: return
    val ratingCard = card as? Card.Rating ?: return
    // As on iOS: NaN and infinities are refused, the rest clamped before the conversion.
    if (!rating.isFinite()) return
    conversation.rate(kotlin.math.round(rating.coerceIn(1.0, 100.0)).toInt(), ratingCard, message)
  }

  private fun putPending(map: WritableMap, state: ConversationState) {
    map.putArray(
      "pending",
      Arguments.createArray().apply {
        state.pending.forEach { message ->
          pushMap(
            Arguments.createMap().apply {
              putString("clientId", message.clientId)
              message.text?.let { putString("text", it) }
              putInt("photoCount", message.photos.size)
              putString("state", message.state.name.lowercase())
              message.failure?.let { putString("failure", it) }
              // The hold reason's wire code, or null.
              val held = message.heldFor?.code
              if (held != null) putString("heldFor", held) else putNull("heldFor")
            },
          )
        }
      },
    )
  }

  private fun encode(state: ConversationState, messages: Boolean, pending: Boolean): WritableMap = Arguments.createMap().apply {
    putString(
      "phase",
      when (state.phase) {
        ConversationPhase.Idle -> "idle"
        ConversationPhase.Loading -> "loading"
        ConversationPhase.Ready -> "ready"
        is ConversationPhase.Failed -> "failed"
      },
    )
    if (messages) {
      putArray(
        "messages",
        Arguments.createArray().apply {
          state.messages.forEach { pushMap(toWritable(json.encodeToJsonElement(Message.serializer(), it))) }
        },
      )
    }
    if (pending) putPending(this, state)
    putBoolean("hasOlder", state.hasOlder)
    putBoolean("isLoadingOlder", state.isLoadingOlder)
    val typing = state.typing
    if (typing == null) {
      putNull("typing")
    } else {
      putMap(
        "typing",
        Arguments.createMap().apply {
          typing.name?.let { putString("name", it) }
          putBoolean("isAI", typing.isAi)
        },
      )
    }
    val reply = state.replyExpectation
    if (reply != null) putString("replyExpectation", reply) else putNull("replyExpectation")
    putString(
      "policy",
      when (val policy = state.policy) {
        SendPolicy.Open -> "open"
        is SendPolicy.Closed -> policy.reason.code
      },
    )
    putString(
      "status",
      when (state.status) {
        ThreadStatus.Open -> "open"
        ThreadStatus.Resolved -> "resolved"
        // As on iOS, a status this SDK doesn't know reads as open.
        ThreadStatus.Unknown -> "open"
      },
    )
    putInt("teamReadSeq", state.teamReadSeq)
    putBoolean("isOffline", state.isOffline)
    putBoolean("isServerUnreachable", state.isServerUnreachable)
  }

  /** Android 13+ needs POST_NOTIFICATIONS; the JavaScript side asks for it with PermissionsAndroid. */
  override fun requestPushAuthorization(promise: Promise) {
    promise.resolve(true)
  }

  // State and events

  override fun getSnapshot(promise: Promise) {
    scope.launch { promise.resolve(snapshot(PingFront.storeAccountToken())) }
  }

  private fun snapshot(storeAccountToken: String?): WritableMap = Arguments.createMap().apply {
    putBoolean("isConfigured", configured && PingFront.configurationProblem.value?.disablesSdk != true)
    putInt("unreadCount", PingFront.unreadCount.value)
    putPerson(this, PingFront.person.value)
    putBoolean("isChatVisible", PingFront.isChatVisible.value)
    putBoolean("isTestDevice", PingFront.isTestDevice.value)
    val problem = PingFront.configurationProblem.value
    if (problem != null) putMap("configurationProblem", encode(problem)) else putNull("configurationProblem")
    if (storeAccountToken != null) putString("storeAccountToken", storeAccountToken) else putNull("storeAccountToken")
    putLanguage(this)
    if (configured) putMap("look", encode(PingFront.look.value)) else putNull("look")
  }

  private fun encode(look: ResolvedLook): WritableMap = Arguments.createMap().apply {
    fun color(name: String, value: dev.pingfront.model.PingFrontColor) = putMap(
      name,
      Arguments.createMap().apply {
        putString("light", value.light.hex)
        putString("dark", value.dark.hex)
      },
    )
    putString("appName", look.appName)
    color("accent", look.accent)
    color("onAccent", look.onAccent)
    color("background", look.background)
    color("teamBubble", look.teamBubble)
    color("text", look.text)
    color("muted", look.muted)
    putString("scheme", look.scheme.name.lowercase())
    putString("font", look.font.name.lowercase())
    putString("corners", look.corners.name.lowercase())
    putString("density", look.density.name.lowercase())
    putString("headerStyle", look.headerStyle.name.lowercase())
    putArray("topics", Arguments.createArray().apply { look.topics.forEach { pushString(it.id) } })
  }

  private fun putPerson(map: WritableMap, person: PersonSummary?) {
    if (person == null) map.putNull("person") else map.putMap("person", encode(person))
  }

  private fun startCollecting() {
    collectors?.cancel()
    collectors = scope.launch {
      launch {
        PingFront.events.collect { event ->
          emitOnEvent(encode(event))
        }
      }
      launch { PingFront.unreadCount.drop(1).collect { emitOnState(Arguments.createMap().apply { putInt("unreadCount", it) }) } }
      launch { PingFront.person.drop(1).collect { p -> emitOnState(Arguments.createMap().apply { putPerson(this, p) }) } }
      // The store account token is per person (a new one after logout): read it again whenever the person changes.
      launch {
        var last: String? = null
        PingFront.person.collect {
          val token = PingFront.storeAccountToken()
          if (token != last) {
            last = token
            emitOnState(Arguments.createMap().apply { if (token != null) putString("storeAccountToken", token) else putNull("storeAccountToken") })
          }
        }
      }
      launch { PingFront.look.drop(1).collect { look -> emitOnState(Arguments.createMap().apply { putMap("look", encode(look)) }) } }
      launch { PingFront.isChatVisible.drop(1).collect { emitOnState(Arguments.createMap().apply { putBoolean("isChatVisible", it) }) } }
      launch { PingFront.isTestDevice.drop(1).collect { emitOnState(Arguments.createMap().apply { putBoolean("isTestDevice", it) }) } }
      launch {
        PingFront.configurationProblem.drop(1).collect { problem ->
          emitOnState(
            Arguments.createMap().apply {
              // A problem that disables the SDK (or its fix) changes isConfigured too, as on iOS.
              putBoolean("isConfigured", configured && problem?.disablesSdk != true)
              if (problem != null) putMap("configurationProblem", encode(problem)) else putNull("configurationProblem")
            },
          )
        }
      }
      emitOnState(snapshot(PingFront.storeAccountToken()))
    }
  }

  // Self-check

  /** The native SDK's setup check: sends "Setup check from <app>" and resolves with its one line. */
  override fun selfCheck(promise: Promise) {
    scope.launch { promise.resolve(PingFront.selfCheck().line) }
  }

  // Encoding

  private fun describe(e: PingFrontException): Pair<String, String> {
    val message = e.message ?: e.javaClass.simpleName
    return when (e) {
      is PingFrontException.NotConfigured -> "not_configured" to message
      is PingFrontException.InvalidKey -> "key_invalid" to message
      is PingFrontException.Network -> "network" to message
      is PingFrontException.CoolingDown -> "cooling_down" to message
      is PingFrontException.InvalidResponse -> "invalid_response" to message
      is PingFrontException.InvalidInput -> "invalid_input" to message
      is PingFrontException.StorageUnavailable -> "storage_unavailable" to message
      is PingFrontException.SessionChanged -> "session_changed" to message
      is PingFrontException.Server -> when (e.code?.raw) {
        "invalid_app_key" -> "key_unknown" to message
        "app_paused" -> "app_paused" to message
        "blocked" -> "blocked" to message
        else -> "server" to message
      }
    }
  }

  private fun code(problem: ConfigurationProblem): String = when (problem.kind) {
    is ConfigurationProblem.Kind.InvalidKey -> "key_invalid"
    ConfigurationProblem.Kind.MissingKey -> "missing_key"
    ConfigurationProblem.Kind.UnknownKey -> "key_unknown"
    ConfigurationProblem.Kind.AppPaused -> "app_paused"
    ConfigurationProblem.Kind.Option -> "option"
  }

  private fun encode(problem: ConfigurationProblem): WritableMap = Arguments.createMap().apply {
    val kind = when (problem.kind) {
      is ConfigurationProblem.Kind.InvalidKey -> "invalid_key"
      ConfigurationProblem.Kind.UnknownKey -> "unknown_key"
      else -> code(problem)
    }
    putString("kind", kind)
    putString("message", problem.message)
    putBoolean("disablesSDK", problem.disablesSdk)
  }

  private fun identity(problem: IdentityProblem): String = when (problem) {
    IdentityProblem.TokenInvalid -> "token_invalid"
    IdentityProblem.TokenExpired -> "token_expired"
    IdentityProblem.UserMismatch -> "user_mismatch"
    else -> "unknown"
  }

  private fun encode(person: PersonSummary): WritableMap = toWritable(json.encodeToJsonElement(PersonSummary.serializer(), person))

  private fun encode(request: OfferRequest): WritableMap = Arguments.createMap().apply {
    putString("offerId", request.offerId)
    putString("cardId", request.cardId)
    putString("messageId", request.messageId)
    request.slot?.let { putMap("slot", toWritable(json.encodeToJsonElement(OfferSlot.serializer(), it))) }
    request.storeOffer?.let { putMap("storeOffer", encode(it)) }
  }

  private fun encode(offer: StoreOffer): WritableMap = Arguments.createMap().apply {
    putString("kind", offer.kind.name.lowercase())
    putString("id", offer.id)
    offer.productId?.let { putString("productId", it) }
    offer.basePlanId?.let { putString("basePlanId", it) }
    offer.offerId?.let { putString("offerId", it) }
  }

  private fun encode(outcome: OfferOutcome): WritableMap = Arguments.createMap().apply {
    when (outcome) {
      is OfferOutcome.Purchased -> putString("type", "purchased")
      is OfferOutcome.Pending -> putString("type", "pending")
      is OfferOutcome.Cancelled -> putString("type", "cancelled")
      is OfferOutcome.Unavailable -> putString("type", "unavailable")
      is OfferOutcome.Failed -> {
        putString("type", "failed")
        putString("reason", outcome.failure.code)
      }
    }
  }

  private fun encode(result: MomentResult): WritableMap = Arguments.createMap().apply {
    when (result) {
      MomentResult.Delivered -> putString("type", "delivered")
      MomentResult.Scheduled -> putString("type", "scheduled")
      MomentResult.HeldOut -> putString("type", "heldOut")
      MomentResult.Ignored -> putString("type", "ignored")
      MomentResult.InvalidName -> putString("type", "invalidName")
      MomentResult.NotListened -> putString("type", "notListened")
      is MomentResult.OpenRequested -> {
        putString("type", "openRequested")
        putBoolean("presented", result.presented)
      }
      is MomentResult.Failed -> {
        putString("type", "failed")
        val (code, message) = describe(result.error)
        putMap("error", Arguments.createMap().apply { putString("code", code); putString("message", message) })
      }
    }
  }

  // The else branch is for event types a newer SDK artifact adds at runtime (sealed across a binary
  // boundary): without it they would throw NoWhenBranchMatchedException instead of reaching JS as unknown.
  @Suppress("REDUNDANT_ELSE_IN_WHEN")
  private fun encode(event: PingFrontEvent): WritableMap = Arguments.createMap().apply {
    when (event) {
      PingFrontEvent.ChatOpened -> putString("type", "chatOpened")
      PingFrontEvent.ChatClosed -> putString("type", "chatClosed")
      PingFrontEvent.ReportSent -> putString("type", "reportSent")
      PingFrontEvent.SessionRevoked -> putString("type", "sessionRevoked")
      is PingFrontEvent.MessageSent -> {
        putString("type", "messageSent")
        putMap(
          "message",
          Arguments.createMap().apply {
            putString("id", event.message.id)
            putInt("textLength", event.message.textLength)
            putInt("photoCount", event.message.photoCount)
            putBoolean("repliesToPing", event.message.repliesToPing)
          },
        )
      }
      is PingFrontEvent.CardOpened -> {
        putString("type", "cardOpened")
        putMap(
          "card",
          Arguments.createMap().apply {
            putString("kind", event.card.kind.name)
            putString("cardId", event.card.cardId)
            putString("messageId", event.card.messageId)
          },
        )
      }
      is PingFrontEvent.UnreadChanged -> {
        putString("type", "unreadChanged")
        putInt("count", event.count)
      }
      is PingFrontEvent.MessageReceived -> {
        putString("type", "messageReceived")
        putMap(
          "message",
          Arguments.createMap().apply {
            putString("id", event.message.id)
            putString("preview", event.message.preview)
            putBoolean("isPing", event.message.isPing)
            putBoolean("isAI", event.message.isAi)
            event.message.authorName?.let { putString("authorName", it) }
          },
        )
      }
      is PingFrontEvent.SessionStarted -> {
        putString("type", "sessionStarted")
        putMap("person", encode(event.person))
      }
      is PingFrontEvent.IdentityProblemReported -> {
        putString("type", "identityProblem")
        putString("problem", identity(event.problem))
      }
      is PingFrontEvent.OfferRequested -> {
        putString("type", "offerRequested")
        putMap("request", encode(event.request))
      }
      is PingFrontEvent.OfferCompleted -> {
        putString("type", "offerCompleted")
        putMap("request", encode(event.request))
        putMap("outcome", encode(event.outcome))
      }
      is PingFrontEvent.LookChanged -> {
        putString("type", "lookChanged")
        putInt("revision", event.revision)
        putBoolean("draft", event.draft)
      }
      is PingFrontEvent.ConfigurationProblemFound -> {
        putString("type", "configurationProblem")
        putMap("problem", encode(event.problem))
      }
      // An event type from a newer SDK: JavaScript gets it as { type: 'unknown', name }.
      else -> {
        putString("type", "unknown")
        putString("name", event.javaClass.simpleName)
      }
    }
  }

  private fun <T> decode(serializer: kotlinx.serialization.KSerializer<T>, value: Map<String, Any?>): T? = try {
    json.decodeFromJsonElement(serializer, toJson(value))
  } catch (e: kotlinx.serialization.SerializationException) {
    Log.e(TAG, "Could not read a value from JavaScript (${e.javaClass.simpleName}).")
    null
  } catch (e: IllegalArgumentException) {
    Log.e(TAG, "Could not read a value from JavaScript (${e.javaClass.simpleName}).")
    null
  }

  companion object {
    const val NAME = NativePingfrontSpec.NAME
    private const val TAG = "PingfrontRN"
    private val json = Json {
      ignoreUnknownKeys = true
      explicitNulls = false
    }
    private val PRESETS = mapOf(
      "billing" to ChatTopic.Billing,
      "bug" to ChatTopic.Bug,
      "idea" to ChatTopic.Idea,
      "question" to ChatTopic.Question,
      "account" to ChatTopic.Account,
      "feedback" to ChatTopic.Feedback,
      "restore" to ChatTopic.Restore,
      "gift" to ChatTopic.Gift,
      "privacy" to ChatTopic.Privacy,
    )

    /** A topic from the JSON the embedded chat view gets (the shape `openChat` sends), mapped as `openChat` maps it. */
    internal fun topic(id: String, value: org.json.JSONObject): ChatTopic {
      if (!value.has("label") || value.isNull("label")) return PRESETS[id] ?: ChatTopic(id, null as LocalizedText?, TopicSymbol.Other)
      fun text(key: String): LocalizedText? {
        val field: Any? = value.opt(key)
        if (field is String) return LocalizedText.of(field)
        if (field !is org.json.JSONObject) return null
        val values = mutableMapOf<String, String>()
        for (language in field.keys()) values[language] = field.optString(language)
        return LocalizedText(values)
      }
      val symbol = TopicSymbol.entries.firstOrNull { it.name.equals(value.optString("symbol"), ignoreCase = true) } ?: TopicSymbol.Other
      return ChatTopic(id, text("label"), symbol, text("prefill"))
    }

    private fun toJson(value: Any?): JsonElement = when (value) {
      null -> JsonNull
      is String -> JsonPrimitive(value)
      is Boolean -> JsonPrimitive(value)
      is Double -> if (value % 1.0 == 0.0 && kotlin.math.abs(value) < 1e15) JsonPrimitive(value.toLong()) else JsonPrimitive(value)
      is Number -> JsonPrimitive(value)
      is Map<*, *> -> JsonObject(value.entries.associate { it.key.toString() to toJson(it.value) })
      is List<*> -> JsonArray(value.map(::toJson))
      else -> JsonPrimitive(value.toString())
    }

    private fun toWritable(element: JsonElement): WritableMap {
      val map = Arguments.createMap()
      (element as? JsonObject)?.forEach { (key, value) -> putValue(map, key, value) }
      return map
    }

    private fun putValue(map: WritableMap, key: String, value: JsonElement) {
      when (value) {
        is JsonNull -> map.putNull(key)
        is JsonObject -> map.putMap(key, toWritable(value))
        is JsonArray -> map.putArray(key, toWritableArray(value))
        is JsonPrimitive -> when {
          value.isString -> map.putString(key, value.content)
          value.booleanOrNull != null -> map.putBoolean(key, value.boolean)
          else -> value.doubleOrNull?.let { map.putDouble(key, it) }
        }
      }
    }

    /** Every JSON value an array can hold, nested arrays and booleans included (the same mapping as [putValue]). */
    private fun toWritableArray(array: JsonArray): WritableArray = Arguments.createArray().apply {
      array.forEach { item ->
        when (item) {
          is JsonNull -> pushNull()
          is JsonObject -> pushMap(toWritable(item))
          is JsonArray -> pushArray(toWritableArray(item))
          is JsonPrimitive -> when {
            item.isString -> pushString(item.content)
            item.booleanOrNull != null -> pushBoolean(item.boolean)
            else -> item.doubleOrNull?.let(::pushDouble) ?: pushNull()
          }
        }
      }
    }
  }
}

private fun ReadableMap.string(key: String): String? = if (hasKey(key) && getType(key) == ReadableType.String) getString(key) else null

private fun ReadableMap.bool(key: String): Boolean? = if (hasKey(key) && getType(key) == ReadableType.Boolean) getBoolean(key) else null

private fun ReadableMap.map(key: String): ReadableMap? = if (hasKey(key) && getType(key) == ReadableType.Map) getMap(key) else null

private fun ReadableMap.array(key: String): ReadableArray? = if (hasKey(key) && getType(key) == ReadableType.Array) getArray(key) else null

private fun ReadableArray.maps(): List<ReadableMap> = (0 until size()).mapNotNull { if (getType(it) == ReadableType.Map) getMap(it) else null }

private fun ReadableArray.strings(): List<String> = (0 until size()).mapNotNull { if (getType(it) == ReadableType.String) getString(it) else null }
