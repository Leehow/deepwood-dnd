/**
 * Resource_AIQueryTab - 资源AI询问组件
 * 使用Function Calling架构，支持查询、创建遭遇、创建商店、创建物品
 */
import { useState, useEffect, useRef, useCallback, memo, useMemo } from "react";
import { createPortal } from "react-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { createLogger } from '~/utils/logger';
import { apiFetch } from "~/utils/api-client";
import { useTTS } from '~/hooks/useTTS';
import { useVoiceStore } from '~/stores/voiceStore';

const logger = createLogger('Resource_AIQueryTab');

interface EncounterMonster {
  name: string;
  name_cn?: string;
  name_en?: string;
  quantity: number;
  monster_id?: string;
  matched: boolean;
  cr?: string;
  hp?: number;
  ac?: number;
  size?: string;
  type?: string;
  generated_stats?: {
    cr?: string;
    hp?: number;
    hpFormula?: string;
    ac?: number;
    size?: string;
    type?: string;
    alignment?: string;
    speed?: Record<string, number>;
    abilityScores?: Record<string, number>;
    specialAbilities?: { name: string; description: string }[];
    actions?: { name: string; description: string }[];
    description?: string;
  };
}

interface EncounterPlan {
  monsters: EncounterMonster[];
  difficulty?: string;
  notes?: string;
}

interface ShopPlan {
  name: string;
  description: string;
  appearance?: string;
  gold_gp: number;
  discount_rate: number;
}

interface ItemPlan {
  name: string;
  name_cn?: string;
  category: string;
  rarity: string;
  description: string;
  damage?: { dice: string; type: string };
  armor_class?: { base: number; dex_bonus?: boolean };
  magic_bonus?: number;
  requires_attunement?: boolean;
  attunement_by?: string;
  abilities?: { name: string; type: string; description: string }[];
  charges?: { max: number; recharge?: string };
}

interface ChestItemSpec {
  name: string;
  quantity?: number;
  category?: string;
  rarity?: string;
  description?: string;
}

interface ChestPlan {
  name: string;
  description: string;
  appearance?: string;
  is_locked: boolean;
  lock_dc: number;
  requires_key: boolean;
  key_name?: string;
  is_trapped: boolean;
  trap_type?: string;
  currency?: { cp?: number; sp?: number; ep?: number; gp?: number; pp?: number };
  items?: ChestItemSpec[];
}

// Search results for "add to library" feature
interface SearchResultMonster {
  name: string;
  name_en?: string;
  cr?: string;
  type?: string;
  size?: string;
  hp?: number;
  ac?: number;
  monster_id?: string;
  matched: boolean;
  avatar_url?: string;
}

interface SearchResultItem {
  name: string;
  name_en?: string;
  preset_id?: string;
  category?: string;
  cost_gp?: number;
  matched: boolean;
  avatar_url?: string;
}

interface SearchResults {
  monsters?: SearchResultMonster[];
  items?: SearchResultItem[];
}

interface ToolCall {
  tool: string;
  encounter_plan?: EncounterPlan;
  shop_plan?: ShopPlan;
  item_plan?: ItemPlan;
  chest_plan?: ChestPlan;
  scene_plan?: ScenePlan;
}

// Scene generation interfaces
interface SceneNPCQuest {
  name: string;
  description: string;
  reward?: string;
}

interface SceneNPC {
  name: string;
  name_cn: string;
  role: string;
  description: string;
  position_percent: { x: number; y: number };  // 百分比坐标 (0-100)
  quest?: SceneNPCQuest;  // 可选的任务
}

interface SceneShop {
  name: string;
  type: string;
  description: string;
  position_percent: { x: number; y: number };  // 百分比坐标 (0-100)
}

interface ScenePlan {
  summary: string;
  npcs: SceneNPC[];
  shops: SceneShop[];
}

// Module map item for finding chapter associations
interface ModuleMapItem {
  url: string;
  chapter?: string;
  name?: string;
}

// Chapter tree node
interface ChapterNode {
  title: string;
  content?: string;
  children?: ChapterNode[];
}

interface ChatMessage {
  id?: number;
  role: 'user' | 'assistant';
  content: string;
  context?: { monsters: number; items: number };
  isStreaming?: boolean;
  tool_calls?: ToolCall[];
  search_results?: SearchResults;
}

interface Props {
  campaignId: number;
  userId: string;
  viewportCenter?: { x: number; y: number };
  // Scene generation props - can be passed in or fetched dynamically
  currentMapUrl?: string;
  moduleMaps?: ModuleMapItem[];
  chapterTree?: ChapterNode[];
  // Module ID for fetching data if not passed
  moduleId?: number;
}

// Loading indicator
const LoadingIndicator = () => (
  <span className="inline-flex items-center gap-0.5 ml-2">
    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '150ms' }} />
    <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" style={{ animationDelay: '300ms' }} />
  </span>
);

