# CocoaPods helpers for apps that use @pingfront/react-native. Both fix linker warnings, not errors:
#
# - The bridge pod depends on the pingfront Swift package through React Native's `spm_dependency`. With
#   static pods, React Native builds such a pod straight into the products folder but leaves its old
#   folder in the app's library search paths, so the linker warns that the folder does not exist.
# - CocoaPods adds `${TOOLCHAIN_DIR}/usr/lib/swift/${PLATFORM_NAME}` for Swift pods. When Xcode lists
#   another toolchain first (Xcode 27 with the Metal toolchain installed), TOOLCHAIN_DIR points there and
#   the folder does not exist; `DT_TOOLCHAIN_DIR` is always Xcode's default toolchain.
#
# Call it after `react_native_post_install` in your Podfile:
#
#   require_relative '../node_modules/@pingfront/react-native/scripts/cocoapods'
#   post_install do |installer|
#     react_native_post_install(installer, config[:reactNativePath], :mac_catalyst_enabled => false)
#     pingfront_post_install(installer)
#   end
def pingfront_post_install(installer, pod_name: "PingfrontReactNative")
  stale = "\"${PODS_CONFIGURATION_BUILD_DIR}/#{pod_name}\""
  installer.aggregate_targets.each do |aggregate_target|
    aggregate_target.xcconfigs.each do |config_name, config_file|
      paths = config_file.attributes["LIBRARY_SEARCH_PATHS"]
      next unless paths

      fixed = paths.sub(stale, "")
                   .gsub("${TOOLCHAIN_DIR}/usr/lib/swift/${PLATFORM_NAME}", "${DT_TOOLCHAIN_DIR}/usr/lib/swift/${PLATFORM_NAME}")
                   .squeeze(" ").strip
      next if fixed == paths

      config_file.attributes["LIBRARY_SEARCH_PATHS"] = fixed
      config_file.save_as(aggregate_target.xcconfig_path(config_name))
    end
  end
end
