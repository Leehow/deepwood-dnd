/**
 * Fog of War管理器 - 处理迷雾数据和操作
 * 迷雾数据格式：Set of "x,y" strings（网格坐标）
 */

export interface FogData {
  mapUrl: string;
  cells: Array<[number, number]>; // [x, y] 网格坐标
}

export class FogOfWarManager {
  private fogCells: Set<string> = new Set();
  private mapUrl: string = "";

  constructor(mapUrl: string, initialData?: FogData) {
    this.mapUrl = mapUrl;
    if (initialData && initialData.mapUrl === mapUrl) {
      this.fogCells = new Set(initialData.cells.map(([x, y]) => `${x},${y}`));
    }
  }

  /**
   * 检查某个网格单元是否被迷雾覆盖
   */
  isCovered(gridX: number, gridY: number): boolean {
    return this.fogCells.has(`${gridX},${gridY}`);
  }

  /**
   * 添加迷雾到指定网格区域（笔刷）
   */
  addFog(gridX: number, gridY: number, brushSize: number = 1): Set<string> {
    const affectedCells = new Set<string>();
    const radius = Math.floor(brushSize / 2);

    for (let x = gridX - radius; x <= gridX + radius; x++) {
      for (let y = gridY - radius; y <= gridY + radius; y++) {
        const key = `${x},${y}`;
        if (!this.fogCells.has(key)) {
          this.fogCells.add(key);
          affectedCells.add(key);
        }
      }
    }

    return affectedCells;
  }

  /**
   * 从指定网格区域移除迷雾（橡皮）
   */
  removeFog(gridX: number, gridY: number, brushSize: number = 1): Set<string> {
    const affectedCells = new Set<string>();
    const radius = Math.floor(brushSize / 2);

    for (let x = gridX - radius; x <= gridX + radius; x++) {
      for (let y = gridY - radius; y <= gridY + radius; y++) {
        const key = `${x},${y}`;
        if (this.fogCells.has(key)) {
          this.fogCells.delete(key);
          affectedCells.add(key);
        }
      }
    }

    return affectedCells;
  }

  /**
   * 填充整个地图为迷雾
   */
  fillAll(mapWidth: number, mapHeight: number): Set<string> {
    const affectedCells = new Set<string>();

    for (let x = 0; x < mapWidth; x++) {
      for (let y = 0; y < mapHeight; y++) {
        const key = `${x},${y}`;
        if (!this.fogCells.has(key)) {
          this.fogCells.add(key);
          affectedCells.add(key);
        }
      }
    }

    return affectedCells;
  }

  /**
   * 清除所有迷雾
   */
  clearAll(): Set<string> {
    const affectedCells = new Set(this.fogCells);
    this.fogCells.clear();
    return affectedCells;
  }

  /**
   * 获取所有迷雾数据（用于保存）
   */
  getData(): FogData {
    const cells = Array.from(this.fogCells).map(key => {
      const [x, y] = key.split(",").map(Number);
      return [x, y] as [number, number];
    });

    return {
      mapUrl: this.mapUrl,
      cells,
    };
  }

  /**
   * 获取所有迷雾网格坐标
   */
  getAllCells(): Set<string> {
    return new Set(this.fogCells);
  }

  /**
   * 更新地图URL（不清除迷雾，迷雾由外部管理）
   */
  setMapUrl(newMapUrl: string): void {
    this.mapUrl = newMapUrl;
  }
}
