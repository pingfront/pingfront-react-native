#import "Pingfront.h"

#if __has_include(<PingfrontReactNative/PingfrontReactNative-Swift.h>)
#import <PingfrontReactNative/PingfrontReactNative-Swift.h>
#else
#import "PingfrontReactNative-Swift.h"
#endif

@implementation Pingfront {
  PingfrontBridge *_bridge;
}

RCT_EXPORT_MODULE(Pingfront)

// The native SDK's facade lives on the main actor: every call runs on the main queue.
- (dispatch_queue_t)methodQueue
{
  return dispatch_get_main_queue();
}

+ (BOOL)requiresMainQueueSetup
{
  return YES;
}

- (instancetype)init
{
  if (self = [super init]) {
    __weak Pingfront *weakSelf = self;
    _bridge = [[PingfrontBridge alloc] initWithEmitter:^(NSString *name, NSDictionary *value) {
      [weakSelf emit:name value:value];
    }];
  }
  return self;
}

- (void)emit:(NSString *)name value:(NSDictionary *)value
{
  if ([name isEqualToString:@"onEvent"]) {
    [self emitOnEvent:value];
  } else if ([name isEqualToString:@"onState"]) {
    [self emitOnState:value];
  } else if ([name isEqualToString:@"onOfferRequest"]) {
    [self emitOnOfferRequest:value];
  } else if ([name isEqualToString:@"onLinkRequest"]) {
    [self emitOnLinkRequest:value];
  } else if ([name isEqualToString:@"onScreenRequest"]) {
    [self emitOnScreenRequest:value];
  } else if ([name isEqualToString:@"onLog"]) {
    [self emitOnLog:value];
  } else if ([name isEqualToString:@"onTeamAction"]) {
    [self emitOnTeamAction:value];
  } else if ([name isEqualToString:@"onConversation"]) {
    [self emitOnConversation:value];
  }
}

- (void)invalidate
{
  [_bridge invalidate];
}

- (void)configure:(NSString *)appKey options:(NSDictionary *)options
{
  [_bridge configure:appKey options:options];
}

- (void)identify:(NSString *)userId name:(NSString *)name email:(NSString *)email
{
  [_bridge identify:userId name:name email:email];
}

- (void)identifyWithToken:(NSString *)token
{
  [_bridge identifyWithToken:token];
}

- (void)setTraits:(NSDictionary *)traits
{
  [_bridge setTraits:traits];
}

- (void)setEntitlement:(NSDictionary *)entitlement
{
  [_bridge setEntitlement:entitlement];
}

- (void)logout
{
  [_bridge logout];
}

- (void)eraseMyData:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_bridge eraseMyDataWithResolve:resolve reject:reject];
}

- (void)exportMyData:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_bridge exportMyDataWithResolve:resolve reject:reject];
}

- (void)prepare:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_bridge prepareWithResolve:resolve reject:reject];
}

- (void)openChat:(NSDictionary *)topic
{
  [_bridge openChat:topic];
}

- (void)closeChat:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_bridge closeChatWithResolve:resolve];
}

- (void)openReport:(NSString *)prefill
{
  [_bridge openReport:prefill];
}

- (void)handleUrl:(NSString *)url
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject
{
  resolve(@([_bridge handleUrl:url]));
}

- (void)reportBug:(NSString *)text
    screenshotBase64:(NSString *)screenshotBase64
             resolve:(RCTPromiseResolveBlock)resolve
              reject:(RCTPromiseRejectBlock)reject
{
  [_bridge reportBug:text screenshotBase64:screenshotBase64 resolve:resolve reject:reject];
}

- (void)moment:(NSString *)name
         props:(NSDictionary *)props
       resolve:(RCTPromiseResolveBlock)resolve
        reject:(RCTPromiseRejectBlock)reject
{
  [_bridge moment:name props:props resolve:resolve];
}

- (void)setOffers:(NSArray *)offers
{
  [_bridge setOffers:offers];
}

