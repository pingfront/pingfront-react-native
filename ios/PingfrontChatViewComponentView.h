#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// The Fabric component view of `<PingfrontChatView />`. It forwards props to the Swift host
/// (PingfrontChatHostView.swift), which embeds the SDK's SwiftUI chat.
@interface PingfrontChatViewComponentView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END
