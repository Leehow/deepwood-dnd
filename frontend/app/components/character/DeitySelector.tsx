import { useState, useRef, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import godsData from "~/data/rules/gods.json";
import { getAssetUrl } from "~/utils/asset-url";
import { useModalContextStore } from "~/stores/modalContextStore";
import { isClickInsideFloatingChat } from "~/utils/floatingChatGuard";

interface Deity {
  id: string;
  name: string;
  nameEn: string;
  title: string;
  titleEn: string;
  alignment: string;
  domains: string[];
  symbol: string;
  description?: string;
  descriptionEn?: string;
  portfolio?: string[];
  portfolioEn?: string[];
  worshippers?: string[];
  worshippersEn?: string[];
}

interface DeitySelectorProps {
  selectedDeityId?: string;
  characterClass?: string;
  onSelect: (deity: Deity | null, alignment: string) => void;
  disabled?: boolean;
  allowedDeityIds?: Set<string> | null;
}

const ALIGNMENT_NAMES: Record<string, string> = {
  "LG": "守序善良",
  "NG": "中立善良",
  "CG": "混乱善良",
  "LN": "守序中立",
  "N": "绝对中立",
  "CN": "混乱中立",
  "LE": "守序邪恶",
  "NE": "中立邪恶",
  "CE": "混乱邪恶"
};

// Get all deities from pantheons
const getAllDeities = (): Deity[] => {
  const allDeities: Deity[] = [];
  godsData.pantheons.forEach((pantheon: any) => {
    if (pantheon.deities) {
      pantheon.deities.forEach((deity: any) => {
        allDeities.push({
          ...deity,
          pantheon: pantheon.name,
          pantheonId: pantheon.id
        });
      });
    }
  });
  return allDeities;
};

// Sort deities by alignment
const sortByAlignment = (deities: Deity[]): Deity[] => {
  const alignmentOrder = ["LG", "NG", "CG", "LN", "N", "CN", "LE", "NE", "CE"];
  return deities.sort((a, b) => {
    const aIndex = alignmentOrder.indexOf(a.alignment);
    const bIndex = alignmentOrder.indexOf(b.alignment);
    return aIndex - bIndex;
  });
};

// Get recommended deities for Cleric or Paladin
const getRecommendedDeities = (characterClass: string, allDeities: Deity[]): string[] => {
  if (characterClass === "cleric") {
    // Clerics: recommend good/neutral deities with Life, Light, or Knowledge domains
    return allDeities
      .filter(d =>
        ["LG", "NG", "CG", "LN", "N"].includes(d.alignment) &&
        (d.domains.includes("生命") || d.domains.includes("光明") || d.domains.includes("知识"))
      )
      .map(d => d.id);
  } else if (characterClass === "paladin") {
    // Paladins: recommend lawful good and good-aligned deities
    return allDeities
      .filter(d => ["LG", "NG"].includes(d.alignment))
      .map(d => d.id);
  }
  return [];
};

export function DeitySelector({ selectedDeityId, characterClass, onSelect, disabled, allowedDeityIds = null }: DeitySelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedAlignment, setSelectedAlignment] = useState<string>("all");
  const [detailDeity, setDetailDeity] = useState<Deity | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  // Register modal context for AI chat awareness
  const setModalContext = useModalContextStore(s => s.setModalContext);
  const clearModalContext = useModalContextStore(s => s.clearModalContext);
  useEffect(() => {
    if (isOpen) {
      setModalContext('deity-selection', `正在选择信仰的神祇，角色职业：${characterClass || '未知'}`);
    } else {
      clearModalContext('deity-selection');
    }
  }, [isOpen, characterClass, setModalContext, clearModalContext]);

  const rawDeities = getAllDeities();
  const allDeities = allowedDeityIds ? rawDeities.filter(d => allowedDeityIds.has(d.id)) : rawDeities;
  const sortedDeities = sortByAlignment(allDeities);
  const recommendedIds = characterClass ? getRecommendedDeities(characterClass, allDeities) : [];

  const selectedDeity = selectedDeityId ? allDeities.find(d => d.id === selectedDeityId) : null;

  // Filter deities
  const filteredDeities = sortedDeities.filter(deity => {
    const matchesSearch = deity.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         deity.nameEn.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         deity.title.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesAlignment = selectedAlignment === "all" || deity.alignment === selectedAlignment;
    return matchesSearch && matchesAlignment;
  });


  const handleSelectDeity = (deity: Deity) => {
    onSelect(deity, deity.alignment);
    setIsOpen(false);
  };

  const handleClearDeity = () => {
    onSelect(null, "");
    setIsOpen(false);
  };

  return (
    <div>
      {/* Selection Button */}
      <button
        onClick={() => setIsOpen(true)}
        disabled={disabled}
        className={`w-full p-4 rounded-lg border-2 transition-all text-left ${
          selectedDeity
            ? "border-amber-400 bg-amber-400/10"
            : "border-gray-700 hover:border-gray-600 bg-gray-900/50"
        } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
      >
        {selectedDeity ? (
          <div className="flex items-center gap-3">
            <img
              src={getAssetUrl(`assets/god-icons/${selectedDeity.id}.png`)}
              alt={selectedDeity.name}
              className="w-12 h-12 rounded-full object-cover border-2 border-amber-400"
              loading="lazy"
            />
            <div className="flex-1">
              <div className="text-sm font-medium text-amber-400">
                {selectedDeity.name} ({selectedDeity.nameEn})
              </div>
              <div className="text-xs text-gray-400 mt-1">
                {selectedDeity.title} | {ALIGNMENT_NAMES[selectedDeity.alignment]}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-gray-400">
            <div className="text-lg mb-1">⛪</div>
            <div className="text-sm">选择信仰的神祇（可选）</div>
            <div className="text-xs text-gray-500 mt-1">点击浏览所有神祇</div>
          </div>
        )}
      </button>

      {/* Deity Modal (Radix Dialog) */}
      <Dialog.Root open={isOpen} onOpenChange={setIsOpen} modal={false}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/80 z-[1000]" />
          <Dialog.Content
            ref={modalRef}
            aria-describedby={undefined}
            className="fixed z-[1001] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 rounded-lg border border-gray-700 max-w-5xl w-[92vw] md:w-full max-h-[85dvh] overflow-hidden flex flex-col"
            onPointerDownOutside={(e) => { if (isClickInsideFloatingChat(e)) e.preventDefault(); }}
          >
            {/* Header */}
            <div className="p-6 border-b border-gray-700">
              <div className="flex items-center justify-between mb-4">
                <Dialog.Title asChild>
                  <h3 className="text-xl font-bold text-amber-400">选择信仰的神祇</h3>
                </Dialog.Title>
                <Dialog.Close asChild>
                  <button
                    className="text-gray-400 hover:text-gray-200 transition-colors"
                  >
                    ✕
                  </button>
                </Dialog.Close>
              </div>

              {/* Class Recommendation */}
              {characterClass && recommendedIds.length > 0 && (
                <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3 mb-4">
                  <div className="text-sm text-blue-300">
                    💡 根据你的职业{characterClass === "cleric" ? "（牧师）" : "（圣武士）"}，推荐以下神祇
                  </div>
                </div>
              )}

              {/* Search and Filter */}
              <div className="flex gap-3">
                <input
                  type="text"
                  placeholder="搜索神祇名称或称号..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none text-sm"
                />
                <select
                  value={selectedAlignment}
                  onChange={(e) => setSelectedAlignment(e.target.value)}
                  className="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none text-sm"
                >
                  <option value="all">所有阵营</option>
                  {Object.entries(ALIGNMENT_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Deity Grid */}
            <div className="flex-1 overflow-y-auto p-6">
              {filteredDeities.length === 0 ? (
                <div className="text-center text-gray-500 py-12">
                  未找到匹配的神祇
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredDeities.map((deity) => {
                    const isRecommended = recommendedIds.includes(deity.id);
                    const isSelected = deity.id === selectedDeityId;

                    return (
                      <button
                        key={deity.id}
                        onClick={() => handleSelectDeity(deity)}
                        className={`group relative rounded-lg border-2 transition-all text-left overflow-hidden h-64 ${
                          isSelected
                            ? "border-amber-400 ring-2 ring-amber-400/50"
                            : "border-gray-700 hover:border-amber-500/50"
                        }`}
                      >
                        {/* Background Image with Overlay */}
                        <div className="absolute inset-0">
                          <img
                            src={getAssetUrl(`assets/god-icons/${deity.id}.png`)}
                            alt={deity.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                          />
                          {/* Dark gradient overlay for text readability */}
                          <div className="absolute inset-0 bg-gradient-to-t from-black/95 via-black/70 to-black/40 group-hover:from-black/98 group-hover:via-black/90 transition-colors" />
                        </div>

                        {/* Content */}
                        <div className="relative h-full flex flex-col justify-between p-4">
                          <div>
                            {/* Recommended Badge */}
                            {isRecommended && (
                              <div className="inline-block bg-blue-500 text-white text-xs px-2 py-1 rounded shadow-lg mb-2">
                                推荐
                              </div>
                            )}

                            {/* Selected Indicator */}
                            {isSelected && (
                              <div className="inline-block bg-amber-400 text-gray-900 text-xs px-2 py-1 rounded shadow-lg font-bold mb-2 ml-2">
                                ✓ 已选择
                              </div>
                            )}
                          </div>

                          {/* Deity Info */}
                          <div className="space-y-2">
                            <div className="font-bold text-xl text-amber-400 drop-shadow-lg">
                              {deity.name}
                            </div>
                            <div className="text-xs text-gray-300 drop-shadow">
                              {deity.nameEn}
                            </div>
                            <div className="text-sm text-gray-200 drop-shadow">
                              {deity.title}
                            </div>

                            {/* Description preview - shows on hover */}
                            {deity.description && (
                              <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 max-h-0 group-hover:max-h-20 overflow-hidden">
                                <div className="mt-2 pt-2 border-t border-gray-600/50">
                                  <p className="text-xs text-gray-300 line-clamp-3">
                                    {deity.description}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Alignment Badge and Detail Button */}
                            <div className="flex items-center justify-between gap-2">
                              <span className={`text-xs px-2 py-1 rounded shadow ${
                                deity.alignment.includes("G") ? "bg-green-600/80 text-white" :
                                deity.alignment.includes("E") ? "bg-red-600/80 text-white" :
                                "bg-gray-700/80 text-gray-200"
                              }`}>
                                {ALIGNMENT_NAMES[deity.alignment]}
                              </span>

                              {/* Detail Button */}
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDetailDeity(deity);
                                }}
                                className="text-xs px-3 py-1 bg-amber-600/80 hover:bg-amber-500 text-white rounded shadow transition-colors"
                              >
                                详情
                              </button>
                            </div>

                            {/* Domains - hidden on hover */}
                            <div className="flex flex-wrap gap-1 group-hover:opacity-0 transition-opacity">
                              {deity.domains.slice(0, 3).map((domain) => (
                                <span
                                  key={domain}
                                  className="text-xs px-2 py-0.5 bg-gray-800/80 text-gray-200 rounded shadow"
                                >
                                  {domain}
                                </span>
                              ))}
                              {deity.domains.length > 3 && (
                                <span className="text-xs px-2 py-0.5 bg-gray-800/80 text-gray-400 rounded shadow">
                                  +{deity.domains.length - 3}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Hover Effect */}
                        <div className="absolute inset-0 bg-amber-400/0 group-hover:bg-amber-400/5 transition-colors pointer-events-none" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-6 border-t border-gray-700 flex justify-between">
              <button
                onClick={handleClearDeity}
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
              >
                清除选择
              </button>
              <Dialog.Close asChild>
                <button
                  className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors"
                >
                  关闭
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {/* Deity Detail Modal (Radix Dialog) */}
      <Dialog.Root open={!!detailDeity} onOpenChange={(open) => { if (!open) setDetailDeity(null); }} modal={false}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-black/90 z-[1001]" />
          <Dialog.Content
            aria-describedby={undefined}
            className="fixed z-[1002] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-900 rounded-lg border border-gray-700 max-w-3xl w-[92vw] md:w-full max-h-[90dvh] overflow-hidden flex flex-col"
            onPointerDownOutside={(e) => { if (isClickInsideFloatingChat(e)) e.preventDefault(); }}
          >
            {/* Header with Background */}
            <div className="relative h-48 overflow-hidden">
              <img
                src={getAssetUrl(`assets/god-icons/${detailDeity?.id}.png`)}
                alt={detailDeity?.name || ""}
                className="w-full h-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/70 to-transparent" />

              <div className="absolute bottom-4 left-6 right-6">
                <Dialog.Title asChild>
                  <h2 className="text-3xl font-bold text-amber-400 drop-shadow-lg">
                    {detailDeity?.name}
                  </h2>
                </Dialog.Title>
                <p className="text-lg text-gray-300 drop-shadow mt-1">
                  {detailDeity?.nameEn} - {detailDeity?.title}
                </p>
              </div>

              <Dialog.Close asChild>
                <button
                  className="absolute top-4 right-4 text-gray-300 hover:text-white bg-black/50 hover:bg-black/70 rounded-full w-8 h-8 flex items-center justify-center transition-colors"
                >
                  ✕
                </button>
              </Dialog.Close>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              {/* Alignment */}
              <div>
                <h3 className="text-sm font-semibold text-gray-400 mb-2">阵营</h3>
                <span className={`inline-block text-sm px-3 py-1.5 rounded ${
                  (detailDeity?.alignment || "").includes("G") ? "bg-green-600 text-white" :
                  (detailDeity?.alignment || "").includes("E") ? "bg-red-600 text-white" :
                  "bg-gray-700 text-gray-200"
                }`}>
                  {detailDeity ? ALIGNMENT_NAMES[detailDeity.alignment] : ""}
                </span>
              </div>

              {/* Description */}
              {detailDeity?.description && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 mb-2">描述</h3>
                  <p className="text-gray-300 leading-relaxed text-sm">
                    {detailDeity.description}
                  </p>
                </div>
              )}

              {/* Portfolio */}
              {detailDeity?.portfolio && detailDeity.portfolio.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 mb-2">神职领域</h3>
                  <div className="flex flex-wrap gap-2">
                    {detailDeity.portfolio.map((item) => (
                      <span
                        key={item}
                        className="text-sm px-3 py-1 bg-amber-900/30 text-amber-300 border border-amber-700/50 rounded"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Domains */}
              {detailDeity?.domains && detailDeity.domains.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 mb-2">牧师领域</h3>
                  <div className="flex flex-wrap gap-2">
                    {detailDeity.domains.map((domain) => (
                      <span
                        key={domain}
                        className="text-sm px-3 py-1 bg-blue-900/30 text-blue-300 border border-blue-700/50 rounded"
                      >
                        {domain}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Worshippers */}
              {detailDeity?.worshippers && detailDeity.worshippers.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-gray-400 mb-2">典型信徒</h3>
                  <div className="flex flex-wrap gap-2">
                    {detailDeity.worshippers.map((worshipper) => (
                      <span
                        key={worshipper}
                        className="text-sm px-3 py-1 bg-gray-800 text-gray-300 border border-gray-700 rounded"
                      >
                        {worshipper}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Symbol */}
              <div>
                <h3 className="text-sm font-semibold text-gray-400 mb-2">圣徽</h3>
                <p className="text-gray-300 text-sm">{detailDeity?.symbol}</p>
              </div>
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-700 flex justify-between">
              <button
                onClick={() => {
                  if (detailDeity) {
                    handleSelectDeity(detailDeity);
                    setDetailDeity(null);
                  }
                }}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors"
              >
                选择此神祇
              </button>
              <Dialog.Close asChild>
                <button
                  className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors"
                >
                  关闭
                </button>
              </Dialog.Close>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  );
}