- (void)setOfferHandlerEnabled:(BOOL)enabled
{
  [_bridge setOfferHandlerEnabled:enabled];
}

- (void)setLinkHandlerEnabled:(BOOL)enabled closesChat:(BOOL)closesChat
{
  [_bridge setLinkHandlerEnabled:enabled closesChat:closesChat];
}

- (void)answerLink:(NSString *)requestId handled:(BOOL)handled
{
  [_bridge answerLink:requestId handled:handled];
}

- (void)registerScreens:(NSArray *)screens
{
  [_bridge registerScreens:screens];
}

- (void)setScreenHandlerEnabled:(BOOL)enabled closesChat:(BOOL)closesChat
{
  [_bridge setScreenHandlerEnabled:enabled closesChat:closesChat];
}

- (void)answerScreen:(NSString *)requestId opened:(BOOL)opened
{
  [_bridge answerScreen:requestId opened:opened];
}

- (void)setPushToken:(NSString *)token
{
  [_bridge setPushToken:token];
}

- (void)handlePush:(NSDictionary *)payload
            opened:(BOOL)opened
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject
{
  resolve(@([_bridge handlePush:payload opened:opened]));
}

- (void)isPingFrontPush:(NSDictionary *)payload
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject
{
  resolve(@([_bridge isPingFrontPush:payload]));
}

- (void)requestPushAuthorization:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_bridge requestPushAuthorizationWithResolve:resolve];
}

- (void)handleBackgroundPush:(NSDictionary *)payload
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject
{
  [_bridge handleBackgroundPush:payload resolve:resolve];
}

- (void)setLanguage:(NSString *)tag
{
  [_bridge setLanguage:tag];
}

- (void)usesAppBadge:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve(@([_bridge usesAppBadge]));
}

- (void)setTeamActionsEnabled:(BOOL)enabled
{
  [_bridge setTeamActionsEnabled:enabled];
}

- (void)completeTeamAction:(NSString *)actionRunId
                   resolve:(RCTPromiseResolveBlock)resolve
                    reject:(RCTPromiseRejectBlock)reject
{
  [_bridge completeTeamAction:actionRunId resolve:resolve];
}

- (void)failTeamAction:(NSString *)actionRunId
               message:(NSString *)message
               resolve:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject
{
  [_bridge failTeamAction:actionRunId message:message resolve:resolve];
}

- (void)setConversationObserved:(BOOL)enabled
{
  [_bridge setConversationObserved:enabled];
}

- (void)conversationSend:(NSString *)text
{
  [_bridge conversationSend:text];
}

- (void)conversationRetry:(NSString *)clientId
{
  [_bridge conversationRetry:clientId];
}

- (void)conversationDiscard:(NSString *)clientId
{
  [_bridge conversationDiscard:clientId];
}

- (void)conversationLoadOlder
{
  [_bridge conversationLoadOlder];
}

- (void)conversationReload:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_bridge conversationReloadWithResolve:resolve];
}

- (void)conversationMarkRead
{
  [_bridge conversationMarkRead];
}

- (void)conversationSetTyping:(BOOL)typing
{
  [_bridge conversationSetTyping:typing];
}

- (void)conversationOpenCard:(NSString *)messageId cardId:(NSString *)cardId
{
  [_bridge conversationOpenCard:messageId cardId:cardId];
}

- (void)conversationChoose:(NSString *)messageId cardId:(NSString *)cardId optionId:(NSString *)optionId
{
  [_bridge conversationChoose:messageId cardId:cardId optionId:optionId];
}

- (void)conversationRate:(NSString *)messageId cardId:(NSString *)cardId rating:(double)rating
{
  [_bridge conversationRate:messageId cardId:cardId rating:rating];
}

- (void)getSnapshot:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  resolve([_bridge snapshot]);
}

- (void)selfCheck:(RCTPromiseResolveBlock)resolve reject:(RCTPromiseRejectBlock)reject
{
  [_bridge selfCheckWithResolve:resolve];
}

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativePingfrontSpecJSI>(params);
}

@end
