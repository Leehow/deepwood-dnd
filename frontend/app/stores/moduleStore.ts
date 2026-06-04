import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createLogger } from '~/utils/logger';
import { apiFetch } from '~/utils/api-client';
import { getCurrentUserId } from '~/utils/user';
import {
  fetchAIMapMarkersCached,
  invalidateAIMapMarkersCache,
  setAIMapMarkersCache,
} from '~/utils/aiMapMarkersCache';
const logger = createLogger('moduleStore');

// Base path for static assets
const BASE_PATH = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL.replace(/\/$/, '') : '';


// 类型定义
export interface Module {
  id: string;
  title: string;
  title_en: string;
  description: string;
  version: string;
  author: string;
  level_range: string;
  player_count: string;
  estimated_time: string;
}

export interface Chapter {
  id: string;
  number: number;
  title: string;
  title_en: string;
  description: string;
  key_locations: string[];
  key_npcs: string[];
  encounters: string[];
  level_range: string;
}

export interface NPC {
  id: string;
  name: string;
  name_en: string;
  race: string;
  occupation: string;
  faction?: string;
  location: string;
  description: string;
  personality: Record<string, any>;
  knowledge: string[];
  secrets: string[];
  stats?: Record<string, any>;
  quest_giver: boolean;
  quests: string[];
  dialogue_samples?: string[];
  relationships?: Record<string, string>;
  personality_traits?: string;
  alignment?: string;
  hp?: number;
  ac?: number;
  is_combatant?: boolean;
  combat_stats?: {
    cr: number;
    hp: number;
    ac: number;
    attacks: any[];
  };
}

export interface Location {
  id: string;
  name: string;
  name_en: string;
  type: string;
  description: string;
  atmosphere?: string;
  lighting?: string;
  sounds?: string;
  smells?: string;
  connections?: string[];
  room_features?: string[];
}

export interface Quest {
  id: string;
  name: string;
  type: 'main' | 'side';
  giver: string | null;
  description: string;
  objectives: string[];
  rewards: {
    gold?: number;
    items?: string[];
    xp?: number;
  };
  prerequisites: string[];
  consequences: Record<string, any>;
}

export interface Faction {
  id: string;
  name: string;
  name_en: string;
  description: string;
  goals?: string[];
  members?: string[];
  relationships?: Record<string, string>;
}

export interface Encounter {
  id: string;
  name: string;
  location_ref: string;
  monsters: Array<{
    ref: string;
    qty: number;
    type: 'npc' | 'monster';
  }>;
  terrain?: string;
  trigger?: string;
  tactics?: string;
  initial_tokens?: Array<{
    monster_ref: string;
    x: number;
    y: number;
  }>;
}

export interface Monster {
  id: string;
  name: string;
  name_en?: string;
  cr: number;
  type: string;
  hp: number;
  ac: number;
  speed?: string;
  attacks?: any[];
  special_abilities?: any[];
  description?: string;
}

export interface Scene {
  id: string;
  title: string;
  chapter_id: string;
  location_ref?: string;
  read_aloud?: string;
  developments?: string[];
  checks?: Array<{
    skill: string;
    dc: number;
    on_success: string;
    on_fail: string;
  }>;
  treasure?: string[];
  xp?: number;
  dm_notes?: string;
  source?: {
    file: string;
    heading_path: string;
    line_range: [number, number];
  };
}

// AI生成的地图标记
export interface MapMarker {
  x: string;  // 百分比，如 "25%"
  y: string;  // 百分比，如 "30%"
  label: string;  // 简短标签
  content: string;  // 详细描述
}

export interface ModuleData {
  module: Module;
  chapters: Chapter[];
  npcs: NPC[];
  locations: Location[];
  quests: Quest[];
  factions: Faction[];
  encounters: Encounter[];
  items?: any[];
  maps?: any[];
  npcs_detailed?: NPC[];
  locations_detailed?: Location[];
  traps?: any[];
  treasures?: any[];
  dialogues?: any[];
  scenes?: Scene[];
}

export interface QuestProgress {
  [questId: string]: 'not_started' | 'in_progress' | 'completed';
}

interface ModuleStore {
  // 数据状态
  currentModule: ModuleData | null;
  selectedScene: Scene | null;
  selectedNPC: NPC | null;
  selectedMonster: Monster | null;
  selectedLocation: Location | null;
  selectedQuest: Quest | null;

  // AI生成的地图标记
  mapMarkers: MapMarker[];
  mapMarkersLoading: boolean;

  // 怪物库（通用 + 模组特有）
  allMonsters: Monster[];

