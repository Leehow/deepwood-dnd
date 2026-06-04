import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getMessagesMock, editMessageMock } = vi.hoisted(() => ({
  getMessagesMock: vi.fn(),
  editMessageMock: vi.fn(),
}));

vi.mock('~/services', () => ({
  chatService: {
    getMessages: getMessagesMock,
    editMessage: editMessageMock,
  },
}));

vi.mock('~/utils/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
  }),
}));

import { useChatMessages } from '../../app/components/ui/hooks/useChatMessages';

describe('useChatMessages', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    getMessagesMock.mockReset();
    editMessageMock.mockReset();
    getMessagesMock.mockResolvedValue({
      messages: [
        {
          id: 2,
          campaign_id: 1,
          sender_user_id: 'u1',
          sender_role: 'player',
          content: '最新消息',
          recipients: [],
          is_deleted: false,
          message_type: 'chat',
          created_at: '2026-03-07T10:01:00.000Z',
        },
        {
          id: 1,
          campaign_id: 1,
          sender_user_id: 'u1',
          sender_role: 'player',
          content: '更早的消息',
          recipients: [],
          is_deleted: false,
          message_type: 'chat',
          created_at: '2026-03-07T10:00:00.000Z',
        },
      ],
      total: 2,
      page: 1,
      page_size: 50,
    });
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      cb(0);
      return 1;
    });
  });

  it('scrolls to bottom when the end ref attaches after initial history load', async () => {
    const { result } = renderHook(() => useChatMessages('1', 'u1', 'player'));

    await waitFor(() => {
      expect(result.current.messages).toHaveLength(2);
    });

    const endElement = document.createElement('div');
    const scrollIntoView = vi.fn();
    Object.defineProperty(endElement, 'scrollIntoView', {
      value: scrollIntoView,
      configurable: true,
    });

    act(() => {
      result.current.messagesEndRef(endElement);
    });

    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'auto',
      block: 'end',
    });
  });
});

