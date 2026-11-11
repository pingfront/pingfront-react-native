import {
  addListener,
  closeChat,
  configure,
  eraseMyData,
  exportMyData,
  getLanguage,
  getUnreadCount,
  handleBackgroundPush,
  handlePush,
  handleUrl,
  identify,
  isPingFrontPush,
  logout,
  moment,
  openChat,
  openReport,
  prepare,
  reportBug,
  requestPushAuthorization,
  selfCheck,
  setEntitlement,
  setLanguage,
  setOffers,
  setPushToken,
  setTraits,
  subscribeUnreadCount,
  usesAppBadge,
  version,
} from './pingfront';
import { conversation } from './conversation';
import { onTeamAction } from './teamActions';
import { onLink, onOffer } from './handlers';
import { onScreen, registerScreens } from './screens';
import { getSnapshot } from './store';

export * from './pingfront';
export * from './hooks';
export * from './types';
export { onOffer, onLink } from './handlers';
export type {
  ChatBehaviour,
  LinkHandler,
  LinkHandlerOptions,
  OfferHandler,
  OfferHandlerOptions,
} from './handlers';
export { getSnapshot } from './store';
export { conversation, usePingfrontConversation } from './conversation';
export { onTeamAction } from './teamActions';
export { registerScreens, onScreen } from './screens';
export type { ScreenHandler, ScreenHandlerOptions } from './screens';
export type { TeamActionHandler } from './teamActions';
export { PingfrontChatView } from './PingfrontChatView';
export type { PingfrontChatViewProps } from './PingfrontChatView';

/**
 * The whole API as one object, mirroring `PingFront` in the native SDKs:
 *
 * ```ts
 * import Pingfront from '@pingfront/react-native';
 * Pingfront.configure('pk_live_…');
 * Pingfront.openChat();
 * ```
 */
const Pingfront = {
  configure,
  identify,
  setTraits,
  setEntitlement,
  logout,
  eraseMyData,
  exportMyData,
  prepare,
  openChat,
  closeChat,
  openReport,
  handleUrl,
  reportBug,
  moment,
  setOffers,
  onOffer,
  onLink,
  registerScreens,
  onScreen,
  setLanguage,
  getLanguage,
  onTeamAction,
  conversation,
  usesAppBadge,
  setPushToken,
  handlePush,
  handleBackgroundPush,
  isPingFrontPush,
  requestPushAuthorization,
  getUnreadCount,
  subscribeUnreadCount,
  getSnapshot,
  addListener,
  selfCheck,
  version,
};

export default Pingfront;