  // 任务进度追踪（按战役 ID 存储）
  questProgress: Record<string, QuestProgress>; // { campaignId: { questId: status } }

  // Actions
  loadModule: (moduleData: ModuleData) => void;
  clearModule: () => void;

  selectScene: (sceneId: string | null) => void;
  selectNPC: (npcId: string | null) => void;
  selectMonster: (monsterId: string | null) => void;
  selectLocation: (locationId: string | null) => void;
  selectQuest: (questId: string | null) => void;

  // 地图标记管理（带持久化）
  setMapMarkers: (markers: MapMarker[]) => void;
  clearMapMarkers: () => void;
  loadAIMapMarkers: (campaignId: number, mapUrl: string) => Promise<void>;
  saveAIMapMarkers: (campaignId: number, mapUrl: string, markers: MapMarker[]) => Promise<void>;
  deleteAIMapMarkers: (campaignId: number, mapUrl: string) => Promise<void>;

  // 怪物库管理
  loadMonsters: () => Promise<void>;
  getMonstersForEncounter: (encounterId: string) => Monster[];

  // 任务进度管理
  updateQuestProgress: (campaignId: string, questId: string, status: 'not_started' | 'in_progress' | 'completed') => Promise<void>;
  getQuestProgress: (campaignId: string, questId: string) => 'not_started' | 'in_progress' | 'completed';
  loadQuestProgress: (campaignId: string) => Promise<void>;
}

