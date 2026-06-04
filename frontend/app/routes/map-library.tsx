import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router";
import type { MetaFunction } from "react-router";
import { Container, Flex, Heading, Text, Dialog, Button } from "@radix-ui/themes";
import { ArrowLeftIcon, TrashIcon } from "@radix-ui/react-icons";
import { getAuthUser } from "~/utils/auth";
import { apiFetch } from "~/utils/api-client";

export const meta: MetaFunction = () => [
  { title: "地图库 - DND 5E 跑团平台" },
];

interface MapItem {
  id: number;
  name: string;
  url: string;
  thumbnail_url?: string;
  source_type: string;
  environment?: string;
  description?: string;
  created_at: string;
}

const ENV_LABELS: Record<string, string> = {
  forest: "森林",
  dungeon: "地下城",
  town: "城镇",
  cave: "洞穴",
  castle: "城堡",
  battlefield: "战场",
  tavern: "酒馆",
  temple: "神殿",
  ruins: "废墟",
};

const SOURCE_LABELS: Record<string, string> = {
  ai_generated: "AI 生成",
  manual: "手动添加",
  module: "模组提取",
};

export default function MapLibrary() {
  const navigate = useNavigate();
  const [maps, setMaps] = useState<MapItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [previewMap, setPreviewMap] = useState<MapItem | null>(null);
  const authUser = getAuthUser();

  const loadMaps = useCallback(async () => {
    if (!authUser) return;
    try {
      setLoading(true);
      const response = await apiFetch("/api/map-library");
      if (response.ok) {
        const data = await response.json();
        setMaps(data);
      }
    } catch (err) {
      console.error("Failed to load map library:", err);
    } finally {
      setLoading(false);
    }
  }, [authUser]);

  useEffect(() => {
    loadMaps();
  }, [loadMaps]);

  const handleDelete = async (mapId: number) => {
    if (!confirm("确定要从地图库中移除此地图吗？")) return;
    try {
      const response = await apiFetch(`/api/map-library/${mapId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        setMaps((prev) => prev.filter((m) => m.id !== mapId));
      }
    } catch (err) {
      console.error("Failed to delete map:", err);
    }
  };

  if (!authUser) {
    return (
      <div className="min-h-screen bg-[#0d0f12] flex items-center justify-center">
        <Text className="text-gray-400">请先登录</Text>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0d0f12]" style={{ paddingTop: 'var(--sat, 0px)' }}>
      {/* Header */}
      <div className="bg-[#12151a] border-b border-gray-800 sticky z-10" style={{ top: 'var(--sat, 0px)' }}>
        <Container size="4" className="px-4 py-3">
          <Flex align="center" gap="3">
            <button
              onClick={() => navigate("/")}
              className="p-2 rounded-lg hover:bg-gray-800/50 transition-colors text-gray-400 hover:text-gray-200"
            >
              <ArrowLeftIcon width={20} height={20} />
            </button>
            <Heading size="4" className="text-amber-100">
              地图库
            </Heading>
            <Text size="2" className="text-gray-500">
              {maps.length} 张地图
            </Text>
          </Flex>
        </Container>
      </div>

      {/* Content */}
      <Container size="4" className="px-4 py-6">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="animate-spin w-8 h-8 border-2 border-amber-500 border-t-transparent rounded-full" />
          </div>
        ) : maps.length === 0 ? (
          <div className="text-center py-20">
            <div className="text-6xl mb-4">🗺️</div>
            <Text className="text-gray-400 block mb-2">地图库为空</Text>
            <Text className="text-gray-500 text-sm">
              在模组中使用 AI 生成地图，或在战役地图列表中添加
            </Text>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {maps.map((map) => (
              <div
                key={map.id}
                className="group bg-[#1a1d24] rounded-xl border border-gray-800 overflow-hidden hover:border-amber-700/50 transition-all cursor-pointer"
                onClick={() => setPreviewMap(map)}
              >
                {/* Image */}
                <div className="aspect-video bg-gray-900 relative overflow-hidden">
                  <img
                    src={map.thumbnail_url || map.url}
                    alt={map.name}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>

                {/* Info */}
                <div className="p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-gray-200 truncate">
                        {map.name}
                      </h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs px-1.5 py-0.5 rounded bg-amber-900/30 text-amber-400/80">
                          {SOURCE_LABELS[map.source_type] || map.source_type}
                        </span>
                        {map.environment && (
                          <span className="text-xs text-gray-500">
                            {ENV_LABELS[map.environment] || map.environment}
                          </span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDelete(map.id);
                      }}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-red-400 hover:bg-red-500/10 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <TrashIcon width={14} height={14} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Container>

      {/* Preview Dialog */}
      <Dialog.Root open={!!previewMap} onOpenChange={() => setPreviewMap(null)}>
        <Dialog.Content aria-describedby={undefined} className="!max-w-4xl !p-0 !bg-[#12151a] !border-gray-800">
          {previewMap && (
            <>
              <Dialog.Title className="sr-only">{previewMap.name} 地图预览</Dialog.Title>
              <div className="relative">
                <img
                  src={previewMap.url}
                  alt={previewMap.name}
                  className="w-full max-h-[70dvh] object-contain bg-black"
                />
              </div>
              <div className="p-4 border-t border-gray-800">
                <Flex justify="between" align="start">
                  <div>
                    <Heading size="3" className="text-gray-100">
                      {previewMap.name}
                    </Heading>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs px-2 py-0.5 rounded bg-amber-900/30 text-amber-400">
                        {SOURCE_LABELS[previewMap.source_type] || previewMap.source_type}
                      </span>
                      {previewMap.environment && (
                        <span className="text-xs text-gray-500">
                          {ENV_LABELS[previewMap.environment] || previewMap.environment}
                        </span>
                      )}
                    </div>
                    {previewMap.description && (
                      <Text className="text-gray-400 text-sm mt-2 block">
                        {previewMap.description}
                      </Text>
                    )}
                  </div>
                  <Button
                    variant="soft"
                    color="red"
                    onClick={() => {
                      handleDelete(previewMap.id);
                      setPreviewMap(null);
                    }}
                  >
                    <TrashIcon /> 删除
                  </Button>
                </Flex>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Root>
    </div>
  );
}
