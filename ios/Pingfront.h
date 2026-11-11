#import <PingfrontSpec/PingfrontSpec.h>

/// The pingfront Turbo Module. The work happens in Swift (PingfrontBridge.swift); this class adapts the
/// Codegen protocol to it and owns the event emitters.
@interface Pingfront : NativePingfrontSpecBase <NativePingfrontSpec>
@end