// Encounter Confirmation Card
function EncounterConfirmCard({ plan, onConfirm, onCancel, isCreating }: {
  plan: EncounterPlan; onConfirm: () => void; onCancel: () => void; isCreating: boolean;
}) {
  return (
    <div className="mt-3 p-3 bg-amber-950/30 border border-amber-700/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">⚔️</span>
        <span className="text-amber-300 font-semibold text-sm">遭遇计划</span>
        {plan.difficulty && (
          <span className={`text-xs px-2 py-0.5 rounded ${
            plan.difficulty === '致命' ? 'bg-red-900/50 text-red-300' :
            plan.difficulty === '困难' ? 'bg-orange-900/50 text-orange-300' :
            plan.difficulty === '中等' ? 'bg-yellow-900/50 text-yellow-300' :
            'bg-green-900/50 text-green-300'
          }`}>{plan.difficulty}</span>
        )}
      </div>
      <div className="space-y-2 mb-3">
        {plan.monsters.map((m, idx) => (
          <div key={idx} className="flex items-center justify-between bg-gray-900/50 rounded px-2 py-1.5">
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${m.matched ? 'bg-green-500' : 'bg-yellow-500'}`} />
              <span className="text-gray-200 text-sm">{m.name}</span>
            </div>
            <div className="flex items-center gap-3 text-xs">
              {m.cr && <span className="text-orange-400">CR {m.cr}</span>}
              {m.hp && <span className="text-green-400">HP {typeof m.hp === 'object' ? ((m.hp as any)?.average || (m.hp as any)?.dice || '') : m.hp}</span>}
              <span className="text-amber-300 font-medium">x{m.quantity}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-2">
        <button onClick={onConfirm} disabled={isCreating}
          className="flex-1 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:bg-amber-800/50 text-white text-sm rounded transition-all flex items-center justify-center gap-2">
          {isCreating ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <span>正在创建怪物...</span>
            </>
          ) : '✓ 确认创建'}
        </button>
        <button onClick={onCancel} disabled={isCreating}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm rounded transition-all">取消</button>
      </div>
    </div>
  );
}

// Shop Confirmation Card
function ShopConfirmCard({ plan, onConfirm, onCancel, isCreating }: {
  plan: ShopPlan; onConfirm: () => void; onCancel: () => void; isCreating: boolean;
}) {
  return (
    <div className="mt-3 p-3 bg-blue-950/30 border border-blue-700/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">🏪</span>
        <span className="text-blue-300 font-semibold text-sm">商店: {plan.name}</span>
      </div>
      <div className="space-y-1 mb-3 text-sm">
        <p className="text-gray-300">{plan.description}</p>
        <div className="flex gap-4 text-xs text-gray-400">
          <span>💰 {plan.gold_gp} gp</span>
          <span>📊 回收率 {Math.round(plan.discount_rate * 100)}%</span>
        </div>
      </div>
      <div className="flex gap-2">
        <button onClick={onConfirm} disabled={isCreating}
          className="flex-1 px-3 py-1.5 bg-blue-700 hover:bg-blue-600 disabled:bg-blue-800/50 text-white text-sm rounded transition-all flex items-center justify-center gap-2">
          {isCreating ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <span>正在创建商店...</span>
            </>
          ) : '✓ 确认创建'}
        </button>
        <button onClick={onCancel} disabled={isCreating}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm rounded transition-all">取消</button>
      </div>
    </div>
  );
}

// Item Confirmation Card
function ItemConfirmCard({ plan, onConfirm, onCancel, isCreating }: {
  plan: ItemPlan; onConfirm: () => void; onCancel: () => void; isCreating: boolean;
}) {
  const rarityColors: Record<string, string> = {
    common: 'text-gray-300', uncommon: 'text-green-400', rare: 'text-blue-400',
    very_rare: 'text-purple-400', legendary: 'text-orange-400', artifact: 'text-red-400'
  };
  return (
    <div className="mt-3 p-3 bg-purple-950/30 border border-purple-700/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">✨</span>
        <span className="text-purple-300 font-semibold text-sm">{plan.name_cn || plan.name}</span>
        <span className={`text-xs ${rarityColors[plan.rarity] || 'text-gray-400'}`}>
          [{plan.rarity}]
        </span>
      </div>
      <div className="space-y-1 mb-3 text-sm">
        <p className="text-gray-300 text-xs">{plan.description}</p>
        <div className="flex flex-wrap gap-2 text-xs">
          {plan.damage && <span className="text-red-400">⚔️ {plan.damage.dice} {plan.damage.type}</span>}
          {plan.armor_class && <span className="text-blue-400">🛡️ AC {plan.armor_class.base}</span>}
          {plan.magic_bonus && <span className="text-yellow-400">+{plan.magic_bonus}</span>}
          {plan.requires_attunement && <span className="text-purple-400">需要调谐</span>}
        </div>
        {plan.abilities && plan.abilities.length > 0 && (
          <div className="text-xs text-gray-400 mt-1">
            能力: {plan.abilities.map(a => a.name).join(', ')}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onConfirm} disabled={isCreating}
          className="flex-1 px-3 py-1.5 bg-purple-700 hover:bg-purple-600 disabled:bg-purple-800/50 text-white text-sm rounded transition-all flex items-center justify-center gap-2">
          {isCreating ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <span>正在创建物品...</span>
            </>
          ) : '✓ 确认创建'}
        </button>
        <button onClick={onCancel} disabled={isCreating}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm rounded transition-all">取消</button>
      </div>
    </div>
  );
}

// Chest Confirmation Card
function ChestConfirmCard({ plan, onConfirm, onCancel, isCreating }: {
  plan: ChestPlan; onConfirm: () => void; onCancel: () => void; isCreating: boolean;
}) {
  const trapNames: Record<string, string> = {
    poison_needle: '毒针', fire_trap: '火焰', alarm: '警报',
    acid_spray: '强酸喷射', poison_gas: '毒气', blade_trap: '刀刃'
  };

  const formatCurrency = (currency: ChestPlan['currency']) => {
    if (!currency) return null;
    const parts = [];
    if (currency.pp) parts.push(`${currency.pp}铂`);
    if (currency.gp) parts.push(`${currency.gp}金`);
    if (currency.ep) parts.push(`${currency.ep}银金`);
    if (currency.sp) parts.push(`${currency.sp}银`);
    if (currency.cp) parts.push(`${currency.cp}铜`);
    return parts.length > 0 ? parts.join(' ') : null;
  };

  const currencyStr = formatCurrency(plan.currency);

  return (
    <div className="mt-3 p-3 bg-amber-950/30 border border-amber-700/50 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg">📦</span>
        <span className="text-amber-300 font-semibold text-sm">{plan.name}</span>
      </div>
      <div className="space-y-1 mb-3 text-sm">
        {plan.description && <p className="text-gray-300 text-xs">{plan.description}</p>}
        <div className="flex flex-wrap gap-2 text-xs">
          {plan.is_locked && (
            <span className="text-yellow-400">
              🔒 {plan.requires_key ? `需要钥匙(${plan.key_name || '未知'})` : `DC${plan.lock_dc}`}
            </span>
          )}
          {plan.is_trapped && plan.trap_type && (
            <span className="text-red-400">⚠️ {trapNames[plan.trap_type] || plan.trap_type}陷阱</span>
          )}
          {currencyStr && <span className="text-yellow-300">💰 {currencyStr}</span>}
        </div>
        {plan.items && plan.items.length > 0 && (
          <div className="text-xs text-gray-400 mt-1">
            物品: {plan.items.map(i => `${i.name}${i.quantity && i.quantity > 1 ? `x${i.quantity}` : ''}`).join(', ')}
          </div>
        )}
      </div>
      <div className="flex gap-2">
        <button onClick={onConfirm} disabled={isCreating}
          className="flex-1 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 disabled:bg-amber-800/50 text-white text-sm rounded transition-all flex items-center justify-center gap-2">
          {isCreating ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <span>正在创建宝箱...</span>
            </>
          ) : '✓ 确认创建'}
        </button>
        <button onClick={onCancel} disabled={isCreating}
          className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm rounded transition-all">取消</button>
      </div>
    </div>
  );
}

// Scene Creation Button (简化版 - 只显示按钮)
function SceneCreateButton({ plan, onConfirm, onCancel, isCreating, creationProgress }: {
  plan: ScenePlan; onConfirm: () => void; onCancel: () => void; isCreating: boolean;
  creationProgress?: string;
}) {
  const npcCount = plan.npcs.length;
  const shopCount = plan.shops.length;
  const questCount = plan.npcs.filter(n => n.quest).length;

  return (
    <div className="mt-3 p-3 bg-gradient-to-br from-indigo-950/30 to-purple-950/30 border border-indigo-700/40 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2 text-xs text-gray-400">
          {npcCount > 0 && <span>👤 {npcCount}个NPC</span>}
          {shopCount > 0 && <span>🏪 {shopCount}个商店</span>}
          {questCount > 0 && <span>📜 {questCount}个任务</span>}
        </div>
      </div>

      {isCreating && creationProgress && (
        <div className="mb-2 text-xs text-indigo-300">{creationProgress}</div>
      )}

      <div className="flex gap-2">
        <button onClick={onConfirm} disabled={isCreating}
          className="flex-1 px-3 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 disabled:from-gray-700 disabled:to-gray-700 text-white text-sm rounded-lg transition-all flex items-center justify-center gap-2">
          {isCreating ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
              <span>正在创建...</span>
            </>
          ) : (
            <>
              <span>🎭</span>
              <span>创建场景</span>
            </>
          )}
        </button>
        <button onClick={onCancel} disabled={isCreating}
          className="px-3 py-2 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-300 text-sm rounded-lg transition-all">
          取消
        </button>
      </div>
    </div>
  );
}

// Search Result Card - for adding search results to resource library
function SearchResultCard({ results, onAddMonster, onAddItem, addingMonster, addingItem, onImageClick }: {
  results: SearchResults;
  onAddMonster: (m: SearchResultMonster) => void;
  onAddItem: (i: SearchResultItem) => void;
  addingMonster: string | null;
  addingItem: string | null;
  onImageClick?: (src: string) => void;
}) {
  const hasMonsters = (results.monsters?.length ?? 0) > 0;
  const hasItems = (results.items?.length ?? 0) > 0;
  if (!hasMonsters && !hasItems) return null;

  return (
    <div className="mt-3 pt-2 border-t border-gray-700/30 space-y-2">
      {/* Monsters */}
      {hasMonsters && (
        <div>
          <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            <span>🐉</span>
            <span>找到的怪物（点击添加到资源库）：</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {results.monsters!.map((m, i) => (
              <button
                key={i}
                onClick={() => onAddMonster(m)}
                disabled={addingMonster !== null || addingItem !== null}
                className={`px-2.5 py-1.5 text-xs rounded-lg transition-all flex items-center gap-1.5 ${
                  m.matched
                    ? 'bg-red-900/40 hover:bg-red-800/50 text-red-300 border border-red-700/50'
                    : 'bg-orange-900/40 hover:bg-orange-800/50 text-orange-300 border border-orange-700/50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {addingMonster === m.name ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                    <span>添加中...</span>
                  </>
                ) : (
                  <>
                    {m.avatar_url ? (
                      <img
                        src={m.avatar_url}
                        alt=""
                        className="w-5 h-5 rounded-sm object-cover flex-shrink-0 cursor-pointer hover:opacity-70"
                        onClick={(e) => {
                          e.stopPropagation();
                          onImageClick?.(m.avatar_url!.replace('_128.', '_512.'));
                        }}
                      />
                    ) : (
                      <span>+</span>
                    )}
                    <span>{m.name}</span>
                    {m.cr && <span className="text-[10px] opacity-70">CR{m.cr}</span>}
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Items */}
      {hasItems && (
        <div>
          <p className="text-xs text-gray-500 mb-2 flex items-center gap-1">
            <span>📦</span>
            <span>找到的物品（点击添加到资源库）：</span>
          </p>
          <div className="flex flex-wrap gap-2">
            {results.items!.map((item, i) => (
              <button
                key={i}
                onClick={() => onAddItem(item)}
                disabled={addingMonster !== null || addingItem !== null}
                className={`px-2.5 py-1.5 text-xs rounded-lg transition-all flex items-center gap-1.5 ${
                  item.matched
                    ? 'bg-blue-900/40 hover:bg-blue-800/50 text-blue-300 border border-blue-700/50'
                    : 'bg-cyan-900/40 hover:bg-cyan-800/50 text-cyan-300 border border-cyan-700/50'
                } disabled:opacity-50 disabled:cursor-not-allowed`}
              >
                {addingItem === item.name ? (
                  <>
                    <div className="w-3 h-3 rounded-full border-2 border-current/30 border-t-current animate-spin" />
                    <span>添加中...</span>
                  </>
                ) : (
                  <>
                    {item.avatar_url ? (
                      <img
                        src={item.avatar_url}
                        alt=""
                        className="w-5 h-5 rounded-sm object-cover flex-shrink-0 cursor-pointer hover:opacity-70"
                        onClick={(e) => {
                          e.stopPropagation();
                          onImageClick?.(item.avatar_url!);
                        }}
                      />
                    ) : (
                      <span>+</span>
                    )}
                    <span>{item.name}</span>
                    {item.cost_gp !== undefined && item.cost_gp > 0 && (
                      <span className="text-[10px] opacity-70">{item.cost_gp}gp</span>
                    )}
                  </>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ===== Pure Helper Functions (outside component to avoid re-creation) =====

// Inject avatar images above heading lines for matched entities (monsters + items)
function injectEntityAvatars(content: string, searchResults?: SearchResults): string {
  if (!searchResults) return content;
  let result = content;
  const entities: { name: string; avatar_url: string }[] = [];
  for (const m of searchResults.monsters || []) {
    if (m.avatar_url && m.name) entities.push({ name: m.name, avatar_url: m.avatar_url });
  }
  for (const i of searchResults.items || []) {
    if (i.avatar_url && i.name) entities.push({ name: i.name, avatar_url: i.avatar_url });
  }
  for (const e of entities) {
    const esc = e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^(#{1,3}\\s+[^\\n]*${esc}[^\\n]*)`, 'm');
    result = result.replace(re, `![${e.name}](${e.avatar_url})\n\n$1`);
  }
  return result;
}

// ===== Stable Markdown Components (never re-created) =====

function createResourceMarkdownComponents(onImageClick: (src: string) => void) {
  return {
    h1: ({ children }: { children?: React.ReactNode }) => <h1 className="text-base font-bold text-emerald-400 mt-3 mb-2 border-b border-emerald-900/30 pb-1">{children}</h1>,
    h2: ({ children }: { children?: React.ReactNode }) => <h2 className="text-sm font-bold text-emerald-300 mt-3 mb-1">{children}</h2>,
    h3: ({ children }: { children?: React.ReactNode }) => <h3 className="text-sm font-semibold text-emerald-200/90 mt-2 mb-1">{children}</h3>,
    p: ({ children }: { children?: React.ReactNode }) => <p className="my-1.5 leading-relaxed text-gray-300">{children}</p>,
    ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-1.5 space-y-1 ml-1">{children}</ul>,
    li: ({ children }: { children?: React.ReactNode }) => (
      <li className="flex items-start gap-2 text-gray-300">
        <span className="text-emerald-500 mt-1.5 text-[6px]">●</span>
        <span className="flex-1">{children}</span>
      </li>
    ),
    strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold text-emerald-200">{children}</strong>,
    img: ({ src, alt }: { src?: string; alt?: string }) => {
      const largeSrc = src?.replace('_128.', '_512.').replace('-icons/', '-icons/');
      return (
        <img
          src={src}
          alt={alt || ''}
          className="w-16 h-16 rounded-lg object-cover border border-gray-600/50 my-1 cursor-pointer hover:opacity-80 transition-opacity"
          onClick={(e) => { e.stopPropagation(); onImageClick(largeSrc || src || ''); }}
        />
      );
    },
  } as const;
}

const remarkPluginsStable = [remarkGfm];

// ===== Memoized Markdown Renderer =====
const MemoizedResourceMarkdown = memo(function MemoizedResourceMarkdown({
  content,
  searchResults,
  onImageClick,
}: {
  content: string;
  searchResults?: SearchResults;
  onImageClick: (src: string) => void;
}) {
  const processed = useMemo(() => injectEntityAvatars(content, searchResults), [content, searchResults]);
  const components = useMemo(() => createResourceMarkdownComponents(onImageClick), [onImageClick]);
  return (
    <ReactMarkdown
      remarkPlugins={remarkPluginsStable}
      components={components as any}
    >
      {processed}
    </ReactMarkdown>
  );
});

export function Resource_AIQueryTab({ campaignId, userId, viewportCenter, currentMapUrl, moduleMaps, chapterTree, moduleId }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [isCreatingEncounter, setIsCreatingEncounter] = useState(false);
  const [isCreatingShop, setIsCreatingShop] = useState(false);
  const [isCreatingItem, setIsCreatingItem] = useState(false);
  const [isCreatingChest, setIsCreatingChest] = useState(false);
  const [isGeneratingScene, setIsGeneratingScene] = useState(false);
  const [isCreatingScene, setIsCreatingScene] = useState(false);
  const [sceneCreationProgress, setSceneCreationProgress] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [pendingEncounter, setPendingEncounter] = useState<{ plan: EncounterPlan; messageIdx: number } | null>(null);
  const [pendingShop, setPendingShop] = useState<{ plan: ShopPlan; messageIdx: number } | null>(null);
  const [pendingItem, setPendingItem] = useState<{ plan: ItemPlan; messageIdx: number } | null>(null);
  const [pendingChest, setPendingChest] = useState<{ plan: ChestPlan; messageIdx: number } | null>(null);
  const [pendingScene, setPendingScene] = useState<{ plan: ScenePlan; messageIdx: number } | null>(null);
  // Search result adding states
  const [addingMonster, setAddingMonster] = useState<string | null>(null);
  const [addingItem, setAddingItem] = useState<string | null>(null);
  // Collapse states
  const [collapsedMessages, setCollapsedMessages] = useState<Set<number>>(new Set());

  // Dynamic module data state (fetched when needed)
  const [dynamicModuleMaps, setDynamicModuleMaps] = useState<ModuleMapItem[]>([]);
  const [dynamicChapterTree, setDynamicChapterTree] = useState<ChapterNode[]>([]);
  const [dynamicMapUrl, setDynamicMapUrl] = useState<string | undefined>();

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const isAtBottomRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const { handleTTS, handleTTSBroadcast, handleTTSRegenerate, ttsPlayingId, ttsLoading, stopPlayback } = useTTS(String(campaignId));
  const voiceIsConnected = useVoiceStore(s => s.isConnected);
  const [ttsMenuMsgId, setTtsMenuMsgId] = useState<number | null>(null);
  const ttsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ttsMenuMsgId) return;
    const handler = (e: MouseEvent) => {
      if (ttsMenuRef.current && !ttsMenuRef.current.contains(e.target as Node)) setTtsMenuMsgId(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ttsMenuMsgId]);

  // Mode toggle: 'query' for searching resources, 'create' for creating encounters/shops/items
  const [mode, setMode] = useState<'query' | 'create'>('query');
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);

  // Escape key to close lightbox
  useEffect(() => {
    if (!lightboxSrc) return;
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxSrc(null); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [lightboxSrc]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" });
    isAtBottomRef.current = true;
    setShowScrollBtn(false);
  }, []);

  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    isAtBottomRef.current = atBottom;
    setShowScrollBtn(!atBottom);
  }, []);

  useEffect(() => {
    if (isAtBottomRef.current) scrollToBottom();
  }, [messages, scrollToBottom]);

  // Generate summary for collapsed messages
  const generateSummary = (content: string): string => {
    let plain = content
      .replace(/^#+\s*/gm, '')
      .replace(/\*+([^*]+)\*+/g, '$1')
      .replace(/\n{2,}/g, '\n')
      .trim();
    const lines = plain.split('\n').filter(l => l.trim().length > 10);
    const firstLine = lines[0] || plain.substring(0, 100);
    if (firstLine.length > 100) return firstLine.substring(0, 97) + '...';
    return firstLine + (lines.length > 1 ? '...' : '');
  };

  // Toggle collapse state
  const toggleCollapse = (messageId: number) => {
    setCollapsedMessages(prev => {
      const newSet = new Set(prev);
      if (newSet.has(messageId)) newSet.delete(messageId);
      else newSet.add(messageId);
      localStorage.setItem(`resource_chat_collapsed_${campaignId}_${userId}`, JSON.stringify([...newSet]));
      return newSet;
    });
  };

  // Load collapsed state from localStorage
  useEffect(() => {
    const saved = localStorage.getItem(`resource_chat_collapsed_${campaignId}_${userId}`);
    if (saved) {
      try { setCollapsedMessages(new Set(JSON.parse(saved) as number[])); } catch { /* ignore */ }
    }
  }, [campaignId, userId]);

  // Load chat history
  useEffect(() => {
    const loadHistory = async () => {
      setIsReady(false);
      try {
        const response = await apiFetch(
          `/api/campaigns/${campaignId}/resource-chat?limit=50`
        );
        if (response.ok) {
          const data = await response.json();
          // Parse stored messages (some may have tool_calls or scene_plan stored as JSON)
          let lastScenePlan: ScenePlan | null = null;
          let lastSceneMessageIdx = -1;
          let sceneCreatedAfterPlan = false;
          const parsedMessages = (data.messages || []).map((m: any, idx: number) => {
            if (m.role === 'assistant' && m.content) {
              try {
                const parsed = JSON.parse(m.content);
                if (parsed.type === 'agent_response') {
                  return {
                    ...m,
                    content: parsed.content || '',
                    tool_calls: parsed.tool_calls,
                    search_results: parsed.search_results  // Also restore search results
                  };
                }
                if (parsed.type === 'scene_plan') {
                  // Restore scene plan for "create scene" button
                  lastScenePlan = parsed.plan;
                  lastSceneMessageIdx = idx;
                  sceneCreatedAfterPlan = false; // Reset flag
                  return { ...m, content: parsed.content || '', scenePlan: parsed.plan };
                }
                if (parsed.type === 'scene_created') {
                  // Scene was already created, don't show "create scene" button
                  sceneCreatedAfterPlan = true;
                  return { ...m, content: parsed.content || '' };
                }
              } catch { /* not JSON, use as-is */ }
            }
            return m;
          });
          setMessages(parsedMessages);
          // Only restore pending scene if there's a scene_plan but NO subsequent scene_created
          if (lastScenePlan && lastSceneMessageIdx >= 0 && !sceneCreatedAfterPlan) {
            setPendingScene({ plan: lastScenePlan, messageIdx: lastSceneMessageIdx });
          }
        }
      } catch (err) {
        logger.error("Failed to load chat history:", err);
      } finally {
        // Use requestAnimationFrame to ensure scroll completes before showing
        requestAnimationFrame(() => {
          scrollToBottom();
          requestAnimationFrame(() => {
            setIsReady(true);
          });
        });
      }
    };
    if (campaignId && userId) loadHistory();
  }, [campaignId, userId, scrollToBottom]);

  const sendMessage = async (overrideContent?: string) => {
    const content = overrideContent || inputValue.trim();
    if (!content || isLoading) return;
    // Reset scroll to bottom when user sends a new message
    isAtBottomRef.current = true;
    setShowScrollBtn(false);
    const userMessage: ChatMessage = { role: 'user', content };
    setMessages(prev => [...prev, userMessage]);
    setInputValue("");
    if (inputRef.current) inputRef.current.style.height = 'auto';
    setIsLoading(true);
    setError(null);

    // Add loading placeholder
    const loadingMessage: ChatMessage = { role: 'assistant', content: '', isStreaming: true };
    setMessages(prev => [...prev, loadingMessage]);

    try {
      if (mode === 'query') {
        await sendQueryStreaming(content);
      } else {
        await sendCreateNonStreaming(content);
      }
    } catch (err) {
      logger.error("Failed to send message:", err);
      setError(err instanceof Error ? err.message : "发送失败");
      setMessages(prev => prev.filter(m => m.content || m.role !== 'assistant'));
    } finally {
      setIsLoading(false);
    }
  };

  // Query mode: SSE streaming response
  const sendQueryStreaming = async (content: string) => {
    const response = await apiFetch(
      `/api/campaigns/${campaignId}/resource-chat/query`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, mode: 'query' }) }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const reader = response.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const jsonStr = line.slice(6).trim();
        if (!jsonStr) continue;

        try {
          const data = JSON.parse(jsonStr);

          if (data.error) {
            throw new Error(data.error);
          }

          if (data.content) {
            // Append streaming content
            setMessages(prev => {
              const newMessages = [...prev];
              const lastIdx = newMessages.length - 1;
              if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                newMessages[lastIdx] = {
                  ...newMessages[lastIdx],
                  content: newMessages[lastIdx].content + data.content,
                  isStreaming: true,
                };
              }
              return newMessages;
            });
          }

          if (data.done) {
            // Streaming complete - set message_id and search_results
            setMessages(prev => {
              const newMessages = [...prev];
              const lastIdx = newMessages.length - 1;
              if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
                newMessages[lastIdx] = {
                  ...newMessages[lastIdx],
                  id: data.message_id,
                  search_results: data.search_results,
                  isStreaming: false,
                };
              }
              return newMessages;
            });
          }
        } catch (parseErr) {
          if (parseErr instanceof Error && parseErr.message !== jsonStr) {
            throw parseErr;
          }
          logger.error("Failed to parse SSE data:", jsonStr);
        }
      }
    }
  };

  // Create mode: non-streaming with tool calls
  const sendCreateNonStreaming = async (content: string) => {
    const response = await apiFetch(
      `/api/campaigns/${campaignId}/resource-chat/query`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ content, mode: 'create' }) }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = await response.json();
    if (data.type === 'error') throw new Error(data.error);

    // Update the loading message with actual response
    setMessages(prev => {
      const newMessages = [...prev];
      const lastIdx = newMessages.length - 1;
      if (lastIdx >= 0 && newMessages[lastIdx].role === 'assistant') {
        newMessages[lastIdx] = {
          ...newMessages[lastIdx],
          id: data.message_id,
          content: data.content || '',
          context: { monsters: data.monsters_count || 0, items: data.items_count || 0 },
          tool_calls: data.tool_calls,
          isStreaming: false,
        };

        // Check for encounter plan
        const encounterCall = data.tool_calls?.find((tc: ToolCall) => tc.tool === 'create_encounter');
        if (encounterCall?.encounter_plan) {
          setPendingEncounter({ plan: encounterCall.encounter_plan, messageIdx: lastIdx });
        }

        // Check for shop plan
        const shopCall = data.tool_calls?.find((tc: ToolCall) => tc.tool === 'create_shop');
        if (shopCall?.shop_plan) {
          setPendingShop({ plan: shopCall.shop_plan, messageIdx: lastIdx });
        }

        // Check for item plan
        const itemCall = data.tool_calls?.find((tc: ToolCall) => tc.tool === 'create_item');
        if (itemCall?.item_plan) {
          setPendingItem({ plan: itemCall.item_plan, messageIdx: lastIdx });
        }

        // Check for chest plan
        const chestCall = data.tool_calls?.find((tc: ToolCall) => tc.tool === 'create_chest');
        if (chestCall?.chest_plan) {
          setPendingChest({ plan: chestCall.chest_plan, messageIdx: lastIdx });
        }
      }
      return newMessages;
    });
  };

  const confirmEncounter = async () => {
    if (!pendingEncounter) return;
    setIsCreatingEncounter(true);

    // Get viewport center dynamically from TacticalMap
    let center = viewportCenter || { x: 10, y: 10 };
    if (typeof (window as any).__getViewportCenterGridPosition === 'function') {
      center = (window as any).__getViewportCenterGridPosition();
    }

    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/create-encounter`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            monsters: pendingEncounter.plan.monsters.map(m => ({
              name: m.name,
              name_cn: m.name_cn || m.name,
              quantity: m.quantity,
              monster_id: m.monster_id,
              matched: m.matched,
              generated_stats: m.generated_stats,
            })),
            viewport_center: center
          })
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();

      // Add success message
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ 遭遇创建成功！已创建 ${result.created_monsters} 个怪物实例和 ${result.created_tokens} 个Token。`
      }]);

      setPendingEncounter(null);
    } catch (err) {
      logger.error("Failed to create encounter:", err);
      setError(err instanceof Error ? err.message : "创建遭遇失败");
    } finally {
      setIsCreatingEncounter(false);
    }
  };

  const cancelEncounter = () => {
    setPendingEncounter(null);
  };

  const confirmShop = async () => {
    if (!pendingShop) return;
    setIsCreatingShop(true);

    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/create-shop`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingShop.plan)
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ 商店创建成功！已创建商店「${result.name}」(ID: ${result.shop_id})`
      }]);

      setPendingShop(null);
    } catch (err) {
      logger.error("Failed to create shop:", err);
      setError(err instanceof Error ? err.message : "创建商店失败");
    } finally {
      setIsCreatingShop(false);
    }
  };

  const cancelShop = () => {
    setPendingShop(null);
  };

  const confirmItem = async () => {
    if (!pendingItem) return;
    setIsCreatingItem(true);

    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/create-item`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingItem.plan)
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ 物品创建成功！已创建物品「${result.name}」(ID: ${result.item_id})`
      }]);

      setPendingItem(null);
    } catch (err) {
      logger.error("Failed to create item:", err);
      setError(err instanceof Error ? err.message : "创建物品失败");
    } finally {
      setIsCreatingItem(false);
    }
  };

  const cancelItem = () => {
    setPendingItem(null);
  };

  const confirmChest = async () => {
    if (!pendingChest) return;
    setIsCreatingChest(true);

    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/create-chest`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingChest.plan)
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ 宝箱创建成功！已创建「${result.name}」(ID: ${result.chest_id})${result.items_added > 0 ? `，包含${result.items_added}件物品` : ''}`
      }]);

      setPendingChest(null);
    } catch (err) {
      logger.error("Failed to create chest:", err);
      setError(err instanceof Error ? err.message : "创建宝箱失败");
    } finally {
      setIsCreatingChest(false);
    }
  };

  const cancelChest = () => {
    setPendingChest(null);
  };

  // Add monster from search results to resource library (without placing on map)
  const addMonsterToLibrary = async (monster: SearchResultMonster) => {
    setAddingMonster(monster.name);
    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/add-monster`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: monster.name,
            name_en: monster.name_en,
            monster_id: monster.monster_id,
            matched: monster.matched,
            cr: monster.cr,
            hp: monster.hp,
            ac: monster.ac,
            size: monster.size,
            type: monster.type,
          })
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ 已将「${result.name}」添加到资源库！`
      }]);
    } catch (err) {
      logger.error("Failed to add monster:", err);
      setError(err instanceof Error ? err.message : "添加怪物失败");
    } finally {
      setAddingMonster(null);
    }
  };

  // Add item from search results to resource library
  const addItemToLibrary = async (item: SearchResultItem) => {
    setAddingItem(item.name);
    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/create-item`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: item.name,
            name_cn: item.name,
            name_en: item.name_en,
            preset_id: item.preset_id,
            category: item.category || 'gear',
            cost: item.cost_gp ? { amount: item.cost_gp, unit: 'gp' } : undefined,
          })
        }
      );

      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const result = await response.json();
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ 已将「${result.name}」添加到资源库！`
      }]);
    } catch (err) {
      logger.error("Failed to add item:", err);
      setError(err instanceof Error ? err.message : "添加物品失败");
    } finally {
      setAddingItem(null);
    }
  };

  // Helper: Convert image URL to base64 (compressed to maxWidth)
  const imageUrlToBase64 = async (url: string, maxWidth = 1024): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const scale = Math.min(1, maxWidth / img.width);
        canvas.width = img.width * scale;
        canvas.height = img.height * scale;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL('image/jpeg', 0.8));
      };
      img.onerror = reject;
      // Add cache buster to avoid CORS issues
      img.src = url + (url.includes('?') ? '&' : '?') + '_t=' + Date.now();
    });
  };

  // Helper: Find chapter by map URL
  const findChapterByMapUrl = (mapUrl: string): ChapterNode | null => {
    if (!moduleMaps || !chapterTree) return null;

    // Find current map's chapter field
    const currentMap = moduleMaps.find(m => m.url === mapUrl);
    if (!currentMap?.chapter) return null;

    // Recursively search chapter tree
    const findInTree = (nodes: ChapterNode[], targetTitle: string): ChapterNode | null => {
      for (const node of nodes) {
        if (node.title === targetTitle || node.title.includes(targetTitle)) {
          return node;
        }
        if (node.children?.length) {
          const found = findInTree(node.children, targetTitle);
          if (found) return found;
        }
      }
      return null;
    };

    return findInTree(chapterTree, currentMap.chapter);
  };

  // Helper: Collect chapter content recursively
  const collectChapterContent = (chapter: ChapterNode): string => {
    let content = `## ${chapter.title}\n${chapter.content || ''}\n\n`;
    if (chapter.children) {
      for (const child of chapter.children) {
        content += collectChapterContent(child);
      }
    }
    return content;
  };

  // Generate scene from map + chapter
  const generateScene = async () => {
    setIsGeneratingScene(true);
    setError(null);

    try {
      // Step 1: Get current map URL and module data
      let mapUrl = currentMapUrl || dynamicMapUrl;
      let maps = moduleMaps || dynamicModuleMaps;
      let chapters = chapterTree || dynamicChapterTree;

      // If we don't have the data, fetch from campaign
      if (!mapUrl || maps.length === 0 || chapters.length === 0) {
        // Fetch campaign to get current_map_url and module_id
        const campaignRes = await apiFetch(`/api/campaigns/${campaignId}`);
        if (!campaignRes.ok) throw new Error('无法获取战役信息');
        const campaignData = await campaignRes.json();

        mapUrl = campaignData.current_map_url;
        const moduleIdToUse = moduleId || campaignData.selected_module_id || campaignData.module_id;

        if (!mapUrl) {
          setError('请先选择一个地图');
          setIsGeneratingScene(false);
          return;
        }

        if (!moduleIdToUse) {
          setError('此战役未关联模组');
          setIsGeneratingScene(false);
          return;
        }

        // Fetch module data
        const moduleRes = await apiFetch(`/api/modules/parsed/${moduleIdToUse}`);
        if (!moduleRes.ok) throw new Error('无法获取模组数据');
        const moduleData = await moduleRes.json();

        // Extract maps from images (category=map)
        const moduleImages = moduleData.images || [];
        maps = moduleImages
          .filter((img: any) => img.category === 'map')
          .map((img: any) => ({
            url: img.oss_url,
            chapter: img.chapter,
            name: img.description || img.image_id
          }));

        chapters = moduleData.chapter_tree || [];

        // Cache the dynamic data
        setDynamicMapUrl(mapUrl);
        setDynamicModuleMaps(maps);
        setDynamicChapterTree(chapters);
      }

      if (!mapUrl) {
        setError('请先选择一个地图');
        setIsGeneratingScene(false);
        return;
      }

      // Step 2: Find chapter by map URL or fall back to first available chapter
      const findChapter = (url: string): ChapterNode | null => {
        const currentMap = maps.find(m => m.url === url);

        const findInTree = (nodes: ChapterNode[], targetTitle: string): ChapterNode | null => {
          for (const node of nodes) {
            if (node.title === targetTitle || node.title.includes(targetTitle)) {
              return node;
            }
            if (node.children?.length) {
              const found = findInTree(node.children, targetTitle);
              if (found) return found;
            }
          }
          return null;
        };

        // Try to find by map's chapter field first
        if (currentMap?.chapter) {
          const found = findInTree(chapters, currentMap.chapter);
          if (found) return found;
        }

        // Fall back to first chapter with content
        const findFirstWithContent = (nodes: ChapterNode[]): ChapterNode | null => {
          for (const node of nodes) {
            if (node.content && node.content.length > 100) {
              return node;
            }
            if (node.children?.length) {
              const found = findFirstWithContent(node.children);
              if (found) return found;
            }
          }
          return null;
        };

        return findFirstWithContent(chapters);
      };

      const chapter = findChapter(mapUrl);
      if (!chapter) {
        setError('无法找到当前地图关联的章节，且模组中没有可用的章节内容');
        setIsGeneratingScene(false);
        return;
      }

      // Step 3: Collect chapter content (map URL will be sent to backend to download)
      const chapterContent = collectChapterContent(chapter);

      // Step 4: Call API (backend will download the map image)
      const requestBody = {
        map_url: mapUrl,  // Backend downloads and converts to base64
        chapter_title: chapter.title,
        chapter_content: chapterContent.slice(0, 10000)
      };

      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/generate-scene`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }

      const data = await response.json();

      // 构建场景描述文字
      const plan = data.plan as ScenePlan;
      let sceneDescription = `## 🎭 场景分析\n\n${plan.summary}\n\n`;

      if (plan.npcs.length > 0) {
        sceneDescription += `### 👤 NPC (${plan.npcs.length})\n`;
        plan.npcs.forEach(npc => {
          sceneDescription += `- **${npc.name_cn}** (${npc.role}): ${npc.description}`;
          if (npc.quest) {
            sceneDescription += `\n  - 📜 任务: ${npc.quest.name}`;
          }
          sceneDescription += '\n';
        });
        sceneDescription += '\n';
      }

      if (plan.shops.length > 0) {
        sceneDescription += `### 🏪 商店 (${plan.shops.length})\n`;
        plan.shops.forEach(shop => {
          sceneDescription += `- **${shop.name}** (${shop.type}): ${shop.description}\n`;
        });
        sceneDescription += '\n';
      }

      sceneDescription += `---\n*点击下方按钮创建场景*`;

      // Add AI message showing scene description
      const newMessageIdx = messages.length;
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: sceneDescription,
        tool_calls: [{ tool: 'generate_scene', scene_plan: plan }]
      }]);

      setPendingScene({ plan, messageIdx: newMessageIdx });
    } catch (err) {
      logger.error('Failed to generate scene:', err);
      const errorMessage = err instanceof Error ? err.message : '生成场景失败';
      setError(errorMessage);
    } finally {
      setIsGeneratingScene(false);
    }
  };

  // Confirm scene creation
  const confirmScene = async () => {
    if (!pendingScene) return;
    setIsCreatingScene(true);
    setSceneCreationProgress("正在创建场景...");

    try {
      // Show progress for NPCs
      const npcCount = pendingScene.plan.npcs.length;
      const shopCount = pendingScene.plan.shops.length;

      if (npcCount > 0) {
        setSceneCreationProgress(`正在创建 ${npcCount} 个NPC...`);
      }

      const response = await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/create-scene`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pendingScene.plan)
        }
      );

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.detail || `HTTP ${response.status}`);
      }

      const result = await response.json();

      // Build success message
      const parts: string[] = [];
      if (result.created_npcs > 0) parts.push(`${result.created_npcs}个NPC`);
      if (result.created_shops > 0) parts.push(`${result.created_shops}个商店`);

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `✅ 场景创建成功！已创建 ${parts.join('、')}，共 ${result.created_tokens} 个Token。`
      }]);

      setPendingScene(null);
    } catch (err) {
      logger.error('Failed to create scene:', err);
      setError(err instanceof Error ? err.message : '创建场景失败');
    } finally {
      setIsCreatingScene(false);
      setSceneCreationProgress("");
    }
  };

  const cancelScene = () => {
    setPendingScene(null);
  };

  const deleteMessage = async (messageId: number, idx: number) => {
    try {
      await apiFetch(
        `/api/campaigns/${campaignId}/resource-chat/${messageId}`,
        { method: 'DELETE' }
      );
      setMessages(prev => prev.filter((_, i) => i !== idx));
    } catch (err) {
      logger.error("Failed to delete message:", err);
    }
  };

  const clearHistory = async () => {
    if (!confirm("确定要清空聊天记录吗？")) return;
    try {
      await apiFetch(`/api/campaigns/${campaignId}/resource-chat`, { method: 'DELETE' });
      setMessages([]);
      setPendingEncounter(null);
      setPendingShop(null);
      setPendingItem(null);
      setPendingScene(null);
    } catch (err) {
      logger.error("Failed to clear history:", err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // Stable callback ref for image clicks (doesn't change on re-renders)
  const handleImageClick = useCallback((src: string) => {
    setLightboxSrc(src);
  }, []);

  return (
    <>
    <div className="h-full flex flex-col bg-gradient-to-b from-gray-900 to-gray-950 overflow-hidden relative">
      {/* Messages Area */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className={`flex-1 overflow-auto px-3 py-4 space-y-3 transition-opacity duration-200 ${isReady ? 'opacity-100' : 'opacity-0'}`}>
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${
              mode === 'query' ? 'from-emerald-900/40' : 'from-amber-900/40'
            } to-gray-900 border ${
              mode === 'query' ? 'border-emerald-800/30' : 'border-amber-800/30'
            } flex items-center justify-center mb-4`}>
              <span className="text-2xl">{mode === 'query' ? '🔍' : '⚔️'}</span>
            </div>
            <p className={`${mode === 'query' ? 'text-emerald-300/80' : 'text-amber-300/80'} text-sm font-medium mb-1`}>
              {mode === 'query' ? '查询资源' : '添加资源'}
            </p>
            <p className="text-gray-500 text-xs max-w-[240px]">
              {mode === 'query'
                ? '检索战役中已添加的资源，或搜索预设怪物、物品信息'
                : '创建遭遇、商店、自定义物品'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {mode === 'query' ? (
                <>
                  {["地精有什么能力", "搜索火焰相关法术", "战役里有哪些怪物"].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInputValue(q)}
                      className="text-xs px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-full text-gray-400 hover:text-emerald-300 hover:border-emerald-700/50 transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </>
              ) : (
                <>
                  {["3个地精和1个狼", "创建武器商店", "创建霜之哀伤+3冰剑"].map((q, i) => (
                    <button
                      key={i}
                      onClick={() => setInputValue(q)}
                      className="text-xs px-3 py-1.5 bg-gray-800/50 border border-gray-700 rounded-full text-gray-400 hover:text-amber-300 hover:border-amber-700/50 transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </>
              )}
            </div>
          </div>
        ) : (
          messages.map((msg, idx) => (
            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              {msg.role === 'user' ? (
                <div className="max-w-[85%] group">
                  <div className="bg-emerald-900/40 rounded-lg px-3 py-2 border border-emerald-800/30">
                    <p className="text-emerald-100/90 text-sm whitespace-pre-wrap">{msg.content}</p>
                  </div>
                  <div className="flex justify-end gap-3 mt-1 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => sendMessage(msg.content)}
                      disabled={isLoading}
                      className="text-[10px] text-gray-500 hover:text-emerald-400 disabled:opacity-50 transition-colors flex items-center gap-1"
                      title="再次发送"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      再次发送
                    </button>
                    {msg.id && (
                      <button
                        onClick={() => deleteMessage(msg.id!, idx)}
                        className="text-[10px] text-gray-500 hover:text-red-400 transition-colors flex items-center gap-1"
                        title="删除消息"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                        删除
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="max-w-full bg-gray-800/60 rounded-lg border border-gray-700/50 overflow-hidden group">
                  {msg.context && (
                    <div className="px-3 py-1.5 bg-gray-900/50 border-b border-gray-700/30 flex gap-3 text-[10px] text-gray-500">
                      <span>🐉 怪物: {msg.context.monsters}</span>
                      <span>📦 物品: {msg.context.items}</span>
                    </div>
                  )}
                  <div className="px-3 py-2">
                    {msg.isStreaming && !msg.content ? (
                      <div className="text-sm text-gray-400 flex items-center gap-2">
                        <div className="w-5 h-5 rounded-full border-2 border-emerald-500/30 border-t-emerald-500 animate-spin" />
                        <span>正在分析您的请求...</span>
                      </div>
                    ) : (
                      <>
                        {/* Collapsed view */}
                        {msg.id && collapsedMessages.has(msg.id) ? (
                          <div
                            className="text-sm text-gray-400 italic cursor-pointer"
                            onClick={() => toggleCollapse(msg.id!)}
                          >
                            {generateSummary(msg.content)}
                          </div>
                        ) : (
                        <>
                        <div className="text-sm text-gray-300 prose-sm">
                          <MemoizedResourceMarkdown
                            content={msg.content}
                            searchResults={msg.search_results}
                            onImageClick={handleImageClick}
                          />
                        </div>

                        {/* Streaming indicator */}
                        {msg.isStreaming && <LoadingIndicator />}

                        {/* Encounter Confirmation Card */}
                        {pendingEncounter && pendingEncounter.messageIdx === idx && (
                          <EncounterConfirmCard
                            plan={pendingEncounter.plan}
                            onConfirm={confirmEncounter}
                            onCancel={cancelEncounter}
                            isCreating={isCreatingEncounter}
                          />
                        )}

                        {/* Shop Confirmation Card */}
                        {pendingShop && pendingShop.messageIdx === idx && (
                          <ShopConfirmCard
                            plan={pendingShop.plan}
                            onConfirm={confirmShop}
                            onCancel={cancelShop}
                            isCreating={isCreatingShop}
                          />
                        )}

                        {/* Item Confirmation Card */}
                        {pendingItem && pendingItem.messageIdx === idx && (
                          <ItemConfirmCard
                            plan={pendingItem.plan}
                            onConfirm={confirmItem}
                            onCancel={cancelItem}
                            isCreating={isCreatingItem}
                          />
                        )}

                        {/* Chest Create Button */}
                        {pendingChest && pendingChest.messageIdx === idx && (
                          <ChestConfirmCard
                            plan={pendingChest.plan}
                            onConfirm={confirmChest}
                            onCancel={cancelChest}
                            isCreating={isCreatingChest}
                          />
                        )}

                        {/* Scene Create Button */}
                        {pendingScene && pendingScene.messageIdx === idx && (
                          <SceneCreateButton
                            plan={pendingScene.plan}
                            onConfirm={confirmScene}
                            onCancel={cancelScene}
                            isCreating={isCreatingScene}
                            creationProgress={sceneCreationProgress}
                          />
                        )}

                        {/* Search Results - Add to Library buttons */}
                        {msg.search_results && (
                          <SearchResultCard
                            results={msg.search_results}
                            onAddMonster={addMonsterToLibrary}
                            onAddItem={addItemToLibrary}
                            addingMonster={addingMonster}
                            addingItem={addingItem}
                            onImageClick={setLightboxSrc}
                          />
                        )}
                        </>
                        )}

                        {/* Action bar: TTS, delete, collapse */}
                        {msg.id && !pendingEncounter && !pendingShop && !pendingItem && !pendingChest && !pendingScene && (
                          <div className="mt-2 pt-2 border-t border-gray-700/30 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity flex items-center gap-3">
                            <div className="relative" ref={ttsMenuMsgId === msg.id ? ttsMenuRef : undefined}>
                              <button
                                onClick={() => {
                                  if (ttsPlayingId === String(msg.id)) { stopPlayback(); return; }
                                  if (ttsLoading === String(msg.id)) return;
                                  setTtsMenuMsgId(ttsMenuMsgId === msg.id! ? null : msg.id!);
                                }}
                                disabled={ttsLoading === String(msg.id)}
                                className={`text-[10px] transition-colors flex items-center gap-1 ${
                                  ttsPlayingId === String(msg.id)
                                    ? 'text-amber-400'
                                    : ttsLoading === String(msg.id)
                                      ? 'text-gray-500 cursor-wait'
                                      : 'text-gray-500 hover:text-amber-400'
                                }`}
                                title={ttsPlayingId === String(msg.id) ? '停止朗读' : '朗读'}
                              >
                                {ttsLoading === String(msg.id) ? (
                                  <>
                                    <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                    </svg>
                                    加载中
                                  </>
                                ) : ttsPlayingId === String(msg.id) ? (
                                  <>
                                    <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>
                                    停止
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
                                    朗读
                                  </>
                                )}
                              </button>
                              {ttsMenuMsgId === msg.id && (
                                <div className="absolute bottom-full left-0 mb-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl py-1 z-50 whitespace-nowrap text-xs">
                                  <button
                                    className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-700 text-gray-200"
                                    onClick={() => { setTtsMenuMsgId(null); handleTTS(String(msg.id), msg.content, msg.id); }}
                                  >
                                    <span className="w-4 text-center">🔊</span> 朗读
                                  </button>
                                  <button
                                    className={`flex items-center gap-2 w-full px-3 py-1.5 ${voiceIsConnected ? 'hover:bg-gray-700 text-gray-200' : 'text-gray-500 cursor-not-allowed'}`}
                                    onClick={() => { if (voiceIsConnected) { setTtsMenuMsgId(null); handleTTSBroadcast(String(msg.id), msg.content, msg.id); } }}
                                    disabled={!voiceIsConnected}
                                    title={voiceIsConnected ? '合成并广播给语音频道' : '需要先连接语音频道'}
                                  >
                                    <span className="w-4 text-center">📢</span> 语音播放
                                  </button>
                                  <button
                                    className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-gray-700 text-gray-200"
                                    onClick={() => { setTtsMenuMsgId(null); handleTTSRegenerate(String(msg.id), msg.content, msg.id); }}
                                  >
                                    <span className="w-4 text-center">🔄</span> 重新生成
                                  </button>
                                </div>
                              )}
                            </div>
                            <button
                              onClick={() => deleteMessage(msg.id!, idx)}
                              className="text-[10px] text-gray-500 hover:text-red-400 transition-colors flex items-center gap-1"
                              title="删除消息"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                              删除
                            </button>
                            {msg.content.length > 300 && (
                              <button
                                onClick={() => toggleCollapse(msg.id!)}
                                className="text-[10px] text-gray-500 hover:text-emerald-400 transition-colors flex items-center gap-1"
                                title={collapsedMessages.has(msg.id!) ? '展开内容' : '折叠内容'}
                              >
                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d={collapsedMessages.has(msg.id!) ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
                                </svg>
                                {collapsedMessages.has(msg.id!) ? '展开' : '折叠'}
                              </button>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Scroll to bottom button */}
      {showScrollBtn && (
        <button
          onClick={scrollToBottom}
          className="absolute bottom-24 right-4 z-10 w-8 h-8 bg-amber-600 hover:bg-amber-500 text-white rounded-full shadow-lg flex items-center justify-center transition-all duration-200 hover:scale-110"
          title="跳转到最新消息"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
          </svg>
        </button>
      )}

      {/* Error */}
      {error && (
        <div className="mx-3 mb-2 px-3 py-2 bg-red-950/50 border border-red-900/50 rounded-lg">
          <p className="text-xs text-red-400">{error}</p>
        </div>
      )}

      {/* Input */}
      <div className="px-3 py-3 border-t border-gray-800 flex-shrink-0">
        {/* Mode Toggle + Generate Scene Button (same row) */}
        <div className="flex gap-1 p-1 mb-2 bg-gray-800/50 rounded-lg items-center">
          <button
            onClick={() => setMode('query')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-all ${
              mode === 'query'
                ? 'bg-emerald-700 text-emerald-100 shadow'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
            }`}
          >
            🔍 查询资源
          </button>
          <button
            onClick={() => setMode('create')}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-all ${
              mode === 'create'
                ? 'bg-amber-700 text-amber-100 shadow'
                : 'text-gray-400 hover:text-gray-300 hover:bg-gray-700/50'
            }`}
          >
            ✨ 添加资源
          </button>
          <button
            onClick={generateScene}
            disabled={isGeneratingScene}
            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-all flex items-center justify-center gap-1 ${
              isGeneratingScene
                ? 'bg-gray-700 text-gray-500 cursor-not-allowed'
                : 'bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white'
            }`}
            title="根据当前地图和关联章节生成NPC、商店"
          >
            {isGeneratingScene ? (
              <>
                <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span>生成中...</span>
              </>
            ) : (
              <>
                <span>🎭</span>
                <span>生成场景</span>
              </>
            )}
          </button>
          {/* Clear history button */}
          {messages.length > 0 && (
            <button
              onClick={clearHistory}
              className="px-2 py-1.5 text-[10px] text-gray-500 hover:text-red-400 hover:bg-red-950/30 rounded transition-all"
              title="清除聊天记录"
            >
              🗑️
            </button>
          )}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={inputValue}
            onChange={(e) => { setInputValue(e.target.value); e.target.style.height = 'auto'; e.target.style.height = Math.min(e.target.scrollHeight, 100) + 'px'; }}
            onKeyDown={handleKeyDown}
            placeholder={mode === 'query' ? '搜索怪物、物品、法术信息...' : '创建遭遇/商店/物品...'}
            disabled={isLoading}
            rows={1}
            className={`flex-1 px-3 py-2 bg-gray-800/50 border border-gray-700 rounded-lg text-gray-200 text-sm resize-none overflow-hidden focus:outline-none ${
              mode === 'query' ? 'focus:border-emerald-700/50' : 'focus:border-amber-700/50'
            } disabled:opacity-50 placeholder:text-gray-600`}
            style={{ minHeight: '40px', maxHeight: '100px' }}
          />
          <button
            onClick={() => sendMessage()}
            disabled={isLoading || !inputValue.trim()}
            className={`px-3 py-2 ${
              mode === 'query'
                ? 'bg-gradient-to-r from-emerald-700 to-teal-700 hover:from-emerald-600 hover:to-teal-600'
                : 'bg-gradient-to-r from-amber-700 to-orange-700 hover:from-amber-600 hover:to-orange-600'
            } disabled:from-gray-700 disabled:to-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-all`}
          >
            {isLoading ? "..." : "发送"}
          </button>
        </div>
      </div>
    </div>

    {/* Image Lightbox */}
    {lightboxSrc && createPortal(
      <div
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm"
        onClick={() => setLightboxSrc(null)}
      >
        <button
          className="absolute top-4 right-4 text-white/70 hover:text-white bg-black/40 rounded-full w-10 h-10 flex items-center justify-center text-2xl"
          onClick={() => setLightboxSrc(null)}
          title="关闭 (Esc)"
        >
          ✕
        </button>
        <img
          src={lightboxSrc}
          alt=""
          className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onClick={(e) => e.stopPropagation()}
        />
      </div>,
      document.body
    )}
    </>
  );
}
