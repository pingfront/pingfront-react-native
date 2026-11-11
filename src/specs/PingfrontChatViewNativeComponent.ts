import type { HostComponent, ViewProps } from 'react-native';
import { codegenNativeComponent } from 'react-native';

/**
 * The Codegen spec of the embedded chat: a Fabric component that hosts the native chat screen
 * (`PingFrontChatView` in SwiftUI on iOS, the `PingFrontChat` composable on Android) inside your layout.
 *
 * `topic` is the topic as JSON in the shape `openChat` sends (`{ id }` for a preset or
 * `{ id, label, symbol, prefill }`), or empty for none: one string keeps localized labels intact through Codegen.
 */
export interface NativeProps extends ViewProps {
  topic?: string;
}

export default codegenNativeComponent<NativeProps>(
  'PingfrontChatView'
) as HostComponent<NativeProps>;
