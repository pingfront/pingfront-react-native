package dev.pingfront.reactnative

import android.util.Log
import dev.pingfront.PingFrontModule
import java.util.concurrent.ConcurrentHashMap

/**
 * Native-side hooks for React Native apps.
 *
 * Vendor adapters (RevenueCat, Superwall, Adapty) wrap vendor SDKs, so the bridge does not link them. Add
 * the adapter artifact to your app, register it in `Application.onCreate` before JavaScript calls
 * `configure`, and list its id in `modules.vendors`:
 *
 * ```kotlin
 * PingfrontReactNative.register(dev.pingfront.revenuecat.RevenueCat)
 * ```
 */
object PingfrontReactNative {
  private val modules = ConcurrentHashMap<String, PingFrontModule>()

  /** Makes a module available to `configure({ modules: { vendors: [id] } })` from JavaScript. */
  @JvmStatic
  fun register(module: PingFrontModule) {
    modules[module.id] = module
  }

  internal fun registered(id: String): PingFrontModule? = modules[id]

  internal fun missingVendor(id: String) {
    // Asked for in JavaScript but never registered: say so instead of doing nothing.
    Log.e("PingfrontRN", "modules.vendors lists $id, but no module with that id was registered. Call PingfrontReactNative.register(...) in Application.onCreate.")
  }
}
