import { useEffect, useState } from 'react';
import { Modal, Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import { onLink, onOffer, type OfferRequest } from '../index';
import { flush, native, resetAll } from './helpers';

beforeEach(resetAll);

const tap: OfferRequest = {
  offerId: 'yearly_winback',
  cardId: 'card_1',
  messageId: 'msg_1',
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/**
 * A teardown pitfall: in React Native a JS <Modal> paywall opened from an offer card
 * never shows above the native chat sheet. onOffer must close the chat and wait until it is off
 * screen before the app's handler opens its modal.
 */
function PaywallApp() {
  const [offerId, setOfferId] = useState<string | null>(null);
  useEffect(() => onOffer((request) => setOfferId(request.offerId)), []);
  return (
    <Modal visible={offerId !== null} animationType="slide">
      <Text>Paywall for {offerId}</Text>
    </Modal>
  );
}

describe('onOffer: the modal paywall pattern', () => {
  it('closes the native chat first and shows the JS modal only once it is off screen', async () => {
    const closing = deferred();
    native.closeChat.mockImplementationOnce(() => closing.promise);
    await render(<PaywallApp />);
    expect(native.setOfferHandlerEnabled).toHaveBeenLastCalledWith(true);

    await act(async () => {
      native.emit('onOfferRequest', tap);
      await flush();
    });
    // The chat is still animating away: the paywall must not be up yet.
    expect(native.closeChat).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Paywall for yearly_winback')).toBeNull();

    await act(async () => {
      closing.resolve();
      await flush();
    });
    expect(screen.getByText('Paywall for yearly_winback')).toBeTruthy();
  });

  // The native closeChat closes only an SDK-presented chat and resolves at once when none is up; an embedded
  // <PingfrontChatView /> is never waited for. These model the two native answers.
  it('embedded only: offer handler runs at once', async () => {
    // Only the embedded chat is on screen: the native close has nothing to dismiss and resolves immediately.
    const handler = jest.fn();
    onOffer(handler);
    native.emit('onOfferRequest', tap);
    await flush();
    expect(native.closeChat).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(tap);
  });

  it('sheet + embedded: waits for the sheet', async () => {
    // A presented sheet is up above the embedded chat: the native close resolves once the sheet is gone.
    const sheetGone = deferred();
    native.closeChat.mockImplementationOnce(() => sheetGone.promise);
    const handler = jest.fn();
    onOffer(handler);
    native.emit('onOfferRequest', tap);
    await flush();
    expect(handler).not.toHaveBeenCalled();
    sheetGone.resolve();
    await flush();
    expect(handler).toHaveBeenCalledWith(tap);
  });

  it('runs the handler with the chat open with chat: keep (native paywalls)', async () => {
    const handler = jest.fn();
    onOffer(handler, { chat: 'keep' });
    native.emit('onOfferRequest', tap);
    await flush();
    expect(native.closeChat).not.toHaveBeenCalled();
    expect(handler).toHaveBeenCalledWith(tap);
  });

  it('still runs the handler when closing fails', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    native.closeChat.mockRejectedValueOnce(new Error('already closed'));
    const handler = jest.fn();
    onOffer(handler);
    native.emit('onOfferRequest', tap);
    await flush();
    expect(handler).toHaveBeenCalledWith(tap);
    warn.mockRestore();
  });

  it('ignores a second tap on the same card while the first is handled', async () => {
    const closing = deferred();
    native.closeChat.mockImplementationOnce(() => closing.promise);
    const handler = jest.fn();
    onOffer(handler);
    native.emit('onOfferRequest', tap);
    native.emit('onOfferRequest', tap);
    closing.resolve();
    await flush();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('passes the slot and store offer through', async () => {
    const handler = jest.fn();
    onOffer(handler, { chat: 'keep' });
    const request = {
      ...tap,
      slot: {
        id: 'yearly_winback',
        title: 'Pro yearly',
        kind: 'winback',
        available: true,
      },
      storeOffer: {
        kind: 'promotional',
        id: 'winback50',
        productId: 'pro_yearly',
      },
    };
    native.emit('onOfferRequest', request);
    await flush();
    expect(handler).toHaveBeenCalledWith(request);
  });

  it('removing the handler hands offer cards back to native modules', () => {
    const remove = onOffer(jest.fn());
    expect(native.listenerCount('onOfferRequest')).toBe(1);
    remove();
    expect(native.setOfferHandlerEnabled).toHaveBeenLastCalledWith(false);
    expect(native.listenerCount('onOfferRequest')).toBe(0);
  });

  it('a newer handler replaces the older one, and the stale remover does nothing', async () => {
    const first = jest.fn();
    const second = jest.fn();
    const removeFirst = onOffer(first, { chat: 'keep' });
    onOffer(second, { chat: 'keep' });
    removeFirst();
    expect(native.setOfferHandlerEnabled).toHaveBeenLastCalledWith(true);
    native.emit('onOfferRequest', tap);
    await flush();
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('onLink', () => {
  it('asks the handler first and answers natively, which closes the chat after a true', async () => {
    const order: string[] = [];
    native.answerLink.mockImplementation((id: string, handled: boolean) => {
      order.push(`answer ${id} ${handled}`);
    });
    onLink(async (url) => {
      order.push(url);
      return true;
    });
    expect(native.setLinkHandlerEnabled).toHaveBeenLastCalledWith(true, true);
    native.emit('onLinkRequest', {
      requestId: 'l1',
      url: 'clockwise://alarms/7',
    });
    await flush();
    expect(order).toEqual(['clockwise://alarms/7', 'answer l1 true']);
    // Closing is native, after a timely true: never before the handler runs.
    expect(native.closeChat).not.toHaveBeenCalled();
  });

  it('declines for false, a throw or a rejection, so the link opens natively', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    onLink(() => false);
    native.emit('onLinkRequest', { requestId: 'l1', url: 'https://a.example' });
    await flush();
    expect(native.answerLink).toHaveBeenLastCalledWith('l1', false);
    onLink(() => {
      throw new Error('app bug');
    });
    native.emit('onLinkRequest', { requestId: 'l2', url: 'https://a.example' });
    await flush();
    expect(native.answerLink).toHaveBeenLastCalledWith('l2', false);
    onLink(async () => Promise.reject(new Error('later')));
    native.emit('onLinkRequest', { requestId: 'l3', url: 'https://a.example' });
    await flush();
    expect(native.answerLink).toHaveBeenLastCalledWith('l3', false);
    expect(native.closeChat).not.toHaveBeenCalled();
  });

  it('keeps the chat with chat: keep, and ignores a malformed request', async () => {
    onLink(() => true, { chat: 'keep' });
    expect(native.setLinkHandlerEnabled).toHaveBeenLastCalledWith(true, false);
    native.emit('onLinkRequest', { url: 'myapp://x' });
    await flush();
    expect(native.answerLink).not.toHaveBeenCalled();
  });

  it('never opens a link itself: the native SDK checks the link rule and opens what JavaScript declines', async () => {
    const { Linking } =
      jest.requireActual<typeof import('react-native')>('react-native');
    const openURL = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    const handler = jest.fn(() => false);
    onLink(handler);
    native.emit('onLinkRequest', { requestId: 'l1', url: 'myapp://settings' });
    await flush();
    expect(handler).toHaveBeenCalledWith('myapp://settings');
    // The bridge has no fallback of its own (https://pingfront.sh/docs/chat-links): nothing opens from JavaScript.
    expect(openURL).not.toHaveBeenCalled();
    openURL.mockRestore();
  });

  it('removing it turns the native handler off', async () => {
    const remove = onLink(jest.fn(() => true));
    remove();
    await flush();
    expect(native.setLinkHandlerEnabled).toHaveBeenLastCalledWith(false, false);
    expect(native.listenerCount('onLinkRequest')).toBe(0);
  });

  it('keeps a waiting tap when an effect registers the handler again', async () => {
    let answer: (handled: boolean) => void = () => {};
    const remove = onLink(
      () => new Promise<boolean>((resolve) => (answer = resolve))
    );
    native.emit('onLinkRequest', { requestId: 'l1', url: 'myapp://a' });
    await flush();
    // React runs the cleanup, then the effect again, in the same commit: nothing goes native.
    remove();
    const again = onLink(() => true);
    await flush();
    expect(native.setLinkHandlerEnabled).toHaveBeenCalledTimes(1);
    expect(native.listenerCount('onLinkRequest')).toBe(1);
    answer(true);
    await flush();
    expect(native.answerLink).toHaveBeenCalledWith('l1', true);
    // A real change still goes native: other chat behaviour, then off.
    onLink(() => true, { chat: 'keep' });
    expect(native.setLinkHandlerEnabled).toHaveBeenLastCalledWith(true, false);
    again(); // no longer the current handler: does nothing
    await flush();
    expect(native.setLinkHandlerEnabled).toHaveBeenCalledTimes(2);
  });
});
