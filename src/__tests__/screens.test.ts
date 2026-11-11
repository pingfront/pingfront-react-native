import Pingfront, { onScreen, registerScreens } from '../index';
import { flush, native, resetAll } from './helpers';

beforeEach(resetAll);

describe('registerScreens', () => {
  it('passes the list on, leaving out absent titles', () => {
    registerScreens([
      { id: 'settings.sound', title: 'Sound settings' },
      { id: 'plans/yearly' },
    ]);
    expect(native.registerScreens).toHaveBeenCalledWith([
      { id: 'settings.sound', title: 'Sound settings' },
      { id: 'plans/yearly' },
    ]);
    expect(Pingfront.registerScreens).toBe(registerScreens);
  });

  it('throws on a bad id in a debug build', () => {
    expect(() => registerScreens([{ id: 'ok' }, { id: 'not ok' }])).toThrow(
      /registerScreens/
    );
    expect(native.registerScreens).not.toHaveBeenCalled();
  });
});

describe('onScreen', () => {
  const request = {
    requestId: 'r1',
    id: 'plans/yearly',
    params: { tab: 'yearly', bad: 3 },
  };

  it('answers with what the handler returned, awaiting a promise', async () => {
    const seen: unknown[] = [];
    const remove = onScreen(async (screen) => {
      seen.push(screen);
      return true;
    });
    expect(native.setScreenHandlerEnabled).toHaveBeenLastCalledWith(true, true);
    native.emit('onScreenRequest', request);
    await flush();
    expect(seen).toEqual([{ id: 'plans/yearly', params: { tab: 'yearly' } }]);
    expect(native.answerScreen).toHaveBeenCalledWith('r1', true);
    // The native side closes the chat after a timely true; JavaScript never closes it before the answer.
    expect(native.closeChat).not.toHaveBeenCalled();
    remove();
    await flush();
    expect(native.setScreenHandlerEnabled).toHaveBeenLastCalledWith(
      false,
      false
    );
    expect(native.listenerCount('onScreenRequest')).toBe(0);
  });

  it('keeps a waiting tap across an effect re-registering the handler', async () => {
    let answer: (opened: boolean) => void = () => {};
    const remove = onScreen(
      () => new Promise<boolean>((resolve) => (answer = resolve))
    );
    native.emit('onScreenRequest', request);
    await flush();
    // React's cleanup, then the effect again in the same commit.
    remove();
    onScreen(() => true);
    await flush();
    expect(native.setScreenHandlerEnabled).toHaveBeenCalledTimes(1);
    answer(true);
    await flush();
    expect(native.answerScreen).toHaveBeenCalledWith('r1', true);
    onScreen(() => true, { chat: 'keep' });
    expect(native.setScreenHandlerEnabled).toHaveBeenLastCalledWith(
      true,
      false
    );
  });

  it('answers false for false, a throw or a rejection', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    onScreen(() => false);
    native.emit('onScreenRequest', request);
    await flush();
    expect(native.answerScreen).toHaveBeenLastCalledWith('r1', false);
    onScreen(() => {
      throw new Error('app bug');
    });
    native.emit('onScreenRequest', { ...request, requestId: 'r2' });
    await flush();
    expect(native.answerScreen).toHaveBeenLastCalledWith('r2', false);
    onScreen(async () => Promise.reject(new Error('later')));
    native.emit('onScreenRequest', { ...request, requestId: 'r3' });
    await flush();
    expect(native.answerScreen).toHaveBeenLastCalledWith('r3', false);
    expect(native.listenerCount('onScreenRequest')).toBe(1);
  });

  it('keeps the chat with chat: keep', async () => {
    onScreen(() => true, { chat: 'keep' });
    expect(native.setScreenHandlerEnabled).toHaveBeenLastCalledWith(
      true,
      false
    );
    native.emit('onScreenRequest', request);
    await flush();
    expect(native.closeChat).not.toHaveBeenCalled();
    expect(native.answerScreen).toHaveBeenCalledWith('r1', true);
  });

  it('runs the handler with the chat still up, and closes nothing for a false answer', async () => {
    const order: string[] = [];
    native.answerScreen.mockImplementation((_id: string, opened: boolean) => {
      order.push(`answer ${opened}`);
    });
    onScreen(async () => {
      order.push('handler');
      return false;
    });
    native.emit('onScreenRequest', request);
    await flush();
    expect(order).toEqual(['handler', 'answer false']);
    expect(native.closeChat).not.toHaveBeenCalled();
  });

  it('ignores a malformed request', async () => {
    onScreen(() => true);
    native.emit('onScreenRequest', { id: 'x' });
    await flush();
    expect(native.answerScreen).not.toHaveBeenCalled();
  });
});
