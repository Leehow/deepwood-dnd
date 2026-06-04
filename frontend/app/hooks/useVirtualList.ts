/**
 * Virtual list hook for rendering large lists efficiently.
 * Only renders visible items plus a buffer for smooth scrolling.
 */

import { useState, useEffect, useRef, useMemo, useCallback } from 'react';

interface VirtualListOptions {
  itemHeight: number;
  overscan?: number;  // Number of items to render outside viewport
  containerHeight?: number;
}

interface VirtualListResult<T> {
  visibleItems: T[];
  totalHeight: number;
  offsetTop: number;
  containerRef: React.RefObject<HTMLDivElement>;
  onScroll: (e: React.UIEvent<HTMLDivElement>) => void;
  scrollToIndex: (index: number) => void;
}

/**
 * Hook for virtualizing a list of items.
 *
 * @param items - Full array of items
 * @param options - Virtualization options
 * @returns Virtual list state and handlers
 *
 * @example
 * const { visibleItems, totalHeight, offsetTop, containerRef, onScroll } = useVirtualList(
 *   messages,
 *   { itemHeight: 60, overscan: 5 }
 * );
 *
 * return (
 *   <div ref={containerRef} onScroll={onScroll} style={{ height: 400, overflow: 'auto' }}>
 *     <div style={{ height: totalHeight, position: 'relative' }}>
 *       <div style={{ position: 'absolute', top: offsetTop, width: '100%' }}>
 *         {visibleItems.map(item => <MessageItem key={item.id} {...item} />)}
 *       </div>
 *     </div>
 *   </div>
 * );
 */
export function useVirtualList<T>(
  items: T[],
  options: VirtualListOptions
): VirtualListResult<T> {
  const { itemHeight, overscan = 3, containerHeight: initialHeight } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(initialHeight || 400);

  // Update container height on resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(entries => {
      const entry = entries[0];
      if (entry) {
        setContainerHeight(entry.contentRect.height);
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  // Calculate visible range
  const { startIndex, endIndex, visibleItems, offsetTop } = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
    const visibleCount = Math.ceil(containerHeight / itemHeight);
    const end = Math.min(items.length, start + visibleCount + overscan * 2);

    return {
      startIndex: start,
      endIndex: end,
      visibleItems: items.slice(start, end),
      offsetTop: start * itemHeight,
    };
  }, [items, scrollTop, itemHeight, containerHeight, overscan]);

  // Total height of all items
  const totalHeight = items.length * itemHeight;

  // Scroll handler
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Scroll to specific index
  const scrollToIndex = useCallback((index: number) => {
    if (containerRef.current) {
      containerRef.current.scrollTop = index * itemHeight;
    }
  }, [itemHeight]);

  return {
    visibleItems,
    totalHeight,
    offsetTop,
    containerRef,
    onScroll,
    scrollToIndex,
  };
}

/**
 * Virtual list with variable item heights.
 * Requires measuring items after render.
 */
interface DynamicVirtualListOptions {
  estimatedItemHeight: number;
  overscan?: number;
}

interface ItemMeasurement {
  index: number;
  height: number;
  offset: number;
}

export function useDynamicVirtualList<T>(
  items: T[],
  options: DynamicVirtualListOptions
) {
  const { estimatedItemHeight, overscan = 3 } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(400);

  // Cache of measured heights
  const measurementsRef = useRef<Map<number, ItemMeasurement>>(new Map());

  // Calculate estimated total height
  const estimatedTotalHeight = useMemo(() => {
    let total = 0;
    for (let i = 0; i < items.length; i++) {
      const measurement = measurementsRef.current.get(i);
      total += measurement?.height || estimatedItemHeight;
    }
    return total;
  }, [items.length, estimatedItemHeight]);

  // Find start index using binary search
  const findStartIndex = useCallback((scrollTop: number): number => {
    let offset = 0;
    for (let i = 0; i < items.length; i++) {
      const height = measurementsRef.current.get(i)?.height || estimatedItemHeight;
      if (offset + height > scrollTop) {
        return Math.max(0, i - overscan);
      }
      offset += height;
    }
    return Math.max(0, items.length - 1);
  }, [items.length, estimatedItemHeight, overscan]);

  // Calculate visible items
  const { visibleItems, offsetTop, startIndex } = useMemo(() => {
    const start = findStartIndex(scrollTop);

    let offset = 0;
    for (let i = 0; i < start; i++) {
      offset += measurementsRef.current.get(i)?.height || estimatedItemHeight;
    }

    let currentOffset = offset;
    const visible: T[] = [];

    for (let i = start; i < items.length; i++) {
      const height = measurementsRef.current.get(i)?.height || estimatedItemHeight;

      if (currentOffset > scrollTop + containerHeight + overscan * estimatedItemHeight) {
        break;
      }

      visible.push(items[i]);
      currentOffset += height;
    }

    return {
      visibleItems: visible,
      offsetTop: offset,
      startIndex: start,
    };
  }, [items, scrollTop, containerHeight, findStartIndex, estimatedItemHeight, overscan]);

  // Measure item callback
  const measureItem = useCallback((index: number, element: HTMLElement) => {
    const height = element.getBoundingClientRect().height;
    const current = measurementsRef.current.get(index);

    if (!current || current.height !== height) {
      measurementsRef.current.set(index, {
        index,
        height,
        offset: 0, // Will be recalculated
      });
    }
  }, []);

  // Scroll handler
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  return {
    visibleItems,
    totalHeight: estimatedTotalHeight,
    offsetTop,
    containerRef,
    onScroll,
    measureItem,
    startIndex,
  };
}

/**
 * Simple infinite scroll hook.
 * Loads more items when scrolled near the bottom.
 */
interface InfiniteScrollOptions {
  threshold?: number;  // Distance from bottom to trigger load
  hasMore: boolean;
  isLoading: boolean;
}

export function useInfiniteScroll(
  onLoadMore: () => void,
  options: InfiniteScrollOptions
) {
  const { threshold = 200, hasMore, isLoading } = options;
  const containerRef = useRef<HTMLDivElement>(null);

  const handleScroll = useCallback(() => {
    if (!containerRef.current || isLoading || !hasMore) return;

    const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
    const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

    if (distanceFromBottom < threshold) {
      onLoadMore();
    }
  }, [onLoadMore, isLoading, hasMore, threshold]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return { containerRef };
}