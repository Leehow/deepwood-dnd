import { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as Select from "@radix-ui/react-select";

// Import D&D 5E rules data
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes.json";
import abilitiesData from "~/data/rules/abilities.json";
import { createLogger } from '~/utils/logger';
const logger = createLogger('CharacterCreator');


interface Race {
  id: string;
  name: string;
  nameEn: string;
  description: string;
  abilityScoreIncrease: Record<string, number | undefined>;
  speed: number;
  size: string;
  traits: Array<{
    name: string;
    nameEn: string;
    description: string;
  }>;
  subraces?: Array<{
    id: string;
    name: string;
    nameEn: string;
    description: string;
    abilityScoreIncrease?: Record<string, number | undefined>;
    traits: Array<{
      name: string;
      nameEn: string;
      description: string;
    }>;
  }>;
}

interface Class {
  id: string;
  name: string;
  nameEn: string;
  hitDie: number;
  primaryAbility: string[];
  savingThrows: string[];
  proficiencies: {
    armor: string[];
    weapons: string[];
    tools: string[];
    skillsAvailable: string[];
    skillChoices: number;
  };
}

interface Ability {
  id: string;
  name: string;
  nameEn: string;
  abbreviation: string;
  abbreviationCn: string;
  description: string;
}

interface AbilityScores {
  strength: number;
  dexterity: number;
  constitution: number;
  intelligence: number;
  wisdom: number;
  charisma: number;
}

interface CharacterCreatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCharacterCreated?: (character: any) => void;
}

