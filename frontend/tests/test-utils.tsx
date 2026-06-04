/**
 * Test utilities for React component testing.
 */

import React, { ReactElement } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { vi } from 'vitest';

// Custom render with providers
interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  initialState?: Record<string, unknown>;
}

function AllProviders({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
    </>
  );
}

function customRender(
  ui: ReactElement,
  options?: CustomRenderOptions
): RenderResult {
  return render(ui, { wrapper: AllProviders, ...options });
}

// Re-export everything
export * from '@testing-library/react';
export { customRender as render };

// Mock factories

export function createMockUser(overrides = {}) {
  return {
    id: 1,
    username: 'testuser',
    email: 'test@example.com',
    is_active: true,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockCampaign(overrides = {}) {
  return {
    id: 1,
    name: 'Test Campaign',
    description: 'A test campaign',
    dm_id: 1,
    setting: 'Sundered Realms',
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

export function createMockCharacter(overrides = {}) {
  return {
    id: 1,
    name: 'Test Character',
    race: 'Human',
    character_class: 'Fighter',
    level: 1,
    strength: 16,
    dexterity: 14,
    constitution: 15,
    intelligence: 10,
    wisdom: 12,
    charisma: 8,
    max_hp: 12,
    current_hp: 12,
    ...overrides,
  };
}

export function createMockMonster(overrides = {}) {
  return {
    id: 1,
    name: 'Goblin',
    size: 'Small',
    type: 'Humanoid',
    armor_class: 15,
    hit_points: 7,
    speed: '30 ft.',
    challenge_rating: '1/4',
    ...overrides,
  };
}

export function createMockToken(overrides = {}) {
  return {
    id: 'token-1',
    x: 100,
    y: 100,
    width: 50,
    height: 50,
    name: 'Token',
    ...overrides,
  };
}

// API mock helpers

export function mockFetch(response: unknown, options: { ok?: boolean; status?: number } = {}) {
  const { ok = true, status = 200 } = options;
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  });
}

export function mockFetchError(message: string, status = 500) {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: () => Promise.resolve({ detail: message }),
  });
}

// WebSocket mock helpers

export function createMockWebSocket() {
  const ws = {
    readyState: WebSocket.OPEN,
    send: vi.fn(),
    close: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    onopen: null as ((event: Event) => void) | null,
    onclose: null as ((event: CloseEvent) => void) | null,
    onmessage: null as ((event: MessageEvent) => void) | null,
    onerror: null as ((event: Event) => void) | null,
  };

  return {
    ws,
    simulateMessage: (data: unknown) => {
      const event = new MessageEvent('message', {
        data: JSON.stringify(data),
      });
      ws.onmessage?.(event);
    },
    simulateOpen: () => {
      ws.onopen?.(new Event('open'));
    },
    simulateClose: () => {
      ws.onclose?.(new CloseEvent('close'));
    },
    simulateError: () => {
      ws.onerror?.(new Event('error'));
    },
  };
}

// Wait utilities

export function waitForMs(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function waitForCondition(
  condition: () => boolean,
  timeout = 5000,
  interval = 50
): Promise<void> {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeout) {
      throw new Error('Condition not met within timeout');
    }
    await waitForMs(interval);
  }
}

// Event helpers

export function createKeyboardEvent(key: string, options = {}) {
  return new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
}

export function createMouseEvent(type: string, options = {}) {
  return new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...options,
  });
}
