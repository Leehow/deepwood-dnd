// Other detail rendering functions for Rules Panel
import { useState } from "react";
import { translateId } from "./Rules_Types";

export function renderGenericDetail(content: any, depth: number = 0): React.ReactNode {
  if (depth > 5) {
    return <span className="text-gray-600 italic">...</span>;
  }

  if (typeof content === "string") {
    return <span className="text-gray-300 break-words">{content}</span>;
  } else if (typeof content === "number" || typeof content === "boolean") {
    return <span className="text-amber-400">{String(content)}</span>;
  } else if (Array.isArray(content)) {
    if (content.length === 0) {
      return <span className="text-gray-600">[]</span>;
    }
    return (
      <div className="pl-4 space-y-1">
        {content.map((item, idx) => (
          <div key={idx} className="text-sm border-l-2 border-gray-700 pl-2">
            <span className="text-gray-500">[{idx}]</span> {renderGenericDetail(item, depth + 1)}
          </div>
        ))}
      </div>
    );
  } else if (typeof content === "object" && content !== null) {
    const entries = Object.entries(content);
    if (entries.length === 0) {
      return <span className="text-gray-600">{"{}"}</span>;
    }
    return (
      <div className="space-y-2">
        {entries.map(([key, value]) => (
          <div key={key} className="border-l-2 border-gray-700 pl-3">
            <span className="text-blue-400 font-medium">{key}:</span>{" "}
            {renderGenericDetail(value, depth + 1)}
          </div>
        ))}
      </div>
    );
  }
  return null;
}