export function CharacterCreator({ open, onOpenChange, onCharacterCreated }: CharacterCreatorProps) {
  const [characterName, setCharacterName] = useState("");
  const [selectedRace, setSelectedRace] = useState<string>("");
  const [selectedSubrace, setSelectedSubrace] = useState<string>("");
  const [selectedClass, setSelectedClass] = useState<string>("");
  const [selectedBackground, setSelectedBackground] = useState("");
  const [level, setLevel] = useState(1);
  const [description, setDescription] = useState("");

  // Ability scores
  const [abilityScores, setAbilityScores] = useState<AbilityScores>({
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  });

  // Get data
  const races: Race[] = racesData.races;
  const classes: Class[] = classesData.classes;
  const abilities: Ability[] = abilitiesData.abilities;

  // Get selected race and class details
  const currentRace = races.find(r => r.id === selectedRace);
  const currentSubrace = currentRace?.subraces?.find(sr => sr.id === selectedSubrace);
  const currentClass = classes.find(c => c.id === selectedClass);

  // D&D 5E backgrounds - simplified list
  const backgrounds = [
    "贵族", "平民", "学者", "士兵", "罪犯", "工匠", "隐士", "娱乐者"
  ];

  // Calculate ability modifier
  const calculateModifier = (score: number): number => {
    return Math.floor((score - 10) / 2);
  };

  // Reset subrace when race changes
  useEffect(() => {
    setSelectedSubrace("");
  }, [selectedRace]);

  // Handle ability score change
  const handleAbilityChange = (ability: keyof AbilityScores, value: string) => {
    const numValue = parseInt(value) || 10;
    setAbilityScores(prev => ({
      ...prev,
      [ability]: Math.max(3, Math.min(20, numValue))
    }));
  };

  // Handle character creation
  const handleCreate = () => {
    const character = {
      name: characterName,
      race: selectedRace,
      subrace: selectedSubrace,
      class: selectedClass,
      background: selectedBackground,
      level,
      abilityScores,
      description,
      createdAt: new Date().toISOString()
    };

    logger.debug("Creating character:", character);
    onCharacterCreated?.(character);
    onOpenChange(false);

    // Reset form
    resetForm();
  };

  const resetForm = () => {
    setCharacterName("");
    setSelectedRace("");
    setSelectedSubrace("");
    setSelectedClass("");
    setSelectedBackground("");
    setLevel(1);
    setDescription("");
    setAbilityScores({
      strength: 10,
      dexterity: 10,
      constitution: 10,
      intelligence: 10,
      wisdom: 10,
      charisma: 10,
    });
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-40" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-2xl z-50 w-[95vw] max-w-4xl max-h-[90dvh] overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex justify-between items-center sticky top-0 bg-gray-800 pb-4 border-b border-gray-700">
              <Dialog.Title className="text-2xl font-fantasy text-amber-400">
                创建角色卡
              </Dialog.Title>
              <Dialog.Close className="text-gray-400 hover:text-gray-300 text-2xl leading-none">
                ×
              </Dialog.Close>
            </div>

            {/* Two Column Layout */}
            <div className="grid md:grid-cols-2 gap-6">
              {/* Left Column - Basic Info */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-amber-400 border-b border-gray-700 pb-2">
                  基本信息
                </h3>

                {/* Character Name */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">角色名称 *</label>
                  <input
                    type="text"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
                    placeholder="输入角色名称..."
                    value={characterName}
                    onChange={(e) => setCharacterName(e.target.value)}
                  />
                </div>

                {/* Race Selection */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">种族 *</label>
                  <select
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
                    value={selectedRace}
                    onChange={(e) => setSelectedRace(e.target.value)}
                  >
                    <option value="">选择种族...</option>
                    {races.map((race) => (
                      <option key={race.id} value={race.id}>
                        {race.name} ({race.nameEn})
                      </option>
                    ))}
                  </select>

                  {/* Race Description */}
                  {currentRace && (
                    <div className="mt-2 p-3 bg-gray-900 rounded text-xs text-gray-400">
                      <div className="font-medium text-amber-400 mb-1">{currentRace.name}</div>
                      <div>{currentRace.description}</div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div>速度: {currentRace.speed}尺</div>
                        <div>体型: {currentRace.size}</div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Subrace Selection */}
                {currentRace?.subraces && currentRace.subraces.length > 0 && (
                  <div>
                    <label className="text-sm text-gray-400 mb-2 block">亚种 *</label>
                    <select
                      className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
                      value={selectedSubrace}
                      onChange={(e) => setSelectedSubrace(e.target.value)}
                    >
                      <option value="">选择亚种...</option>
                      {currentRace.subraces.map((subrace) => (
                        <option key={subrace.id} value={subrace.id}>
                          {subrace.name} ({subrace.nameEn})
                        </option>
                      ))}
                    </select>

                    {currentSubrace && (
                      <div className="mt-2 p-3 bg-gray-900 rounded text-xs text-gray-400">
                        {currentSubrace.description}
                      </div>
                    )}
                  </div>
                )}

                {/* Class Selection */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">职业 *</label>
                  <select
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
                    value={selectedClass}
                    onChange={(e) => setSelectedClass(e.target.value)}
                  >
                    <option value="">选择职业...</option>
                    {classes.map((cls) => (
                      <option key={cls.id} value={cls.id}>
                        {cls.name} ({cls.nameEn})
                      </option>
                    ))}
                  </select>

                  {/* Class Details */}
                  {currentClass && (
                    <div className="mt-2 p-3 bg-gray-900 rounded text-xs text-gray-400 space-y-1">
                      <div className="font-medium text-amber-400">{currentClass.name}</div>
                      <div>生命骰: {currentClass.hitDie}</div>
                      <div>主要属性: {currentClass.primaryAbility.map(a =>
                        abilities.find(ab => ab.id === a)?.name
                      ).join(", ")}</div>
                      <div>豁免熟练: {currentClass.savingThrows.map(s =>
                        abilities.find(ab => ab.id === s)?.name
                      ).join(", ")}</div>
                    </div>
                  )}
                </div>

                {/* Background */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">背景</label>
                  <select
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
                    value={selectedBackground}
                    onChange={(e) => setSelectedBackground(e.target.value)}
                  >
                    <option value="">选择背景...</option>
                    {backgrounds.map((bg) => (
                      <option key={bg} value={bg}>
                        {bg}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Level */}
                <div>
                  <label className="text-sm text-gray-400 mb-2 block">等级</label>
                  <input
                    type="number"
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
                    value={level}
                    onChange={(e) => setLevel(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    min="1"
                    max="20"
                  />
                </div>
              </div>

              {/* Right Column - Ability Scores */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-amber-400 border-b border-gray-700 pb-2">
                  属性值
                </h3>

                <div className="space-y-3">
                  {abilities.map((ability) => {
                    const abilityKey = ability.id as keyof AbilityScores;
                    const baseScore = abilityScores[abilityKey];
                    const raceBonus = currentRace?.abilityScoreIncrease?.[abilityKey] || 0;
                    const subraceBonus = currentSubrace?.abilityScoreIncrease?.[abilityKey] || 0;
                    const totalScore = baseScore + raceBonus + subraceBonus;
                    const modifier = calculateModifier(totalScore);

                    return (
                      <div key={ability.id} className="bg-gray-900 rounded p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <div className="font-medium text-gray-300">
                              {ability.name} ({ability.abbreviationCn})
                            </div>
                            <div className="text-xs text-gray-500">
                              {ability.nameEn}
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <input
                              type="number"
                              className="w-16 px-2 py-1 bg-gray-800 border border-gray-700 rounded text-center text-gray-300 focus:border-amber-400 focus:outline-none"
                              value={baseScore}
                              onChange={(e) => handleAbilityChange(abilityKey, e.target.value)}
                              min="3"
                              max="20"
                            />
                            {(raceBonus > 0 || subraceBonus > 0) && (
                              <span className="text-green-400 text-sm">
                                +{raceBonus + subraceBonus}
                              </span>
                            )}
                            <div className="flex flex-col items-center min-w-[60px]">
                              <div className="text-lg font-bold text-amber-400">
                                {totalScore}
                              </div>
                              <div className="text-xs text-gray-400">
                                ({modifier >= 0 ? "+" : ""}{modifier})
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="text-xs text-gray-500">
                          {ability.description}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Character Description */}
                <div className="pt-4">
                  <label className="text-sm text-gray-400 mb-2 block">角色描述</label>
                  <textarea
                    className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none resize-none"
                    placeholder="描述你的角色外观、性格、背景故事等..."
                    rows={4}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3 pt-4 border-t border-gray-700">
              <button
                className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                onClick={handleCreate}
                disabled={!characterName || !selectedRace || !selectedClass || (currentRace?.subraces && !selectedSubrace)}
              >
                创建角色
              </button>
              <button
                className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded font-medium transition-colors"
                onClick={() => onOpenChange(false)}
              >
                取消
              </button>
            </div>

            {/* Validation hint */}
            {(!characterName || !selectedRace || !selectedClass || (currentRace?.subraces && !selectedSubrace)) && (
              <div className="text-xs text-yellow-400 text-center">
                * 请填写必填项（角色名称、种族、{currentRace?.subraces && "亚种、"}职业）
              </div>
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