export const useModuleStore = create<ModuleStore>()(
  persist(
    (set, get) => ({
      // 初始状态
      currentModule: null,
      selectedScene: null,
      selectedNPC: null,
      selectedMonster: null,
      selectedLocation: null,
      selectedQuest: null,
      mapMarkers: [],
      mapMarkersLoading: false,
      allMonsters: [],
      questProgress: {},

      // 加载模组
      loadModule: (moduleData: ModuleData) => {
        set({ currentModule: moduleData });
      },

      // 清空模组
      clearModule: () => {
        set({
          currentModule: null,
          selectedScene: null,
          selectedNPC: null,
          selectedMonster: null,
          selectedLocation: null,
          selectedQuest: null,
          mapMarkers: [],
        });
      },

      // 地图标记管理 - 仅本地状态
      setMapMarkers: (markers: MapMarker[]) => {
        set({ mapMarkers: markers });
      },

      clearMapMarkers: () => {
        set({ mapMarkers: [] });
      },

      // 从API加载AI地图标记
      loadAIMapMarkers: async (campaignId: number, mapUrl: string) => {
        if (!campaignId || !mapUrl) return;
        set({ mapMarkersLoading: true });
        try {
          const markers = await fetchAIMapMarkersCached(campaignId, mapUrl, {
            userId: getCurrentUserId(),
          });
          set({ mapMarkers: markers });
        } catch (error) {
          logger.error('Failed to load AI map markers:', error);
          set({ mapMarkers: [] });
        } finally {
          set({ mapMarkersLoading: false });
        }
      },

      // 保存AI地图标记到API
      saveAIMapMarkers: async (campaignId: number, mapUrl: string, markers: MapMarker[]) => {
        if (!campaignId || !mapUrl || markers.length === 0) return;
        try {
          const response = await apiFetch(
            `/api/campaigns/${campaignId}/ai-map-markers`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ map_url: mapUrl, markers }),
            }
          );
          if (response.ok) {
            const data = await response.json();
            set({ mapMarkers: data.markers });
            setAIMapMarkersCache(campaignId, mapUrl, data.markers || []);
            logger.info(`Saved ${markers.length} AI map markers to database`);
          }
        } catch (error) {
          logger.error('Failed to save AI map markers:', error);
        }
      },

      // 从API删除AI地图标记
      deleteAIMapMarkers: async (campaignId: number, mapUrl: string) => {
        if (!campaignId || !mapUrl) return;
        try {
          await apiFetch(
            `/api/campaigns/${campaignId}/ai-map-markers?map_url=${encodeURIComponent(mapUrl)}`,
            { method: 'DELETE' }
          );
          set({ mapMarkers: [] });
          invalidateAIMapMarkersCache(campaignId, mapUrl);
          logger.info('Deleted AI map markers from database');
        } catch (error) {
          logger.error('Failed to delete AI map markers:', error);
          // Still clear local state
          set({ mapMarkers: [] });
        }
      },

      // 选择场景
      selectScene: (sceneId: string | null) => {
        const { currentModule } = get();
        if (!sceneId || !currentModule?.scenes) {
          set({ selectedScene: null });
          return;
        }
        const scene = currentModule.scenes.find(s => s.id === sceneId);
        set({ selectedScene: scene || null });
      },
      
      // 选择 NPC
      selectNPC: (npcId: string | null) => {
        const { currentModule } = get();
        if (!npcId || !currentModule) {
          set({ selectedNPC: null });
          return;
        }
        const npc = currentModule.npcs.find(n => n.id === npcId);
        set({ selectedNPC: npc || null });
      },
      
      // 选择怪物
      selectMonster: (monsterId: string | null) => {
        const { allMonsters } = get();
        if (!monsterId) {
          set({ selectedMonster: null });
          return;
        }
        const monster = allMonsters.find(m => m.id === monsterId);
        set({ selectedMonster: monster || null });
      },
      
      // 选择地点
      selectLocation: (locationId: string | null) => {
        const { currentModule } = get();
        if (!locationId || !currentModule) {
          set({ selectedLocation: null });
          return;
        }
        const location = currentModule.locations.find(l => l.id === locationId);
        set({ selectedLocation: location || null });
      },
      
      // 选择任务
      selectQuest: (questId: string | null) => {
        const { currentModule } = get();
        if (!questId || !currentModule) {
          set({ selectedQuest: null });
          return;
        }
        const quest = currentModule.quests.find(q => q.id === questId);
        set({ selectedQuest: quest || null });
      },
      
      // 加载怪物库
      loadMonsters: async () => {
        try {
          const module = await import('~/data/npc/monsters.json');
          const data = module.default;
          // 全局配置是 {overview: {...}, monsters: [...]} 结构
          const monsters = data.monsters || data;
          set({ allMonsters: Array.isArray(monsters) ? monsters as unknown as Monster[] : [] });
        } catch (error) {
          logger.error('Failed to load monsters:', error);
        }
      },
      
      // 获取遭遇的怪物列表
      getMonstersForEncounter: (encounterId: string) => {
        const { currentModule, allMonsters } = get();
        if (!currentModule) return [];
        
        const encounter = currentModule.encounters.find(e => e.id === encounterId);
        if (!encounter) return [];
        
        const monsters: Monster[] = [];
        encounter.monsters.forEach(({ ref, type }) => {
          if (type === 'monster') {
            const monster = allMonsters.find(m => m.id === ref);
            if (monster) monsters.push(monster);
          } else if (type === 'npc') {
            const npc = currentModule.npcs.find(n => n.id === ref);
            if (npc && npc.combat_stats) {
              // 将 NPC 转换为怪物格式
              monsters.push({
                id: npc.id,
                name: npc.name,
                name_en: npc.name_en,
                cr: npc.combat_stats.cr,
                type: npc.race,
                hp: npc.combat_stats.hp,
                ac: npc.combat_stats.ac,
                attacks: npc.combat_stats.attacks,
              });
            }
          }
        });
        
        return monsters;
      },
      
      // 更新任务进度（同步到后端）
      updateQuestProgress: async (campaignId: string, questId: string, status: 'not_started' | 'in_progress' | 'completed') => {
        // 先更新本地状态
        set((state) => ({
          questProgress: {
            ...state.questProgress,
            [campaignId]: {
              ...state.questProgress[campaignId],
              [questId]: status,
            },
          },
        }));

        // 同步到后端
        try {
          const userId = getCurrentUserId();
          await apiFetch(`/api/quest-progress/${campaignId}/${questId}`, {
            method: 'PUT',
            headers: {
              'Content-Type': 'application/json',
            },
            userId,
            body: JSON.stringify({ status }),
          });
        } catch (error) {
          logger.error('Failed to sync quest progress to backend:', error);
        }
      },
      
        // 获取任务进度
        getQuestProgress: (campaignId: string, questId: string) => {
          const { questProgress } = get();
          return questProgress[campaignId]?.[questId] || 'not_started';
        },
      
        // 加载任务进度（从后端）
        loadQuestProgress: async (campaignId: string) => {
          try {
            const userId = getCurrentUserId();
            const response = await apiFetch(`/api/quest-progress/${campaignId}`, {
              userId,
            });

            if (response.ok) {
              const data = await response.json();
            set((state) => ({
              questProgress: {
                ...state.questProgress,
                [campaignId]: data.progress,
              },
            }));
          }
        } catch (error) {
          logger.error('Failed to load quest progress from backend:', error);
        }
      },
    }),
    {
      name: 'module-storage',
      partialize: (state) => ({
        // 仅持久化任务进度，AI地图标记存储在数据库中
        questProgress: state.questProgress,
      }),
    }
  )
);