// Render background details
export function renderBackgroundDetail(bgData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div>
        <h3 className="text-lg font-semibold text-yellow-400 mb-2">{bgData.name}</h3>
        <p className="text-sm text-gray-400 italic mb-2">{bgData.nameEn}</p>
        {bgData.description && (
          <p className="text-gray-300 leading-relaxed">{bgData.description}</p>
        )}
      </div>

      {/* Proficiencies */}
      <div className="grid grid-cols-2 gap-4">
        {bgData.skillProficiencies && bgData.skillProficiencies.length > 0 && (
          <div>
            <div className="text-sm font-medium text-amber-400 mb-2">技能熟练</div>
            <div className="text-sm text-gray-300 space-y-1">
              {bgData.skillProficiencies.map((skill: string, idx: number) => (
                <div key={idx}>• {translateId(skill)}</div>
              ))}
            </div>
          </div>
        )}

        {bgData.languages && (
          <div>
            <div className="text-sm font-medium text-amber-400 mb-2">语言</div>
            <div className="text-sm text-gray-300">
              可选择 {bgData.languages} 种语言
            </div>
          </div>
        )}
      </div>

      {/* Feature */}
      {bgData.feature && (
        <div>
          <div className="text-sm font-medium text-amber-400 mb-2">特性: {bgData.feature.name}</div>
          <div className="text-xs text-gray-500 mb-1 italic">{bgData.feature.nameEn}</div>
          <p className="text-sm text-gray-300 leading-relaxed">{bgData.feature.description}</p>
        </div>
      )}

      {/* Equipment */}
      {bgData.equipment && bgData.equipment.length > 0 && (
        <div>
          <div className="text-sm font-medium text-amber-400 mb-2">初始装备</div>
          <div className="text-sm text-gray-300 space-y-1">
            {bgData.equipment.map((item: string, idx: number) => (
              <div key={idx}>• {translateId(item)}</div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Render condition details
export function renderConditionDetail(condData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div>
        <h3 className="text-lg font-semibold text-red-400 mb-2">{condData.name}</h3>
        <p className="text-sm text-gray-400 italic mb-2">{condData.nameEn}</p>
        {condData.description && (
          <p className="text-gray-300 leading-relaxed">{condData.description}</p>
        )}
      </div>

      {/* Effects */}
      {condData.effects && condData.effects.length > 0 && (
        <div>
          <div className="text-sm font-medium text-red-400 mb-3">效果</div>
          <div className="space-y-2">
            {condData.effects.map((effect: string, idx: number) => (
              <div key={idx} className="flex items-start gap-2 bg-red-900/20 p-3 rounded border-l-2 border-red-500">
                <span className="text-red-400 flex-shrink-0">▸</span>
                <span className="text-sm text-gray-300 leading-relaxed">{effect}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Collapsible Section Component
export function CollapsibleSection({
  title,
  icon,
  children,
  defaultOpen = false
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-3 bg-gray-800/50 hover:bg-gray-800 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon && <span className="text-base">{icon}</span>}
          <span className="text-sm font-medium text-gray-300">{title}</span>
        </div>
        <span className={`text-gray-500 transition-transform ${isOpen ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>
      {isOpen && (
        <div className="p-4 bg-gray-900/30">
          {children}
        </div>
      )}
    </div>
  );
}

// Render creature category details (showing creatures in a category)
export function renderCreatureDetail(categoryData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div>
        <h3 className="text-lg font-semibold text-emerald-400 mb-2">{categoryData.category}</h3>
        <p className="text-sm text-gray-400 italic mb-2">{categoryData.categoryEn}</p>
      </div>

      {/* CR Description Tip - Collapsible */}
      {categoryData.challengeRating && (
        <CollapsibleSection title="关于挑战等级 (CR)" icon="💡" defaultOpen={false}>
          <div className="space-y-4">
            {/* Main description */}
            <div className="text-sm text-gray-300 leading-relaxed">
              {categoryData.challengeRating.description}
            </div>

            {/* CR Scale Table */}
            {categoryData.challengeRating.scale && categoryData.challengeRating.scale.length > 0 && (
              <div>
                <div className="text-xs text-blue-400 mb-2 font-medium">挑战等级对照表</div>
                <div className="space-y-2">
                  {categoryData.challengeRating.scale.map((item: any, idx: number) => (
                    <div key={idx} className="bg-gray-800/50 p-3 rounded border border-gray-700 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="text-center min-w-[60px]">
                          <div className="text-xs text-gray-500">CR</div>
                          <div className="text-lg font-bold text-amber-400">{item.cr}</div>
                        </div>
                        {item.xp && (
                          <div className="text-center min-w-[80px]">
                            <div className="text-xs text-gray-500">经验值</div>
                            <div className="text-sm text-green-400">{item.xp} XP</div>
                          </div>
                        )}
                        <div className="flex-1">
                          <div className="text-sm text-gray-300">{item.description}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Examples from current category */}
            {categoryData.creatures && categoryData.creatures.length > 0 && (
              <div>
                <div className="text-xs text-emerald-400 mb-2 font-medium">当前分类中的示例</div>
                <div className="flex flex-wrap gap-2">
                  {/* Group creatures by CR and show a few examples */}
                  {Array.from(new Set(categoryData.creatures.map((c: any) => c.cr)))
                    .sort((a: any, b: any) => {
                      // Sort CR values: 0 < 1/8 < 1/4 < 1/2 < 1 < 2 < ...
                      const parseRating = (cr: string) => {
                        if (cr.includes('/')) {
                          const [n, d] = cr.split('/');
                          return parseInt(n) / parseInt(d);
                        }
                        return parseInt(cr);
                      };
                      return parseRating(a) - parseRating(b);
                    })
                    .map((cr: any) => {
                      const creaturesWithCR = categoryData.creatures.filter((c: any) => c.cr === cr);
                      const exampleNames = creaturesWithCR.slice(0, 3).map((c: any) => c.name).join('、');
                      const moreCount = creaturesWithCR.length - 3;

                      return (
                        <div key={cr} className="bg-slate-900/40 px-3 py-2 rounded border border-slate-700 text-xs">
                          <span className="text-amber-400 font-medium">CR {cr}:</span>{' '}
                          <span className="text-gray-300">{exampleNames}</span>
                          {moreCount > 0 && <span className="text-gray-500"> +{moreCount}种</span>}
                        </div>
                      );
                    })}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Used For */}
      {categoryData.usedFor && categoryData.usedFor.length > 0 && (
        <div>
          <div className="text-sm font-medium text-emerald-400 mb-2">用途</div>
          <div className="flex flex-wrap gap-2">
            {categoryData.usedFor.map((use: string, idx: number) => (
              <span key={idx} className="px-3 py-1 bg-emerald-900/30 rounded-full text-sm text-emerald-300 border border-emerald-700">
                {use}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Creatures Grid */}
      {categoryData.creatures && categoryData.creatures.length > 0 && (
        <div>
          <div className="text-sm font-medium text-emerald-400 mb-3">生物列表</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {categoryData.creatures.map((creature: any, idx: number) => (
              <div key={idx} className="bg-emerald-900/20 p-4 rounded-lg border border-emerald-800 hover:border-emerald-600 transition-colors">
                <div className="font-semibold text-emerald-300 mb-1">{creature.name}</div>
                <div className="text-xs text-gray-500 mb-2">{creature.nameEn}</div>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {creature.size && (
                    <div>
                      <span className="text-gray-500">体型:</span> <span className="text-blue-400">{creature.size}</span>
                    </div>
                  )}
                  {creature.cr !== undefined && (
                    <div>
                      <span className="text-gray-500">挑战等级:</span> <span className="text-amber-400">{creature.cr}</span>
                    </div>
                  )}
                  {creature.type && (
                    <div className="col-span-2">
                      <span className="text-gray-500">类型:</span> <span className="text-purple-400">{creature.type}</span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Common Familiars - Collapsible */}
      {categoryData.commonFamiliars && (
        <CollapsibleSection title="常见魔宠" icon="🐾">
          <div className="space-y-4">
            {categoryData.commonFamiliars.normal && categoryData.commonFamiliars.normal.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">普通魔宠</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {categoryData.commonFamiliars.normal.map((familiar: any, idx: number) => (
                    <div key={idx} className="bg-cyan-900/20 p-3 rounded border border-cyan-800 text-xs">
                      <div className="font-medium text-cyan-300">{familiar.name}</div>
                      <div className="text-gray-500 mb-1">{familiar.nameEn}</div>
                      <div className="text-gray-400">✨ {familiar.benefit}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {categoryData.commonFamiliars.variant && categoryData.commonFamiliars.variant.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">变体魔宠</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {categoryData.commonFamiliars.variant.map((familiar: any, idx: number) => (
                    <div key={idx} className="bg-purple-900/20 p-3 rounded border border-purple-800 text-xs">
                      <div className="font-medium text-purple-300">{familiar.name}</div>
                      <div className="text-gray-500 mb-1">{familiar.nameEn}</div>
                      <div className="text-orange-400 mb-1">📋 {familiar.requirement}</div>
                      <div className="text-gray-400">✨ {familiar.benefit}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Wild Shape Options - Collapsible */}
      {categoryData.wildShapeOptions && (
        <CollapsibleSection title="野性形态选项" icon="🐺">
          <div className="space-y-3">
            {categoryData.wildShapeOptions.lowLevel && categoryData.wildShapeOptions.lowLevel.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">低等级选项</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {categoryData.wildShapeOptions.lowLevel.map((option: any, idx: number) => (
                    <div key={idx} className="bg-green-900/20 p-3 rounded border border-green-800 text-xs">
                      <div className="font-medium text-green-300">{option.name} ({option.nameEn})</div>
                      <div className="text-amber-400 mb-1">CR {option.cr}</div>
                      <div className="text-gray-400">✨ {option.benefit}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {categoryData.wildShapeOptions.swimming && categoryData.wildShapeOptions.swimming.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">水栖形态</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {categoryData.wildShapeOptions.swimming.map((option: any, idx: number) => (
                    <div key={idx} className="bg-blue-900/20 p-3 rounded border border-blue-800 text-xs">
                      <div className="font-medium text-blue-300">{option.name} ({option.nameEn})</div>
                      <div className="text-amber-400 mb-1">CR {option.cr}</div>
                      <div className="text-gray-400">✨ {option.benefit}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {categoryData.wildShapeOptions.flying && categoryData.wildShapeOptions.flying.length > 0 && (
              <div>
                <div className="text-xs text-gray-500 mb-2">飞行形态</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {categoryData.wildShapeOptions.flying.map((option: any, idx: number) => (
                    <div key={idx} className="bg-sky-900/20 p-3 rounded border border-sky-800 text-xs">
                      <div className="font-medium text-sky-300">{option.name} ({option.nameEn})</div>
                      <div className="text-amber-400 mb-1">CR {option.cr}</div>
                      <div className="text-gray-400">✨ {option.benefit}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Size Categories - Collapsible */}
      {categoryData.creatureSizeCategories && (
        <CollapsibleSection title="生物体型说明" icon="📏">
          <div className="space-y-2">
            {Object.entries(categoryData.creatureSizeCategories).map(([size, info]: [string, any], idx) => (
              <div key={idx} className="bg-slate-900/30 p-3 rounded border border-slate-700 text-xs">
                <div className="flex items-start justify-between">
                  <div>
                    <span className="font-medium text-slate-300">{size}</span>
                    <span className="text-gray-500 ml-2">({info.nameEn})</span>
                  </div>
                  <span className="text-blue-400">{info.space}</span>
                </div>
                {info.examples && info.examples.length > 0 && (
                  <div className="text-gray-500 mt-1">示例: {info.examples.join('、')}</div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Summoning Spells - Collapsible */}
      {categoryData.summoningSpells && (
        <CollapsibleSection title="相关召唤法术" icon="✨">
          <div className="space-y-3">
            {/* Conjure Animals */}
            {categoryData.summoningSpells.conjureAnimals && (
              <div className="bg-amber-900/20 p-4 rounded border border-amber-700">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-amber-300">{categoryData.summoningSpells.conjureAnimals.name}</div>
                    <div className="text-xs text-gray-500">{categoryData.summoningSpells.conjureAnimals.nameEn}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">等级</div>
                    <div className="text-amber-400">{categoryData.summoningSpells.conjureAnimals.level}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mb-2">
                  职业: {categoryData.summoningSpells.conjureAnimals.class.join('、')}
                </div>
                <div className="mb-2">
                  <div className="text-xs text-amber-400 mb-1">召唤选项:</div>
                  <div className="space-y-1">
                    {categoryData.summoningSpells.conjureAnimals.options.map((opt: string, idx: number) => (
                      <div key={idx} className="text-xs text-gray-300">• {opt}</div>
                    ))}
                  </div>
                </div>
                {categoryData.summoningSpells.conjureAnimals.commonChoices && (
                  <div>
                    <div className="text-xs text-amber-400 mb-1">常见选择:</div>
                    <div className="text-xs text-gray-300">
                      {categoryData.summoningSpells.conjureAnimals.commonChoices.join('、')}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Find Familiar */}
            {categoryData.summoningSpells.findFamiliar && (
              <div className="bg-purple-900/20 p-4 rounded border border-purple-700">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-purple-300">{categoryData.summoningSpells.findFamiliar.name}</div>
                    <div className="text-xs text-gray-500">{categoryData.summoningSpells.findFamiliar.nameEn}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">等级</div>
                    <div className="text-purple-400">{categoryData.summoningSpells.findFamiliar.level}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mb-2">
                  职业: {categoryData.summoningSpells.findFamiliar.class.join('、')}
                  {categoryData.summoningSpells.findFamiliar.ritual && <span className="ml-2 text-blue-400">(仪式)</span>}
                </div>
                <div className="mb-2">
                  <div className="text-xs text-purple-400 mb-1">普通选项:</div>
                  <div className="text-xs text-gray-300">
                    {categoryData.summoningSpells.findFamiliar.options.join('、')}
                  </div>
                </div>
                {categoryData.summoningSpells.findFamiliar.variantOptions && (
                  <div>
                    <div className="text-xs text-purple-400 mb-1">变体选项:</div>
                    <div className="text-xs text-gray-300">
                      {categoryData.summoningSpells.findFamiliar.variantOptions.join('、')}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Animate Dead */}
            {categoryData.summoningSpells.animateDead && (
              <div className="bg-slate-900/30 p-4 rounded border border-slate-600">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-slate-300">{categoryData.summoningSpells.animateDead.name}</div>
                    <div className="text-xs text-gray-500">{categoryData.summoningSpells.animateDead.nameEn}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-gray-500">等级</div>
                    <div className="text-slate-400">{categoryData.summoningSpells.animateDead.level}</div>
                  </div>
                </div>
                <div className="text-xs text-gray-400 mb-2">
                  职业: {categoryData.summoningSpells.animateDead.class.join('、')}
                </div>
                <div className="mb-2">
                  <div className="text-xs text-slate-400 mb-1">创造生物:</div>
                  <div className="text-xs text-gray-300">
                    {categoryData.summoningSpells.animateDead.creates.join('、')}
                  </div>
                </div>
                {categoryData.summoningSpells.animateDead.duration && (
                  <div className="text-xs text-orange-400">
                    ⏱ {categoryData.summoningSpells.animateDead.duration}
                  </div>
                )}
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// Render equipment details
function renderEquipmentDetail(eqData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div>
        <h3 className="text-lg font-semibold text-slate-400 mb-2">{eqData.name}</h3>
        <p className="text-sm text-gray-400 italic mb-2">{eqData.nameEn}</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-4">
        {eqData.type && (
          <div>
            <div className="text-sm text-gray-500">类型</div>
            <div className="text-base text-slate-300">{translateId(eqData.type)}</div>
          </div>
        )}
        {eqData.ac && (
          <div>
            <div className="text-sm text-gray-500">护甲等级</div>
            <div className="text-base text-blue-400">{eqData.ac}</div>
          </div>
        )}
        {eqData.damage && (
          <div>
            <div className="text-sm text-gray-500">伤害</div>
            <div className="text-base text-red-400">{eqData.damage}</div>
          </div>
        )}
        {eqData.damageType && (
          <div>
            <div className="text-sm text-gray-500">伤害类型</div>
            <div className="text-base text-red-300">{eqData.damageType}</div>
          </div>
        )}
        {eqData.weight !== undefined && (
          <div>
            <div className="text-sm text-gray-500">重量</div>
            <div className="text-base text-gray-300">{eqData.weight} 磅</div>
          </div>
        )}
        {eqData.cost && (
          <div>
            <div className="text-sm text-gray-500">价格</div>
            <div className="text-base text-amber-400">
              {eqData.cost.gp && `${eqData.cost.gp}gp`}
              {eqData.cost.sp && ` ${eqData.cost.sp}sp`}
              {eqData.cost.cp && ` ${eqData.cost.cp}cp`}
            </div>
          </div>
        )}
      </div>

      {/* Special Properties */}
      {eqData.strengthRequired && (
        <div className="bg-yellow-900/20 p-3 rounded border-l-2 border-yellow-500">
          <span className="text-sm text-yellow-400">力量需求: {eqData.strengthRequired}</span>
        </div>
      )}
      {eqData.stealthDisadvantage && (
        <div className="bg-red-900/20 p-3 rounded border-l-2 border-red-500">
          <span className="text-sm text-red-400">隐匿劣势</span>
        </div>
      )}

      {/* Properties */}
      {eqData.properties && eqData.properties.length > 0 && (
        <div>
          <div className="text-sm font-medium text-slate-400 mb-2">属性</div>
          <div className="flex flex-wrap gap-2">
            {eqData.properties.map((prop: string, idx: number) => (
              <span key={idx} className="px-2 py-1 bg-slate-700 rounded text-xs text-slate-300">
                {translateId(prop)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Description */}
      {eqData.description && (
        <div>
          <div className="text-sm font-medium text-slate-400 mb-2">描述</div>
          <p className="text-sm text-gray-300 leading-relaxed">{eqData.description}</p>
        </div>
      )}
    </div>
  );
}

// Render plane details
export function renderPlaneDetail(planeData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div>
        <h3 className="text-lg font-semibold text-indigo-400 mb-2">{planeData.name}</h3>
        <p className="text-sm text-gray-400 italic mb-2">{planeData.nameEn}</p>
        {planeData.description && (
          <p className="text-gray-300 leading-relaxed">{planeData.description}</p>
        )}
      </div>

      {/* Properties */}
      <div className="grid grid-cols-2 gap-4">
        {planeData.type && (
          <div>
            <div className="text-sm text-gray-500">类型</div>
            <div className="text-base text-indigo-300">{planeData.type}</div>
          </div>
        )}
        {planeData.alignment && (
          <div>
            <div className="text-sm text-gray-500">倾向</div>
            <div className="text-base text-purple-300">{planeData.alignment}</div>
          </div>
        )}
      </div>

      {/* Traits */}
      {planeData.traits && (
        <div>
          <div className="text-sm font-medium text-indigo-400 mb-2">位面特性</div>
          <div className="space-y-2">
            {Array.isArray(planeData.traits) ? (
              planeData.traits.map((trait: any, idx: number) => (
                <div key={idx} className="bg-indigo-900/20 p-3 rounded border-l-2 border-indigo-500">
                  {typeof trait === "string" ? (
                    <span className="text-sm text-gray-300">{trait}</span>
                  ) : (
                    <>
                      {trait.name && <div className="text-sm font-medium text-indigo-400 mb-1">{trait.name}</div>}
                      {trait.description && <div className="text-sm text-gray-300">{trait.description}</div>}
                    </>
                  )}
                </div>
              ))
            ) : (
              <div className="text-sm text-gray-300">{JSON.stringify(planeData.traits)}</div>
            )}
          </div>
        </div>
      )}

      {/* Inhabitants */}
      {planeData.inhabitants && (
        <div>
          <div className="text-sm font-medium text-indigo-400 mb-2">居民</div>
          <p className="text-sm text-gray-300">{planeData.inhabitants}</p>
        </div>
      )}
    </div>
  );
}

// Render skill details
export function renderSkillDetail(skillData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div>
        <h3 className="text-lg font-semibold text-cyan-400 mb-2">{skillData.name}</h3>
        <p className="text-sm text-gray-400 italic mb-2">{skillData.nameEn}</p>
      </div>

      {/* Ability */}
      {skillData.ability && (
        <div className="bg-blue-900/20 p-4 rounded border-l-4 border-blue-500">
          <div className="text-sm text-gray-500 mb-1">关联属性</div>
          <div className="text-lg font-semibold text-blue-400">{translateId(skillData.ability)}</div>
        </div>
      )}

      {/* Description */}
      {skillData.description && (
        <div>
          <div className="text-sm font-medium text-cyan-400 mb-2">说明</div>
          <p className="text-sm text-gray-300 leading-relaxed">{skillData.description}</p>
        </div>
      )}

      {/* Example Uses */}
      {skillData.examples && skillData.examples.length > 0 && (
        <div>
          <div className="text-sm font-medium text-cyan-400 mb-3">使用示例</div>
          <div className="space-y-2">
            {skillData.examples.map((example: string, idx: number) => (
              <div key={idx} className="flex items-start gap-2 bg-cyan-900/20 p-3 rounded">
                <span className="text-cyan-400 flex-shrink-0">▸</span>
                <span className="text-sm text-gray-300 leading-relaxed">{example}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Render core rule details
export function renderCoreRuleDetail(ruleData: any): React.ReactNode {
  const { id, name, nameEn } = ruleData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-amber-400 mb-1">{name}</h3>
        {nameEn && <p className="text-sm text-gray-500 italic">{nameEn}</p>}
        {ruleData.description && (
          <p className="text-gray-300 leading-relaxed mt-3">{ruleData.description}</p>
        )}
      </div>

      {/* Dice Types */}
      {id === "dice" && ruleData.types && (
        <div className="space-y-4">
          <div className="text-sm font-medium text-amber-400 mb-2">骰子类型</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            {ruleData.types.map((dice: any, idx: number) => (
              <div key={idx} className="bg-amber-900/20 p-3 rounded border border-amber-700 text-center">
                <div className="text-2xl font-bold text-amber-400">{dice.name}</div>
                <div className="text-xs text-gray-400 mt-1">{dice.description}</div>
              </div>
            ))}
          </div>
          {ruleData.notation?.examples && (
            <div className="mt-4">
              <div className="text-sm font-medium text-amber-400 mb-2">表示法示例</div>
              <div className="space-y-2">
                {ruleData.notation.examples.map((ex: any, idx: number) => (
                  <div key={idx} className="flex items-center gap-4 bg-gray-800/50 p-2 rounded">
                    <code className="text-amber-300 font-mono">{ex.notation}</code>
                    <span className="text-gray-400">→</span>
                    <span className="text-gray-300">{ex.meaning}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* d20 System */}
      {id === "d20System" && (
        <div className="space-y-4">
          {ruleData.procedure && (
            <div className="bg-blue-900/20 p-4 rounded border border-blue-700">
              <div className="text-sm font-medium text-blue-400 mb-2">检定流程</div>
              <ol className="space-y-2">
                {ruleData.procedure.map((step: string, idx: number) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-gray-300">
                    <span className="text-blue-400 font-bold">{idx + 1}.</span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {ruleData.types && (
            <div>
              <div className="text-sm font-medium text-amber-400 mb-2">检定类型</div>
              <div className="space-y-2">
                {ruleData.types.map((type: any, idx: number) => (
                  <div key={idx} className="bg-gray-800/50 p-3 rounded border-l-2 border-amber-500">
                    <div className="font-medium text-amber-300">{type.name}</div>
                    <div className="text-xs text-gray-500">{type.nameEn} • 目标值: {type.targetValue}</div>
                    <div className="text-sm text-gray-400 mt-1">{type.description}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Advantage/Disadvantage */}
      {id === "advantageDisadvantage" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {ruleData.advantage && (
              <div className="bg-green-900/20 p-4 rounded border border-green-700">
                <div className="font-medium text-green-400 mb-1">{ruleData.advantage.name}</div>
                <div className="text-xs text-gray-500 mb-2">{ruleData.advantage.nameEn}</div>
                <div className="text-sm text-gray-300">{ruleData.advantage.description}</div>
              </div>
            )}
            {ruleData.disadvantage && (
              <div className="bg-red-900/20 p-4 rounded border border-red-700">
                <div className="font-medium text-red-400 mb-1">{ruleData.disadvantage.name}</div>
                <div className="text-xs text-gray-500 mb-2">{ruleData.disadvantage.nameEn}</div>
                <div className="text-sm text-gray-300">{ruleData.disadvantage.description}</div>
              </div>
            )}
          </div>
          {ruleData.rules && (
            <div className="bg-gray-800/50 p-4 rounded">
              <div className="text-sm font-medium text-amber-400 mb-2">重要规则</div>
              <ul className="space-y-1">
                {ruleData.rules.map((rule: string, idx: number) => (
                  <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-amber-400">•</span>{rule}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Proficiency Bonus */}
      {id === "proficiencyBonus" && ruleData.table && (
        <div className="space-y-4">
          <div className="text-sm font-medium text-amber-400 mb-2">等级对照表</div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
            {ruleData.table.map((row: any, idx: number) => (
              <div key={idx} className="bg-amber-900/20 p-3 rounded border border-amber-700 text-center">
                <div className="text-xs text-gray-500">等级 {row.level}</div>
                <div className="text-xl font-bold text-amber-400">+{row.bonus}</div>
              </div>
            ))}
          </div>
          {ruleData.appliesTo && (
            <div className="bg-gray-800/50 p-4 rounded mt-4">
              <div className="text-sm font-medium text-amber-400 mb-2">适用于</div>
              <ul className="space-y-1">
                {ruleData.appliesTo.map((item: string, idx: number) => (
                  <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-green-400">✓</span>{item}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Time */}
      {id === "time" && (
        <div className="space-y-4">
          {ruleData.combat && (
            <div className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="text-sm font-medium text-red-400 mb-2">战斗时间</div>
              <div className="space-y-2">
                {ruleData.combat.round && (
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-400">{ruleData.combat.round.name}</span>
                    <span className="text-red-300">{ruleData.combat.round.duration}</span>
                  </div>
                )}
                {ruleData.combat.turn && (
                  <div className="text-sm text-gray-300">{ruleData.combat.turn.description}</div>
                )}
              </div>
            </div>
          )}
          {ruleData.exploration && (
            <div className="bg-blue-900/20 p-4 rounded border border-blue-700">
              <div className="text-sm font-medium text-blue-400 mb-2">探索时间</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                {Object.entries(ruleData.exploration).map(([key, value]: [string, any], idx) => (
                  <div key={idx} className="text-sm">
                    <span className="text-gray-400">{value.name}:</span>
                    <span className="text-blue-300 ml-2">{value.duration}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Movement */}
      {id === "movement" && (
        <div className="space-y-4">
          {ruleData.speed && (
            <div className="bg-green-900/20 p-4 rounded border border-green-700">
              <div className="text-sm font-medium text-green-400 mb-2">基础速度</div>
              <p className="text-sm text-gray-300 mb-2">{ruleData.speed.description}</p>
              {ruleData.speed.commonSpeeds && (
                <div className="space-y-1">
                  {ruleData.speed.commonSpeeds.map((s: any, idx: number) => (
                    <div key={idx} className="flex justify-between text-sm">
                      <span className="text-gray-400">{s.type}</span>
                      <span className="text-green-300">{s.speed} 尺</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
          {ruleData.types && (
            <div>
              <div className="text-sm font-medium text-amber-400 mb-2">移动类型</div>
              <div className="flex flex-wrap gap-2">
                {ruleData.types.map((type: any, idx: number) => (
                  <span key={idx} className="px-3 py-1 bg-gray-700 rounded-full text-sm text-gray-300">
                    {type.name}
                  </span>
                ))}
              </div>
            </div>
          )}
          {ruleData.difficultTerrain && (
            <div className="bg-yellow-900/20 p-4 rounded border border-yellow-700">
              <div className="font-medium text-yellow-400">{ruleData.difficultTerrain.name}</div>
              <p className="text-sm text-gray-300 mt-1">{ruleData.difficultTerrain.description}</p>
            </div>
          )}
        </div>
      )}

      {/* Vision */}
      {id === "vision" && (
        <div className="space-y-3">
          {Object.entries(ruleData).filter(([key]) => !["id", "name", "nameEn"].includes(key)).map(([key, value]: [string, any], idx) => (
            <div key={idx} className="bg-gray-800/50 p-3 rounded border-l-2 border-purple-500">
              <div className="font-medium text-purple-300">{value.name}</div>
              <div className="text-xs text-gray-500">{value.nameEn}</div>
              <div className="text-sm text-gray-300 mt-1">{value.description}</div>
            </div>
          ))}
        </div>
      )}

      {/* Cover */}
      {id === "cover" && (
        <div className="space-y-3">
          {ruleData.half && (
            <div className="bg-yellow-900/20 p-4 rounded border border-yellow-700">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-yellow-400">{ruleData.half.name}</div>
                  <div className="text-xs text-gray-500">{ruleData.half.nameEn}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-yellow-300">AC +{ruleData.half.acBonus}</div>
                  <div className="text-sm text-yellow-300">敏捷豁免 +{ruleData.half.savingThrowBonus}</div>
                </div>
              </div>
              <p className="text-sm text-gray-300 mt-2">{ruleData.half.description}</p>
            </div>
          )}
          {ruleData.threeQuarters && (
            <div className="bg-orange-900/20 p-4 rounded border border-orange-700">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-orange-400">{ruleData.threeQuarters.name}</div>
                  <div className="text-xs text-gray-500">{ruleData.threeQuarters.nameEn}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm text-orange-300">AC +{ruleData.threeQuarters.acBonus}</div>
                  <div className="text-sm text-orange-300">敏捷豁免 +{ruleData.threeQuarters.savingThrowBonus}</div>
                </div>
              </div>
              <p className="text-sm text-gray-300 mt-2">{ruleData.threeQuarters.description}</p>
            </div>
          )}
          {ruleData.total && (
            <div className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="font-medium text-red-400">{ruleData.total.name}</div>
              <div className="text-xs text-gray-500">{ruleData.total.nameEn}</div>
              <p className="text-sm text-gray-300 mt-2">{ruleData.total.description}</p>
            </div>
          )}
        </div>
      )}

      {/* Resting */}
      {id === "resting" && (
        <div className="space-y-4">
          {ruleData.shortRest && (
            <div className="bg-blue-900/20 p-4 rounded border border-blue-700">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-medium text-blue-400">{ruleData.shortRest.name}</div>
                  <div className="text-xs text-gray-500">{ruleData.shortRest.nameEn}</div>
                </div>
                <span className="text-sm text-blue-300">{ruleData.shortRest.duration}</span>
              </div>
              <p className="text-sm text-gray-300">{ruleData.shortRest.description}</p>
              {ruleData.shortRest.benefits && (
                <ul className="mt-2 space-y-1">
                  {ruleData.shortRest.benefits.map((b: string, idx: number) => (
                    <li key={idx} className="text-sm text-gray-400 flex items-start gap-2">
                      <span className="text-blue-400">•</span>{b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {ruleData.longRest && (
            <div className="bg-green-900/20 p-4 rounded border border-green-700">
              <div className="flex justify-between items-start mb-2">
                <div>
                  <div className="font-medium text-green-400">{ruleData.longRest.name}</div>
                  <div className="text-xs text-gray-500">{ruleData.longRest.nameEn}</div>
                </div>
                <span className="text-sm text-green-300">{ruleData.longRest.duration}</span>
              </div>
              <p className="text-sm text-gray-300">{ruleData.longRest.description}</p>
              {ruleData.longRest.benefits && (
                <ul className="mt-2 space-y-1">
                  {ruleData.longRest.benefits.map((b: string, idx: number) => (
                    <li key={idx} className="text-sm text-gray-400 flex items-start gap-2">
                      <span className="text-green-400">✓</span>{b}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}

      {/* Damage Types */}
      {id === "damageTypes" && (
        <div className="space-y-6">
          {/* 重要规则说明 */}
          {ruleData.importantRule && (
            <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-4">
              <div className="font-medium text-blue-400 mb-2 flex items-center gap-2">
                <span>⚠️</span>
                <span>{ruleData.importantRule.title}</span>
              </div>
              <p className="text-sm text-gray-300 mb-2">{ruleData.importantRule.content}</p>
              <p className="text-xs text-gray-400 mb-3">{ruleData.importantRule.clarification}</p>
              {ruleData.importantRule.examples && (
                <div className="space-y-1">
                  <div className="text-xs text-gray-500 mb-1">示例：</div>
                  {ruleData.importantRule.examples.map((ex: string, idx: number) => (
                    <div key={idx} className="text-xs text-gray-400 pl-3 border-l-2 border-blue-700/50">
                      {ex}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {ruleData.physical && (
            <div>
              <div className="text-sm font-medium text-gray-400 mb-3">物理伤害</div>
              <div className="space-y-2">
                {ruleData.physical.map((d: any, idx: number) => (
                  <div key={idx} className="bg-slate-800/50 p-3 rounded border border-slate-700">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-slate-300">{d.name}</span>
                      <span className="text-xs text-gray-500">({d.nameEn})</span>
                    </div>
                    <p className="text-sm text-gray-400">{d.description}</p>
                    {d.sources && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {d.sources.map((src: string, sIdx: number) => (
                          <span key={sIdx} className="text-xs px-2 py-0.5 bg-slate-700 rounded text-slate-400">{src}</span>
                        ))}
                      </div>
                    )}
                    {d.notes && (
                      <div className="mt-2 text-xs text-amber-400/80 bg-amber-900/20 p-2 rounded">
                        💡 {d.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {ruleData.elemental && (
            <div>
              <div className="text-sm font-medium text-orange-400 mb-3">元素伤害</div>
              <div className="space-y-2">
                {ruleData.elemental.map((d: any, idx: number) => (
                  <div key={idx} className="bg-orange-900/20 p-3 rounded border border-orange-800">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-orange-300">{d.name}</span>
                      <span className="text-xs text-gray-500">({d.nameEn})</span>
                    </div>
                    <p className="text-sm text-gray-400">{d.description}</p>
                    {d.sources && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {d.sources.map((src: string, sIdx: number) => (
                          <span key={sIdx} className="text-xs px-2 py-0.5 bg-orange-900/50 rounded text-orange-300">{src}</span>
                        ))}
                      </div>
                    )}
                    {d.notes && (
                      <div className="mt-2 text-xs text-amber-400/80 bg-amber-900/20 p-2 rounded">
                        💡 {d.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          {ruleData.magical && (
            <div>
              <div className="text-sm font-medium text-purple-400 mb-3">魔法伤害</div>
              <div className="space-y-2">
                {ruleData.magical.map((d: any, idx: number) => (
                  <div key={idx} className="bg-purple-900/20 p-3 rounded border border-purple-800">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-purple-300">{d.name}</span>
                      <span className="text-xs text-gray-500">({d.nameEn})</span>
                    </div>
                    <p className="text-sm text-gray-400">{d.description}</p>
                    {d.sources && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {d.sources.map((src: string, sIdx: number) => (
                          <span key={sIdx} className="text-xs px-2 py-0.5 bg-purple-900/50 rounded text-purple-300">{src}</span>
                        ))}
                      </div>
                    )}
                    {d.notes && (
                      <div className="mt-2 text-xs text-amber-400/80 bg-amber-900/20 p-2 rounded">
                        💡 {d.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Conditions list */}
      {id === "conditions" && ruleData.list && (
        <div className="space-y-3">
          {ruleData.list.map((cond: any, idx: number) => (
            <div key={idx} className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-medium text-red-400">{cond.name}</div>
                  <div className="text-xs text-gray-500">{cond.nameEn}</div>
                </div>
              </div>
              {cond.description && (
                <p className="text-sm text-gray-400 mb-2 italic">{cond.description}</p>
              )}
              {cond.effects && (
                <ul className="space-y-1">
                  {cond.effects.map((effect: string, effectIdx: number) => (
                    <li key={effectIdx} className="text-sm text-gray-300 flex items-start gap-2">
                      <span className="text-red-400">•</span>{effect}
                    </li>
                  ))}
                </ul>
              )}
              {cond.levels && (
                <div className="mt-2 space-y-1">
                  {cond.levels.map((level: any) => (
                    <div key={level.level} className="flex items-center gap-3 text-sm">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                        level.level === 6 ? 'bg-red-600 text-white' : 'bg-gray-700 text-gray-300'
                      }`}>{level.level}</span>
                      <span className={level.level === 6 ? 'text-red-400 font-medium' : 'text-gray-300'}>{level.effect}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Simple rules (inspiration, specificBeatsGeneral, roundDown) */}
      {(id === "inspiration" || id === "specificBeatsGeneral" || id === "roundDown") && (
        <div className="space-y-4">
          {ruleData.usage && (
            <div className="bg-amber-900/20 p-4 rounded border border-amber-700">
              <div className="text-sm font-medium text-amber-400 mb-2">用法</div>
              <p className="text-sm text-gray-300">{ruleData.usage}</p>
            </div>
          )}
          {ruleData.gaining && (
            <div className="bg-green-900/20 p-4 rounded border border-green-700">
              <div className="text-sm font-medium text-green-400 mb-2">获取方式</div>
              <p className="text-sm text-gray-300">{ruleData.gaining}</p>
            </div>
          )}
          {ruleData.limit && (
            <div className="bg-yellow-900/20 p-4 rounded border border-yellow-700">
              <div className="text-sm font-medium text-yellow-400 mb-2">限制</div>
              <p className="text-sm text-gray-300">{ruleData.limit}</p>
            </div>
          )}
          {ruleData.examples && (
            <div>
              <div className="text-sm font-medium text-amber-400 mb-2">示例</div>
              <ul className="space-y-1">
                {ruleData.examples.map((ex: string, idx: number) => (
                  <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-amber-400">•</span>{ex}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Damage Resistance */}
      {id === "damageResistance" && (
        <div className="space-y-3">
          {ruleData.resistance && (
            <div className="bg-blue-900/20 p-4 rounded border border-blue-700">
              <div className="font-medium text-blue-400">{ruleData.resistance.name}</div>
              <div className="text-xs text-gray-500">{ruleData.resistance.nameEn}</div>
              <p className="text-sm text-gray-300 mt-2">{ruleData.resistance.effect}</p>
            </div>
          )}
          {ruleData.vulnerability && (
            <div className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="font-medium text-red-400">{ruleData.vulnerability.name}</div>
              <div className="text-xs text-gray-500">{ruleData.vulnerability.nameEn}</div>
              <p className="text-sm text-gray-300 mt-2">{ruleData.vulnerability.effect}</p>
            </div>
          )}
          {ruleData.immunity && (
            <div className="bg-purple-900/20 p-4 rounded border border-purple-700">
              <div className="font-medium text-purple-400">{ruleData.immunity.name}</div>
              <div className="text-xs text-gray-500">{ruleData.immunity.nameEn}</div>
              <p className="text-sm text-gray-300 mt-2">{ruleData.immunity.effect}</p>
            </div>
          )}
        </div>
      )}

      {/* Healing and Dying */}
      {id === "healingAndDying" && ruleData.death && (
        <div className="space-y-4">
          {ruleData.death.deathSaves && (
            <div className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="font-medium text-red-400 mb-2">{ruleData.death.deathSaves.name}</div>
              <p className="text-sm text-gray-300">{ruleData.death.deathSaves.description}</p>
              <div className="mt-2 space-y-1 text-sm">
                <div className="text-green-400">✓ 成功: {ruleData.death.deathSaves.success}</div>
                <div className="text-red-400">✗ 失败: {ruleData.death.deathSaves.failure}</div>
                <div className="text-amber-400">⚡ 特殊: {ruleData.death.deathSaves.critical}</div>
              </div>
            </div>
          )}
          {ruleData.death.instantDeath && (
            <div className="bg-gray-800 p-4 rounded border-l-4 border-red-600">
              <div className="font-medium text-red-500">{ruleData.death.instantDeath.name}</div>
              <p className="text-sm text-gray-300 mt-1">{ruleData.death.instantDeath.description}</p>
            </div>
          )}
          {ruleData.stabilizing && (
            <div className="bg-green-900/20 p-4 rounded border border-green-700">
              <div className="font-medium text-green-400 mb-2">{ruleData.stabilizing.name}</div>
              <ul className="space-y-1">
                {ruleData.stabilizing.methods.map((m: string, idx: number) => (
                  <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-green-400">•</span>{m}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Render combat rule details
export function renderCombatRuleDetail(ruleData: any): React.ReactNode {
  const { id, name, nameEn } = ruleData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-red-400 mb-1">{name}</h3>
        {nameEn && <p className="text-sm text-gray-500 italic">{nameEn}</p>}
        {ruleData.description && (
          <p className="text-gray-300 leading-relaxed mt-3">{ruleData.description}</p>
        )}
      </div>

      {/* Initiative */}
      {id === "initiative" && (
        <div className="space-y-4">
          {ruleData.roll && (
            <div className="bg-amber-900/20 p-4 rounded border border-amber-700 text-center">
              <div className="text-sm text-gray-400 mb-1">先攻检定</div>
              <div className="text-xl font-mono text-amber-400">{ruleData.roll}</div>
            </div>
          )}
          {ruleData.procedure && (
            <div>
              <div className="text-sm font-medium text-amber-400 mb-2">流程</div>
              <ol className="space-y-2">
                {ruleData.procedure.map((step: string, idx: number) => (
                  <li key={idx} className="text-sm text-gray-300 flex items-start gap-2">
                    <span className="text-amber-400 font-bold">{idx + 1}.</span>{step}
                  </li>
                ))}
              </ol>
            </div>
          )}
          {ruleData.ties && (
            <div className="bg-gray-800/50 p-3 rounded">
              <span className="text-sm text-gray-400">平局处理: </span>
              <span className="text-sm text-gray-300">{ruleData.ties}</span>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {id === "actions" && ruleData.types && (
        <div className="space-y-3">
          {ruleData.types.map((action: any, idx: number) => (
            <div key={idx} className="bg-gray-800/50 p-4 rounded border-l-2 border-red-500">
              <div className="flex justify-between items-start">
                <div>
                  <div className="font-medium text-red-300">{action.name}</div>
                  <div className="text-xs text-gray-500">{action.nameEn}</div>
                </div>
              </div>
              <p className="text-sm text-gray-300 mt-2">{action.description}</p>
              {action.details && (
                <p className="text-xs text-gray-500 mt-1">{action.details}</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Bonus Actions & Reactions */}
      {(id === "bonusActions" || id === "reactions") && ruleData.rules && (
        <div className="space-y-4">
          <div className="text-sm font-medium text-amber-400 mb-2">规则</div>
          <ul className="space-y-2">
            {ruleData.rules.map((rule: string, idx: number) => (
              <li key={idx} className="text-sm text-gray-300 flex items-start gap-2 bg-gray-800/50 p-3 rounded">
                <span className="text-amber-400">•</span>{rule}
              </li>
            ))}
          </ul>
          {ruleData.opportunityAttack && (
            <div className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="font-medium text-red-400">{ruleData.opportunityAttack.name}</div>
              <div className="text-xs text-gray-500">{ruleData.opportunityAttack.nameEn}</div>
              <div className="text-sm text-gray-300 mt-2">
                <div><span className="text-yellow-400">触发: </span>{ruleData.opportunityAttack.trigger}</div>
                <div><span className="text-green-400">动作: </span>{ruleData.opportunityAttack.action}</div>
                <div><span className="text-blue-400">规避: </span>{ruleData.opportunityAttack.avoidance}</div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Movement */}
      {id === "movement" && (
        <div className="space-y-4">
          {ruleData.rules && (
            <ul className="space-y-2">
              {ruleData.rules.map((rule: string, idx: number) => (
                <li key={idx} className="text-sm text-gray-300 flex items-start gap-2 bg-gray-800/50 p-3 rounded">
                  <span className="text-green-400">•</span>{rule}
                </li>
              ))}
            </ul>
          )}
          {ruleData.difficultTerrain && (
            <div className="bg-yellow-900/20 p-4 rounded border border-yellow-700">
              <div className="font-medium text-yellow-400">{ruleData.difficultTerrain.name}</div>
              <p className="text-sm text-gray-300 mt-1">消耗: {ruleData.difficultTerrain.cost}</p>
            </div>
          )}
          {ruleData.jumping && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ruleData.jumping.longJump && (
                <div className="bg-blue-900/20 p-4 rounded border border-blue-700">
                  <div className="font-medium text-blue-400">{ruleData.jumping.longJump.name}</div>
                  <p className="text-sm text-gray-300 mt-1">{ruleData.jumping.longJump.description}</p>
                </div>
              )}
              {ruleData.jumping.highJump && (
                <div className="bg-green-900/20 p-4 rounded border border-green-700">
                  <div className="font-medium text-green-400">{ruleData.jumping.highJump.name}</div>
                  <p className="text-sm text-gray-300 mt-1">{ruleData.jumping.highJump.description}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Attacking */}
      {id === "attacking" && (
        <div className="space-y-4">
          {ruleData.attackRolls && (
            <div className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="font-medium text-red-400 mb-2">{ruleData.attackRolls.name}</div>
              <div className="text-lg font-mono text-amber-400 mb-3">{ruleData.attackRolls.formula}</div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {ruleData.attackRolls.melee && (
                  <div className="bg-gray-800/50 p-3 rounded">
                    <div className="text-sm font-medium text-orange-400">{ruleData.attackRolls.melee.name}</div>
                    <div className="text-xs text-gray-400 mt-1">调整值: {ruleData.attackRolls.melee.modifier}</div>
                    <div className="text-xs text-gray-400">触及: {ruleData.attackRolls.melee.reach}</div>
                  </div>
                )}
                {ruleData.attackRolls.ranged && (
                  <div className="bg-gray-800/50 p-3 rounded">
                    <div className="text-sm font-medium text-blue-400">{ruleData.attackRolls.ranged.name}</div>
                    <div className="text-xs text-gray-400 mt-1">调整值: {ruleData.attackRolls.ranged.modifier}</div>
                  </div>
                )}
              </div>
            </div>
          )}
          {ruleData.twoWeaponFighting && (
            <div className="bg-purple-900/20 p-4 rounded border border-purple-700">
              <div className="font-medium text-purple-400">{ruleData.twoWeaponFighting.name}</div>
              <p className="text-sm text-gray-300 mt-2">{ruleData.twoWeaponFighting.requirement}</p>
              <p className="text-sm text-gray-400 mt-1">{ruleData.twoWeaponFighting.bonusAction}</p>
            </div>
          )}
        </div>
      )}

      {/* Cover */}
      {id === "cover" && ruleData.types && (
        <div className="space-y-3">
          {ruleData.types.map((cover: any, idx: number) => (
            <div key={idx} className={`p-4 rounded border ${
              cover.type === "half" ? "bg-yellow-900/20 border-yellow-700" :
              cover.type === "threeQuarters" ? "bg-orange-900/20 border-orange-700" :
              "bg-red-900/20 border-red-700"
            }`}>
              <div className="flex justify-between items-start">
                <div>
                  <div className={`font-medium ${
                    cover.type === "half" ? "text-yellow-400" :
                    cover.type === "threeQuarters" ? "text-orange-400" :
                    "text-red-400"
                  }`}>{cover.name}</div>
                  <div className="text-xs text-gray-500">{cover.nameEn}</div>
                </div>
                {cover.bonus && (
                  <div className="text-right text-sm">
                    <div>AC +{cover.bonus.ac}</div>
                    <div>敏捷豁免 +{cover.bonus.dexSave}</div>
                  </div>
                )}
              </div>
              <p className="text-sm text-gray-300 mt-2">{cover.condition || cover.effect}</p>
            </div>
          ))}
        </div>
      )}

      {/* Damage */}
      {id === "damage" && (
        <div className="space-y-4">
          {ruleData.damageRolls && (
            <div className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="font-medium text-red-400 mb-2">{ruleData.damageRolls.name}</div>
              <p className="text-sm text-gray-300">{ruleData.damageRolls.formula}</p>
              {ruleData.damageRolls.criticalHits && (
                <div className="mt-3 bg-amber-900/30 p-3 rounded">
                  <div className="text-sm font-medium text-amber-400">{ruleData.damageRolls.criticalHits.name}</div>
                  <p className="text-xs text-gray-300 mt-1">{ruleData.damageRolls.criticalHits.effect}</p>
                </div>
              )}
            </div>
          )}
          {ruleData.damageTypes?.types && (
            <div>
              <div className="text-sm font-medium text-amber-400 mb-2">伤害类型</div>
              <div className="flex flex-wrap gap-2">
                {ruleData.damageTypes.types.map((type: string, idx: number) => (
                  <span key={idx} className="px-3 py-1 bg-gray-700 rounded text-sm text-gray-300">{type}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Death Saves */}
      {id === "droppingTo0HitPoints" && (
        <div className="space-y-4">
          {ruleData.deathSavingThrows && (
            <div className="bg-red-900/20 p-4 rounded border border-red-700">
              <div className="font-medium text-red-400 mb-2">{ruleData.deathSavingThrows.name}</div>
              <div className="text-center mb-3">
                <span className="text-lg font-mono text-amber-400">DC {ruleData.deathSavingThrows.dc}</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex items-start gap-2">
                  <span className="text-green-400">✓</span>
                  <span className="text-gray-300">{ruleData.deathSavingThrows.success}</span>
                </div>
                <div className="flex items-start gap-2">
                  <span className="text-red-400">✗</span>
                  <span className="text-gray-300">{ruleData.deathSavingThrows.failure}</span>
                </div>
              </div>
            </div>
          )}
          {ruleData.instantDeath && (
            <div className="bg-gray-800 p-4 rounded border-l-4 border-red-600">
              <div className="font-medium text-red-500">{ruleData.instantDeath.name}</div>
              <p className="text-sm text-gray-300 mt-1">{ruleData.instantDeath.condition}</p>
            </div>
          )}
        </div>
      )}

      {/* Mounted/Underwater Combat */}
      {(id === "mountedCombat" || id === "underwaterCombat") && (
        <div className="space-y-4">
          {ruleData.mounting && (
            <div className="bg-amber-900/20 p-4 rounded border border-amber-700">
              <div className="text-sm text-gray-300">{ruleData.mounting}</div>
            </div>
          )}
          {ruleData.meleeAttacks && (
            <div className="bg-orange-900/20 p-4 rounded border border-orange-700">
              <div className="font-medium text-orange-400 mb-2">近战攻击</div>
              <p className="text-sm text-gray-300">{ruleData.meleeAttacks.disadvantage}</p>
              {ruleData.meleeAttacks.exception && (
                <p className="text-xs text-gray-500 mt-1">例外: {ruleData.meleeAttacks.exception}</p>
              )}
            </div>
          )}
          {ruleData.rangedAttacks && (
            <div className="bg-blue-900/20 p-4 rounded border border-blue-700">
              <div className="font-medium text-blue-400 mb-2">远程攻击</div>
              <p className="text-sm text-gray-300">{ruleData.rangedAttacks.disadvantage || ruleData.rangedAttacks.underwater}</p>
            </div>
          )}
          {ruleData.controllingMount && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {ruleData.controllingMount.controlled && (
                <div className="bg-green-900/20 p-4 rounded border border-green-700">
                  <div className="font-medium text-green-400">{ruleData.controllingMount.controlled.name}</div>
                  <p className="text-sm text-gray-300 mt-1">{ruleData.controllingMount.controlled.description}</p>
                </div>
              )}
              {ruleData.controllingMount.independent && (
                <div className="bg-purple-900/20 p-4 rounded border border-purple-700">
                  <div className="font-medium text-purple-400">{ruleData.controllingMount.independent.name}</div>
                  <p className="text-sm text-gray-300 mt-1">{ruleData.controllingMount.independent.description}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Generic fields fallback */}
      {!["initiative", "actions", "bonusActions", "reactions", "movement", "attacking", "cover", "damage", "droppingTo0HitPoints", "mountedCombat", "underwaterCombat"].includes(id) && (
        <div className="space-y-3">
          {Object.entries(ruleData)
            .filter(([key]) => !["id", "name", "nameEn", "description"].includes(key))
            .map(([key, value]: [string, any], idx) => (
              <div key={idx} className="bg-gray-800/50 p-3 rounded">
                <div className="text-sm font-medium text-amber-400 mb-1">{key}</div>
                <div className="text-sm text-gray-300">
                  {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
                </div>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

// Render ability details
export function renderAbilityDetail(abilityData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div>
        <div className="flex items-center gap-4 mb-2">
          <div className="w-16 h-16 rounded-lg bg-gradient-to-br from-blue-500 to-cyan-600 flex items-center justify-center text-2xl font-bold text-white">
            {abilityData.abbreviationCn || abilityData.abbreviation}
          </div>
          <div className="flex-1">
            <h3 className="text-lg font-semibold text-blue-400">{abilityData.name}</h3>
            <p className="text-sm text-gray-400 italic">{abilityData.nameEn} ({abilityData.abbreviation})</p>
          </div>
        </div>
        <p className="text-gray-300 leading-relaxed">{abilityData.description}</p>
      </div>

      {/* Important For */}
      {abilityData.importantFor && abilityData.importantFor.length > 0 && (
        <div className="bg-amber-900/20 p-4 rounded border-l-4 border-amber-500">
          <div className="text-sm text-gray-500 mb-2">重要职业</div>
          <div className="flex flex-wrap gap-2">
            {abilityData.importantFor.map((classId: string, idx: number) => (
              <span key={idx} className="px-3 py-1 bg-amber-700/30 rounded-full text-sm text-amber-300 border border-amber-700">
                {translateId(classId)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Special Properties */}
      {(abilityData.armorClass || abilityData.initiative || abilityData.hitPoints) && (
        <div>
          <div className="text-sm font-medium text-blue-400 mb-3">特殊用途</div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {abilityData.armorClass && (
              <div className="bg-blue-900/20 p-3 rounded border border-blue-700 text-center">
                <div className="text-blue-300 text-sm">影响护甲等级 (AC)</div>
              </div>
            )}
            {abilityData.initiative && (
              <div className="bg-green-900/20 p-3 rounded border border-green-700 text-center">
                <div className="text-green-300 text-sm">决定先攻值</div>
              </div>
            )}
            {abilityData.hitPoints && (
              <div className="bg-red-900/20 p-3 rounded border border-red-700 text-center">
                <div className="text-red-300 text-sm">影响生命值</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Related Skills - Collapsible */}
      {abilityData.skills && abilityData.skills.length > 0 && (
        <CollapsibleSection title={`相关技能 (${abilityData.skills.length})`} icon="🎯" defaultOpen={true}>
          <div className="space-y-3">
            {abilityData.skills.map((skill: any, idx: number) => (
              <div key={idx} className="bg-cyan-900/20 p-4 rounded border border-cyan-800">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-cyan-300">{skill.name}</div>
                    <div className="text-xs text-gray-500">{skill.nameEn}</div>
                  </div>
                </div>
                {skill.description && (
                  <div className="text-sm text-gray-300 leading-relaxed">{skill.description}</div>
                )}
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Common Checks - Collapsible */}
      {abilityData.checks && abilityData.checks.common && abilityData.checks.common.length > 0 && (
        <CollapsibleSection title="常见检定" icon="🎲" defaultOpen={false}>
          <div className="space-y-2">
            {abilityData.checks.common.map((check: string, idx: number) => (
              <div key={idx} className="flex items-start gap-2 bg-blue-900/20 p-3 rounded">
                <span className="text-blue-400 flex-shrink-0">▸</span>
                <span className="text-sm text-gray-300 leading-relaxed">{check}</span>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Saving Throws - Collapsible */}
      {abilityData.savingThrows && (
        <CollapsibleSection title="豁免检定" icon="🛡️" defaultOpen={false}>
          <div className="space-y-3">
            <div className="text-sm text-gray-300 leading-relaxed">
              {abilityData.savingThrows.description}
            </div>

            {abilityData.savingThrows.formula && (
              <div className="bg-purple-900/20 p-3 rounded border border-purple-700">
                <div className="text-xs text-purple-400 mb-1">计算公式</div>
                <div className="text-sm text-purple-300 font-mono">{abilityData.savingThrows.formula}</div>
              </div>
            )}

            {abilityData.savingThrows.common && (
              <div>
                <div className="text-xs text-blue-400 mb-2">各属性豁免用途</div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {Object.entries(abilityData.savingThrows.common).map(([ability, purpose]: [string, any], idx) => (
                    <div key={idx} className="bg-slate-900/40 p-3 rounded border border-slate-700">
                      <div className="text-xs text-amber-400 font-medium">{translateId(ability)}</div>
                      <div className="text-xs text-gray-300 mt-1">{purpose}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Ability Checks and DC - Collapsible */}
      {abilityData.abilityChecks && (
        <CollapsibleSection title="属性检定与难度等级" icon="📊" defaultOpen={false}>
          <div className="space-y-4">
            <div className="text-sm text-gray-300 leading-relaxed">
              {abilityData.abilityChecks.description}
            </div>

            {abilityData.abilityChecks.formula && (
              <div className="bg-green-900/20 p-3 rounded border border-green-700">
                <div className="text-xs text-green-400 mb-1">计算公式</div>
                <div className="text-sm text-green-300 font-mono">{abilityData.abilityChecks.formula}</div>
              </div>
            )}

            {abilityData.abilityChecks.difficultyClass && (
              <div>
                <div className="text-xs text-blue-400 mb-2 font-medium">难度等级 (DC) 对照表</div>
                <div className="space-y-2">
                  {Object.entries(abilityData.abilityChecks.difficultyClass).map(([key, dcInfo]: [string, any], idx) => (
                    <div key={idx} className="bg-gray-800/50 p-3 rounded border border-gray-700 flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="text-center min-w-[60px]">
                          <div className="text-xs text-gray-500">DC</div>
                          <div className="text-xl font-bold text-amber-400">{dcInfo.dc}</div>
                        </div>
                        <div className="flex-1">
                          <div className="text-sm text-gray-300">{dcInfo.name}</div>
                          <div className="text-xs text-gray-500">{dcInfo.nameEn}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}

      {/* Modifier Calculation - Collapsible */}
      {abilityData.modifierCalculation && (
        <CollapsibleSection title="属性调整值计算" icon="🧮" defaultOpen={false}>
          <div className="space-y-4">
            <div className="text-sm text-gray-300 leading-relaxed">
              {abilityData.modifierCalculation.description}
            </div>

            {abilityData.modifierCalculation.formula && (
              <div className="bg-cyan-900/20 p-3 rounded border border-cyan-700">
                <div className="text-xs text-cyan-400 mb-1">计算公式</div>
                <div className="text-sm text-cyan-300 font-mono">{abilityData.modifierCalculation.formula}</div>
              </div>
            )}

            {abilityData.modifierCalculation.table && (
              <div>
                <div className="text-xs text-blue-400 mb-2 font-medium">属性值与调整值对照表</div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2">
                  {abilityData.modifierCalculation.table.map((row: any, idx: number) => (
                    <div key={idx} className="bg-slate-900/40 p-2 rounded border border-slate-700 flex items-center justify-between">
                      <div className="text-sm text-gray-400">属性 {row.score}</div>
                      <div className={`text-sm font-semibold ${
                        row.modifier > 0 ? 'text-green-400' :
                        row.modifier < 0 ? 'text-red-400' :
                        'text-gray-400'
                      }`}>
                        {row.modifier > 0 ? '+' : ''}{row.modifier}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// Alignment color helper
function getAlignmentColor(alignment: string): string {
  const colors: Record<string, string> = {
    'LG': 'text-yellow-400', // Lawful Good
    'NG': 'text-green-400',  // Neutral Good
    'CG': 'text-cyan-400',   // Chaotic Good
    'LN': 'text-blue-400',   // Lawful Neutral
    'N': 'text-gray-400',    // True Neutral
    'TN': 'text-gray-400',   // True Neutral
    'CN': 'text-purple-400', // Chaotic Neutral
    'LE': 'text-orange-400', // Lawful Evil
    'NE': 'text-red-400',    // Neutral Evil
    'CE': 'text-red-500',    // Chaotic Evil
  };
  return colors[alignment] || 'text-gray-400';
}

function getAlignmentName(alignment: string): string {
  const names: Record<string, string> = {
    'LG': '守序善良',
    'NG': '中立善良',
    'CG': '混乱善良',
    'LN': '守序中立',
    'N': '绝对中立',
    'TN': '绝对中立',
    'CN': '混乱中立',
    'LE': '守序邪恶',
    'NE': '中立邪恶',
    'CE': '混乱邪恶',
  };
  return names[alignment] || alignment;
}

// Render pantheon/deity details
export function renderDeityDetail(data: any): React.ReactNode {
  // Check the data structure and render appropriately
  if (data.deities && data.deities.length > 0) {
    // Standard pantheon with deities array (Sundered Realms / 裂隙诸境)
    return <PantheonDetail pantheon={data} />;
  } else if (data.families) {
    // Dragonlance style with families
    return <DragonlancePantheonDetail pantheon={data} />;
  } else if (data.mainPantheons) {
    // Eberron style with mainPantheons and otherReligions
    return <EberronPantheonDetail pantheon={data} />;
  } else if (data.races && data.races.length > 0) {
    // Nonhuman deities with races
    return <NonhumanDeitiesDetail data={data} />;
  } else if (data.examples) {
    // Nonhuman deities with examples (alternative structure)
    return <NonhumanDeitiesExamplesDetail data={data} />;
  } else if (data.alignment) {
    // Single deity
    return <SingleDeityDetail deity={data} />;
  } else {
    // Fallback: show what we have
    return <GenericPantheonDetail data={data} />;
  }
}

// Dragonlance pantheon with families
function DragonlancePantheonDetail({ pantheon }: { pantheon: any }) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-900/30 to-yellow-900/20 p-4 rounded-lg border border-amber-700/50">
        <h3 className="text-xl font-bold text-amber-400">{pantheon.name}</h3>
        <p className="text-sm text-gray-400 italic">{pantheon.nameEn}</p>
        {pantheon.world && (
          <p className="text-sm text-gray-300 mt-2">世界设定: {pantheon.world}</p>
        )}
        {pantheon.description && (
          <p className="text-sm text-gray-400 mt-2">{pantheon.description}</p>
        )}
      </div>

      {/* Note */}
      {pantheon.note && (
        <div className="bg-blue-900/20 p-4 rounded border border-blue-700/50">
          <p className="text-sm text-gray-300">{pantheon.note}</p>
        </div>
      )}

      {/* Families */}
      <div className="space-y-4">
        <div className="text-sm font-medium text-gray-400">神祇家族</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {pantheon.families?.map((family: any, idx: number) => (
            <div
              key={idx}
              className={`p-4 rounded-lg border ${
                family.name === '善良神' ? 'bg-green-900/20 border-green-700/50' :
                family.name === '中立神' ? 'bg-gray-800/60 border-gray-600' :
                'bg-red-900/20 border-red-700/50'
              }`}
            >
              <div className={`font-medium mb-2 ${
                family.name === '善良神' ? 'text-green-400' :
                family.name === '中立神' ? 'text-gray-300' :
                'text-red-400'
              }`}>
                {family.name}
              </div>
              <div className="text-xs text-gray-500 mb-2">共 {family.count} 位神祇</div>
              {family.leaders && (
                <div className="space-y-1">
                  <div className="text-xs text-gray-500">主要神祇:</div>
                  {family.leaders.map((leader: string, lIdx: number) => (
                    <div key={lIdx} className="text-sm text-gray-300">• {leader}</div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Eberron pantheon with mainPantheons and otherReligions
function EberronPantheonDetail({ pantheon }: { pantheon: any }) {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/20 p-4 rounded-lg border border-purple-700/50">
        <h3 className="text-xl font-bold text-purple-400">{pantheon.name}</h3>
        <p className="text-sm text-gray-400 italic">{pantheon.nameEn}</p>
        {pantheon.world && (
          <p className="text-sm text-gray-300 mt-2">世界设定: {pantheon.world}</p>
        )}
        {pantheon.description && (
          <p className="text-sm text-gray-400 mt-2">{pantheon.description}</p>
        )}
      </div>

      {/* Main Pantheons */}
      {pantheon.mainPantheons && pantheon.mainPantheons.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-400">主要神系</div>
          {pantheon.mainPantheons.map((mp: any, idx: number) => (
            <div
              key={idx}
              className={`bg-slate-800/60 rounded-lg border transition-all ${
                expandedSection === mp.name ? 'border-purple-500' : 'border-slate-700'
              }`}
            >
              <div
                className="p-3 flex items-center justify-between cursor-pointer"
                onClick={() => setExpandedSection(expandedSection === mp.name ? null : mp.name)}
              >
                <div>
                  <span className="font-medium text-gray-200">{mp.name}</span>
                  <span className="text-xs text-gray-500 ml-2">{mp.nameEn}</span>
                </div>
                <span className="text-gray-500">{expandedSection === mp.name ? '▼' : '▶'}</span>
              </div>
              {expandedSection === mp.name && (
                <div className="border-t border-slate-700 p-4">
                  {mp.description && (
                    <p className="text-sm text-gray-300 mb-3">{mp.description}</p>
                  )}
                  {mp.deities && mp.deities.length > 0 ? (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {mp.deities.map((deity: any, dIdx: number) => (
                        <div key={dIdx} className="bg-slate-900/50 p-2 rounded text-sm">
                          <span className="text-gray-200">{deity.name}</span>
                          {deity.title && <span className="text-amber-400/80 ml-2">- {deity.title}</span>}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-gray-500 italic">详细神祇信息待补充</p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Other Religions */}
      {pantheon.otherReligions && pantheon.otherReligions.length > 0 && (
        <div className="space-y-3">
          <div className="text-sm font-medium text-gray-400">其他宗教</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {pantheon.otherReligions.map((religion: any, idx: number) => (
              <div key={idx} className="bg-slate-800/60 p-3 rounded border border-slate-700">
                <div className="font-medium text-gray-200">{religion.name}</div>
                {religion.nameEn && <div className="text-xs text-gray-500">{religion.nameEn}</div>}
                {religion.description && (
                  <p className="text-sm text-gray-400 mt-2">{religion.description}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Nonhuman deities with examples structure
function NonhumanDeitiesExamplesDetail({ data }: { data: any }) {
  const [expandedRace, setExpandedRace] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-green-900/30 to-teal-900/20 p-4 rounded-lg border border-green-700/50">
        <h3 className="text-xl font-bold text-green-400">{data.name || "非人类种族神祇"}</h3>
        <p className="text-sm text-gray-400 italic">{data.nameEn || "Nonhuman Deities"}</p>
        {data.description && (
          <p className="text-sm text-gray-400 mt-2">{data.description}</p>
        )}
        {data.note && (
          <p className="text-xs text-gray-500 mt-2">{data.note}</p>
        )}
      </div>

      {/* Races with deities */}
      <div className="space-y-3">
        {data.examples?.map((race: any, idx: number) => (
          <div
            key={idx}
            className={`bg-slate-800/60 rounded-lg border transition-all ${
              expandedRace === race.race ? 'border-green-500' : 'border-slate-700'
            }`}
          >
            {/* Race header */}
            <div
              className="p-3 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedRace(expandedRace === race.race ? null : race.race)}
            >
              <div className="flex items-center gap-3">
                <span className="font-medium text-gray-200">{race.race}</span>
                <span className="text-xs text-gray-500">({race.raceEn})</span>
                {race.mainDeity && (
                  <span className="text-xs text-amber-400">主神: {race.mainDeity.name}</span>
                )}
              </div>
              <span className="text-gray-500">{expandedRace === race.race ? '▼' : '▶'}</span>
            </div>

            {/* Expanded pantheon */}
            {expandedRace === race.race && (
              <div className="border-t border-slate-700 p-4 space-y-3">
                {race.mainDeity && (
                  <div className="bg-amber-900/20 p-3 rounded border border-amber-700/50">
                    <div className="text-xs text-gray-500 mb-1">主神</div>
                    <div className="font-medium text-amber-400">{race.mainDeity.name}</div>
                    <div className="text-xs text-gray-500">{race.mainDeity.nameEn}</div>
                  </div>
                )}
                {race.pantheon && race.pantheon.length > 0 && (
                  <div>
                    <div className="text-xs text-gray-500 mb-2">神系成员</div>
                    <div className="space-y-1">
                      {race.pantheon.map((deity: string, dIdx: number) => (
                        <div key={dIdx} className="text-sm text-gray-300 pl-2 border-l-2 border-slate-700">
                          {deity}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Generic fallback for unknown structures
function GenericPantheonDetail({ data }: { data: any }) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-gray-800 to-gray-700 p-4 rounded-lg border border-gray-600">
        <h3 className="text-xl font-bold text-gray-200">{data.name || "神祇信息"}</h3>
        {data.nameEn && <p className="text-sm text-gray-400 italic">{data.nameEn}</p>}
        {data.world && <p className="text-sm text-gray-300 mt-2">世界设定: {data.world}</p>}
        {data.description && <p className="text-sm text-gray-400 mt-2">{data.description}</p>}
      </div>

      {/* Note if present */}
      {data.note && (
        <div className="bg-blue-900/20 p-4 rounded border border-blue-700/50">
          <p className="text-sm text-gray-300">{data.note}</p>
        </div>
      )}

      {/* Show any arrays we find */}
      {Object.entries(data).map(([key, value]: [string, any]) => {
        if (Array.isArray(value) && value.length > 0 && !['deities'].includes(key)) {
          return (
            <div key={key} className="space-y-2">
              <div className="text-sm font-medium text-gray-400 capitalize">{key}</div>
              <div className="bg-slate-800/60 p-3 rounded border border-slate-700">
                {value.map((item: any, idx: number) => (
                  <div key={idx} className="text-sm text-gray-300 py-1">
                    {typeof item === 'string' ? item : JSON.stringify(item)}
                  </div>
                ))}
              </div>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function PantheonDetail({ pantheon }: { pantheon: any }) {
  const [expandedDeity, setExpandedDeity] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Pantheon header */}
      <div className="bg-gradient-to-r from-amber-900/30 to-yellow-900/20 p-4 rounded-lg border border-amber-700/50">
        <h3 className="text-xl font-bold text-amber-400">{pantheon.name}</h3>
        <p className="text-sm text-gray-400 italic">{pantheon.nameEn}</p>
        {pantheon.world && (
          <p className="text-sm text-gray-300 mt-2">世界设定: {pantheon.world}</p>
        )}
        {pantheon.description && (
          <p className="text-sm text-gray-400 mt-2">{pantheon.description}</p>
        )}
      </div>

      {/* Deities grid */}
      <div className="space-y-3">
        <div className="text-sm font-medium text-gray-400">
          神祇列表 ({pantheon.deities?.length || 0}位)
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {pantheon.deities?.map((deity: any) => (
            <div
              key={deity.id}
              className={`bg-slate-800/60 rounded-lg border transition-all cursor-pointer ${
                expandedDeity === deity.id
                  ? 'border-amber-500 col-span-1 md:col-span-2'
                  : 'border-slate-700 hover:border-slate-600'
              }`}
              onClick={() => setExpandedDeity(expandedDeity === deity.id ? null : deity.id)}
            >
              {/* Deity header */}
              <div className="p-3 flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-gray-200">{deity.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${getAlignmentColor(deity.alignment)} bg-slate-900/50`}>
                      {deity.alignment}
                    </span>
                  </div>
                  <div className="text-xs text-gray-500">{deity.nameEn}</div>
                  <div className="text-sm text-amber-400/80 mt-1">{deity.title}</div>
                </div>
                <div className="text-gray-500 text-xs">
                  {expandedDeity === deity.id ? '▼' : '▶'}
                </div>
              </div>

              {/* Expanded deity details */}
              {expandedDeity === deity.id && (
                <div className="border-t border-slate-700 p-4 space-y-4">
                  {/* Description */}
                  {deity.description && (
                    <p className="text-sm text-gray-300 leading-relaxed">{deity.description}</p>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Alignment */}
                    <div className="bg-slate-900/40 p-3 rounded">
                      <div className="text-xs text-gray-500 mb-1">阵营</div>
                      <div className={`font-medium ${getAlignmentColor(deity.alignment)}`}>
                        {getAlignmentName(deity.alignment)} ({deity.alignment})
                      </div>
                    </div>

                    {/* Symbol */}
                    {deity.symbol && (
                      <div className="bg-slate-900/40 p-3 rounded">
                        <div className="text-xs text-gray-500 mb-1">圣徽</div>
                        <div className="text-sm text-gray-300">{deity.symbol}</div>
                      </div>
                    )}
                  </div>

                  {/* Domains */}
                  {deity.domains && deity.domains.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-500 mb-2">神域</div>
                      <div className="flex flex-wrap gap-2">
                        {deity.domains.map((domain: string, idx: number) => (
                          <span key={idx} className="px-2 py-1 bg-purple-900/40 text-purple-300 text-xs rounded border border-purple-700/50">
                            {domain}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Portfolio */}
                  {deity.portfolio && deity.portfolio.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-500 mb-2">职能领域</div>
                      <div className="flex flex-wrap gap-2">
                        {deity.portfolio.map((p: string, idx: number) => (
                          <span key={idx} className="px-2 py-1 bg-blue-900/40 text-blue-300 text-xs rounded border border-blue-700/50">
                            {p}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Worshippers */}
                  {deity.worshippers && deity.worshippers.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-500 mb-2">主要信徒</div>
                      <div className="flex flex-wrap gap-2">
                        {deity.worshippers.map((w: string, idx: number) => (
                          <span key={idx} className="px-2 py-1 bg-green-900/40 text-green-300 text-xs rounded border border-green-700/50">
                            {w}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SingleDeityDetail({ deity }: { deity: any }) {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-amber-900/30 to-yellow-900/20 p-4 rounded-lg border border-amber-700/50">
        <div className="flex items-center gap-3">
          <h3 className="text-xl font-bold text-amber-400">{deity.name}</h3>
          <span className={`text-sm px-2 py-0.5 rounded ${getAlignmentColor(deity.alignment)} bg-slate-900/50`}>
            {deity.alignment}
          </span>
        </div>
        <p className="text-sm text-gray-400 italic">{deity.nameEn}</p>
        <p className="text-lg text-amber-400/80 mt-1">{deity.title}</p>
      </div>

      {/* Description */}
      {deity.description && (
        <p className="text-gray-300 leading-relaxed">{deity.description}</p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Alignment */}
        <div className="bg-slate-800/60 p-4 rounded border border-slate-700">
          <div className="text-xs text-gray-500 mb-2">阵营</div>
          <div className={`font-medium ${getAlignmentColor(deity.alignment)}`}>
            {getAlignmentName(deity.alignment)} ({deity.alignment})
          </div>
        </div>

        {/* Symbol */}
        {deity.symbol && (
          <div className="bg-slate-800/60 p-4 rounded border border-slate-700">
            <div className="text-xs text-gray-500 mb-2">圣徽</div>
            <div className="text-gray-300">{deity.symbol}</div>
          </div>
        )}
      </div>

      {/* Domains */}
      {deity.domains && deity.domains.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-400 mb-2">神域</div>
          <div className="flex flex-wrap gap-2">
            {deity.domains.map((domain: string, idx: number) => (
              <span key={idx} className="px-3 py-1.5 bg-purple-900/40 text-purple-300 rounded border border-purple-700/50">
                {domain}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Portfolio */}
      {deity.portfolio && deity.portfolio.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-400 mb-2">职能领域</div>
          <div className="flex flex-wrap gap-2">
            {deity.portfolio.map((p: string, idx: number) => (
              <span key={idx} className="px-3 py-1.5 bg-blue-900/40 text-blue-300 rounded border border-blue-700/50">
                {p}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Worshippers */}
      {deity.worshippers && deity.worshippers.length > 0 && (
        <div>
          <div className="text-sm font-medium text-gray-400 mb-2">主要信徒</div>
          <div className="flex flex-wrap gap-2">
            {deity.worshippers.map((w: string, idx: number) => (
              <span key={idx} className="px-3 py-1.5 bg-green-900/40 text-green-300 rounded border border-green-700/50">
                {w}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function NonhumanDeitiesDetail({ data }: { data: any }) {
  const [expandedRace, setExpandedRace] = useState<string | null>(null);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-900/30 to-indigo-900/20 p-4 rounded-lg border border-purple-700/50">
        <h3 className="text-xl font-bold text-purple-400">{data.name || "非人类种族神祇"}</h3>
        <p className="text-sm text-gray-400 italic">{data.nameEn || "Nonhuman Deities"}</p>
        {data.description && (
          <p className="text-sm text-gray-400 mt-2">{data.description}</p>
        )}
      </div>

      {/* Races with deities */}
      <div className="space-y-3">
        {data.races?.map((race: any) => (
          <div
            key={race.race}
            className={`bg-slate-800/60 rounded-lg border transition-all ${
              expandedRace === race.race
                ? 'border-purple-500'
                : 'border-slate-700'
            }`}
          >
            {/* Race header */}
            <div
              className="p-3 flex items-center justify-between cursor-pointer"
              onClick={() => setExpandedRace(expandedRace === race.race ? null : race.race)}
            >
              <div>
                <span className="font-medium text-gray-200">{race.race}</span>
                <span className="text-gray-500 text-sm ml-2">({race.deities?.length || 0}位神祇)</span>
              </div>
              <span className="text-gray-500">{expandedRace === race.race ? '▼' : '▶'}</span>
            </div>

            {/* Expanded deities */}
            {expandedRace === race.race && race.deities && (
              <div className="border-t border-slate-700 p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {race.deities.map((deity: any, idx: number) => (
                  <div key={idx} className="bg-slate-900/50 p-3 rounded border border-slate-700">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-medium text-gray-200">{deity.name}</span>
                      <span className={`text-xs px-1.5 py-0.5 rounded ${getAlignmentColor(deity.alignment)} bg-slate-900/50`}>
                        {deity.alignment}
                      </span>
                    </div>
                    <div className="text-xs text-gray-500">{deity.nameEn}</div>
                    <div className="text-sm text-amber-400/80 mt-1">{deity.title}</div>
                    {deity.domains && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {deity.domains.map((d: string, dIdx: number) => (
                          <span key={dIdx} className="text-xs px-1.5 py-0.5 bg-purple-900/40 text-purple-300 rounded">
                            {d}
                          </span>
                        ))}
                      </div>
                    )}
                    {deity.symbol && (
                      <div className="text-xs text-gray-500 mt-2">圣徽: {deity.symbol}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ============= Disease Detail Renderer =============
export function renderDiseaseDetail(disease: any): React.ReactNode {
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-red-400">{disease.name}</h3>
        <p className="text-sm text-gray-500 italic">{disease.nameEn}</p>
      </div>

      {/* Basic Info */}
      <div className="grid grid-cols-2 gap-3">
        {disease.transmission && (
          <div className="bg-red-900/20 p-3 rounded border border-red-700/50">
            <div className="text-xs text-red-400 mb-1">传播方式</div>
            <div className="text-sm text-gray-300">{disease.transmission}</div>
          </div>
        )}
        {disease.incubation && (
          <div className="bg-orange-900/20 p-3 rounded border border-orange-700/50">
            <div className="text-xs text-orange-400 mb-1">潜伏期</div>
            <div className="text-sm text-gray-300">{disease.incubation}</div>
          </div>
        )}
        {disease.dc && (
          <div className="bg-purple-900/20 p-3 rounded border border-purple-700/50">
            <div className="text-xs text-purple-400 mb-1">豁免DC</div>
            <div className="text-lg font-bold text-purple-300">{disease.dc}</div>
          </div>
        )}
      </div>

      {/* Description */}
      {disease.description && (
        <div className="bg-gray-800/50 p-4 rounded">
          <p className="text-gray-300 leading-relaxed">{disease.description}</p>
        </div>
      )}

      {/* Symptoms */}
      {disease.symptoms && disease.symptoms.length > 0 && (
        <div>
          <div className="text-sm font-medium text-yellow-400 mb-2">症状</div>
          <div className="flex flex-wrap gap-2">
            {disease.symptoms.map((symptom: string, idx: number) => (
              <span key={idx} className="px-3 py-1 bg-yellow-900/30 text-yellow-300 rounded-full text-sm border border-yellow-700/50">
                {symptom}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Effects */}
      {disease.effects && disease.effects.length > 0 && (
        <div>
          <div className="text-sm font-medium text-red-400 mb-2">效果</div>
          <div className="space-y-2">
            {disease.effects.map((effect: any, idx: number) => (
              <div key={idx} className="bg-red-900/20 p-3 rounded border-l-2 border-red-500">
                <div className="text-xs text-red-400 mb-1">{effect.trigger}</div>
                <div className="text-sm text-gray-300">{effect.effect}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Cure */}
      {disease.cure && (
        <div className="bg-green-900/20 p-4 rounded border border-green-700/50">
          <div className="text-sm font-medium text-green-400 mb-2">治愈方法</div>
          <p className="text-gray-300">{disease.cure}</p>
        </div>
      )}
    </div>
  );
}

// ============= Poison Detail Renderer =============
export function renderPoisonDetail(poison: any): React.ReactNode {
  const typeColors: Record<string, { bg: string; text: string; border: string }> = {
    contact: { bg: 'bg-orange-900/30', text: 'text-orange-300', border: 'border-orange-700/50' },
    ingested: { bg: 'bg-green-900/30', text: 'text-green-300', border: 'border-green-700/50' },
    inhaled: { bg: 'bg-cyan-900/30', text: 'text-cyan-300', border: 'border-cyan-700/50' },
    injury: { bg: 'bg-red-900/30', text: 'text-red-300', border: 'border-red-700/50' },
  };
  const typeLabels: Record<string, string> = {
    contact: '接触型',
    ingested: '摄入型',
    inhaled: '吸入型',
    injury: '伤口型',
  };
  const colors = typeColors[poison.type] || typeColors.injury;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h3 className="text-lg font-semibold text-purple-400">{poison.name}</h3>
          <p className="text-sm text-gray-500 italic">{poison.nameEn}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm font-medium ${colors.bg} ${colors.text} border ${colors.border}`}>
          {typeLabels[poison.type] || poison.type}
        </span>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3">
        {poison.dc && (
          <div className="bg-purple-900/20 p-3 rounded border border-purple-700/50">
            <div className="text-xs text-purple-400 mb-1">豁免DC</div>
            <div className="text-lg font-bold text-purple-300">{poison.dc}</div>
          </div>
        )}
        {poison.price && (
          <div className="bg-amber-900/20 p-3 rounded border border-amber-700/50">
            <div className="text-xs text-amber-400 mb-1">价格</div>
            <div className="text-lg font-bold text-amber-300">{poison.price}</div>
          </div>
        )}
      </div>

      {/* Description */}
      {poison.description && (
        <div className="bg-gray-800/50 p-4 rounded">
          <p className="text-gray-300 leading-relaxed">{poison.description}</p>
        </div>
      )}

      {/* English Description */}
      {poison.descriptionEn && (
        <div className="bg-gray-900/50 p-3 rounded border border-gray-700">
          <p className="text-sm text-gray-500 italic leading-relaxed">{poison.descriptionEn}</p>
        </div>
      )}
    </div>
  );
}

// ============= NPC Template Detail Renderer =============
export function renderNPCTemplateDetail(npc: any): React.ReactNode {
  const getMod = (score: number) => Math.floor((score - 10) / 2);
  const formatMod = (mod: number) => mod >= 0 ? `+${mod}` : `${mod}`;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-violet-400">{npc.name}</h3>
        <p className="text-sm text-gray-500 italic">{npc.nameEn}</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <span className="px-2 py-0.5 bg-gray-700 rounded text-xs text-gray-300">{npc.size}</span>
          <span className="px-2 py-0.5 bg-violet-900/40 rounded text-xs text-violet-300">{npc.type}</span>
          {npc.alignment && (
            <span className="px-2 py-0.5 bg-gray-700/50 rounded text-xs text-gray-400">{npc.alignment}</span>
          )}
          {npc.cr && (
            <span className="px-2 py-0.5 bg-red-900/40 rounded text-xs text-red-300 font-medium">CR {npc.cr}</span>
          )}
        </div>
      </div>

      {/* Combat Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-blue-900/20 p-3 rounded border border-blue-700/50 text-center">
          <div className="text-xs text-blue-400">AC</div>
          <div className="text-xl font-bold text-blue-300">{typeof npc.ac === 'object' ? (npc.ac?.value || npc.ac?.base || '') : npc.ac}</div>
          {npc.acNote && <div className="text-xs text-gray-500">{npc.acNote}</div>}
        </div>
        <div className="bg-red-900/20 p-3 rounded border border-red-700/50 text-center">
          <div className="text-xs text-red-400">HP</div>
          <div className="text-xl font-bold text-red-300">{typeof npc.hp === 'object' ? (npc.hp?.average || npc.hp?.dice || '') : npc.hp}</div>
          {npc.hpFormula && <div className="text-xs text-gray-500">{npc.hpFormula}</div>}
        </div>
        <div className="bg-yellow-900/20 p-3 rounded border border-yellow-700/50 text-center">
          <div className="text-xs text-yellow-400">XP</div>
          <div className="text-xl font-bold text-yellow-300">{npc.xp}</div>
        </div>
      </div>

      {/* Ability Scores */}
      {npc.abilityScores && (
        <div>
          <div className="text-sm font-medium text-gray-400 mb-2">属性值</div>
          <div className="grid grid-cols-6 gap-1">
            {['str', 'dex', 'con', 'int', 'wis', 'cha'].map(key => {
              const score = npc.abilityScores[key];
              const mod = getMod(score);
              const labels: Record<string, string> = { str: '力量', dex: '敏捷', con: '体质', int: '智力', wis: '感知', cha: '魅力' };
              return (
                <div key={key} className="bg-gray-800/50 p-2 rounded text-center">
                  <div className="text-[10px] text-gray-500 uppercase">{labels[key]}</div>
                  <div className="text-sm font-bold text-white">{score}</div>
                  <div className={`text-xs ${mod >= 0 ? 'text-green-400' : 'text-red-400'}`}>{formatMod(mod)}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Description */}
      {npc.description && (
        <div className="bg-gray-800/50 p-3 rounded">
          <p className="text-sm text-gray-300 leading-relaxed">{npc.description}</p>
        </div>
      )}

      {/* Special Abilities */}
      {npc.specialAbilities && npc.specialAbilities.length > 0 && (
        <div>
          <div className="text-sm font-medium text-purple-400 mb-2">特殊能力</div>
          <div className="space-y-2">
            {npc.specialAbilities.map((ability: any, idx: number) => (
              <div key={idx} className="bg-purple-900/20 p-3 rounded border-l-2 border-purple-500">
                <div className="font-medium text-purple-300 text-sm">{ability.name}</div>
                <p className="text-xs text-gray-400 mt-1">{ability.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {npc.actions && npc.actions.length > 0 && (
        <div>
          <div className="text-sm font-medium text-amber-400 mb-2">动作</div>
          <div className="space-y-2">
            {npc.actions.map((action: any, idx: number) => (
              <div key={idx} className="bg-amber-900/20 p-3 rounded border-l-2 border-amber-500">
                <div className="font-medium text-amber-300 text-sm">{action.name}</div>
                <p className="text-xs text-gray-400 mt-1">{action.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Reactions */}
      {npc.reactions && npc.reactions.length > 0 && (
        <div>
          <div className="text-sm font-medium text-cyan-400 mb-2">反应</div>
          <div className="space-y-2">
            {npc.reactions.map((reaction: any, idx: number) => (
              <div key={idx} className="bg-cyan-900/20 p-3 rounded border-l-2 border-cyan-500">
                <div className="font-medium text-cyan-300 text-sm">{reaction.name}</div>
                <p className="text-xs text-gray-400 mt-1">{reaction.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ============= Encounter Table (Environment) Detail Renderer =============
export function renderEncounterTableDetail(env: any): React.ReactNode {
  const crColors: Record<string, { bg: string; text: string; border: string }> = {
    'cr0-1': { bg: 'bg-green-900/20', text: 'text-green-400', border: 'border-green-700/50' },
    'cr2-4': { bg: 'bg-yellow-900/20', text: 'text-yellow-400', border: 'border-yellow-700/50' },
    'cr5-10': { bg: 'bg-orange-900/20', text: 'text-orange-400', border: 'border-orange-700/50' },
    'cr11-16': { bg: 'bg-red-900/20', text: 'text-red-400', border: 'border-red-700/50' },
    'cr17+': { bg: 'bg-purple-900/20', text: 'text-purple-400', border: 'border-purple-700/50' },
  };
  const crLabels: Record<string, string> = {
    'cr0-1': 'CR 0-1',
    'cr2-4': 'CR 2-4',
    'cr5-10': 'CR 5-10',
    'cr11-16': 'CR 11-16',
    'cr17+': 'CR 17+',
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <h3 className="text-lg font-semibold text-emerald-400">{env.name}</h3>
        <p className="text-sm text-gray-500 italic">{env.nameEn}</p>
        {env.description && (
          <p className="text-sm text-gray-400 mt-2">{env.description}</p>
        )}
      </div>

      {/* Encounter Tables by CR */}
      {env.encounters && (
        <div className="space-y-4">
          {Object.entries(env.encounters).map(([crKey, encounters]: [string, any]) => {
            const colors = crColors[crKey] || crColors['cr0-1'];
            return (
              <div key={crKey} className={`${colors.bg} p-4 rounded border ${colors.border}`}>
                <div className={`font-medium ${colors.text} mb-3`}>{crLabels[crKey] || crKey}</div>
                <div className="space-y-1">
                  {(encounters as any[]).map((enc: any, idx: number) => (
                    <div key={idx} className="flex items-start gap-3 text-sm">
                      <span className="text-gray-500 font-mono w-12 flex-shrink-0">{enc.roll}</span>
                      <span className="text-gray-300">{enc.encounter}</span>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
