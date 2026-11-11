import { Text } from 'react-native';
import { act, render, screen } from '@testing-library/react-native';
import {
  usePingfrontChatVisible,
  usePingfrontEvents,
  usePingfrontPerson,
  usePingfrontUnread,
  type PingfrontEvent,
} from '../index';
import { flush, native, resetAll } from './helpers';

beforeEach(resetAll);

function Badge() {
  const unread = usePingfrontUnread();
  const person = usePingfrontPerson();
  const visible = usePingfrontChatVisible();
  return (
    <Text>
      {`unread ${unread} · ${person?.name ?? 'guest'} · ${visible ? 'open' : 'closed'}`}
    </Text>
  );
}

describe('hooks', () => {
  it('seed from the native snapshot and follow events and state changes', async () => {
    native.getSnapshot.mockResolvedValueOnce({
      isConfigured: true,
      unreadCount: 1,
      person: { id: 'per_1', level: 'named', name: 'Riley' },
      isChatVisible: false,
    });
    await render(<Badge />);
    await act(flush);
    expect(screen.getByText('unread 1 · Riley · closed')).toBeTruthy();

    await act(async () =>
      native.emit('onEvent', { type: 'unreadChanged', count: 3 })
    );
    expect(screen.getByText('unread 3 · Riley · closed')).toBeTruthy();

    await act(async () => native.emit('onEvent', { type: 'chatOpened' }));
    expect(screen.getByText('unread 3 · Riley · open')).toBeTruthy();

    await act(async () =>
      native.emit('onState', {
        unreadCount: 0,
        person: null,
        isChatVisible: false,
      })
    );
    expect(screen.getByText('unread 0 · guest · closed')).toBeTruthy();
  });

  it('usePingfrontEvents filters by type and unsubscribes on unmount', async () => {
    const seen: PingfrontEvent[] = [];
    function Listener() {
      usePingfrontEvents((event) => seen.push(event), ['messageReceived']);
      return null;
    }
    const view = await render(<Listener />);
    await act(async () => {
      native.emit('onEvent', { type: 'chatOpened' });
      native.emit('onEvent', {
        type: 'messageReceived',
        message: { id: 'm1', preview: 'Hi Riley', isPing: true, isAI: false },
      });
    });
    await view.unmount();
    await act(async () =>
      native.emit('onEvent', {
        type: 'messageReceived',
        message: { id: 'm2', preview: 'Later' },
      })
    );
    expect(seen).toEqual([
      {
        type: 'messageReceived',
        message: { id: 'm1', preview: 'Hi Riley', isPing: true, isAI: false },
      },
    ]);
  });
});
