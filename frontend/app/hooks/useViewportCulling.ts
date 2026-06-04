/**
 * Viewport culling hook for optimizing token rendering.
 * Only renders tokens that are visible within the current viewport.
 */

import { useMemo, useCallback } from 'react';

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Token {
  id: string | number;
  x: number;
  y: number;
  size?: number;
  radius?: number;
  width?: number;
  height?: number;
}

interface ViewportState {
  x: number;  // Pan X offset
  y: number;  // Pan Y offset
  scale: number;  // Zoom level
  width: number;  // Viewport width
  height: number; // Viewport height
}

interface CullingOptions {
  margin?: number;  // Extra margin around viewport (default 100px)
  minScale?: number;  // Minimum scale to apply culling (default 0.1)
}

/**
 * Hook to filter tokens based on viewport visibility.
 *
 * @param tokens - Array of tokens to filter
 * @param viewport - Current viewport state (pan, zoom, dimensions)
 * @param options - Culling options
 * @returns Filtered array of visible tokens
 */
export function useViewportCulling<T extends Token>(
  tokens: T[],
  viewport: ViewportState,
  options: CullingOptions = {}
): T[] {
  const { margin = 100, minScale = 0.1 } = options;

  const visibleTokens = useMemo(() => {
    // Skip culling if zoomed out too much (show all)
    if (viewport.scale < minScale) {
      return tokens;
    }

    // Calculate visible bounds in world coordinates
    const visibleBounds: Bounds = {
      x: (-viewport.x / viewport.scale) - margin,
      y: (-viewport.y / viewport.scale) - margin,
      width: (viewport.width / viewport.scale) + margin * 2,
      height: (viewport.height / viewport.scale) + margin * 2,
    };

    // Filter tokens within bounds
    return tokens.filter(token => {
      const tokenSize = token.size || token.radius || token.width || 50;

      // Check if token overlaps with visible bounds
      return isInBounds(
        token.x,
        token.y,
        tokenSize,
        visibleBounds
      );
    });
  }, [tokens, viewport.x, viewport.y, viewport.scale, viewport.width, viewport.height, margin, minScale]);

  return visibleTokens;
}

/**
 * Check if a point/circle is within bounds.
 */
function isInBounds(
  x: number,
  y: number,
  size: number,
  bounds: Bounds
): boolean {
  const halfSize = size / 2;

  return (
    x + halfSize >= bounds.x &&
    x - halfSize <= bounds.x + bounds.width &&
    y + halfSize >= bounds.y &&
    y - halfSize <= bounds.y + bounds.height
  );
}

/**
 * Hook for spatial partitioning using a simple grid.
 * Useful for quick spatial queries with many tokens.
 */
export function useSpatialGrid<T extends Token>(
  tokens: T[],
  cellSize: number = 200
) {
  const grid = useMemo(() => {
    const gridMap = new Map<string, T[]>();

    for (const token of tokens) {
      const cellX = Math.floor(token.x / cellSize);
      const cellY = Math.floor(token.y / cellSize);
      const key = `${cellX},${cellY}`;

      if (!gridMap.has(key)) {
        gridMap.set(key, []);
      }
      gridMap.get(key)!.push(token);
    }

    return gridMap;
  }, [tokens, cellSize]);

  const queryRegion = useCallback((bounds: Bounds): T[] => {
    const results: T[] = [];

    const minCellX = Math.floor(bounds.x / cellSize);
    const maxCellX = Math.floor((bounds.x + bounds.width) / cellSize);
    const minCellY = Math.floor(bounds.y / cellSize);
    const maxCellY = Math.floor((bounds.y + bounds.height) / cellSize);

    for (let cx = minCellX; cx <= maxCellX; cx++) {
      for (let cy = minCellY; cy <= maxCellY; cy++) {
        const key = `${cx},${cy}`;
        const cellTokens = grid.get(key);
        if (cellTokens) {
          results.push(...cellTokens);
        }
      }
    }

    return results;
  }, [grid, cellSize]);

  return { grid, queryRegion };
}

/**
 * QuadTree implementation for efficient spatial queries.
 */
export class QuadTree<T extends Token> {
  private boundary: Bounds;
  private capacity: number;
  private tokens: T[] = [];
  private divided = false;
  private northeast?: QuadTree<T>;
  private northwest?: QuadTree<T>;
  private southeast?: QuadTree<T>;
  private southwest?: QuadTree<T>;

  constructor(boundary: Bounds, capacity: number = 4) {
    this.boundary = boundary;
    this.capacity = capacity;
  }

  insert(token: T): boolean {
    // Check if token is in boundary
    if (!this.contains(token)) {
      return false;
    }

    // Add if capacity not reached
    if (this.tokens.length < this.capacity) {
      this.tokens.push(token);
      return true;
    }

    // Subdivide and insert
    if (!this.divided) {
      this.subdivide();
    }

    return (
      this.northeast!.insert(token) ||
      this.northwest!.insert(token) ||
      this.southeast!.insert(token) ||
      this.southwest!.insert(token)
    );
  }

  query(range: Bounds): T[] {
    const found: T[] = [];

    // Skip if range doesn't intersect boundary
    if (!this.intersects(range)) {
      return found;
    }

    // Check tokens in this node
    for (const token of this.tokens) {
      if (isInBounds(token.x, token.y, token.size || 50, range)) {
        found.push(token);
      }
    }

    // Query children
    if (this.divided) {
      found.push(...this.northeast!.query(range));
      found.push(...this.northwest!.query(range));
      found.push(...this.southeast!.query(range));
      found.push(...this.southwest!.query(range));
    }

    return found;
  }

  private contains(token: Token): boolean {
    return (
      token.x >= this.boundary.x &&
      token.x < this.boundary.x + this.boundary.width &&
      token.y >= this.boundary.y &&
      token.y < this.boundary.y + this.boundary.height
    );
  }

  private intersects(range: Bounds): boolean {
    return !(
      range.x > this.boundary.x + this.boundary.width ||
      range.x + range.width < this.boundary.x ||
      range.y > this.boundary.y + this.boundary.height ||
      range.y + range.height < this.boundary.y
    );
  }

  private subdivide(): void {
    const { x, y, width, height } = this.boundary;
    const hw = width / 2;
    const hh = height / 2;

    this.northeast = new QuadTree({ x: x + hw, y, width: hw, height: hh }, this.capacity);
    this.northwest = new QuadTree({ x, y, width: hw, height: hh }, this.capacity);
    this.southeast = new QuadTree({ x: x + hw, y: y + hh, width: hw, height: hh }, this.capacity);
    this.southwest = new QuadTree({ x, y: y + hh, width: hw, height: hh }, this.capacity);

    this.divided = true;
  }
}

/**
 * Hook to use QuadTree for spatial queries.
 */
export function useQuadTree<T extends Token>(
  tokens: T[],
  mapBounds: Bounds
) {
  const tree = useMemo(() => {
    const qt = new QuadTree<T>(mapBounds, 4);
    for (const token of tokens) {
      qt.insert(token);
    }
    return qt;
  }, [tokens, mapBounds.x, mapBounds.y, mapBounds.width, mapBounds.height]);

  const queryVisible = useCallback((viewport: ViewportState, margin: number = 100): T[] => {
    const visibleBounds: Bounds = {
      x: (-viewport.x / viewport.scale) - margin,
      y: (-viewport.y / viewport.scale) - margin,
      width: (viewport.width / viewport.scale) + margin * 2,
      height: (viewport.height / viewport.scale) + margin * 2,
    };

    return tree.query(visibleBounds);
  }, [tree]);

  return { tree, queryVisible };
}