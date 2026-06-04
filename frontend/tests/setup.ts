/**
 * Vitest setup file for React testing.
 */

import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, vi } from 'vitest';

// Cleanup after each test
afterEach(() => {
  cleanup();
});

// Mock window.matchMedia
beforeAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

// Mock ResizeObserver
beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
  };
});

// Mock IntersectionObserver
beforeAll(() => {
  global.IntersectionObserver = class IntersectionObserver {
    root = null;
    rootMargin = '';
    thresholds = [];
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn().mockReturnValue([]);
  } as unknown as typeof IntersectionObserver;
});

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
  length: 0,
  key: vi.fn(),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
});

// Mock fetch
global.fetch = vi.fn();

// Mock WebSocket
class MockWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  readyState = MockWebSocket.OPEN;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(public url: string) {
    setTimeout(() => {
      this.onopen?.(new Event('open'));
    }, 0);
  }

  send = vi.fn();
  close = vi.fn();
}

global.WebSocket = MockWebSocket as unknown as typeof WebSocket;

// Mock import.meta.env
vi.stubGlobal('import', {
  meta: {
    env: {
      VITE_API_URL: 'http://localhost:8174',
      VITE_WS_URL: 'ws://localhost:8174',
      MODE: 'test',
      DEV: false,
      PROD: false,
    },
  },
});

// Suppress console errors in tests (optional)
// vi.spyOn(console, 'error').mockImplementation(() => {});
