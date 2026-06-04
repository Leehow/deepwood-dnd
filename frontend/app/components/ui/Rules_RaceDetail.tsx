// Race detail rendering for Rules Panel

// Render race details
export function renderRaceDetail(raceData: any): React.ReactNode {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs text-gray-500">速度</div>
          <div className="text-lg font-semibold text-amber-400">{raceData.speed} 尺</div>
        </div>
        <div>
          <div className="text-xs text-gray-500">体型</div>
          <div className="text-lg font-semibold text-blue-400">{raceData.size}</div>
        </div>
      </div>

      {raceData.description && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">描述</h3>
          <p className="text-gray-400 text-sm leading-relaxed">{raceData.description}</p>
        </div>
      )}

      {raceData.abilityScoreIncrease && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-2">属性提升</h3>
          <div className="text-sm text-gray-300">
            {Object.entries(raceData.abilityScoreIncrease).map(([ability, value]) => (
              <span key={ability} className="inline-block mr-3">
                {ability.toUpperCase()}: +{value as number}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Subraces */}
      {raceData.subraces && raceData.subraces.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">亚种</h3>
          <div className="space-y-3">
            {raceData.subraces.map((subrace: any, idx: number) => (
              <div key={idx} className="border border-cyan-700 rounded-lg p-4 bg-cyan-900/20">
                <div className="font-semibold text-cyan-400 text-base">{subrace.name}</div>
                {subrace.nameEn && (
                  <div className="text-xs text-gray-500 mb-2">{subrace.nameEn}</div>
                )}
                {subrace.description && (
                  <p className="text-sm text-gray-300 mb-3 leading-relaxed">{subrace.description}</p>
                )}

                {/* Subrace ability score increase */}
                {subrace.abilityScoreIncrease && (
                  <div className="mb-2">
                    <span className="text-xs text-gray-500">额外属性提升: </span>
                    <span className="text-sm text-cyan-300">
                      {Object.entries(subrace.abilityScoreIncrease).map(([ability, value]) => (
                        <span key={ability} className="inline-block mr-3">
                          {ability.toUpperCase()}: +{value as number}
                        </span>
                      ))}
                    </span>
                  </div>
                )}

                {/* Subrace traits */}
                {subrace.traits && subrace.traits.length > 0 && (
                  <div className="mt-3 space-y-2">
                    {subrace.traits.map((trait: any, traitIdx: number) => (
                      <div key={traitIdx} className="border-l-2 border-cyan-500 pl-3">
                        <div className="font-medium text-cyan-300 text-sm">{trait.name}</div>
                        {trait.nameEn && <div className="text-xs text-gray-500">{trait.nameEn}</div>}
                        <p className="text-xs text-gray-300 mt-1 leading-relaxed">{trait.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {raceData.traits && (
        <div>
          <h3 className="text-sm font-semibold text-gray-300 mb-3">种族特性</h3>
          <div className="space-y-3">
            {raceData.traits.map((trait: any, idx: number) => (
              <div key={idx} className="border-l-2 border-green-500 pl-3">
                <div className="font-semibold text-green-400">{trait.name}</div>
                {trait.nameEn && <div className="text-xs text-gray-500">{trait.nameEn}</div>}
                <p className="text-sm text-gray-300 mt-1 leading-relaxed">{trait.description}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
