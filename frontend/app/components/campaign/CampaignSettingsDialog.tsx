import * as Dialog from "@radix-ui/react-dialog";
import * as Tabs from "@radix-ui/react-tabs";
import { useState, useEffect, useRef, useCallback } from "react";
import { apiFetch } from "~/utils/api-client";

interface ModuleImage {
  image_id: string;
  oss_url?: string;
  thumbnail_url?: string;
  category?: string;
}

interface UserMap {
  id: number;
  name: string;
  url: string;
  thumbnail_url?: string;
}

interface UserCover {
  id: number;
  name: string;
  url: string;
  thumbnail_url?: string;
  prompt?: string;
}

interface CampaignSettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  campaignId: number;
  campaignName: string;
  campaignDescription?: string;
  coverImage?: string;
  selectedModuleId?: string;
  userId: string;
  enableDeitySystem?: boolean;
  enable3DDice?: boolean;
  maxPlayers?: number;
  onSave: (data: { name: string; description: string; cover_image: string | null; metadata?: { enable_deity_system?: boolean; enable_3d_dice?: boolean }; max_players?: number }) => Promise<void>;
}

type TemplateStatus = "idle" | "saving" | "success" | "error";

export function CampaignSettingsDialog({
  open,
  onOpenChange,
  campaignId,
  campaignName,
  campaignDescription,
  coverImage,
  selectedModuleId,
  userId,
  enableDeitySystem: initialEnableDeitySystem = true,
  enable3DDice: initialEnable3DDice = true,
  maxPlayers: initialMaxPlayers,
  onSave,
}: CampaignSettingsDialogProps) {
  const [name, setName] = useState(campaignName);
  const [description, setDescription] = useState(campaignDescription || "");
  const [selectedImage, setSelectedImage] = useState<string | null>(coverImage || null);
  const [enableDeitySystem, setEnableDeitySystem] = useState(initialEnableDeitySystem);
  const [enable3DDice, setEnable3DDice] = useState(initialEnable3DDice);
  const [maxPlayers, setMaxPlayers] = useState<number>(initialMaxPlayers ?? 6);
  const [activeTab, setActiveTab] = useState<"covers" | "module" | "library" | "ai">("covers");
  const [moduleImages, setModuleImages] = useState<ModuleImage[]>([]);
  const [mapLibrary, setMapLibrary] = useState<UserMap[]>([]);
  const [coverLibrary, setCoverLibrary] = useState<UserCover[]>([]);
  const [loadingModule, setLoadingModule] = useState(false);
  const [loadingLibrary, setLoadingLibrary] = useState(false);
  const [loadingCovers, setLoadingCovers] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");

  // AI generation states
  const [generating, setGenerating] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [generatedPrompt, setGeneratedPrompt] = useState<string>("");
  const [aiError, setAiError] = useState<string>("");

  // Template save states
  const [templateStatus, setTemplateStatus] = useState<TemplateStatus>("idle");
  const [existingTemplate, setExistingTemplate] = useState<{ id: number; name: string; is_shared?: boolean; updated_at?: string; created_at: string } | null>(null);
  const [shareStatus, setShareStatus] = useState<TemplateStatus>("idle");

  // Refs for debounced save
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const latestValuesRef = useRef({ name, description, selectedImage, enableDeitySystem, enable3DDice, maxPlayers });

  // Update refs when values change
  useEffect(() => {
    latestValuesRef.current = { name, description, selectedImage, enableDeitySystem, enable3DDice, maxPlayers };
  }, [name, description, selectedImage, enableDeitySystem, enable3DDice, maxPlayers]);

  // Auto-save function
  const doSave = useCallback(async () => {
    const { name: currentName, description: currentDesc, selectedImage: currentImage, enableDeitySystem: currentDeitySystem, enable3DDice: current3DDice, maxPlayers: currentMaxPlayers } = latestValuesRef.current;
    if (!currentName.trim()) return;

    setSaveStatus("saving");
    try {
      await onSave({
        name: currentName.trim(),
        description: currentDesc.trim(),
        cover_image: currentImage,
        metadata: { enable_deity_system: currentDeitySystem, enable_3d_dice: current3DDice },
        max_players: currentMaxPlayers,
      });
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 1500);
    } catch (err) {
      console.error("Auto-save failed:", err);
      setSaveStatus("idle");
    }
  }, [onSave]);

  // Debounced save for text inputs
  const scheduleSave = useCallback((immediate = false) => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    if (immediate) {
      doSave();
    } else {
      saveTimeoutRef.current = setTimeout(doSave, 800);
    }
  }, [doSave]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (open) {
      setName(campaignName);
      setDescription(campaignDescription || "");
      setSelectedImage(coverImage || null);
      setEnableDeitySystem(initialEnableDeitySystem);
      setMaxPlayers(initialMaxPlayers ?? 6);
      setGeneratedImage(null);
      setGeneratedPrompt("");
      setAiError("");
      setTemplateStatus("idle");
      setExistingTemplate(null);
      setShareStatus("idle");
      loadCoverLibrary();
      loadTemplateStatus();
      if (selectedModuleId) {
        loadModuleImages(selectedModuleId);
      }
      loadMapLibrary();
    }
  }, [open, campaignName, campaignDescription, coverImage, selectedModuleId, userId, initialEnableDeitySystem]);

  const loadCoverLibrary = async () => {
    setLoadingCovers(true);
    try {
      const response = await apiFetch("/api/cover-library");
      if (response.ok) {
        const data = await response.json();
        setCoverLibrary(data || []);
      }
    } catch (err) {
      console.error("Failed to load cover library:", err);
    } finally {
      setLoadingCovers(false);
    }
  };

  const loadModuleImages = async (moduleId: string) => {
    setLoadingModule(true);
    try {
      const response = await apiFetch(`/api/modules/parsed/${moduleId}`);
      if (response.ok) {
        const data = await response.json();
        const images = (data.images || []).filter((img: ModuleImage) =>
          img.oss_url || img.thumbnail_url
        );
        setModuleImages(images);
      }
    } catch (err) {
      console.error("Failed to load module images:", err);
    } finally {
      setLoadingModule(false);
    }
  };

  const loadMapLibrary = async () => {
    setLoadingLibrary(true);
    try {
      const response = await apiFetch("/api/map-library");
      if (response.ok) {
        const data = await response.json();
        setMapLibrary(data || []);
      }
    } catch (err) {
      console.error("Failed to load map library:", err);
    } finally {
      setLoadingLibrary(false);
    }
  };

  const loadTemplateStatus = async () => {
    try {
      const response = await apiFetch(`/api/campaigns/${campaignId}/template-status`);
      if (response.ok) {
        const data = await response.json();
        setExistingTemplate(data);
      }
    } catch (err) {
      console.error("Failed to load template status:", err);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) return;
    await doSave();
  };

  const handleNameChange = (value: string) => {
    setName(value);
    scheduleSave();
  };

  const handleDescriptionChange = (value: string) => {
    setDescription(value);
    scheduleSave();
  };

  const handleImageSelect = (url: string) => {
    const newImage = selectedImage === url ? null : url;
    setSelectedImage(newImage);
    // Immediate save for image selection
    setTimeout(() => scheduleSave(true), 50);
  };

  const handleGenerateAI = async () => {
    if (!selectedModuleId) {
      setAiError("请先在战役中选择一个模组");
      return;
    }

    setGenerating(true);
    setAiError("");
    setGeneratedImage(null);
    setGeneratedPrompt("");

    try {
      const response = await apiFetch(`/api/campaigns/${campaignId}/generate-cover-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "生成失败");
      }

      const data = await response.json();
      if (data.success && data.cover_url) {
        setGeneratedImage(data.cover_url);
        setGeneratedPrompt(data.prompt || "");
        // Refresh cover library since new cover was added
        loadCoverLibrary();
      } else {
        throw new Error("生成失败");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "AI生成失败，请重试";
      setAiError(errorMessage);
    } finally {
      setGenerating(false);
    }
  };

  const handleUseGeneratedImage = () => {
    if (generatedImage) {
      setSelectedImage(generatedImage);
      // Immediate save
      setTimeout(() => scheduleSave(true), 50);
    }
  };

  const handleDeleteCover = async (coverId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要从封面库中删除这个封面吗？")) return;

    try {
      const response = await apiFetch(`/api/cover-library/${coverId}`, {
        method: "DELETE",
      });
      if (response.ok) {
        loadCoverLibrary();
      }
    } catch (err) {
      console.error("Failed to delete cover:", err);
    }
  };

  const handleSaveAsTemplate = async () => {
    setTemplateStatus("saving");
    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/save-as-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name || campaignName }),
        }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "保存失败");
      }
      const data = await response.json();
      setExistingTemplate(data);
      setTemplateStatus("success");
      setTimeout(() => setTemplateStatus("idle"), 3000);
    } catch (err) {
      console.error("Failed to save template:", err);
      setTemplateStatus("error");
      setTimeout(() => setTemplateStatus("idle"), 3000);
    }
  };

  const handleShareTemplate = async () => {
    setShareStatus("saving");
    try {
      const response = await apiFetch(
        `/api/campaigns/${campaignId}/share-template`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: name || campaignName }),
        }
      );
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "分享失败");
      }
      const data = await response.json();
      setExistingTemplate(data);
      setShareStatus("success");
      setTimeout(() => setShareStatus("idle"), 3000);
    } catch (err) {
      console.error("Failed to share template:", err);
      setShareStatus("error");
      setTimeout(() => setShareStatus("idle"), 3000);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[200]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-gray-800 rounded-xl p-6 shadow-2xl z-[201] w-[95vw] max-w-[600px] max-h-[85dvh] overflow-hidden flex flex-col">
          <div className="flex items-center justify-between mb-5">
            <Dialog.Title className="text-xl font-bold text-amber-400">
              战役设置
            </Dialog.Title>
            <Dialog.Close className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors">
              ✕
            </Dialog.Close>
          </div>

          <div className="flex-1 overflow-y-auto space-y-5 pr-1">
            {/* Campaign Name */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                战役名称
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="输入战役名称..."
                className="w-full px-3 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30"
              />
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                战役描述
              </label>
              <textarea
                value={description}
                onChange={(e) => handleDescriptionChange(e.target.value)}
                placeholder="简要描述这个战役的背景或主题..."
                rows={3}
                className="w-full px-3 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 resize-none"
              />
            </div>

            {/* Max Players */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                最大玩家人数
              </label>
              <div className="flex items-center gap-3">
                <input
                  type="number"
                  min={2}
                  max={10}
                  value={maxPlayers}
                  onChange={(e) => {
                    const v = Math.min(10, Math.max(2, parseInt(e.target.value) || 2));
                    setMaxPlayers(v);
                    scheduleSave();
                  }}
                  className="w-20 px-3 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 text-center"
                />
                <span className="text-sm text-gray-500">人（2-10）</span>
              </div>
            </div>

            {/* Optional Rules */}
            <div className="p-4 bg-gray-700/30 rounded-lg border border-gray-600/50">
              <h3 className="text-sm font-medium text-gray-300 mb-3 flex items-center gap-2">
                <span className="text-amber-400">⚙</span> 可选规则
              </h3>
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={enableDeitySystem}
                      onChange={(e) => {
                        setEnableDeitySystem(e.target.checked);
                        setTimeout(() => scheduleSave(true), 50);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-600 rounded-full peer-checked:bg-amber-500 transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm text-gray-200 group-hover:text-white transition-colors">启用神祇系统</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      启用后，玩家创建角色时可以选择信仰的神祇
                    </p>
                  </div>
                </label>
                <label className="flex items-center gap-3 cursor-pointer group">
                  <div className="relative">
                    <input
                      type="checkbox"
                      checked={enable3DDice}
                      onChange={(e) => {
                        setEnable3DDice(e.target.checked);
                        setTimeout(() => scheduleSave(true), 50);
                      }}
                      className="sr-only peer"
                    />
                    <div className="w-10 h-5 bg-gray-600 rounded-full peer-checked:bg-amber-500 transition-colors" />
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition-transform peer-checked:translate-x-5" />
                  </div>
                  <div className="flex-1">
                    <span className="text-sm text-gray-200 group-hover:text-white transition-colors">3D 骰子动画</span>
                    <p className="text-xs text-gray-500 mt-0.5">
                      启用后，投骰时播放 3D 骰子动画（所有玩家同步可见）
                    </p>
                  </div>
                </label>
              </div>
            </div>

            {/* Cover Image Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-3">
                封面图
                {selectedImage && (
                  <button
                    onClick={() => {
                      setSelectedImage(null);
                      setTimeout(() => scheduleSave(true), 50);
                    }}
                    className="ml-2 text-xs text-gray-500 hover:text-red-400 transition-colors"
                  >
                    (清除)
                  </button>
                )}
              </label>

              {/* Current Selection Preview */}
              {selectedImage && (
                <div className="mb-4 p-3 bg-gray-700/50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <img
                      src={selectedImage}
                      alt="封面预览"
                      className="w-20 h-14 object-cover rounded-lg border border-gray-600"
                    />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-300 truncate">已选择封面图</p>
                      <p className="text-xs text-gray-500 truncate">{selectedImage.split('/').pop()}</p>
                    </div>
                  </div>
                </div>
              )}

              {/* Tabs for image sources */}
              <Tabs.Root value={activeTab} onValueChange={(v) => setActiveTab(v as "covers" | "module" | "library" | "ai")}>
                <Tabs.List className="flex gap-1 mb-3 p-1 bg-gray-700/50 rounded-lg">
                  <Tabs.Trigger
                    value="covers"
                    className="flex-1 px-2 py-1.5 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-emerald-600 data-[state=active]:text-white data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-gray-200"
                  >
                    封面库
                  </Tabs.Trigger>
                  <Tabs.Trigger
                    value="module"
                    className="flex-1 px-2 py-1.5 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-gray-200"
                  >
                    模组图片
                  </Tabs.Trigger>
                  <Tabs.Trigger
                    value="library"
                    className="flex-1 px-2 py-1.5 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-amber-600 data-[state=active]:text-white data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-gray-200"
                  >
                    地图库
                  </Tabs.Trigger>
                  <Tabs.Trigger
                    value="ai"
                    className="flex-1 px-2 py-1.5 text-sm font-medium rounded-md transition-colors data-[state=active]:bg-amber-600 data-[state=active]:text-black data-[state=inactive]:text-gray-400 data-[state=inactive]:hover:text-gray-200"
                  >
                    ✨ AI生成
                  </Tabs.Trigger>
                </Tabs.List>

                {/* Cover Library Tab */}
                <Tabs.Content value="covers" className="focus:outline-none">
                  {loadingCovers ? (
                    <div className="p-6 text-center text-gray-400">
                      <div className="animate-pulse">加载中...</div>
                    </div>
                  ) : coverLibrary.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 bg-gray-700/30 rounded-lg">
                      <p>封面库暂无图片</p>
                      <p className="text-xs mt-1">使用"AI生成"创建封面图</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto p-1">
                      {coverLibrary.map((cover) => {
                        const isSelected = selectedImage === cover.url;
                        return (
                          <div
                            key={cover.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleImageSelect(cover.url)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleImageSelect(cover.url); }}
                            className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all hover:scale-105 group cursor-pointer ${
                              isSelected
                                ? "border-emerald-500 ring-2 ring-emerald-500/30"
                                : "border-transparent hover:border-gray-500"
                            }`}
                            title={cover.name}
                          >
                            <img
                              src={cover.url}
                              alt={cover.name}
                              className="w-full h-full object-cover"
                            />
                            {isSelected && (
                              <div className="absolute inset-0 bg-emerald-500/20 flex items-center justify-center">
                                <span className="text-white text-lg">✓</span>
                              </div>
                            )}
                            {/* Delete button */}
                            <button
                              onClick={(e) => handleDeleteCover(cover.id, e)}
                              className="absolute top-1 right-1 w-5 h-5 bg-red-600/80 hover:bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-xs"
                              title="删除"
                            >
                              ×
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </Tabs.Content>

                <Tabs.Content value="module" className="focus:outline-none">
                  {!selectedModuleId ? (
                    <div className="p-6 text-center text-gray-500 bg-gray-700/30 rounded-lg">
                      <p>请先在战役中选择一个模组</p>
                    </div>
                  ) : loadingModule ? (
                    <div className="p-6 text-center text-gray-400">
                      <div className="animate-pulse">加载中...</div>
                    </div>
                  ) : moduleImages.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 bg-gray-700/30 rounded-lg">
                      <p>该模组暂无图片</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto p-1">
                      {moduleImages.map((img) => {
                        const displayUrl = img.thumbnail_url || img.oss_url || "";
                        const saveUrl = img.oss_url || img.thumbnail_url || "";
                        const isSelected = selectedImage === saveUrl;
                        return (
                          <button
                            key={img.image_id}
                            onClick={() => handleImageSelect(saveUrl)}
                            className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                              isSelected
                                ? "border-amber-500 ring-2 ring-amber-500/30"
                                : "border-transparent hover:border-gray-500"
                            }`}
                          >
                            <img
                              src={displayUrl}
                              alt=""
                              className="w-full h-full object-cover"
                            />
                            {isSelected && (
                              <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                                <span className="text-white text-lg">✓</span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Tabs.Content>

                <Tabs.Content value="library" className="focus:outline-none">
                  {loadingLibrary ? (
                    <div className="p-6 text-center text-gray-400">
                      <div className="animate-pulse">加载中...</div>
                    </div>
                  ) : mapLibrary.length === 0 ? (
                    <div className="p-6 text-center text-gray-500 bg-gray-700/30 rounded-lg">
                      <p>地图库暂无图片</p>
                      <p className="text-xs mt-1">可在"地图库"页面添加地图</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto p-1">
                      {mapLibrary.map((map) => {
                        const displayUrl = map.thumbnail_url || map.url;
                        const saveUrl = map.url;
                        const isSelected = selectedImage === saveUrl;
                        return (
                          <button
                            key={map.id}
                            onClick={() => handleImageSelect(saveUrl)}
                            className={`relative aspect-[4/3] rounded-lg overflow-hidden border-2 transition-all hover:scale-105 ${
                              isSelected
                                ? "border-amber-500 ring-2 ring-amber-500/30"
                                : "border-transparent hover:border-gray-500"
                            }`}
                            title={map.name}
                          >
                            <img
                              src={displayUrl}
                              alt={map.name}
                              className="w-full h-full object-cover"
                            />
                            {isSelected && (
                              <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                                <span className="text-white text-lg">✓</span>
                              </div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Tabs.Content>

                <Tabs.Content value="ai" className="focus:outline-none">
                  <div className="space-y-4">
                    {!selectedModuleId ? (
                      <div className="p-6 text-center text-gray-500 bg-gray-700/30 rounded-lg">
                        <p>请先在战役中选择一个模组</p>
                        <p className="text-xs mt-1">AI将基于模组内容生成封面图</p>
                      </div>
                    ) : (
                      <>
                        {/* Generate Button */}
                        <div className="text-center">
                          <button
                            onClick={handleGenerateAI}
                            disabled={generating}
                            className="px-6 py-3 bg-amber-600 hover:bg-amber-500 text-black font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                          >
                            {generating ? (
                              <>
                                <span className="animate-spin">⏳</span>
                                生成中...
                              </>
                            ) : (
                              <>
                                ✨ 根据模组内容生成封面
                              </>
                            )}
                          </button>
                          <p className="text-xs text-gray-500 mt-2">
                            生成后自动保存到封面库，可在其他战役中使用
                          </p>
                        </div>

                        {/* Error Message */}
                        {aiError && (
                          <div className="p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-400 text-sm text-center">
                            {aiError}
                          </div>
                        )}

                        {/* Generated Image Preview */}
                        {generatedImage && (
                          <div className="space-y-3">
                            <div className="relative aspect-video rounded-lg overflow-hidden border-2 border-amber-500/50">
                              <img
                                src={generatedImage}
                                alt="AI生成的封面"
                                className="w-full h-full object-cover"
                              />
                              {selectedImage === generatedImage && (
                                <div className="absolute inset-0 bg-amber-500/20 flex items-center justify-center">
                                  <span className="text-white text-2xl">✓ 已选择</span>
                                </div>
                              )}
                            </div>

                            {/* Prompt Preview */}
                            {generatedPrompt && (
                              <div className="p-2 bg-gray-700/50 rounded-lg">
                                <p className="text-xs text-gray-400 line-clamp-2" title={generatedPrompt}>
                                  {generatedPrompt}
                                </p>
                              </div>
                            )}

                            {/* Use Button */}
                            <div className="flex gap-2 justify-center">
                              <button
                                onClick={handleUseGeneratedImage}
                                disabled={selectedImage === generatedImage}
                                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                                  selectedImage === generatedImage
                                    ? "bg-green-600 text-white cursor-default"
                                    : "bg-amber-600 hover:bg-amber-500 text-black"
                                }`}
                              >
                                {selectedImage === generatedImage ? "✓ 已选为封面" : "使用此图作为封面"}
                              </button>
                              <button
                                onClick={handleGenerateAI}
                                disabled={generating}
                                className="px-4 py-2 bg-gray-600 hover:bg-gray-500 text-white rounded-lg transition-colors disabled:opacity-50"
                              >
                                重新生成
                              </button>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </Tabs.Content>
              </Tabs.Root>
            </div>

            {/* Save / Share as Template */}
            <div className="p-4 bg-gray-700/30 rounded-lg border border-gray-600/50">
              <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                <span className="text-amber-400">📋</span> 战役模板
              </h3>
              <p className="text-xs text-gray-500 mb-3">
                {existingTemplate
                  ? `已保存模板「${existingTemplate.name}」${existingTemplate.is_shared ? '（已分享）' : ''}。`
                  : "保存或分享当前战役的所有资源、地图配置和AI聊天记录为模板。"}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={handleSaveAsTemplate}
                  disabled={templateStatus === "saving"}
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {templateStatus === "saving" ? "保存中..." : templateStatus === "success" ? "✓ 已保存" : templateStatus === "error" ? "失败，重试" : existingTemplate ? "更新模板" : "保存为模板"}
                </button>
                <button
                  onClick={handleShareTemplate}
                  disabled={shareStatus === "saving"}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                >
                  {shareStatus === "saving" ? "分享中..." : shareStatus === "success" ? "✓ 已分享" : shareStatus === "error" ? "失败，重试" : existingTemplate?.is_shared ? "更新分享" : "分享模板"}
                </button>
              </div>
            </div>
          </div>

          {/* Footer with save status */}
          <div className="flex justify-between items-center mt-6 pt-4 border-t border-gray-700">
            <div className="text-sm">
              {saveStatus === "saving" && (
                <span className="text-amber-400 flex items-center gap-1">
                  <span className="animate-pulse">●</span> 保存中...
                </span>
              )}
              {saveStatus === "saved" && (
                <span className="text-green-400 flex items-center gap-1">
                  ✓ 已保存
                </span>
              )}
              {saveStatus === "idle" && (
                <span className="text-gray-500">自动保存</span>
              )}
            </div>
            <Dialog.Close asChild>
              <button className="px-5 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                关闭
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
