require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

# The native iOS SDK is a Swift package, resolved from github.com/pingfront/pingfront-ios. A checkout of
# it in an `ios` folder next to this package is used instead, so a local build can run against an
# unreleased SDK. PINGFRONT_IOS_SDK overrides both (a path or a git URL).
local_sdk = File.expand_path("../ios", __dir__)
ios_sdk = ENV["PINGFRONT_IOS_SDK"] || (File.exist?(File.join(local_sdk, "Package.swift")) ? local_sdk : "https://github.com/pingfront/pingfront-ios")

Pod::Spec.new do |s|
  s.name         = "PingfrontReactNative"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => "17.0" }
  s.source       = { :git => "https://github.com/pingfront/pingfront-react-native.git", :tag => s.version.to_s }

  s.source_files = "ios/**/*.{h,m,mm,swift}"
  s.private_header_files = "ios/**/*.h"
  s.swift_version = "6.0"

  install_modules_dependencies(s)

  if File.exist?(ios_sdk)
    spm_dependency(s, url: ios_sdk, requirement: {}, products: ["PingFront"])
  else
    spm_dependency(s, url: ios_sdk, requirement: { kind: "upToNextMajorVersion", minimumVersion: "1.0.0" }, products: ["PingFront"])
  end
end
