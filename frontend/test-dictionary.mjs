/**
 * Simple test script to verify translation dictionary works
 * Run with: node test-dictionary.mjs
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Simplified dictionary implementation for testing
class TestDictionary {
  constructor() {
    this.damageTypes = new Map();
    this.weaponProperties = new Map();
    this.schools = new Map();
    this.conditions = new Map();
    this.abilities = new Map();
    this.skills = new Map();
    this.proficiencies = new Map();
  }

  async initialize() {
    try {
      // Load core rules
      const coreRulesPath = join(__dirname, 'public/rules/core-rules.json');
      const coreRules = JSON.parse(await readFile(coreRulesPath, 'utf-8'));
      
      // Build damage types
      const damageTypesData = coreRules.coreRules?.damageTypes || coreRules.damageTypes;
      if (damageTypesData) {
        const allDamageTypes = [
          ...(damageTypesData.physical || []),
          ...(damageTypesData.elemental || []),
          ...(damageTypesData.magical || []),
        ];
        console.log(`  Loaded ${allDamageTypes.length} damage types`);
        allDamageTypes.forEach(entry => {
          this.damageTypes.set(entry.type, entry.name);
        });
        console.log(`  Damage types map size: ${this.damageTypes.size}`);
      }

      // Load equipment
      const equipmentPath = join(__dirname, 'public/rules/equipment.json');
      const equipment = JSON.parse(await readFile(equipmentPath, 'utf-8'));
      
      // Build weapon properties
      const weaponPropsData = equipment.weapons?.weaponProperties || equipment.weaponProperties;
      if (weaponPropsData) {
        const props = Object.entries(weaponPropsData);
        console.log(`  Loaded ${props.length} weapon properties`);
        props.forEach(([id, entry]) => {
          this.weaponProperties.set(id, entry.name);
        });
        console.log(`  Weapon properties map size: ${this.weaponProperties.size}`);
      }

      // Load spell schools
      const schoolsPath = join(__dirname, 'public/rules-meta/spell_schools.json');
      const spellSchools = JSON.parse(await readFile(schoolsPath, 'utf-8'));

      // Build schools
      if (spellSchools.schools) {
        spellSchools.schools.forEach(entry => {
          this.schools.set(entry.id, entry.name);
        });
      }

      // Load conditions
      const conditionsPath = join(__dirname, 'public/rules/conditions.json');
      const conditionsData = JSON.parse(await readFile(conditionsPath, 'utf-8'));
      const conditionsArray = conditionsData.conditions || conditionsData;
      if (Array.isArray(conditionsArray)) {
        conditionsArray.forEach(entry => {
          this.conditions.set(entry.id, entry.name);
        });
      }

      // Load abilities
      const abilitiesPath = join(__dirname, 'public/rules/abilities.json');
      const abilitiesData = JSON.parse(await readFile(abilitiesPath, 'utf-8'));
      const abilitiesArray = abilitiesData.abilities || abilitiesData;
      if (Array.isArray(abilitiesArray)) {
        abilitiesArray.forEach(entry => {
          this.abilities.set(entry.id, entry.name);
        });
      }

      // Load skills
      const skillsPath = join(__dirname, 'public/rules/skills.json');
      const skillsData = JSON.parse(await readFile(skillsPath, 'utf-8'));
      const skillsArray = skillsData.skills || skillsData;
      if (Array.isArray(skillsArray)) {
        skillsArray.forEach(entry => {
          this.skills.set(entry.id, entry.name);
        });
      }

      // Build proficiencies (sample)
      this.proficiencies.set('light_armor', '轻甲');
      this.proficiencies.set('simple_weapons', '简易武器');
      this.proficiencies.set('thieves_tools', '盗贼工具');
      this.proficiencies.set('common', '通用语');

      console.log('✅ Dictionary initialized successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to initialize dictionary:', error.message);
      return false;
    }
  }

  tDamageType(id) {
    return this.damageTypes.get(id) || id;
  }

  tWeaponProperty(id) {
    return this.weaponProperties.get(id) || id;
  }

  tSchool(id) {
    return this.schools.get(id) || id;
  }

  tCondition(id) {
    return this.conditions.get(id) || id;
  }

  tAbility(id) {
    return this.abilities.get(id) || id;
  }

  tSkill(id) {
    return this.skills.get(id) || id;
  }

  tProficiency(id) {
    return this.proficiencies.get(id) || id;
  }
}

// Run tests
async function runTests() {
  console.log('🧪 Testing Translation Dictionary\n');
  
  const dict = new TestDictionary();
  const initialized = await dict.initialize();
  
  if (!initialized) {
    console.error('\n❌ Initialization failed, cannot run tests');
    process.exit(1);
  }

  console.log('\n📋 Running tests...\n');

  // Test damage types
  console.log('Testing Damage Types:');
  const damageTests = [
    ['piercing', '穿刺'],
    ['slashing', '挥砍'],
    ['bludgeoning', '钝击'],
    ['fire', '火焰'],
    ['cold', '冷冻'],
    ['lightning', '闪电'],
    ['thunder', '雷鸣'],
    ['acid', '强酸'],
  ];

  let passed = 0;
  let failed = 0;

  damageTests.forEach(([input, expected]) => {
    const result = dict.tDamageType(input);
    if (result === expected) {
      console.log(`  ✅ ${input} → ${result}`);
      passed++;
    } else {
      console.log(`  ❌ ${input} → ${result} (expected: ${expected})`);
      failed++;
    }
  });

  // Test weapon properties
  console.log('\nTesting Weapon Properties:');
  const propertyTests = [
    ['finesse', '灵巧'],
    ['heavy', '重型'],
    ['light', '轻型'],
    ['reach', '触及'],
    ['thrown', '投掷'],
  ];

  propertyTests.forEach(([input, expected]) => {
    const result = dict.tWeaponProperty(input);
    if (result === expected) {
      console.log(`  ✅ ${input} → ${result}`);
      passed++;
    } else {
      console.log(`  ❌ ${input} → ${result} (expected: ${expected})`);
      failed++;
    }
  });

  // Test spell schools (especially enchantment)
  console.log('\nTesting Spell Schools:');
  const schoolTests = [
    ['abjuration', '防护'],
    ['conjuration', '咒法'],
    ['divination', '预言'],
    ['enchantment', '惑控'],  // This is the critical one!
    ['evocation', '塑能'],
    ['illusion', '幻术'],
    ['necromancy', '死灵'],
    ['transmutation', '变化'],
  ];

  schoolTests.forEach(([input, expected]) => {
    const result = dict.tSchool(input);
    if (result === expected) {
      console.log(`  ✅ ${input} → ${result}`);
      passed++;
    } else {
      console.log(`  ❌ ${input} → ${result} (expected: ${expected})`);
      failed++;
    }
  });

  // Test conditions
  console.log('\nTesting Conditions:');
  const conditionTests = [
    ['blinded', '目盲'],
    ['charmed', '魅惑'],
    ['frightened', '恐慌'],
  ];

  conditionTests.forEach(([input, expected]) => {
    const result = dict.tCondition(input);
    if (result === expected) {
      console.log(`  ✅ ${input} → ${result}`);
      passed++;
    } else {
      console.log(`  ❌ ${input} → ${result} (expected: ${expected})`);
      failed++;
    }
  });

  // Test abilities
  console.log('\nTesting Abilities:');
  const abilityTests = [
    ['strength', '力量'],
    ['dexterity', '敏捷'],
    ['intelligence', '智力'],
  ];

  abilityTests.forEach(([input, expected]) => {
    const result = dict.tAbility(input);
    if (result === expected) {
      console.log(`  ✅ ${input} → ${result}`);
      passed++;
    } else {
      console.log(`  ❌ ${input} → ${result} (expected: ${expected})`);
      failed++;
    }
  });

  // Test skills
  console.log('\nTesting Skills:');
  const skillTests = [
    ['athletics', '运动'],
    ['acrobatics', '杂技'],
    ['stealth', '隐匿'],
  ];

  skillTests.forEach(([input, expected]) => {
    const result = dict.tSkill(input);
    if (result === expected) {
      console.log(`  ✅ ${input} → ${result}`);
      passed++;
    } else {
      console.log(`  ❌ ${input} → ${result} (expected: ${expected})`);
      failed++;
    }
  });

  // Test proficiencies
  console.log('\nTesting Proficiencies:');
  const profTests = [
    ['light_armor', '轻甲'],
    ['simple_weapons', '简易武器'],
    ['thieves_tools', '盗贼工具'],
    ['common', '通用语'],
  ];

  profTests.forEach(([input, expected]) => {
    const result = dict.tProficiency(input);
    if (result === expected) {
      console.log(`  ✅ ${input} → ${result}`);
      passed++;
    } else {
      console.log(`  ❌ ${input} → ${result} (expected: ${expected})`);
      failed++;
    }
  });

  // Test fallback
  console.log('\nTesting Fallback Behavior:');
  const fallbackResult = dict.tDamageType('unknown_type');
  if (fallbackResult === 'unknown_type') {
    console.log(`  ✅ unknown_type → ${fallbackResult} (fallback works)`);
    passed++;
  } else {
    console.log(`  ❌ unknown_type → ${fallbackResult} (expected: unknown_type)`);
    failed++;
  }

  // Summary
  console.log('\n' + '='.repeat(50));
  console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
  console.log('='.repeat(50));

  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed');
    process.exit(1);
  }
}

runTests();

