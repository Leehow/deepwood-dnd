/**
 * Translation Layer Test Page
 * Tests the unified translation dictionary
 */

import { useEffect, useState } from 'react';
import { tDamageType, tWeaponProperty, tSchool, tCondition, tAbility, tSkill, tProficiency } from '~/utils/i18n';

export default function TestTranslation() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Give dictionary time to initialize
    setTimeout(() => setReady(true), 1000);
  }, []);

  if (!ready) {
    return <div className="p-8">加载翻译字典中...</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <h1 className="text-3xl font-bold mb-8">翻译层测试页面</h1>

      <div className="space-y-8">
        {/* Damage Types */}
        <section className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-semibold mb-4 text-amber-400">伤害类型 (Damage Types)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-gray-400">piercing:</span> <span className="text-green-400">{tDamageType('piercing')}</span></div>
            <div><span className="text-gray-400">slashing:</span> <span className="text-green-400">{tDamageType('slashing')}</span></div>
            <div><span className="text-gray-400">bludgeoning:</span> <span className="text-green-400">{tDamageType('bludgeoning')}</span></div>
            <div><span className="text-gray-400">fire:</span> <span className="text-green-400">{tDamageType('fire')}</span></div>
            <div><span className="text-gray-400">cold:</span> <span className="text-green-400">{tDamageType('cold')}</span></div>
            <div><span className="text-gray-400">lightning:</span> <span className="text-green-400">{tDamageType('lightning')}</span></div>
            <div><span className="text-gray-400">thunder:</span> <span className="text-green-400">{tDamageType('thunder')}</span></div>
            <div><span className="text-gray-400">acid:</span> <span className="text-green-400">{tDamageType('acid')}</span></div>
          </div>
        </section>

        {/* Weapon Properties */}
        <section className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-semibold mb-4 text-amber-400">武器属性 (Weapon Properties)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-gray-400">finesse:</span> <span className="text-green-400">{tWeaponProperty('finesse')}</span></div>
            <div><span className="text-gray-400">heavy:</span> <span className="text-green-400">{tWeaponProperty('heavy')}</span></div>
            <div><span className="text-gray-400">light:</span> <span className="text-green-400">{tWeaponProperty('light')}</span></div>
            <div><span className="text-gray-400">reach:</span> <span className="text-green-400">{tWeaponProperty('reach')}</span></div>
            <div><span className="text-gray-400">thrown:</span> <span className="text-green-400">{tWeaponProperty('thrown')}</span></div>
            <div><span className="text-gray-400">versatile:</span> <span className="text-green-400">{tWeaponProperty('versatile')}</span></div>
          </div>
        </section>

        {/* Spell Schools */}
        <section className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-semibold mb-4 text-amber-400">法术学派 (Spell Schools)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-gray-400">abjuration:</span> <span className="text-green-400">{tSchool('abjuration')}</span></div>
            <div><span className="text-gray-400">conjuration:</span> <span className="text-green-400">{tSchool('conjuration')}</span></div>
            <div><span className="text-gray-400">divination:</span> <span className="text-green-400">{tSchool('divination')}</span></div>
            <div><span className="text-gray-400">enchantment:</span> <span className="text-red-400 font-bold">{tSchool('enchantment')}</span> <span className="text-xs text-gray-500">(应该是"惑控")</span></div>
            <div><span className="text-gray-400">evocation:</span> <span className="text-green-400">{tSchool('evocation')}</span></div>
            <div><span className="text-gray-400">illusion:</span> <span className="text-green-400">{tSchool('illusion')}</span></div>
            <div><span className="text-gray-400">necromancy:</span> <span className="text-green-400">{tSchool('necromancy')}</span></div>
            <div><span className="text-gray-400">transmutation:</span> <span className="text-green-400">{tSchool('transmutation')}</span></div>
          </div>
        </section>

        {/* Conditions */}
        <section className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-semibold mb-4 text-amber-400">条件状态 (Conditions)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-gray-400">blinded:</span> <span className="text-green-400">{tCondition('blinded')}</span></div>
            <div><span className="text-gray-400">charmed:</span> <span className="text-green-400">{tCondition('charmed')}</span></div>
            <div><span className="text-gray-400">frightened:</span> <span className="text-green-400">{tCondition('frightened')}</span></div>
            <div><span className="text-gray-400">poisoned:</span> <span className="text-green-400">{tCondition('poisoned')}</span></div>
          </div>
        </section>

        {/* Abilities */}
        <section className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-semibold mb-4 text-amber-400">属性 (Abilities)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-gray-400">strength:</span> <span className="text-green-400">{tAbility('strength')}</span></div>
            <div><span className="text-gray-400">dexterity:</span> <span className="text-green-400">{tAbility('dexterity')}</span></div>
            <div><span className="text-gray-400">constitution:</span> <span className="text-green-400">{tAbility('constitution')}</span></div>
            <div><span className="text-gray-400">intelligence:</span> <span className="text-green-400">{tAbility('intelligence')}</span></div>
            <div><span className="text-gray-400">wisdom:</span> <span className="text-green-400">{tAbility('wisdom')}</span></div>
            <div><span className="text-gray-400">charisma:</span> <span className="text-green-400">{tAbility('charisma')}</span></div>
          </div>
        </section>

        {/* Skills */}
        <section className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-semibold mb-4 text-amber-400">技能 (Skills)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-gray-400">athletics:</span> <span className="text-green-400">{tSkill('athletics')}</span></div>
            <div><span className="text-gray-400">acrobatics:</span> <span className="text-green-400">{tSkill('acrobatics')}</span></div>
            <div><span className="text-gray-400">stealth:</span> <span className="text-green-400">{tSkill('stealth')}</span></div>
            <div><span className="text-gray-400">perception:</span> <span className="text-green-400">{tSkill('perception')}</span></div>
          </div>
        </section>

        {/* Proficiencies */}
        <section className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-semibold mb-4 text-amber-400">熟练项 (Proficiencies)</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-gray-400">light_armor:</span> <span className="text-green-400">{tProficiency('light_armor')}</span></div>
            <div><span className="text-gray-400">medium_armor:</span> <span className="text-green-400">{tProficiency('medium_armor')}</span></div>
            <div><span className="text-gray-400">simple_weapons:</span> <span className="text-green-400">{tProficiency('simple_weapons')}</span></div>
            <div><span className="text-gray-400">martial_weapons:</span> <span className="text-green-400">{tProficiency('martial_weapons')}</span></div>
            <div><span className="text-gray-400">thieves_tools:</span> <span className="text-green-400">{tProficiency('thieves_tools')}</span></div>
            <div><span className="text-gray-400">common:</span> <span className="text-green-400">{tProficiency('common')}</span></div>
          </div>
        </section>

        {/* Fallback Test */}
        <section className="bg-gray-800 p-6 rounded-lg">
          <h2 className="text-2xl font-semibold mb-4 text-amber-400">Fallback 测试</h2>
          <div className="grid grid-cols-2 gap-4">
            <div><span className="text-gray-400">unknown_type:</span> <span className="text-yellow-400">{tDamageType('unknown_type')}</span> <span className="text-xs text-gray-500">(应该回退为原值)</span></div>
          </div>
        </section>
      </div>

      <div className="mt-8 p-4 bg-green-900/30 border border-green-700 rounded-lg">
        <h3 className="text-lg font-semibold text-green-400 mb-2">✅ 测试说明</h3>
        <ul className="list-disc list-inside text-sm text-gray-300 space-y-1">
          <li>所有绿色文本应该显示为中文</li>
          <li>"enchantment" 应该显示为 "惑控"（红色高亮）</li>
          <li>"unknown_type" 应该回退为原值（黄色）</li>
          <li>如果看到英文，说明翻译层有问题</li>
        </ul>
      </div>
    </div>
  );
}

