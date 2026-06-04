// Class detail rendering for Rules Panel
import { translateId } from "./Rules_Types";

// Render class details with level progression
export function renderClassDetail(classData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      {/* Basic Info */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div>
          <div className="text-xs text-gray-500">生命骰</div>
          <div className="text-lg font-semibold text-amber-400">{classData.hitDie}</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">主要属性</div>
          <div className="text-lg font-semibold text-blue-400">
            {Array.isArray(classData.primaryAbility)
              ? classData.primaryAbility.map(translateId).join(", ")
              : translateId(classData.primaryAbility)}
          </div>
        </div>
        <div className="col-span-2">
          <div className="text-xs text-gray-500">豁免熟练项</div>
          <div className="text-lg font-semibold text-green-400">
            {classData.savingThrows?.map(translateId).join(", ")}
          </div>
        </div>
      </div>

      {/* Description */}
      {classData.description && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">描述</h3>
          <p className="text-gray-400 text-sm leading-relaxed">{classData.description}</p>
        </div>
      )}

      {/* Proficiencies */}
      {classData.proficiencies && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">熟练项</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {classData.proficiencies.armor && (
              <div>
                <span className="text-gray-500">护甲:</span>{" "}
                <span className="text-gray-300">{classData.proficiencies.armor.map(translateId).join(", ")}</span>
              </div>
            )}
            {classData.proficiencies.weapons && (
              <div>
                <span className="text-gray-500">武器:</span>{" "}
                <span className="text-gray-300">{classData.proficiencies.weapons.map(translateId).join(", ")}</span>
              </div>
            )}
            {classData.proficiencies.skillsAvailable && (
              <div className="col-span-2">
                <span className="text-gray-500">技能选择 ({classData.proficiencies.skillChoices}):</span>{" "}
                <span className="text-gray-300">{classData.proficiencies.skillsAvailable.map(translateId).join(", ")}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Subclasses */}
      {classData.subclasses && classData.subclasses.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">子职业</h3>
          <div className="space-y-4">
            {classData.subclasses.map((subclass: any, idx: number) => (
              <div key={idx} className="border border-purple-700 rounded-lg p-4 bg-purple-900/20">
                <div className="flex items-center justify-between mb-2">
                  <div className="font-semibold text-lg text-purple-400">{subclass.name}</div>
                  {subclass.level && (
                    <div className="text-xs px-2 py-0.5 bg-amber-600/30 text-amber-300 rounded border border-amber-600/50">
                      {subclass.level}级解锁
                    </div>
                  )}
                </div>
                {subclass.nameEn && (
                  <div className="text-xs text-gray-500 mb-2">{subclass.nameEn}</div>
                )}
                {subclass.description && (
                  <p className="text-sm text-gray-300 mb-3 leading-relaxed">{subclass.description}</p>
                )}

                {/* Subclass Features */}
                {(() => {
                  const leveledFeatures = Object.entries(subclass)
                    .filter(([key, value]) => /^level\d+Features$/.test(key) && Array.isArray(value))
                    .flatMap(([, value]) => value as any[])
                    .sort((a: any, b: any) => (a.level || 0) - (b.level || 0));
                  const feats = Array.isArray(subclass.features)
                    ? subclass.features
                    : (leveledFeatures.length > 0 ? leveledFeatures : (subclass.level1Features || []));
                  if (feats.length === 0 && typeof subclass.features === 'string' && subclass.features) {
                    return (
                      <div className="mt-3 pt-3 border-t border-purple-700/50">
                        <div className="text-xs font-semibold text-purple-300 mb-2">子职业特性</div>
                        <p className="text-xs text-gray-400">{subclass.features}</p>
                      </div>
                    );
                  }
                  if (feats.length === 0) return null;
                  return (
                  <div className="mt-3 pt-3 border-t border-purple-700/50">
                    <div className="text-xs font-semibold text-purple-300 mb-2">子职业特性</div>
                    <div className="space-y-2">
                      {feats.map((feature: any, fIdx: number) => (
                        <div key={fIdx} className="border-l-2 border-blue-500 pl-3 py-1">
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-bold text-amber-400">Lv{feature.level}</span>
                            <span className="text-sm font-semibold text-blue-300">{feature.name}</span>
                            {feature.nameEn && (
                              <span className="text-xs text-gray-500">({feature.nameEn})</span>
                            )}
                          </div>
                          {feature.description && (
                            <p className="text-xs text-gray-400 mt-1 leading-relaxed">
                              {feature.description}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                  );
                })()}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Level Progression */}
      {classData.features && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">等级提升</h3>
          <div className="space-y-4">
            {[...Array(20)].map((_, level) => {
              const levelNum = level + 1;
              const levelFeatures = classData.features.filter((f: any) => f.level === levelNum);

              if (levelFeatures.length === 0) return null;

              return (
                <div key={levelNum} className="border border-gray-700 rounded-lg p-4 bg-gray-900/50">
                  <div className="flex items-center gap-2 mb-3">
                    <div className="text-xl font-bold text-amber-400">Lv {levelNum}</div>
                  </div>
                  <div className="space-y-3">
                    {levelFeatures.map((feature: any, idx: number) => (
                      <div key={idx} className="border-l-2 border-blue-500 pl-3">
                        <div className="font-semibold text-blue-400">{feature.name}</div>
                        {feature.nameEn && (
                          <div className="text-xs text-gray-500">{feature.nameEn}</div>
                        )}
                        <p className="text-sm text-gray-300 mt-1 leading-relaxed">
                          {feature.description}
                        </p>
                        {/* Special rendering for features with additional data */}
                        {feature.ragesPerDay && (
                          <div className="mt-2 text-xs text-gray-400">
                            每日狂暴次数: {JSON.stringify(feature.ragesPerDay)}
                          </div>
                        )}
                        {feature.rageDamage && (
                          <div className="text-xs text-gray-400">
                            狂暴伤害加值: {JSON.stringify(feature.rageDamage)}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
