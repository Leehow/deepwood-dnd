/**
 * Undo/Redo hook with command pattern for operation rollback.
 */

import { useState, useCallback, useRef } from 'react';

interface Command<T = any> {
  id: string;
  type: string;
  execute: () => Promise<T>;
  undo: () => Promise<void>;
  description?: string;
  timestamp: number;
}

interface UndoRedoOptions {
  maxHistory?: number;
  onError?: (error: Error, command: Command) => void;
  onUndo?: (command: Command) => void;
  onRedo?: (command: Command) => void;
}

interface UndoRedoState {
  past: Command[];
  future: Command[];
  isExecuting: boolean;
}

/**
 * Hook for managing undo/redo operations.
 *
 * @example
 * const { execute, undo, redo, canUndo, canRedo } = useUndoRedo();
 *
 * // Execute an undoable operation
 * await execute({
 *   type: 'move_token',
 *   execute: async () => {
 *     await api.moveToken(tokenId, newX, newY);
 *     return { tokenId, x: newX, y: newY };
 *   },
 *   undo: async () => {
 *     await api.moveToken(tokenId, oldX, oldY);
 *   },
 *   description: 'Move token to new position'
 * });
 */
export function useUndoRedo(options: UndoRedoOptions = {}) {
  const {
    maxHistory = 50,
    onError,
    onUndo,
    onRedo,
  } = options;

  const [state, setState] = useState<UndoRedoState>({
    past: [],
    future: [],
    isExecuting: false,
  });

  // Generate unique ID for commands
  const generateId = useCallback(() => {
    return `cmd_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }, []);

  /**
   * Execute a command and add to history.
   */
  const execute = useCallback(async <T>(
    command: Omit<Command<T>, 'id' | 'timestamp'>
  ): Promise<T> => {
    const fullCommand: Command<T> = {
      ...command,
      id: generateId(),
      timestamp: Date.now(),
    };

    setState(prev => ({ ...prev, isExecuting: true }));

    try {
      const result = await command.execute();

      setState(prev => {
        const newPast = [...prev.past, fullCommand].slice(-maxHistory);
        return {
          past: newPast,
          future: [], // Clear redo stack on new action
          isExecuting: false,
        };
      });

      return result;
    } catch (error) {
      setState(prev => ({ ...prev, isExecuting: false }));
      onError?.(error instanceof Error ? error : new Error(String(error)), fullCommand);
      throw error;
    }
  }, [generateId, maxHistory, onError]);

  /**
   * Undo the last command.
   */
  const undo = useCallback(async () => {
    const lastCommand = state.past[state.past.length - 1];
    if (!lastCommand || state.isExecuting) return;

    setState(prev => ({ ...prev, isExecuting: true }));

    try {
      await lastCommand.undo();

      setState(prev => ({
        past: prev.past.slice(0, -1),
        future: [lastCommand, ...prev.future],
        isExecuting: false,
      }));

      onUndo?.(lastCommand);
    } catch (error) {
      setState(prev => ({ ...prev, isExecuting: false }));
      onError?.(error instanceof Error ? error : new Error(String(error)), lastCommand);
      throw error;
    }
  }, [state.past, state.isExecuting, onUndo, onError]);

  /**
   * Redo the last undone command.
   */
  const redo = useCallback(async () => {
    const nextCommand = state.future[0];
    if (!nextCommand || state.isExecuting) return;

    setState(prev => ({ ...prev, isExecuting: true }));

    try {
      await nextCommand.execute();

      setState(prev => ({
        past: [...prev.past, nextCommand],
        future: prev.future.slice(1),
        isExecuting: false,
      }));

      onRedo?.(nextCommand);
    } catch (error) {
      setState(prev => ({ ...prev, isExecuting: false }));
      onError?.(error instanceof Error ? error : new Error(String(error)), nextCommand);
      throw error;
    }
  }, [state.future, state.isExecuting, onRedo, onError]);

  /**
   * Clear all history.
   */
  const clear = useCallback(() => {
    setState({
      past: [],
      future: [],
      isExecuting: false,
    });
  }, []);

  return {
    execute,
    undo,
    redo,
    clear,
    canUndo: state.past.length > 0 && !state.isExecuting,
    canRedo: state.future.length > 0 && !state.isExecuting,
    isExecuting: state.isExecuting,
    history: state.past,
    future: state.future,
  };
}

/**
 * Optimistic update hook with automatic rollback on failure.
 */
interface OptimisticOptions<T> {
  onSuccess?: (result: T) => void;
  onError?: (error: Error) => void;
  onRollback?: () => void;
}

export function useOptimisticUpdate<T, R = any>(
  options: OptimisticOptions<R> = {}
) {
  const [isPending, setIsPending] = useState(false);
  const rollbackRef = useRef<(() => void) | null>(null);

  /**
   * Execute an optimistic update with automatic rollback.
   *
   * @example
   * const { execute } = useOptimisticUpdate();
   *
   * await execute(
   *   // Optimistic update (immediate)
   *   () => setTokenPosition({ x: newX, y: newY }),
   *   // Server request
   *   () => api.moveToken(tokenId, newX, newY),
   *   // Rollback on failure
   *   () => setTokenPosition({ x: oldX, y: oldY })
   * );
   */
  const execute = useCallback(async (
    optimisticUpdate: () => void,
    serverRequest: () => Promise<R>,
    rollback: () => void
  ): Promise<R | undefined> => {
    // Apply optimistic update immediately
    optimisticUpdate();
    rollbackRef.current = rollback;
    setIsPending(true);

    try {
      const result = await serverRequest();
      rollbackRef.current = null;
      setIsPending(false);
      options.onSuccess?.(result);
      return result;
    } catch (error) {
      // Rollback on failure
      rollback();
      rollbackRef.current = null;
      setIsPending(false);
      options.onError?.(error instanceof Error ? error : new Error(String(error)));
      options.onRollback?.();
      return undefined;
    }
  }, [options]);

  /**
   * Force rollback current pending operation.
   */
  const forceRollback = useCallback(() => {
    if (rollbackRef.current) {
      rollbackRef.current();
      rollbackRef.current = null;
      setIsPending(false);
      options.onRollback?.();
    }
  }, [options]);

  return {
    execute,
    forceRollback,
    isPending,
  };
}

/**
 * Transaction hook for batching multiple operations.
 */
interface Transaction {
  id: string;
  operations: Array<{
    execute: () => Promise<any>;
    undo: () => Promise<void>;
  }>;
  status: 'pending' | 'committed' | 'rolled_back';
}

export function useTransaction() {
  const [currentTransaction, setCurrentTransaction] = useState<Transaction | null>(null);
  const operationsRef = useRef<Transaction['operations']>([]);

  /**
   * Start a new transaction.
   */
  const begin = useCallback(() => {
    const id = `txn_${Date.now()}`;
    operationsRef.current = [];
    setCurrentTransaction({
      id,
      operations: [],
      status: 'pending',
    });
    return id;
  }, []);

  /**
   * Add operation to current transaction.
   */
  const addOperation = useCallback((operation: {
    execute: () => Promise<any>;
    undo: () => Promise<void>;
  }) => {
    if (!currentTransaction) {
      throw new Error('No active transaction');
    }
    operationsRef.current.push(operation);
  }, [currentTransaction]);

  /**
   * Commit all operations in transaction.
   */
  const commit = useCallback(async () => {
    if (!currentTransaction) {
      throw new Error('No active transaction');
    }

    const completedOps: Array<{ undo: () => Promise<void> }> = [];

    try {
      for (const op of operationsRef.current) {
        await op.execute();
        completedOps.push(op);
      }

      setCurrentTransaction(prev => prev ? { ...prev, status: 'committed' } : null);
    } catch (error) {
      // Rollback completed operations in reverse order
      for (let i = completedOps.length - 1; i >= 0; i--) {
        try {
          await completedOps[i].undo();
        } catch (undoError) {
          console.error('Rollback failed for operation', i, undoError);
        }
      }

      setCurrentTransaction(prev => prev ? { ...prev, status: 'rolled_back' } : null);
      throw error;
    } finally {
      operationsRef.current = [];
    }
  }, [currentTransaction]);

  /**
   * Abort current transaction without executing.
   */
  const abort = useCallback(() => {
    operationsRef.current = [];
    setCurrentTransaction(null);
  }, []);

  return {
    begin,
    addOperation,
    commit,
    abort,
    isInTransaction: currentTransaction !== null,
    transactionId: currentTransaction?.id,
  };
}

/**
 * Simple state snapshot for manual rollback.
 */
export function useStateSnapshot<T>(initialState: T) {
  const [state, setState] = useState<T>(initialState);
  const snapshotRef = useRef<T>(initialState);

  const saveSnapshot = useCallback(() => {
    snapshotRef.current = state;
  }, [state]);

  const restoreSnapshot = useCallback(() => {
    setState(snapshotRef.current);
  }, []);

  const updateState = useCallback((newState: T | ((prev: T) => T)) => {
    setState(newState);
  }, []);

  return {
    state,
    setState: updateState,
    saveSnapshot,
    restoreSnapshot,
    snapshot: snapshotRef.current,
  };
}
