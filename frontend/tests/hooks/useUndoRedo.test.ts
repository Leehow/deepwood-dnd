/**
 * Example test template for custom hooks.
 * Tests the useUndoRedo hook functionality.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useUndoRedo, useOptimisticUpdate } from '../../app/hooks/useUndoRedo';

describe('useUndoRedo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with empty history', () => {
    const { result } = renderHook(() => useUndoRedo());

    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.history).toHaveLength(0);
    expect(result.current.future).toHaveLength(0);
  });

  it('should execute command and add to history', async () => {
    const { result } = renderHook(() => useUndoRedo());

    const executeResult = await act(async () => {
      return result.current.execute({
        type: 'test',
        execute: async () => 'executed',
        undo: async () => {},
      });
    });

    expect(executeResult).toBe('executed');
    expect(result.current.canUndo).toBe(true);
    expect(result.current.history).toHaveLength(1);
  });

  it('should undo last command', async () => {
    const undoFn = vi.fn();
    const { result } = renderHook(() => useUndoRedo());

    // Execute command
    await act(async () => {
      await result.current.execute({
        type: 'test',
        execute: async () => 'result',
        undo: undoFn,
      });
    });

    // Undo
    await act(async () => {
      await result.current.undo();
    });

    expect(undoFn).toHaveBeenCalled();
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);
  });

  it('should redo undone command', async () => {
    const executeFn = vi.fn().mockResolvedValue('result');
    const { result } = renderHook(() => useUndoRedo());

    // Execute
    await act(async () => {
      await result.current.execute({
        type: 'test',
        execute: executeFn,
        undo: async () => {},
      });
    });

    // Undo
    await act(async () => {
      await result.current.undo();
    });

    // Redo
    await act(async () => {
      await result.current.redo();
    });

    expect(executeFn).toHaveBeenCalledTimes(2);
    expect(result.current.canRedo).toBe(false);
    expect(result.current.canUndo).toBe(true);
  });

  it('should clear redo stack on new action', async () => {
    const { result } = renderHook(() => useUndoRedo());

    // Execute first command
    await act(async () => {
      await result.current.execute({
        type: 'first',
        execute: async () => 1,
        undo: async () => {},
      });
    });

    // Undo
    await act(async () => {
      await result.current.undo();
    });

    expect(result.current.canRedo).toBe(true);

    // Execute new command
    await act(async () => {
      await result.current.execute({
        type: 'second',
        execute: async () => 2,
        undo: async () => {},
      });
    });

    expect(result.current.canRedo).toBe(false);
  });

  it('should call onError on execute failure', async () => {
    const onError = vi.fn();
    const error = new Error('Execute failed');
    const { result } = renderHook(() => useUndoRedo({ onError }));

    await act(async () => {
      try {
        await result.current.execute({
          type: 'test',
          execute: async () => { throw error; },
          undo: async () => {},
        });
      } catch {
        // Expected
      }
    });

    expect(onError).toHaveBeenCalledWith(error, expect.any(Object));
  });

  it('should respect maxHistory limit', async () => {
    const { result } = renderHook(() => useUndoRedo({ maxHistory: 3 }));

    // Execute 5 commands
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        await result.current.execute({
          type: `command-${i}`,
          execute: async () => i,
          undo: async () => {},
        });
      });
    }

    expect(result.current.history).toHaveLength(3);
  });

  it('should clear all history', async () => {
    const { result } = renderHook(() => useUndoRedo());

    await act(async () => {
      await result.current.execute({
        type: 'test',
        execute: async () => 'result',
        undo: async () => {},
      });
    });

    act(() => {
      result.current.clear();
    });

    expect(result.current.history).toHaveLength(0);
    expect(result.current.canUndo).toBe(false);
  });
});

describe('useOptimisticUpdate', () => {
  it('should apply optimistic update immediately', async () => {
    const { result } = renderHook(() => useOptimisticUpdate());

    let value = 'initial';
    const optimisticUpdate = () => { value = 'optimistic'; };
    const serverRequest = vi.fn().mockResolvedValue('server');
    const rollback = () => { value = 'initial'; };

    await act(async () => {
      await result.current.execute(optimisticUpdate, serverRequest, rollback);
    });

    expect(value).toBe('optimistic');
    expect(serverRequest).toHaveBeenCalled();
  });

  it('should rollback on server error', async () => {
    const onRollback = vi.fn();
    const { result } = renderHook(() => useOptimisticUpdate({ onRollback }));

    let value = 'initial';
    const optimisticUpdate = () => { value = 'optimistic'; };
    const serverRequest = vi.fn().mockRejectedValue(new Error('Server error'));
    const rollback = () => { value = 'rolled_back'; };

    await act(async () => {
      await result.current.execute(optimisticUpdate, serverRequest, rollback);
    });

    expect(value).toBe('rolled_back');
    expect(onRollback).toHaveBeenCalled();
  });

  it('should track pending state', async () => {
    const { result } = renderHook(() => useOptimisticUpdate());

    let resolveRequest: (value: string) => void;
    const serverRequest = new Promise<string>(resolve => {
      resolveRequest = resolve;
    });

    act(() => {
      result.current.execute(
        () => {},
        () => serverRequest,
        () => {}
      );
    });

    expect(result.current.isPending).toBe(true);

    await act(async () => {
      resolveRequest!('done');
    });

    expect(result.current.isPending).toBe(false);
  });
});
