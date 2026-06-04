/**
 * TerrainManager - 管理地形数据和操作
 * 地形数据格式：Map of "x,y" → TerrainCell
 */

export type TerrainType =
  | "difficult"
  | "hazardous"
  | "water_shallow"
  | "water_deep"
  | "impassable"
  | "lightly_obscured"
  | "heavily_obscured"
  | "half_cover"
  | "three_quarter_cover";

export interface TerrainCell {
  x: number;
  y: number;
  type: TerrainType;
  properties?: {
    damage_type?: string;
    damage_dice?: string;
    source?: "spell" | "manual";
    spell_name?: string;
  };
}

export interface TerrainData {
  mapUrl: string;
  cells: TerrainCell[];
}

export interface TerrainTypeConfig {
  type: TerrainType;
  label: string;
  color: string;
  opacity: number;
  icon: string;
  description: string;
}

export const TERRAIN_TYPES: TerrainTypeConfig[] = [
  { type: "difficult", label: "困难地形", color: "#92400e", opacity: 0.4, icon: "🪨", description: "移动消耗×2" },
  { type: "hazardous", label: "危险地形", color: "#dc2626", opacity: 0.35, icon: "🔥", description: "进入/移动时受伤" },
  { type: "water_shallow", label: "浅水", color: "#38bdf8", opacity: 0.35, icon: "💧", description: "困难地形" },
  { type: "water_deep", label: "深水", color: "#1e40af", opacity: 0.45, icon: "🌊", description: "需要游泳" },
  { type: "impassable", label: "不可通行", color: "#374151", opacity: 0.6, icon: "🚫", description: "无法进入" },
  { type: "lightly_obscured", label: "轻度遮蔽", color: "#9ca3af", opacity: 0.3, icon: "🌫️", description: "感知劣势" },
  { type: "heavily_obscured", label: "重度遮蔽", color: "#4b5563", opacity: 0.5, icon: "🌑", description: "等同致盲" },
  { type: "half_cover", label: "半身掩护", color: "#d97706", opacity: 0.35, icon: "🛡️", description: "AC+2" },
  { type: "three_quarter_cover", label: "3/4掩护", color: "#b45309", opacity: 0.45, icon: "🏰", description: "AC+5" },
];

export const TERRAIN_TYPE_MAP = new Map(TERRAIN_TYPES.map(t => [t.type, t]));

export class TerrainManager {
  private cells: Map<string, TerrainCell> = new Map();
  private mapUrl: string = "";

  constructor(mapUrl: string, initialData?: TerrainData) {
    this.mapUrl = mapUrl;
    if (initialData && initialData.mapUrl === mapUrl) {
      for (const cell of initialData.cells) {
        this.cells.set(`${cell.x},${cell.y}`, cell);
      }
    }
  }

  getCell(gridX: number, gridY: number): TerrainCell | undefined {
    return this.cells.get(`${gridX},${gridY}`);
  }

  paintTerrain(gridX: number, gridY: number, type: TerrainType, brushSize: number = 1): Set<string> {
    const affected = new Set<string>();
    const radius = Math.floor(brushSize / 2);
    for (let x = gridX - radius; x <= gridX + radius; x++) {
      for (let y = gridY - radius; y <= gridY + radius; y++) {
        const key = `${x},${y}`;
        const existing = this.cells.get(key);
        if (!existing || existing.type !== type) {
          this.cells.set(key, { x, y, type, properties: { source: "manual" } });
          affected.add(key);
        }
      }
    }
    return affected;
  }

  eraseTerrain(gridX: number, gridY: number, brushSize: number = 1): Set<string> {
    const affected = new Set<string>();
    const radius = Math.floor(brushSize / 2);
    for (let x = gridX - radius; x <= gridX + radius; x++) {
      for (let y = gridY - radius; y <= gridY + radius; y++) {
        const key = `${x},${y}`;
        if (this.cells.has(key)) {
          this.cells.delete(key);
          affected.add(key);
        }
      }
    }
    return affected;
  }

  clearAll(): void {
    this.cells.clear();
  }

  loadData(data: TerrainData): void {
    this.cells.clear();
    if (data?.cells) {
      for (const cell of data.cells) {
        this.cells.set(`${cell.x},${cell.y}`, cell);
      }
    }
  }

  getData(): TerrainData {
    return {
      mapUrl: this.mapUrl,
      cells: Array.from(this.cells.values()),
    };
  }

  getAllCells(): Map<string, TerrainCell> {
    return new Map(this.cells);
  }

  getCellCount(): number {
    return this.cells.size;
  }

  setMapUrl(newMapUrl: string): void {
    this.mapUrl = newMapUrl;
  }
}
