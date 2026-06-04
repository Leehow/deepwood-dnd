// Monster detail rendering for Rules Panel

// Monster type colors
const MONSTER_TYPE_COLORS: Record<string, string> = {
  '异怪': 'text-purple-400',
  '野兽': 'text-green-400',
  '天界生物': 'text-yellow-300',
  '构装生物': 'text-gray-400',
  '龙类': 'text-red-400',
  '元素生物': 'text-cyan-400',
  '精类': 'text-emerald-400',
  '邪魔': 'text-rose-500',
  '巨人': 'text-orange-400',
  '人形生物': 'text-blue-400',
  '怪兽': 'text-amber-500',
  '泥怪': 'text-lime-400',
  '植物': 'text-green-500',
  '不死生物': 'text-gray-300',
};

function getMonsterTypeColor(type: string): string {
  const baseType = type?.split(/[（(]/)[0]?.trim() || type;
  return MONSTER_TYPE_COLORS[baseType] || 'text-gray-400';
}

// CR color (by danger level)
function getCRDisplayColor(cr: string | number): string {
  const crStr = String(cr);
  const crNum = crStr === '0' ? 0 : crStr.includes('/') ? eval(crStr) : parseFloat(crStr);
  if (crNum <= 1) return 'text-green-400';
  if (crNum <= 4) return 'text-yellow-400';
  if (crNum <= 10) return 'text-orange-400';
  if (crNum <= 17) return 'text-red-400';
  return 'text-purple-400';
}

// Render monster details
export function renderMonsterDetail(monster: any): React.ReactNode {
  const typeColor = getMonsterTypeColor(monster.type);
  const crColor = getCRDisplayColor(monster.cr);

  return (
    <div className="space-y-6">
      {/* Basic Info Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-gray-500">{monster.size} {monster.type}</div>
          <div className="text-xs text-gray-600">{monster.alignment}</div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${crColor}`}>CR {monster.cr}</div>
          <div className="text-xs text-gray-500">{monster.xp?.toLocaleString()} XP</div>
        </div>
      </div>

      {/* Core Stats */}
      <div className="grid grid-cols-3 gap-4 bg-gray-800/50 p-4 rounded-lg">
        <div className="text-center">
          <div className="text-xs text-gray-500">护甲等级</div>
          <div className="text-xl font-bold text-blue-400">{typeof monster.ac === 'object' ? (monster.ac?.value || monster.ac?.base || '') : monster.ac}</div>
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">生命值</div>
          <div className="text-xl font-bold text-red-400">{typeof monster.hp === 'object' ? (monster.hp?.average || monster.hp?.dice || '') : monster.hp}</div>
          {monster.hpFormula && (
            <div className="text-xs text-gray-600">({monster.hpFormula})</div>
          )}
        </div>
        <div className="text-center">
          <div className="text-xs text-gray-500">速度</div>
          <div className="text-sm text-gray-300">
            {monster.speed?.walk && `${monster.speed.walk}尺`}
            {monster.speed?.fly && ` | 飞行${monster.speed.fly}尺`}
            {monster.speed?.swim && ` | 游泳${monster.speed.swim}尺`}
            {monster.speed?.burrow && ` | 掘地${monster.speed.burrow}尺`}
            {monster.speed?.climb && ` | 攀爬${monster.speed.climb}尺`}
          </div>
        </div>
      </div>

      {/* Ability Scores */}
      <div>
        <h3 className="text-sm font-semibold text-gray-400 mb-2">属性值</h3>
        <div className="grid grid-cols-6 gap-2 text-center">
          {[
            { key: 'str', name: '力量', color: 'text-red-400' },
            { key: 'dex', name: '敏捷', color: 'text-green-400' },
            { key: 'con', name: '体质', color: 'text-orange-400' },
            { key: 'int', name: '智力', color: 'text-blue-400' },
            { key: 'wis', name: '感知', color: 'text-cyan-400' },
            { key: 'cha', name: '魅力', color: 'text-pink-400' },
          ].map(({ key, name, color }) => {
            const score = monster[key] || monster.abilityScores?.[key];
            const mod = monster[`${key}Mod`] || monster.abilityScores?.[`${key}Mod`];
            return (
              <div key={key} className="bg-gray-800/50 p-2 rounded">
                <div className="text-xs text-gray-500">{name}</div>
                <div className={`text-lg font-bold ${color}`}>{score || '-'}</div>
                <div className="text-xs text-gray-400">
                  {mod !== undefined ? (mod >= 0 ? `+${mod}` : mod) : '-'}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Description */}
      {monster.description && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2">描述</h3>
          <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
            {monster.description}
          </p>
        </div>
      )}

      {/* Special Abilities */}
      {monster.specialAbilities && monster.specialAbilities.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-amber-400 mb-2">特殊能力</h3>
          <div className="space-y-3">
            {monster.specialAbilities.map((ability: any, idx: number) => (
              <div key={idx} className="bg-amber-900/20 p-3 rounded border border-amber-700/50">
                <div className="font-medium text-amber-300 mb-1">{ability.name}</div>
                <div className="text-sm text-gray-300">{ability.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      {monster.actions && monster.actions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-red-400 mb-2">动作</h3>
          <div className="space-y-3">
            {monster.actions.map((action: any, idx: number) => (
              <div key={idx} className="bg-red-900/20 p-3 rounded border border-red-700/50">
                <div className="font-medium text-red-300 mb-1">{action.name}</div>
                <div className="text-sm text-gray-300">{action.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Legendary Actions */}
      {monster.legendaryActions && monster.legendaryActions.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-purple-400 mb-2">传奇动作</h3>
          <div className="space-y-3">
            {monster.legendaryActions.map((action: any, idx: number) => (
              <div key={idx} className="bg-purple-900/20 p-3 rounded border border-purple-700/50">
                <div className="font-medium text-purple-300 mb-1">{action.name}</div>
                <div className="text-sm text-gray-300">{action.description}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Appearance */}
      {monster.appearance && (
        <div>
          <h3 className="text-sm font-semibold text-gray-400 mb-2">外观</h3>
          <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-wrap">
            {monster.appearance}
          </p>
        </div>
      )}

      {/* Languages & Senses */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        {monster.languages && monster.languages.length > 0 && (
          <div>
            <span className="text-gray-500">语言: </span>
            <span className="text-gray-300">{monster.languages.join(', ')}</span>
          </div>
        )}
        {monster.senses && Object.keys(monster.senses).length > 0 && (
          <div>
            <span className="text-gray-500">感官: </span>
            <span className="text-gray-300">
              {Object.entries(monster.senses).map(([k, v]) => `${k} ${v}`).join(', ')}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
