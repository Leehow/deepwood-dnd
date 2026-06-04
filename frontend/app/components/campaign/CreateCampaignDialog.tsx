import * as Dialog from "@radix-ui/react-dialog";
import { useState, useEffect } from "react";
import { apiFetch } from "~/utils/api-client";

interface Module {
  id: string;
  title: string;
  title_en?: string;
  description?: string;
  images_count?: number;
  monsters_count?: number;
  items_count?: number;
  isCustom?: boolean;
}

interface ModuleImage {
  image_id: string;
  oss_url?: string;
  thumbnail_url?: string;
  category?: string;
}

interface ModuleParseStatus {
  monsters_count: number;
  items_count: number;
  images_count: number;
  map_images_count: number;
  embedding_status: "not_started" | "in_progress" | "completed";
  embedding_count: number;
}

interface CreateCampaignDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  onSuccess: (campaignId: number) => void;
}

interface CampaignTemplate {
  id: number;
  name: string;
  description?: string;
  cover_image?: string;
  created_at: string;
}

type Step = "module" | "info" | "cover";

export function CreateCampaignDialog({
  open,
  onOpenChange,
  userId,
  onSuccess,
}: CreateCampaignDialogProps) {
  const [step, setStep] = useState<Step>("module");
  const [modules, setModules] = useState<Module[]>([]);
  const [loadingModules, setLoadingModules] = useState(false);
  const [selectedModule, setSelectedModule] = useState<Module | null>(null);
  const [isManualMode, setIsManualMode] = useState(false);

  // Module parse status
  const [parseStatus, setParseStatus] = useState<ModuleParseStatus | null>(null);
  const [loadingParseStatus, setLoadingParseStatus] = useState(false);

  // Campaign info
  const [campaignName, setCampaignName] = useState("");
  const [campaignDescription, setCampaignDescription] = useState("");
  const [maxPlayers, setMaxPlayers] = useState(4);
  const [generatingInfo, setGeneratingInfo] = useState(false);

  // Cover selection
  const [moduleImages, setModuleImages] = useState<ModuleImage[]>([]);
  const [loadingImages, setLoadingImages] = useState(false);
  const [selectedCover, setSelectedCover] = useState<string | null>(null);
  const [generatingCover, setGeneratingCover] = useState(false);
  const [generatedCover, setGeneratedCover] = useState<string | null>(null);

  // Submission
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Templates
  const [templates, setTemplates] = useState<CampaignTemplate[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<CampaignTemplate | null>(null);

  // Load modules on open
  useEffect(() => {
    if (open) {
      loadModules();
      loadTemplates();
      // Reset state
      setStep("module");
      setSelectedModule(null);
      setIsManualMode(false);
      setParseStatus(null);
      setCampaignName("");
      setCampaignDescription("");
      setMaxPlayers(4);
      setModuleImages([]);
      setSelectedCover(null);
      setGeneratedCover(null);
      setError(null);
      setSelectedTemplate(null);
    }
  }, [open, userId]);

  const loadModules = async () => {
    setLoadingModules(true);
    try {
      const [parsedRes, customRes] = await Promise.all([
        apiFetch("/api/modules/parsed"),
        apiFetch("/api/custom-modules"),
      ]);

      const allModules: Module[] = [];

      if (parsedRes.ok) {
        const data = await parsedRes.json();
        allModules.push(...(data || []).map((m: any) => ({ ...m, isCustom: false })));
      }

      if (customRes.ok) {
        const data = await customRes.json();
        const items = data.items || data;
        allModules.push(...items.map((m: any) => ({
          id: m.module_id,
          title: m.title,
          description: m.description,
          isCustom: true,
        })));
      }

      setModules(allModules);
    } catch (err) {
      console.error("Failed to load modules:", err);
    } finally {
      setLoadingModules(false);
    }
  };

  const loadTemplates = async () => {
    try {
      const res = await apiFetch("/api/campaign-templates");
      if (res.ok) {
        setTemplates(await res.json());
      }
    } catch (err) {
      console.error("Failed to load templates:", err);
    }
  };

  const handleTemplateSelect = (tpl: CampaignTemplate) => {
    setSelectedTemplate(tpl);
    setSelectedModule(null);
    setIsManualMode(false);
    setCampaignName(tpl.name.replace(/ - 模板$/, ""));
    setCampaignDescription(tpl.description || "");
    setStep("info");
  };

  const handleDeleteTemplate = async (tplId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!confirm("确定要删除这个模板吗？")) return;
    try {
      await apiFetch(`/api/campaign-templates/${tplId}`, { method: "DELETE" });
      setTemplates((prev) => prev.filter((t) => t.id !== tplId));
    } catch (err) {
      console.error("Failed to delete template:", err);
    }
  };

  const loadParseStatus = async (moduleId: string) => {
    setLoadingParseStatus(true);
    try {
      // Fetch module details and embedding status in parallel
      const [moduleRes, embedRes] = await Promise.all([
        apiFetch(`/api/modules/parsed/${moduleId}`),
        apiFetch(`/api/modules/parsed/${moduleId}/embed/status`),
      ]);

      let status: ModuleParseStatus = {
        monsters_count: 0,
        items_count: 0,
        images_count: 0,
        map_images_count: 0,
        embedding_status: "not_started",
        embedding_count: 0,
      };

      if (moduleRes.ok) {
        const moduleData = await moduleRes.json();
        status.monsters_count = moduleData.stats?.monsters_count || 0;
        status.items_count = moduleData.stats?.items_count || 0;
        status.images_count = moduleData.stats?.images_count || 0;
        // Count map images
        const images = moduleData.images || [];
        status.map_images_count = images.filter(
          (img: { category?: string }) => img.category === "map"
        ).length;
      }

      if (embedRes.ok) {
        const embedData = await embedRes.json();
        status.embedding_status = embedData.status || "not_started";
        status.embedding_count = embedData.chunk_count || 0;
      }

      setParseStatus(status);
    } catch (err) {
      console.error("Failed to load parse status:", err);
    } finally {
      setLoadingParseStatus(false);
    }
  };

  const handleModuleSelect = async (module: Module) => {
    setSelectedModule(module);
    setIsManualMode(false);
    setParseStatus(null);
    setStep("info");

    if (module.isCustom) {
      // 自定义模组：直接使用标题和描述
      setCampaignName(module.title || "新战役");
      setCampaignDescription(module.description || "");
      return;
    }

    // 解析模组：加载状态 + AI生成信息 + 加载图片
    loadParseStatus(module.id);

    // Generate campaign info from module
    setGeneratingInfo(true);
    try {
      const response = await apiFetch(
        `/api/campaigns/generate-info-from-module/${module.id}`,
        { method: "POST" }
      );
      if (response.ok) {
        const data = await response.json();
        setCampaignName(data.name || module.title || "");
        setCampaignDescription(data.description || "");
      } else {
        setCampaignName(module.title || "新战役");
        setCampaignDescription(module.description || "");
      }
    } catch (err) {
      console.error("Failed to generate info:", err);
      setCampaignName(module.title || "新战役");
      setCampaignDescription(module.description || "");
    } finally {
      setGeneratingInfo(false);
    }

    // Load module images for cover selection
    loadModuleImages(module.id);
  };

  const handleManualMode = () => {
    setSelectedModule(null);
    setIsManualMode(true);
    setCampaignName("");
    setCampaignDescription("");
    setStep("info");
  };

  const loadModuleImages = async (moduleId: string) => {
    setLoadingImages(true);
    try {
      const response = await apiFetch(`/api/modules/parsed/${moduleId}`);
      if (response.ok) {
        const data = await response.json();
        const images = (data.images || []).filter(
          (img: ModuleImage) => img.oss_url || img.thumbnail_url
        );
        setModuleImages(images);
      }
    } catch (err) {
      console.error("Failed to load module images:", err);
    } finally {
      setLoadingImages(false);
    }
  };

  const handleInfoNext = () => {
    if (!campaignName.trim()) return;
    if (selectedTemplate) {
      // Template mode: create directly, skip cover
      handleCreateFromTemplate();
    } else if (selectedModule) {
      setStep("cover");
    } else {
      // Manual mode - skip cover selection, create directly
      handleCreateCampaign();
    }
  };

  const handleGenerateCover = async () => {
    if (!selectedModule) return;

    setGeneratingCover(true);
    setError(null);
    try {
      // Use AbortController for timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 180000); // 3 minute timeout

      const response = await apiFetch(
        `/api/campaigns/generate-cover-from-module/${selectedModule.id}`,
        { method: "POST", signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || "生成失败");
      }

      const data = await response.json();
      if (data.success && data.cover_url) {
        setGeneratedCover(data.cover_url);
        setSelectedCover(data.cover_url);
      } else {
        throw new Error("生成失败");
      }
    } catch (err: unknown) {
      let errorMessage = "AI生成失败，请重试";
      if (err instanceof Error) {
        if (err.name === "AbortError") {
          errorMessage = "请求超时，AI图像生成需要较长时间，请稍后重试";
        } else if (err.message.includes("Failed to fetch")) {
          errorMessage = "网络连接失败，请检查后端服务是否运行";
        } else {
          errorMessage = err.message;
        }
      }
      setError(errorMessage);
    } finally {
      setGeneratingCover(false);
    }
  };

  const handleCreateCampaign = async () => {
    if (!campaignName.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      // 如果选择了模组，标记需要自动导入
      const metadata = selectedModule
        ? { auto_import_pending: true }
        : undefined;

      const response = await apiFetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: campaignName.trim(),
          description: campaignDescription.trim(),
          dm_user_id: userId,
          max_players: maxPlayers,
          status: "recruiting",
          cover_image: selectedCover || generatedCover || null,
          selected_module_id: selectedModule?.id || null,
          metadata,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        onOpenChange(false);
        onSuccess(data.id);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || "创建失败");
      }
    } catch (err) {
      setError("创建战役失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleCreateFromTemplate = async () => {
    if (!selectedTemplate || !campaignName.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await apiFetch(
        `/api/campaign-templates/${selectedTemplate.id}/create-campaign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: campaignName.trim(),
            description: campaignDescription.trim() || null,
          }),
        }
      );
      if (response.ok) {
        const data = await response.json();
        onOpenChange(false);
        onSuccess(data.id);
      } else {
        const errorData = await response.json();
        setError(errorData.detail || "从模板创建失败");
      }
    } catch (err) {
      setError("从模板创建战役失败");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    if (step === "info") setStep("module");
    else if (step === "cover") setStep("info");
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[200]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-[#1a1d24] rounded-xl shadow-2xl z-[201] w-[95vw] max-w-[560px] max-h-[85dvh] overflow-hidden flex flex-col border border-gray-700">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-700">
            <Dialog.Title className="text-lg font-bold text-amber-400">
              创建新战役
            </Dialog.Title>
            <Dialog.Close className="w-7 h-7 flex items-center justify-center rounded-lg bg-gray-700/50 hover:bg-gray-600/50 text-gray-400 hover:text-white transition-colors text-sm">
              ✕
            </Dialog.Close>
          </div>

          {/* Step Indicator */}
          <div className="px-5 py-3 bg-gray-800/50 border-b border-gray-700/50">
            <div className="flex items-center gap-2">
              <StepBadge
                number={1}
                label="选择模组"
                active={step === "module"}
                completed={step !== "module"}
              />
              <div className="flex-1 h-px bg-gray-600" />
              <StepBadge
                number={2}
                label="基本信息"
                active={step === "info"}
                completed={step === "cover"}
              />
              {selectedModule && !selectedTemplate && (
                <>
                  <div className="flex-1 h-px bg-gray-600" />
                  <StepBadge
                    number={3}
                    label="封面图"
                    active={step === "cover"}
                    completed={false}
                  />
                </>
              )}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-5">
            {error && (
              <div className="mb-4 p-3 bg-red-900/30 border border-red-500/50 rounded-lg text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Step 1: Module Selection */}
            {step === "module" && (
              <div className="space-y-4">
                {/* Template Section */}
                {templates.length > 0 && (
                  <div>
                    <h3 className="text-sm font-medium text-gray-300 mb-2 flex items-center gap-2">
                      <span className="text-indigo-400">📋</span> 从模板恢复
                    </h3>
                    <div className="space-y-2 max-h-[160px] overflow-y-auto">
                      {templates.map((tpl) => (
                        <button
                          key={tpl.id}
                          onClick={() => handleTemplateSelect(tpl)}
                          className="w-full p-3 bg-indigo-900/20 hover:bg-indigo-900/40 rounded-lg border border-indigo-600/30 hover:border-indigo-500/50 transition-all text-left group"
                        >
                          <div className="flex items-center gap-3">
                            {tpl.cover_image && (
                              <img src={tpl.cover_image} alt="" className="w-10 h-10 rounded-lg object-cover flex-shrink-0" />
                            )}
                            <div className="flex-1 min-w-0">
                              <h4 className="text-white text-sm font-medium truncate group-hover:text-indigo-200">
                                {tpl.name}
                              </h4>
                              <p className="text-xs text-gray-500 mt-0.5">
                                {new Date(tpl.created_at).toLocaleDateString("zh-CN")}
                                {tpl.description && ` · ${tpl.description.slice(0, 30)}`}
                              </p>
                            </div>
                            <button
                              onClick={(e) => handleDeleteTemplate(tpl.id, e)}
                              className="w-6 h-6 flex items-center justify-center text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="删除模板"
                            >
                              ×
                            </button>
                            <span className="text-gray-500 group-hover:text-indigo-400 transition-colors">→</span>
                          </div>
                        </button>
                      ))}
                    </div>
                    <div className="my-3 flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-700" />
                      <span className="text-xs text-gray-500">或选择模组</span>
                      <div className="flex-1 h-px bg-gray-700" />
                    </div>
                  </div>
                )}

                <div className="p-4 bg-amber-900/20 border border-amber-600/30 rounded-lg">
                  <p className="text-amber-200 text-sm">
                    💡 <strong>推荐：</strong>选择一个模组开始创建战役。解析模组支持AI自动生成战役信息和封面选择。
                  </p>
                </div>

                {loadingModules ? (
                  <div className="py-8 text-center text-gray-400">
                    <div className="animate-pulse">加载模组列表...</div>
                  </div>
                ) : modules.length === 0 ? (
                  <div className="py-8 text-center">
                    <p className="text-gray-400 mb-3">暂无模组</p>
                    <p className="text-gray-500 text-sm mb-4">
                      可以上传解析模组或创建自定义模组，也可手动创建战役
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2 max-h-[280px] overflow-y-auto">
                    {modules.map((module) => (
                      <button
                        key={module.id}
                        onClick={() => handleModuleSelect(module)}
                        className="w-full p-3 bg-gray-700/50 hover:bg-gray-700 rounded-lg border border-gray-600 hover:border-amber-500/50 transition-all text-left group"
                      >
                        <div className="flex items-start gap-3">
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${module.isCustom ? 'bg-blue-600/20 text-blue-400' : 'bg-amber-600/20 text-amber-400'}`}>
                            {module.isCustom ? '✏️' : '📖'}
                          </div>
                          <div className="flex-1 min-w-0">
                            <h4 className="text-white font-medium truncate group-hover:text-amber-200 transition-colors">
                              {module.title}
                              {module.isCustom && <span className="text-xs text-blue-400 ml-2">自创</span>}
                            </h4>
                            {module.description && (
                              <p className="text-gray-400 text-sm mt-1 line-clamp-2">
                                {module.description}
                              </p>
                            )}
                            <div className="flex gap-3 mt-2 text-xs text-gray-500">
                              {module.images_count !== undefined && module.images_count > 0 && (
                                <span>🖼 {module.images_count} 张图片</span>
                              )}
                            </div>
                          </div>
                          <div className="text-gray-500 group-hover:text-amber-400 transition-colors">
                            →
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}

                {/* Manual mode button */}
                <div className="pt-3 border-t border-gray-700">
                  <button
                    onClick={handleManualMode}
                    className="w-full p-3 bg-gray-800/50 hover:bg-gray-800 rounded-lg border border-dashed border-gray-600 hover:border-gray-500 transition-all text-gray-400 hover:text-gray-300"
                  >
                    <span className="text-lg mr-2">✍️</span>
                    跳过模组，手动创建战役
                  </button>
                </div>
              </div>
            )}

            {/* Step 2: Campaign Info */}
            {step === "info" && (
              <div className="space-y-4">
                {selectedTemplate && (
                  <div className="p-3 bg-indigo-900/20 border border-indigo-600/30 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-indigo-400">📋</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-300 text-sm truncate">
                          从模板创建: <span className="text-white">{selectedTemplate.name}</span>
                        </p>
                        <p className="text-xs text-gray-500 mt-1">
                          将恢复所有资源、地图配置和AI聊天记录
                        </p>
                      </div>
                    </div>
                  </div>
                )}
                {selectedModule && (
                  <div className="p-3 bg-gray-700/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-amber-400">📖</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-gray-300 text-sm truncate">
                          已选模组: <span className="text-white">{selectedModule.title}</span>
                        </p>
                      </div>
                    </div>

                    {/* Parse Status Display */}
                    {loadingParseStatus ? (
                      <div className="mt-3 pt-3 border-t border-gray-600/50">
                        <div className="flex items-center gap-2 text-gray-400 text-sm">
                          <span className="animate-spin">⏳</span>
                          正在检查模组解析状态...
                        </div>
                      </div>
                    ) : parseStatus && (
                      <div className="mt-3 pt-3 border-t border-gray-600/50">
                        <p className="text-xs text-gray-500 mb-2">模组解析状态</p>
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          {/* Monsters */}
                          <div className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                            parseStatus.monsters_count > 0
                              ? "bg-green-900/30 text-green-400"
                              : "bg-gray-800/50 text-gray-500"
                          }`}>
                            <span>{parseStatus.monsters_count > 0 ? "✓" : "○"}</span>
                            <span>怪物/NPC</span>
                            <span className="ml-auto font-medium">
                              {parseStatus.monsters_count > 0 ? parseStatus.monsters_count : "未解析"}
                            </span>
                          </div>

                          {/* Items */}
                          <div className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                            parseStatus.items_count > 0
                              ? "bg-green-900/30 text-green-400"
                              : "bg-gray-800/50 text-gray-500"
                          }`}>
                            <span>{parseStatus.items_count > 0 ? "✓" : "○"}</span>
                            <span>物品</span>
                            <span className="ml-auto font-medium">
                              {parseStatus.items_count > 0 ? parseStatus.items_count : "未解析"}
                            </span>
                          </div>

                          {/* Images & Maps */}
                          <div className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                            parseStatus.images_count > 0
                              ? "bg-green-900/30 text-green-400"
                              : "bg-gray-800/50 text-gray-500"
                          }`}>
                            <span>{parseStatus.images_count > 0 ? "✓" : "○"}</span>
                            <span>图片</span>
                            <span className="ml-auto font-medium">
                              {parseStatus.images_count > 0
                                ? `${parseStatus.images_count} (${parseStatus.map_images_count}张地图)`
                                : "未解析"}
                            </span>
                          </div>

                          {/* Embedding/Vectorization */}
                          <div className={`flex items-center gap-2 px-2 py-1.5 rounded ${
                            parseStatus.embedding_status === "completed"
                              ? "bg-green-900/30 text-green-400"
                              : parseStatus.embedding_status === "in_progress"
                              ? "bg-yellow-900/30 text-yellow-400"
                              : "bg-gray-800/50 text-gray-500"
                          }`}>
                            <span>
                              {parseStatus.embedding_status === "completed" ? "✓"
                                : parseStatus.embedding_status === "in_progress" ? "⏳"
                                : "○"}
                            </span>
                            <span>向量化</span>
                            <span className="ml-auto font-medium">
                              {parseStatus.embedding_status === "completed"
                                ? parseStatus.embedding_count
                                : parseStatus.embedding_status === "in_progress"
                                ? "进行中..."
                                : "未处理"}
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {generatingInfo && (
                  <div className="p-3 bg-amber-900/20 border border-amber-600/30 rounded-lg text-amber-200 text-sm flex items-center gap-2">
                    <span className="animate-spin">⏳</span>
                    AI正在根据模组内容生成战役信息...
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    战役名称 <span className="text-red-400">*</span>
                  </label>
                  <input
                    type="text"
                    value={campaignName}
                    onChange={(e) => setCampaignName(e.target.value)}
                    placeholder="例如：被遗忘的国度..."
                    disabled={generatingInfo}
                    className="w-full px-3 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    战役描述
                  </label>
                  <textarea
                    value={campaignDescription}
                    onChange={(e) => setCampaignDescription(e.target.value)}
                    placeholder="简要描述这个战役的背景或主题..."
                    rows={3}
                    disabled={generatingInfo}
                    className="w-full px-3 py-2.5 bg-gray-700 text-white rounded-lg border border-gray-600 focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/30 resize-none disabled:opacity-50"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    最大玩家数
                  </label>
                  <div className="flex gap-2">
                    {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                      <button
                        key={n}
                        onClick={() => setMaxPlayers(n)}
                        className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                          maxPlayers === n
                            ? "bg-amber-600 text-white"
                            : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                        }`}
                      >
                        {n}人
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Step 3: Cover Selection */}
            {step === "cover" && (
              <div className="space-y-4">
                {/* AI Generate Button */}
                <div className="flex items-center gap-3 p-3 bg-amber-900/15 border border-amber-600/30 rounded-lg">
                  <button
                    onClick={handleGenerateCover}
                    disabled={generatingCover}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-black font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    {generatingCover ? (
                      <>
                        <span className="animate-spin">⏳</span>
                        生成中...
                      </>
                    ) : (
                      <>
                        ✨ AI生成封面
                      </>
                    )}
                  </button>
                  <span className="text-amber-200/80 text-sm">
                    根据模组内容自动生成封面
                  </span>
                </div>

                {/* Current selection */}
                {(selectedCover || generatedCover) && (
                  <div className="p-3 bg-gray-700/50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <img
                        src={selectedCover || generatedCover || ""}
                        alt="封面预览"
                        className="w-20 h-14 object-cover rounded-lg border border-gray-600"
                      />
                      <div className="flex-1">
                        <p className="text-sm text-gray-300">
                          {generatedCover && selectedCover === generatedCover ? "AI生成的封面" : "已选择封面图"}
                        </p>
                      </div>
                      <button
                        onClick={() => {
                          setSelectedCover(null);
                          setGeneratedCover(null);
                        }}
                        className="text-xs text-gray-500 hover:text-red-400 transition-colors"
                      >
                        清除
                      </button>
                    </div>
                  </div>
                )}

                {/* Module Images */}
                <div>
                  <p className="text-gray-400 text-sm mb-3">
                    或从模组图片中选择：
                  </p>
                  {loadingImages ? (
                    <div className="py-8 text-center text-gray-400">
                      <div className="animate-pulse">加载图片...</div>
                    </div>
                  ) : moduleImages.length === 0 ? (
                    <div className="py-6 text-center text-gray-500 bg-gray-800/30 rounded-lg">
                      <p>该模组暂无可用图片</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-4 gap-2 max-h-[200px] overflow-y-auto p-1">
                      {moduleImages.map((img) => {
                        const displayUrl = img.thumbnail_url || img.oss_url || "";
                        const saveUrl = img.oss_url || img.thumbnail_url || "";
                        const isSelected = selectedCover === saveUrl;
                        return (
                          <button
                            key={img.image_id}
                            onClick={() => setSelectedCover(isSelected ? null : saveUrl)}
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
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-between items-center px-5 py-4 border-t border-gray-700 bg-gray-800/50">
            <div>
              {step !== "module" && (
                <button
                  onClick={handleBack}
                  className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
                >
                  ← 返回
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <Dialog.Close asChild>
                <button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors">
                  取消
                </button>
              </Dialog.Close>

              {step === "info" && (
                <button
                  onClick={handleInfoNext}
                  disabled={!campaignName.trim() || generatingInfo || submitting}
                  className={`px-5 py-2 ${selectedTemplate ? 'bg-indigo-600 hover:bg-indigo-500' : 'bg-amber-600 hover:bg-amber-500'} text-white font-medium rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2`}
                >
                  {submitting ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      创建中...
                    </>
                  ) : selectedTemplate ? "从模板创建" : selectedModule ? "下一步" : "创建战役"}
                </button>
              )}

              {step === "cover" && (
                <button
                  onClick={handleCreateCampaign}
                  disabled={submitting}
                  className="px-5 py-2 bg-amber-600 hover:bg-amber-500 text-white font-medium rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                >
                  {submitting ? (
                    <>
                      <span className="animate-spin">⏳</span>
                      创建中...
                    </>
                  ) : (
                    "创建战役"
                  )}
                </button>
              )}
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StepBadge({
  number,
  label,
  active,
  completed,
}: {
  number: number;
  label: string;
  active: boolean;
  completed: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <div
        className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors ${
          active
            ? "bg-amber-500 text-white"
            : completed
            ? "bg-green-600 text-white"
            : "bg-gray-600 text-gray-400"
        }`}
      >
        {completed ? "✓" : number}
      </div>
      <span
        className={`text-sm ${
          active ? "text-amber-400 font-medium" : "text-gray-500"
        }`}
      >
        {label}
      </span>
    </div>
  );
}
