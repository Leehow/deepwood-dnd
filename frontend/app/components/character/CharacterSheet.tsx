import * as Tabs from "@radix-ui/react-tabs";

const mockCharacter = {
  name: "艾尔文",
  race: "人类",
  class: "战士",
  level: 3,
  hp: 30,
  maxHp: 30,
  ac: 16,
  proficiencyBonus: 2,
  abilities: {
    str: 16,
    dex: 14,
    con: 14,
    int: 10,
    wis: 12,
    cha: 8,
  },
  skills: [
    { name: "运动", modifier: 5, proficient: true },
    { name: "察觉", modifier: 3, proficient: true },
    { name: "生存", modifier: 1, proficient: false },
  ],
};

export function CharacterSheet() {
  const getModifier = (score: number) => {
    return Math.floor((score - 10) / 2);
  };

  return (
    <div className="p-4 space-y-4">
      {/* 角色基本信息 */}
      <div className="card">
        <h2 className="text-2xl font-fantasy text-amber-400 mb-2">
          {mockCharacter.name}
        </h2>
        <p className="text-sm text-gray-400">
          {mockCharacter.race} {mockCharacter.class} {mockCharacter.level}级
        </p>
      </div>

      {/* HP 和 AC */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card text-center">
          <div className="text-3xl font-bold text-green-400">
            {mockCharacter.hp}
          </div>
          <div className="text-xs text-gray-400">HP / {mockCharacter.maxHp}</div>
        </div>
        <div className="card text-center">
          <div className="text-3xl font-bold text-blue-400">
            {mockCharacter.ac}
          </div>
          <div className="text-xs text-gray-400">护甲等级</div>
        </div>
      </div>

      {/* 属性值 */}
      <div className="card">
        <h3 className="text-lg font-semibold text-amber-400 mb-3">属性值</h3>
        <div className="grid grid-cols-3 gap-3">
          {Object.entries(mockCharacter.abilities).map(([key, value]) => (
            <div key={key} className="bg-gray-700 rounded p-2 text-center">
              <div className="text-xs text-gray-400 uppercase">{key}</div>
              <div className="text-2xl font-bold">{value}</div>
              <div className="text-sm text-amber-400">
                {getModifier(value) >= 0 ? "+" : ""}
                {getModifier(value)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* 技能 */}
      <div className="card">
        <h3 className="text-lg font-semibold text-amber-400 mb-3">技能</h3>
        <div className="space-y-2">
          {mockCharacter.skills.map((skill) => (
            <div
              key={skill.name}
              className="flex justify-between items-center text-sm"
            >
              <span className={skill.proficient ? "text-amber-300" : "text-gray-400"}>
                {skill.proficient && "⭐ "}
                {skill.name}
              </span>
              <span className="font-mono">
                {skill.modifier >= 0 ? "+" : ""}
                {skill.modifier}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 快捷动作 */}
      <div className="space-y-2">
        <button className="w-full btn-fantasy text-sm">攻击</button>
        <button className="w-full btn-secondary text-sm">施法</button>
        <button className="w-full btn-secondary text-sm">使用物品</button>
      </div>
    </div>
  );
}

