import { useState, useEffect, useMemo } from "react";
import {
  Box,
  Button,
  Flex,
  Text,
  Badge,
  Grid,
  Spinner,
} from "@radix-ui/themes";
import * as Dialog from "@radix-ui/react-dialog";
import { Cross2Icon, ArrowLeftIcon, EyeOpenIcon } from "@radix-ui/react-icons";
import { apiFetch } from "~/utils/api-client";
import { MonstersTab, ItemsTab, ModuleTab, NotesTab } from "./TemplatePreviewTabs";

interface TemplatePreviewModalProps {
  templateId: number | null;
  templateName?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onClone?: (id: number) => void;
  isOwn?: boolean;
}

interface TemplatePreviewData {
  id: number;
  name: string;
  description?: string;
  cover_image?: string;
  shared_by_name?: string;
  created_at?: string;
  template_data: {
    campaign?: { name?: string; description?: string; cover_image?: string };
    monsters?: any[];
    items?: any[];
    shops?: any[];
    chests?: any[];
    module_maps?: any[];
    module_notes?: any[];
    module?: {
      title?: string;
      title_en?: string;
      description?: string;
      toc?: any[];
      chapters?: any[];
      monsters?: any[];
      items?: any[];
    } | null;
  };
}

const RARITY_COLORS: Record<string, string> = {
  common: "gray", uncommon: "green", rare: "blue",
  "very rare": "purple", legendary: "orange", artifact: "red",
};
function getRarityColor(rarity?: string): string {
  return RARITY_COLORS[rarity?.toLowerCase() || ""] || "gray";
}

