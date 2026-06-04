import { useState } from "react";
import invocationsData from "~/data/rules/eldritch_invocations.json";

interface EldritchInvocationSelectorProps {
  character: {
    eldritchInvocations: string[];
    level: number;
    selectedCantrips: string[];
    subclassId: string;
  };
  setCharacter: (updater: (prev: any) => any) => void;
}

interface Invocation {
  id: string;
  name: string;
  nameEn: string;
  level: number;
  prerequisite: {
    cantrip?: string;
    pactBoon?: string;
  } | null;
  description: string;
  category: string;
}

export function EldritchInvocationSelector({ character, setCharacter }: EldritchInvocationSelectorProps) {
  const [expandedInvocations, setExpandedInvocations] = useState<Set<string>>(new Set());
  const [selectedCategory, setSelectedCategory] = useState<string>("all");

  const characterLevel = character.level || 1;
  // 邪术师魔能祈唤数量随等级递增
  const invocationSlots: [number, number][] = [[18,8],[15,7],[12,6],[9,5],[7,4],[5,3],[2,2]];
  const maxInvocations = invocationSlots.find(([lvl]) => characterLevel >= lvl)?.[1] ?? 0;

  // 过滤可用的祈唤
  const availableInvocations = invocationsData.invocations.filter((inv: Invocation) => {
    // 等级要求
    if (inv.level > characterLevel) return false;

    // 前置条件检查
    if (inv.prerequisite) {
      // 戏法前置条件
      if (inv.prerequisite.cantrip) {
        const hasCantrip = character.selectedCantrips?.includes(inv.prerequisite.cantrip);
        if (!hasCantrip) return false;
      }

      // 契约恩惠前置条件 (暂时跳过，因为1级角色还没有选择)
      if (inv.prerequisite.pactBoon) {
        return false; // 1级角色无法选择需要契约恩惠的祈唤
      }
    }

    return true;
  });

  // 按类别过滤
  const filteredInvocations = selectedCategory === "all"
    ? availableInvocations
    : availableInvocations.filter((inv: Invocation) => inv.category === selectedCategory);

  // 按类别分组统计
  const categoryCount = {
    all: availableInvocations.length,
    combat: availableInvocations.filter((inv: Invocation) => inv.category === "combat").length,
    utility: availableInvocations.filter((inv: Invocation) => inv.category === "utility").length,
    social: availableInvocations.filter((inv: Invocation) => inv.category === "social").length,
  };

  const toggleInvocation = (invocationId: string) => {
    setCharacter((prev: any) => {
      const current = prev.eldritchInvocations || [];
      const isSelected = current.includes(invocationId);

      if (isSelected) {
        return {
          ...prev,
          eldritchInvocations: current.filter((id: string) => id !== invocationId)
        };
      } else if (current.length < maxInvocations) {
        return {
          ...prev,
          eldritchInvocations: [...current, invocationId]
        };
      }
      return prev;
    });
  };

  const toggleExpand = (invocationId: string) => {
    setExpandedInvocations(prev => {
      const next = new Set(prev);
      if (next.has(invocationId)) {
        next.delete(invocationId);
      } else {
        next.add(invocationId);
      }
      return next;
    });
  };

  if (characterLevel < 2) {
    return (
      <div className="bg-gray-800/30 rounded-lg p-4 border border-gray-700">
        <div className="text-sm text-gray-400 text-center">
          魔能祈唤在2级时解锁
        </div>
      </div>
    );
  }

  return (
    <div className="bg-gray-800/50 rounded-lg p-4 border border-gray-700">
      <h3 className="text-lg font-semibold text-amber-300 mb-2">
        魔能祈唤 ({character.eldritchInvocations?.length || 0}/{maxInvocations}) {character.eldritchInvocations?.length === maxInvocations ? "✓" : ""}
      </h3>
      <p className="text-sm text-gray-400 mb-3">
        选择你的魔能祈唤，这些是来自你宗主的神秘力量
      </p>

      {/* Category Filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { id: "all", name: "全部", nameEn: "All" },
          { id: "combat", name: "战斗", nameEn: "Combat" },
          { id: "utility", name: "实用", nameEn: "Utility" },
          { id: "social", name: "社交", nameEn: "Social" },
        ].map((cat) => (
          <button
            key={cat.id}
            onClick={() => setSelectedCategory(cat.id)}
            className={`px-3 py-1 rounded text-xs transition-all ${
              selectedCategory === cat.id
                ? "bg-amber-500/30 border border-amber-400 text-amber-300"
                : "bg-gray-800 border border-gray-600 text-gray-400 hover:border-gray-500"
            }`}
          >
            {cat.name} ({categoryCount[cat.id as keyof typeof categoryCount]})
          </button>
        ))}
      </div>

      {/* Invocations Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-96 overflow-y-auto pr-2">
        {filteredInvocations.map((invocation: Invocation) => {
          const isSelected = character.eldritchInvocations?.includes(invocation.id);
          const canSelect = !isSelected && (character.eldritchInvocations?.length || 0) < maxInvocations;
          const isExpanded = expandedInvocations.has(invocation.id);
          const isLongDescription = invocation.description && invocation.description.length > 120;

          const categoryColor = {
            combat: "text-red-400",
            utility: "text-blue-400",
            social: "text-purple-400",
          }[invocation.category] || "text-gray-400";

          const categoryIcon = {
            combat: "⚔️",
            utility: "🔧",
            social: "💬",
          }[invocation.category] || "✨";

          return (
            <div key={invocation.id} className="relative">
              <button
                onClick={() => toggleInvocation(invocation.id)}
                disabled={!isSelected && !canSelect}
                className={`w-full p-3 rounded-lg border text-left transition-all ${
                  isSelected
                    ? "border-amber-400 bg-amber-400/20"
                    : canSelect
                      ? "border-gray-600 hover:border-gray-500 bg-gray-800/50"
                      : "border-gray-700 bg-gray-800/30 opacity-50 cursor-not-allowed"
                }`}
              >
                <div className="flex items-start gap-2">
                  <span className="text-amber-400 mt-0.5">{isSelected ? "●" : "○"}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2 mb-1">
                      <div className="font-medium text-white text-sm">
                        {invocation.name}
                      </div>
                      <span className={`text-xs ${categoryColor}`}>
                        {categoryIcon}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500 mb-1">
                      {invocation.nameEn}
                    </div>

                    {/* Prerequisites */}
                    {invocation.prerequisite && (
                      <div className="text-xs text-orange-400 bg-orange-900/20 rounded px-2 py-0.5 mb-1 inline-block">
                        前置：
                        {invocation.prerequisite.cantrip && " 魔能爆戏法"}
                        {invocation.prerequisite.pactBoon && ` ${invocation.prerequisite.pactBoon === "blade" ? "魔刃契约" : invocation.prerequisite.pactBoon === "chain" ? "魔链契约" : "魔典契约"}`}
                      </div>
                    )}

                    {/* Level Requirement */}
                    {invocation.level > 0 && (
                      <div className="text-xs text-cyan-400 bg-cyan-900/20 rounded px-2 py-0.5 mb-1 inline-block ml-1">
                        {invocation.level}级+
                      </div>
                    )}

                    <div className={`text-xs text-gray-400 mt-1 ${!isExpanded && isLongDescription ? 'line-clamp-2' : ''}`}>
                      {invocation.description}
                    </div>
                  </div>
                </div>
              </button>

              {/* Expand/Collapse for long descriptions */}
              {isLongDescription && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleExpand(invocation.id);
                  }}
                  className="absolute bottom-2 right-2 text-xs text-amber-400 hover:text-amber-300 bg-gray-900/80 px-2 py-0.5 rounded"
                >
                  {isExpanded ? "收起" : "展开"}
                </button>
              )}
            </div>
          );
        })}
      </div>

      {filteredInvocations.length === 0 && (
        <div className="text-center text-gray-500 py-6">
          没有符合条件的祈唤
        </div>
      )}
    </div>
  );
}
