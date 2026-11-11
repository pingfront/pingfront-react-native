#import "PingfrontChatViewComponentView.h"

#import <react/renderer/components/PingfrontSpec/ComponentDescriptors.h>
#import <react/renderer/components/PingfrontSpec/Props.h>

#if __has_include(<PingfrontReactNative/PingfrontReactNative-Swift.h>)
#import <PingfrontReactNative/PingfrontReactNative-Swift.h>
#else
#import "PingfrontReactNative-Swift.h"
#endif

using namespace facebook::react;

@implementation PingfrontChatViewComponentView {
  PingfrontChatHostView *_host;
}

+ (ComponentDescriptorProvider)componentDescriptorProvider
{
  return concreteComponentDescriptorProvider<PingfrontChatViewComponentDescriptor>();
}

// A recycled view would carry a hosting controller (and the chat's state) into an unrelated mount.
+ (BOOL)shouldBeRecycled
{
  return NO;
}

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const PingfrontChatViewProps>();
    _props = defaultProps;
    _host = [[PingfrontChatHostView alloc] initWithFrame:self.bounds];
    _host.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    self.contentView = _host;
  }
  return self;
}

- (void)updateProps:(Props::Shared const &)props oldProps:(Props::Shared const &)oldProps
{
  const auto &newProps = *std::static_pointer_cast<PingfrontChatViewProps const>(props);
  NSString *topic = [NSString stringWithUTF8String:newProps.topic.c_str()] ?: @"";
  [_host setTopicJSON:topic];
  [super updateProps:props oldProps:oldProps];
}

@end