export function TemplatePreviewModal({
  templateId, templateName, open, onOpenChange, onClone, isOwn,
}: TemplatePreviewModalProps) {
  const [data, setData] = useState<TemplatePreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState("overview");

  useEffect(() => {
    if (!open || !templateId) { setData(null); setError(null); setActiveTab("overview"); return; }
    let cancelled = false;
    setLoading(true);
    apiFetch(`/api/campaign-templates/${templateId}/preview`)
      .then(async (res) => { if (cancelled) return; if (!res.ok) throw new Error((await res.json()).detail || "加载失败"); setData(await res.json()); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, templateId]);

  const td = data?.template_data;

  const itemMap = useMemo(() => {
    if (!td?.items) return new Map<number, any>();
    const m = new Map<number, any>();
    for (const it of td.items) { if (it._template_id != null) m.set(it._template_id, it); }
    return m;
  }, [td?.items]);

  const flatMaps = useMemo(() => {
    if (!td?.module_maps) return [];
    const result: any[] = [];
    for (const row of td.module_maps) {
      if (Array.isArray(row.maps)) result.push(...row.maps);
      else if (row.image_url || row.url) result.push(row);
    }
    return result;
  }, [td?.module_maps]);

  const stats = useMemo(() => {
    if (!td) return null;
    return {
      monsters: td.monsters?.length || 0, items: td.items?.length || 0,
      shops: td.shops?.length || 0, chests: td.chests?.length || 0,
      maps: flatMaps.length, notes: td.module_notes?.length || 0,
      moduleChapters: td.module?.chapters?.length || 0,
    };
  }, [td, flatMaps]);

  const tabs = [
    { key: "overview", label: "总览" },
    { key: "monsters", label: `怪物 (${stats?.monsters || 0})` },
    { key: "items", label: `物品 (${stats?.items || 0})` },
    { key: "shops", label: `商店/宝箱 (${(stats?.shops || 0) + (stats?.chests || 0)})` },
    { key: "maps", label: `地图 (${stats?.maps || 0})` },
    ...(td?.module ? [{ key: "module", label: `模组 (${stats?.moduleChapters || 0})` }] : []),
    { key: "notes", label: `笔记 (${stats?.notes || 0})` },
  ];

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-50" />
        <Dialog.Content
          className="fixed inset-4 sm:inset-8 z-50 bg-[#13151a] rounded-xl border border-gray-700/50 flex flex-col overflow-hidden focus:outline-none"
          aria-describedby={undefined}
        >
          {/* Header */}
          <Flex align="center" justify="between" className="px-5 py-3 border-b border-gray-700/50 shrink-0">
            <Flex align="center" gap="3">
              <button onClick={() => onOpenChange(false)} className="text-gray-400 hover:text-white transition-colors p-1">
                <ArrowLeftIcon width={18} height={18} />
              </button>
              <Box>
                <Dialog.Title className="text-lg font-semibold text-gray-100 m-0">
                  {data?.name || templateName || "模板预览"}
                </Dialog.Title>
                {data?.shared_by_name && (
                  <Text size="1" className="text-gray-500">
                    分享者: {data.shared_by_name}{data.description && ` · ${data.description}`}
                  </Text>
                )}
              </Box>
            </Flex>
            <Flex align="center" gap="2">
              {onClone && !isOwn && (
                <Button size="2" className="cursor-pointer"
                  style={{ background: "linear-gradient(135deg, rgba(16,185,129,0.9), rgba(5,150,105,0.9))", color: "white", border: "1px solid rgba(16,185,129,0.3)" }}
                  onClick={() => templateId && onClone(templateId)}
                >加入我的模板</Button>
              )}
              <Dialog.Close asChild>
                <button className="text-gray-400 hover:text-white p-1"><Cross2Icon width={18} height={18} /></button>
              </Dialog.Close>
            </Flex>
          </Flex>

          {/* Content */}
          {loading ? (
            <Flex align="center" justify="center" className="flex-1"><Spinner size="3" /></Flex>
          ) : error ? (
            <Flex align="center" justify="center" className="flex-1"><Text className="text-red-400">{error}</Text></Flex>
          ) : data && td ? (
            <Box className="flex-1 flex flex-col overflow-hidden">
              <Flex gap="1" className="shrink-0 px-5 py-2 border-b border-gray-700/50 overflow-x-auto">
                {tabs.map((t) => (
                  <button key={t.key} onClick={() => setActiveTab(t.key)}
                    className={`px-3 py-1.5 rounded-md text-sm whitespace-nowrap transition-colors ${
                      activeTab === t.key ? "bg-emerald-600/20 text-emerald-400 font-medium" : "text-gray-400 hover:text-gray-200 hover:bg-gray-800/50"
                    }`}
                  >{t.label}</button>
                ))}
              </Flex>
              <Box className="flex-1 overflow-auto p-5">
                {activeTab === "overview" && <OverviewTab data={data} stats={stats!} />}
                {activeTab === "monsters" && <MonstersTab monsters={td.monsters || []} />}
                {activeTab === "items" && <ItemsTab items={td.items || []} />}
                {activeTab === "shops" && <ShopsTab shops={td.shops || []} chests={td.chests || []} itemMap={itemMap} />}
                {activeTab === "maps" && <MapsTab maps={flatMaps} />}
                {activeTab === "module" && td.module && <ModuleTab module={td.module} />}
                {activeTab === "notes" && <NotesTab notes={td.module_notes || []} />}
              </Box>
            </Box>
          ) : null}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/* ── Tab: Overview ─────────────────────────────────── */

function OverviewTab({ data, stats }: { data: TemplatePreviewData; stats: Record<string, number> }) {
  const campaignDesc = data.template_data?.campaign?.description;
  return (
    <Box>
      {data.cover_image && (
        <Box className="relative h-48 rounded-lg overflow-hidden mb-5">
          <img src={data.cover_image} alt={data.name} className="w-full h-full object-cover" style={{ filter: "brightness(0.8)" }} />
          <Box className="absolute inset-0" style={{ background: "linear-gradient(to top, rgba(19,21,26,0.8) 0%, transparent 50%)" }} />
        </Box>
      )}
      {data.description && <Text className="text-gray-300 block mb-5">{data.description}</Text>}
      <Grid columns={{ initial: "2", sm: "3", md: "6" }} gap="3">
        {[
          { label: "怪物", count: stats.monsters, emoji: "👹" },
          { label: "物品", count: stats.items, emoji: "🎒" },
          { label: "商店", count: stats.shops, emoji: "🏪" },
          { label: "宝箱", count: stats.chests, emoji: "📦" },
          { label: "地图", count: stats.maps, emoji: "🗺️" },
          { label: "笔记", count: stats.notes, emoji: "📝" },
        ].map((s) => (
          <Box key={s.label} className="bg-[#1a1d24] rounded-lg p-4 text-center border border-gray-700/30">
            <Text className="text-2xl block mb-1">{s.emoji}</Text>
            <Text className="text-xl font-bold text-gray-100 block">{s.count}</Text>
            <Text size="1" className="text-gray-500">{s.label}</Text>
          </Box>
        ))}
      </Grid>
      {campaignDesc && (
        <Box className="mt-5 bg-[#1a1d24] rounded-lg border border-gray-700/30 p-4">
          <Text size="2" className="text-gray-400 font-medium block mb-2">战役简介</Text>
          <Text className="text-gray-300 leading-relaxed whitespace-pre-line">{campaignDesc}</Text>
        </Box>
      )}
    </Box>
  );
}

/* ── Tab: Shops & Chests ──────────────────────────── */

function ShopsTab({ shops, chests, itemMap }: { shops: any[]; chests: any[]; itemMap: Map<number, any> }) {
  const [expandedShop, setExpandedShop] = useState<number | null>(null);
  if (!shops.length && !chests.length) return <EmptyState text="没有商店/宝箱数据" />;
  return (
    <Box>
      {shops.length > 0 && (
        <Box className="mb-6">
          <Text className="text-gray-300 font-medium block mb-3">商店 ({shops.length})</Text>
          <Grid columns={{ initial: "1", sm: "2" }} gap="3">
            {shops.map((s, i) => (
              <Box key={i} className="bg-[#1a1d24] rounded-lg border border-gray-700/30 p-4">
                <Flex justify="between" align="center" className="mb-1">
                  <Text className="text-gray-100 font-medium">{s.name}</Text>
                  <Badge size="1" variant="soft" color="amber">{s.inventory?.length || 0} 件商品</Badge>
                </Flex>
                {s.shopkeeper_name && <Text size="1" className="text-gray-500 block mb-2">店主: {s.shopkeeper_name}</Text>}
                {s.inventory?.length > 0 && (
                  <Box>
                    <button onClick={() => setExpandedShop(expandedShop === i ? null : i)}
                      className="text-xs text-emerald-400 hover:text-emerald-300 transition-colors">
                      {expandedShop === i ? "收起库存" : "展开库存"}
                    </button>
                    {expandedShop === i && (
                      <Box className="mt-2 space-y-1">
                        {s.inventory.map((inv: any, j: number) => {
                          const item = itemMap.get(inv.item_template_id);
                          return (
                            <Flex key={j} justify="between" className="text-xs py-1 border-t border-gray-700/20">
                              <Text className="text-gray-300">{item?.name_cn || item?.name || `物品 #${inv.item_template_id}`}</Text>
                              <Text className="text-gray-500">x{inv.quantity} · {inv.price_gp}gp</Text>
                            </Flex>
                          );
                        })}
                      </Box>
                    )}
                  </Box>
                )}
              </Box>
            ))}
          </Grid>
        </Box>
      )}
      {chests.length > 0 && (
        <Box>
          <Text className="text-gray-300 font-medium block mb-3">宝箱 ({chests.length})</Text>
          <Grid columns={{ initial: "1", sm: "2" }} gap="3">
            {chests.map((c, i) => (
              <Box key={i} className="bg-[#1a1d24] rounded-lg border border-gray-700/30 p-4">
                <Text className="text-gray-100 font-medium block mb-1">{c.name || `宝箱 ${i + 1}`}</Text>
                {c.inventory?.length > 0 && (
                  <Box className="space-y-1 mt-2">
                    {c.inventory.map((inv: any, j: number) => {
                      const item = itemMap.get(inv.item_template_id);
                      return (
                        <Flex key={j} justify="between" className="text-xs py-1 border-t border-gray-700/20">
                          <Text className="text-gray-300">{item?.name_cn || item?.name || `物品 #${inv.item_template_id}`}</Text>
                          <Text className="text-gray-500">x{inv.quantity}</Text>
                        </Flex>
                      );
                    })}
                  </Box>
                )}
              </Box>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
}

/* ── Tab: Maps ─────────────────────────────────────── */

function MapsTab({ maps }: { maps: any[] }) {
  const [enlarged, setEnlarged] = useState<string | null>(null);
  if (!maps.length) return <EmptyState text="没有地图数据" />;
  return (
    <>
      <Grid columns={{ initial: "2", sm: "3", lg: "4" }} gap="3">
        {maps.map((m, i) => {
          const imgUrl = m.url || m.image_url;
          return (
            <Box key={i}
              className="bg-[#1a1d24] rounded-lg border border-gray-700/30 overflow-hidden cursor-pointer hover:border-emerald-600/50 transition-colors"
              onClick={() => imgUrl && setEnlarged(imgUrl)}>
              {imgUrl ? (
                <img src={imgUrl} alt={m.name || `地图 ${i + 1}`} className="w-full aspect-square object-cover" />
              ) : (
                <Box className="w-full aspect-square bg-gray-800/50 flex items-center justify-center">
                  <Text className="text-gray-600 text-2xl">🗺️</Text>
                </Box>
              )}
              <Box className="p-2"><Text size="1" className="text-gray-300 truncate block">{m.name || `地图 ${i + 1}`}</Text></Box>
            </Box>
          );
        })}
      </Grid>
      {enlarged && (
        <Box className="fixed inset-0 z-[100] bg-black/80 flex items-center justify-center cursor-pointer" onClick={() => setEnlarged(null)}>
          <img src={enlarged} alt="地图" className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg" />
        </Box>
      )}
    </>
  );
}

/* ── Shared ────────────────────────────────────────── */

function EmptyState({ text }: { text: string }) {
  return (
    <Flex align="center" justify="center" className="py-16">
      <Text className="text-gray-600">{text}</Text>
    </Flex>
  );
}
