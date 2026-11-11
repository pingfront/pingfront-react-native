import Foundation
import PingFront
import os

/// Native-side hooks for React Native apps.
///
/// Vendor adapters (RevenueCat, Superwall, Adapty) wrap vendor SDKs, so the bridge does not link them.
/// Add the adapter product to your app, register it before JavaScript calls `configure`, and list its
/// id in `modules.vendors`:
///
/// ```swift
/// import PingFrontRevenueCat
/// import PingfrontReactNative
/// PingfrontReactNative.register(.revenueCat)   // in AppDelegate, before the React Native factory starts
/// ```
@MainActor
public enum PingfrontReactNative {
    private static var modules: [String: PingFrontModule] = [:]
    private static let log = Logger(subsystem: "dev.pingfront.react-native", category: "bridge")

    /// Makes a module available to `configure({ modules: { vendors: [id] } })` from JavaScript.
    public static func register(_ module: PingFrontModule) {
        modules[module.id] = module
    }

    static func registeredModule(id: String) -> PingFrontModule? { modules[id] }

    static func reportMissingVendor(_ id: String) {
        // A module asked for in JavaScript but never registered would otherwise do nothing, silently.
        log.fault("modules.vendors lists \(id, privacy: .public), but no module with that id was registered. Call PingfrontReactNative.register(...) in native code before configure.")
    }

    static func reportBadInput(_ message: String) {
        log.error("\(message, privacy: .public)")
    }
}
