package dev.pingfront.reactnative

import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.ViewManagerDelegate
import com.facebook.react.viewmanagers.PingfrontChatViewManagerDelegate
import com.facebook.react.viewmanagers.PingfrontChatViewManagerInterface
import dev.pingfront.look.ChatTopic
import dev.pingfront.ui.PingFrontChatView
import org.json.JSONObject

/**
 * The Fabric view manager of `<PingfrontChatView />`, from the Codegen spec in `src/specs/PingfrontChatViewNativeComponent.ts`:
 * the Android SDK's own [PingFrontChatView], which owns its composition, lifecycle and insets.
 *
 * React Native draws edge to edge and leaves the system bars and the keyboard to the app's layout, so the view keeps
 * its default insets ([PingFrontChatView.Insets.SafeDrawing]): it pads only for the part of a bar or of the keyboard
 * that overlaps it, not for the space React Native's layout already leaves around it (a header, a tab bar).
 */
@ReactModule(name = PingfrontChatViewManager.NAME)
class PingfrontChatViewManager :
  SimpleViewManager<PingFrontChatView>(),
  PingfrontChatViewManagerInterface<PingFrontChatView> {
  private val delegate = PingfrontChatViewManagerDelegate(this)

  override fun getDelegate(): ViewManagerDelegate<PingFrontChatView> = delegate

  override fun getName(): String = NAME

  override fun createViewInstance(context: ThemedReactContext): PingFrontChatView = PingFrontChatView(context)

  override fun setTopic(view: PingFrontChatView, value: String?) {
    view.topic = topic(value.orEmpty())
  }

  private fun topic(json: String): ChatTopic? {
    if (json.isEmpty()) return null
    val value = try {
      JSONObject(json)
    } catch (_: org.json.JSONException) {
      return null
    }
    val id = value.optString("id").takeIf { it.isNotEmpty() } ?: return null
    // The same mapping as `openChat({ topic })`: `{ id }` is a preset, `{ id, label, ... }` a custom topic.
    return PingfrontModule.topic(id, value)
  }

  companion object {
    const val NAME = "PingfrontChatView"
  }
}
