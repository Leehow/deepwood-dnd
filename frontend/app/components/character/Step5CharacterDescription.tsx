import { useState, useRef, useEffect, useMemo } from "react";
import { TextArea } from "@radix-ui/themes";
import { CharacterState } from "./types";
import { ALIGNMENTS, GENDERS } from "./utils";
import backgroundsData from "~/data/rules/backgrounds.json";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import equipmentData from "~/data/rules/equipment.json";
import { getDeityAlignment, shouldHaveDeity, canHaveDeity } from "~/utils/deity-domain-mapping";
import { DeitySelector } from "./DeitySelector";
import godsData from "~/data/rules/gods.json";
import { apiFetch } from "~/utils/api-client";
import { getCurrentUserId } from "~/utils/user";
import { getAuthUser } from "~/utils/auth";
import { createLogger } from '~/utils/logger';
const logger = createLogger('Step5CharacterDescription');

// 预设描述数据，用于 admin 快速跳过 AI 生成
const PRESET_DESCRIPTION = {
  name: "测试战士", age: 25, gender: "男性", alignment: "lawful_neutral",
  deityId: "", backgroundId: "soldier",
  appearance: { height: "180cm", weight: "85kg", eyes: "棕色", skin: "古铜色", hair: "黑色短发", distinguishingMarks: "左脸一道刀疤" },
  personality: { traits: ["我从不拒绝一场挑战"] as string[], ideals: "荣耀", bonds: "我的战友就是我的家人", flaws: "太过自信" },
  otherTraits: "", backstory: "曾是佣兵团的队长",
};


interface Step5CharacterDescriptionProps {
  character: CharacterState;
  setCharacter: React.Dispatch<React.SetStateAction<CharacterState>>;
  enableDeitySystem?: boolean;
  allowedDeityIds?: Set<string> | null;
  allowedBackgroundIds?: Set<string> | null;
}

function Step5CharacterDescription({ character, setCharacter, enableDeitySystem = true, allowedDeityIds = null, allowedBackgroundIds = null }: Step5CharacterDescriptionProps) {
  const [generating, setGenerating] = useState(false);
  const [generatingAppearance, setGeneratingAppearance] = useState(false);
  const [generatingPersonality, setGeneratingPersonality] = useState(false);
  const [generatingBackstory, setGeneratingBackstory] = useState(false);
  const [generateError, setGenerateError] = useState<string>("");
  const backstoryTextareaRef = useRef<HTMLTextAreaElement>(null);
  const userId = getCurrentUserId();

  // Campaign-scoped filtering for backgrounds
  const backgrounds = useMemo(() => {
    const all = backgroundsData.backgrounds as any[];
    if (!allowedBackgroundIds) return all;
    return all.filter((b: any) => allowedBackgroundIds.has(b.id));
  }, [allowedBackgroundIds]);

  // Auto-resize textarea based on content
  useEffect(() => {
    const textarea = backstoryTextareaRef.current;
    if (textarea) {
      // Reset height to auto to get the correct scrollHeight
      textarea.style.height = 'auto';
      // Set height to scrollHeight to fit content
      textarea.style.height = `${Math.max(120, textarea.scrollHeight)}px`;
    }
  }, [character.backstory]);

  // Find equipment by ID in the equipment data
  const findEquipmentById = (id: string): any => {
    // Search in armor (including shields)
    const armor = equipmentData.armor;
    for (const category of ["light", "medium", "heavy", "shield"]) {
      const found = armor[category as keyof typeof armor]?.find((item: any) => item.id === id);
      if (found) return { ...found, equipmentType: "armor" };
    }

    // Search in weapons
    const weapons = equipmentData.weapons;
    for (const proficiency of ["simple", "martial"]) {
      const prof = weapons[proficiency as keyof typeof weapons] as any;
      for (const type of ["melee", "ranged"]) {
        const found = prof[type as "melee" | "ranged"]?.find((item: any) => item.id === id);
        if (found) return { ...found, equipmentType: "weapon" };
      }
    }

    // Search in packs
    if (equipmentData.packs) {
      const found = equipmentData.packs.find((item: any) => item.id === id);
      if (found) return { ...found, equipmentType: "pack" };
    }

    // Search in adventuring gear (including spellcasting focus, tools, etc.)
    const gear = equipmentData.adventuringGear;
    for (const category of Object.keys(gear)) {
      const found = gear[category as keyof typeof gear]?.find((item: any) => item.id === id);
      if (found) return { ...found, equipmentType: "gear" };
    }

    // Search in tools (artisan tools, gaming sets, musical instruments, specialized tools)
    const tools = (equipmentData as any).tools;
    if (tools) {
      for (const category of Object.keys(tools)) {
        const found = tools[category]?.find((item: any) => item.id === id);
        if (found) return { ...found, equipmentType: "tool" };
      }
    }

    // Search in background-specific items (pouches with gold, insignia, etc.)
    const bgItems = (equipmentData as any).backgroundItems;
    if (bgItems) {
      const found = bgItems.find((item: any) => item.id === id);
      if (found) return { ...found, equipmentType: "gear" };
    }

    return null;
  };

  // Map deity name (English) to deity ID
  const findDeityIdByName = (deityName: string): string | null => {
    if (!deityName) return null;

    const normalizedName = deityName.toLowerCase().trim();

    // Search through all pantheons
    for (const pantheon of (godsData as any).pantheons) {
      const deity = pantheon.deities?.find((d: any) =>
        d.nameEn.toLowerCase() === normalizedName ||
        d.name.toLowerCase() === normalizedName ||
        d.id === normalizedName
      );
      if (deity) {
        logger.debug(`✅ Found deity: ${deityName} -> ${deity.id}`);
        return deity.id;
      }
    }

    logger.warn(`⚠️ Could not find deity: "${deityName}"`);
    return null;
  };

  // Get character context for AI generation
  const getCharacterContext = () => {
    const race = racesData.races.find(r => r.id === character.raceId);
    const subrace = race?.subraces?.find(sr => sr.id === character.subraceId);
    const characterClass = classesData.classes.find(c => c.id === character.classId);
    const alignment = ALIGNMENTS.find(a => a.id === character.alignment);
    const background = backgroundsData.backgrounds.find((b: any) => b.id === character.backgroundId);

    return {
      race: race?.name || "未知",
      subrace: subrace?.name,
      class: characterClass?.name || "未知",
      alignment: alignment?.name || "未知",
      background: background?.name || null, // Background is optional
      name: character.name || "未命名",
      age: character.age || 25,
      gender: character.gender || "未知"
    };
  };

  // Generate full character description
  const handleGenerateFullDescription = async () => {
    setGenerating(true);
    setGenerateError("");

    try {
      const context = getCharacterContext();

      const response = await apiFetch("/api/ai-settings/generate-full-description", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          race: context.race,
          subrace: context.subrace || null,
          character_class: context.class,
          background: context.background
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "AI 生成失败");
      }

      const data = await response.json();

      // Map deity name to deity ID (for all classes except Warlock)
      let deityId = character.deityId || "";
      let alignmentId = character.alignment;

      if (data.deity && canHaveDeity(character.classId)) {
        const foundDeityId = findDeityIdByName(data.deity);
        if (foundDeityId) {
          deityId = foundDeityId;
          // Use deity's alignment
          const deityAlignment = getDeityAlignment(foundDeityId);
          if (deityAlignment) {
            alignmentId = deityAlignment;
            logger.debug(`✅ Using AI-generated deity: ${data.deity} (${foundDeityId}) with alignment: ${deityAlignment}`);
          }
        }
      } else if (character.deityId && canHaveDeity(character.classId)) {
        // If character already has a deity, use deity's alignment
        const deityAlignment = getDeityAlignment(character.deityId);
        if (deityAlignment) {
          alignmentId = deityAlignment;
          logger.debug(`✅ Using existing deity alignment: ${deityAlignment} for deity ${character.deityId}`);
        }
      } else if (data.alignment) {
        // Otherwise use AI-generated alignment
        const foundAlignment = ALIGNMENTS.find(a => a.name === data.alignment);
        if (foundAlignment) alignmentId = foundAlignment.id;
      }

      // Map background name to ID with fuzzy matching
      let backgroundId = character.backgroundId;
      if (data.background && backgroundsData?.backgrounds) {
        const bgText = data.background.toLowerCase().trim();

        // Try exact match first
        let foundBackground = backgroundsData.backgrounds.find((b: any) =>
          b.name === data.background ||
          b.nameEn.toLowerCase() === bgText ||
          b.name.toLowerCase() === bgText
        );

        // If no exact match, try partial match (contains)
        if (!foundBackground) {
          foundBackground = backgroundsData.backgrounds.find((b: any) =>
            bgText.includes(b.name.toLowerCase()) ||
            b.name.toLowerCase().includes(bgText) ||
            bgText.includes(b.nameEn.toLowerCase()) ||
            b.nameEn.toLowerCase().includes(bgText)
          );
        }

        if (foundBackground) {
          backgroundId = foundBackground.id;
          logger.debug(`✅ Matched background: "${data.background}" -> ${foundBackground.name} (${foundBackground.id})`);
        } else {
          logger.warn(`⚠️ Could not match background: "${data.background}". Available backgrounds:`,
            backgroundsData.backgrounds.map((b: any) => `${b.name} (${b.nameEn})`));
        }
      }

      setCharacter(prev => ({
        ...prev,
        name: data.name || prev.name,
        age: data.age || prev.age,
        gender: data.gender || prev.gender,
        alignment: alignmentId,
        backgroundId: backgroundId,
        deityId: deityId,
        appearance: {
          height: String(data.height || prev.appearance.height),
          weight: String(data.weight || prev.appearance.weight),
          eyes: data.eyes || prev.appearance.eyes,
          skin: data.skin || prev.appearance.skin,
          hair: data.hair || prev.appearance.hair,
          distinguishingMarks: data.distinguishingMarks || prev.appearance.distinguishingMarks
        },
        personality: {
          traits: Array.isArray(data.traits) ? data.traits : (data.traits ? [data.traits] : prev.personality.traits),
          ideals: data.ideals || prev.personality.ideals,
          bonds: data.bonds || prev.personality.bonds,
          flaws: data.flaws || prev.personality.flaws
        },
        otherTraits: data.otherTraits || prev.otherTraits
        // Note: backstory is NOT generated here anymore
      }));

      // After other fields are generated, automatically generate backstory with streaming
      setTimeout(() => {
        handleGenerateBackstory();
      }, 500); // Small delay to let UI update

    } catch (error) {
      logger.error("AI generation error:", error);
      setGenerateError(error instanceof Error ? error.message : "生成失败，请重试");
    } finally {
      setGenerating(false);
    }
  };

  // Generate appearance only
  const handleGenerateAppearance = async () => {
    setGeneratingAppearance(true);
    setGenerateError("");

    try {
      const context = getCharacterContext();

      const response = await apiFetch("/api/ai-settings/generate-appearance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          race: context.race,
          subrace: context.subrace || null,
          character_class: context.class,
          background: context.background,
          gender: character.gender || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "AI 生成失败");
      }

      const data = await response.json();

      setCharacter(prev => ({
        ...prev,
        age: data.age || prev.age,
        gender: data.gender || prev.gender,
        appearance: {
          height: String(data.height || prev.appearance.height),
          weight: String(data.weight || prev.appearance.weight),
          eyes: data.eyes || prev.appearance.eyes,
          skin: data.skin || prev.appearance.skin,
          hair: data.hair || prev.appearance.hair,
          distinguishingMarks: data.distinguishingMarks || prev.appearance.distinguishingMarks
        }
      }));

    } catch (error) {
      logger.error("AI generation error:", error);
      setGenerateError(error instanceof Error ? error.message : "生成失败，请重试");
    } finally {
      setGeneratingAppearance(false);
    }
  };

  // Generate personality only
  const handleGeneratePersonality = async () => {
    setGeneratingPersonality(true);
    setGenerateError("");

    try {
      const context = getCharacterContext();

      const response = await apiFetch("/api/ai-settings/generate-personality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          race: context.race,
          subrace: context.subrace || null,
          character_class: context.class,
          background: context.background,
          alignment: context.alignment
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "AI 生成失败");
      }

      const data = await response.json();

      setCharacter(prev => ({
        ...prev,
        personality: {
          traits: Array.isArray(data.traits) ? data.traits : (data.traits ? [data.traits] : prev.personality.traits),
          ideals: data.ideals || prev.personality.ideals,
          bonds: data.bonds || prev.personality.bonds,
          flaws: data.flaws || prev.personality.flaws
        },
        otherTraits: data.otherTraits || prev.otherTraits,
        backstory: data.backstory || prev.backstory
      }));

    } catch (error) {
      logger.error("AI generation error:", error);
      setGenerateError(error instanceof Error ? error.message : "生成失败，请重试");
    } finally {
      setGeneratingPersonality(false);
    }
  };

  // Generate backstory with streaming (using Advanced Language Model)
  const handleGenerateBackstory = async () => {
    setGeneratingBackstory(true);
    setGenerateError("");

    try {
      const context = getCharacterContext();

      const response = await apiFetch("/api/ai-settings/generate-backstory-stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_id: userId,
          race: context.race,
          subrace: context.subrace || null,
          character_class: context.class,
          background: context.background,
          name: character.name || null,
          age: character.age || null,
          gender: character.gender || null,
          alignment: context.alignment,
          personality_traits: character.personality.traits.length > 0 ? character.personality.traits : null,
          ideals: character.personality.ideals || null,
          bonds: character.personality.bonds || null,
          flaws: character.personality.flaws || null
        })
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.detail || "AI 生成失败");
      }

      // Clear existing backstory before streaming
      setCharacter(prev => ({ ...prev, backstory: "" }));

      // Read the stream
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();

      if (!reader) {
        throw new Error("无法读取响应流");
      }

      let streamComplete = false;
      while (!streamComplete) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split("\n");

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);
              if (data.done) {
                streamComplete = true;
                break;
              }
              if (data.content) {
                setCharacter(prev => ({
                  ...prev,
                  backstory: prev.backstory + data.content
                }));
              }
            } catch (e) {
              // Skip malformed JSON
            }
          }
        }
      }

    } catch (error) {
      setGenerateError(error instanceof Error ? error.message : "生成失败，请重试");
    } finally {
      setGeneratingBackstory(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-amber-400 mb-2">描述你的角色</h2>
        <p className="text-gray-400 text-sm">
          添加角色的基本信息和个性特征
        </p>
      </div>

      {/* AI Generation Buttons - Moved to top */}
      <div className="border-b border-gray-700 pb-4">
        <div className="flex gap-3 justify-center pt-2 flex-wrap">
          {/* Admin Preset Button */}
          {getAuthUser()?.role === "admin" && (
            <button
              className="px-6 py-3 bg-red-900/50 hover:bg-red-800/50 text-red-300 border border-red-700/50 rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
              onClick={() => {
                setCharacter(prev => ({
                  ...prev,
                  name: PRESET_DESCRIPTION.name,
                  age: PRESET_DESCRIPTION.age,
                  gender: PRESET_DESCRIPTION.gender,
                  alignment: PRESET_DESCRIPTION.alignment,
                  deityId: PRESET_DESCRIPTION.deityId,
                  backgroundId: PRESET_DESCRIPTION.backgroundId,
                  appearance: { ...PRESET_DESCRIPTION.appearance },
                  personality: { ...PRESET_DESCRIPTION.personality },
                  otherTraits: PRESET_DESCRIPTION.otherTraits,
                  backstory: PRESET_DESCRIPTION.backstory,
                }));
              }}
            >
              <span>DEV 预设参数</span>
            </button>
          )}
          {/* Generate Full Description */}
          <button
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={handleGenerateFullDescription}
            disabled={generating || !character.raceId || !character.classId}
            title={!character.raceId || !character.classId ? "请先在前面步骤选择种族和职业" : "使用 AI 生成全部描述（包括姓名、年龄、性别、外貌、个性）"}
          >
            {generating ? (
              <>
                <span className="animate-spin">⚙️</span>
                <span>生成中...</span>
              </>
            ) : (
              <>
                <span>🎲</span>
                <span>AI 生成全部描述</span>
              </>
            )}
          </button>

          {/* Generate Appearance */}
          <button
            className="px-6 py-3 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={handleGenerateAppearance}
            disabled={generatingAppearance || !character.raceId || !character.classId}
            title={!character.raceId || !character.classId ? "请先在前面步骤选择种族和职业" : "使用 AI 生成外貌（年龄、性别、身高、体重、外貌特征）"}
          >
            {generatingAppearance ? (
              <>
                <span className="animate-spin">⚙️</span>
                <span>生成中...</span>
              </>
            ) : (
              <>
                <span>👤</span>
                <span>AI 生成外貌</span>
              </>
            )}
          </button>

          {/* Generate Personality */}
          <button
            className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            onClick={handleGeneratePersonality}
            disabled={generatingPersonality || !character.raceId || !character.classId}
            title={!character.raceId || !character.classId ? "请先在前面步骤选择种族和职业" : "使用 AI 生成个性特征（性格、理想、羁绊、缺陷）"}
          >
            {generatingPersonality ? (
              <>
                <span className="animate-spin">⚙️</span>
                <span>生成中...</span>
              </>
            ) : (
              <>
                <span>✨</span>
                <span>AI 生成个性特征</span>
              </>
            )}
          </button>
        </div>

        {/* Warning Message */}
        <div className="flex items-center justify-center gap-2 mt-3 text-amber-400 text-xs">
          <span>⚠️</span>
          <span>注意：AI 生成的新数据将替换当前已填写的内容</span>
        </div>
      </div>

      {/* Generation Error */}
      {generateError && (
        <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-3 flex items-start gap-2">
          <span className="text-red-400 text-lg">⚠️</span>
          <div className="text-sm text-red-400">{generateError}</div>
        </div>
      )}

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
              value={character.name}
              onChange={(e) => setCharacter(prev => ({ ...prev, name: e.target.value }))}
            />
          </div>

          {/* Age */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">年龄</label>
            <input
              type="number"
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
              placeholder="输入年龄..."
              value={character.age || ""}
              onChange={(e) => setCharacter(prev => ({ ...prev, age: parseInt(e.target.value) || 0 }))}
              min="1"
              max="999"
            />
            {/* Age Hint */}
            {character.raceId && (() => {
              const race = racesData.races.find(r => r.id === character.raceId);
              if (race?.age) {
                return (
                  <p className="text-xs text-gray-500 mt-1">
                    {race.name}：成年年龄 {race.age.mature} 岁，最大寿命 {race.age.max} 岁
                  </p>
                );
              }
              return null;
            })()}
          </div>

          {/* Gender */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">性别</label>
            <div className="flex gap-2">
              {GENDERS.map(gender => (
                <button
                  key={gender}
                  className={`flex-1 px-4 py-2 rounded border-2 transition-all ${
                    character.gender === gender
                      ? "border-amber-400 bg-amber-400/10 text-amber-400"
                      : "border-gray-700 hover:border-gray-600 text-gray-400"
                  }`}
                  onClick={() => setCharacter(prev => ({ ...prev, gender }))}
                >
                  {gender}
                </button>
              ))}
            </div>
          </div>

          {/* Height and Weight */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm text-gray-400 mb-2 block">身高</label>
              <input
                type="text"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
                placeholder="如 5'6&quot; 或 168cm"
                value={character.appearance.height}
                onChange={(e) => setCharacter(prev => ({
                  ...prev,
                  appearance: { ...prev.appearance, height: e.target.value }
                }))}
              />
            </div>
            <div>
              <label className="text-sm text-gray-400 mb-2 block">体重</label>
              <input
                type="text"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
                placeholder="如 150 lbs 或 68kg"
                value={character.appearance.weight}
                onChange={(e) => setCharacter(prev => ({
                  ...prev,
                  appearance: { ...prev.appearance, weight: e.target.value }
                }))}
              />
            </div>
          </div>

          {/* Appearance Details */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">外貌特征</label>
            {/* Race Appearance Hint */}
            {character.raceId && (() => {
              const race = racesData.races.find(r => r.id === character.raceId);
              const subrace = race?.subraces?.find(sr => sr.id === character.subraceId);
              const raceAppearanceHints: Record<string, { eyes?: string; skin?: string; hair?: string }> = {
                human: { eyes: "各种颜色", skin: "白皙到深褐色", hair: "各种颜色和样式" },
                elf: { eyes: "金色、银色、蓝色", skin: "白皙到古铜色", hair: "金色、银色、黑色" },
                dwarf: { eyes: "深色", skin: "浅褐色到深褐色", hair: "黑色、棕色、红色（常有胡须）" },
                halfling: { eyes: "棕色、蓝色", skin: "浅褐色", hair: "棕色、黑色、卷发" },
                dragonborn: { eyes: "金色、红色、绿色", skin: "鳞片（红、蓝、绿、金等）", hair: "无毛发" },
                gnome: { eyes: "蓝色、棕色", skin: "浅褐色到棕褐色", hair: "金色、棕色、白色" },
                half_elf: { eyes: "各种颜色（可能有精灵特征）", skin: "白皙到古铜色", hair: "各种颜色" },
                half_orc: { eyes: "深色、红色", skin: "灰绿色到棕色", hair: "黑色、深棕色" },
                tiefling: { eyes: "红色、金色、无瞳孔", skin: "红色、紫色、蓝色", hair: "深色（可能有角）" }
              };
              const hints = raceAppearanceHints[character.raceId];
              if (hints) {
                return (
                  <div className="mb-2 p-2 bg-amber-900/10 border border-amber-700/30 rounded text-xs text-amber-400">
                    <strong>{race?.name}{subrace ? ` (${subrace.name})` : ""} 典型特征：</strong>
                    {hints.eyes && ` 眼睛：${hints.eyes}`}
                    {hints.skin && ` | 皮肤：${hints.skin}`}
                    {hints.hair && ` | 头发：${hints.hair}`}
                  </div>
                );
              }
              return null;
            })()}
            <div className="space-y-2">
              <input
                type="text"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none text-sm"
                placeholder="眼睛颜色（如：蓝色、棕色、琥珀色）"
                value={character.appearance.eyes}
                onChange={(e) => setCharacter(prev => ({
                  ...prev,
                  appearance: { ...prev.appearance, eyes: e.target.value }
                }))}
              />
              <input
                type="text"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none text-sm"
                placeholder="皮肤颜色（如：白皙、古铜色、深褐色）"
                value={character.appearance.skin}
                onChange={(e) => setCharacter(prev => ({
                  ...prev,
                  appearance: { ...prev.appearance, skin: e.target.value }
                }))}
              />
              <input
                type="text"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none text-sm"
                placeholder="头发（如：黑色长发、金色短发、光头）"
                value={character.appearance.hair}
                onChange={(e) => setCharacter(prev => ({
                  ...prev,
                  appearance: { ...prev.appearance, hair: e.target.value }
                }))}
              />
              <input
                type="text"
                className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none text-sm"
                placeholder="特殊标记（如：脸上的疤痕、手臂纹身）"
                value={character.appearance.distinguishingMarks}
                onChange={(e) => setCharacter(prev => ({
                  ...prev,
                  appearance: { ...prev.appearance, distinguishingMarks: e.target.value }
                }))}
              />
            </div>
          </div>

          {/* Deity Selection - All classes except Warlock, only when enabled */}
          {enableDeitySystem && canHaveDeity(character.classId) && (
            <div>
              <label className="text-sm text-gray-400 mb-2 block">
                信仰的神祇{shouldHaveDeity(character.classId) ? " (推荐)" : " (可选)"}
              </label>
              <DeitySelector
                selectedDeityId={character.deityId}
                characterClass={character.classId}
                allowedDeityIds={allowedDeityIds}
                onSelect={(deity, alignment) => {
                  setCharacter(prev => ({
                    ...prev,
                    deityId: deity?.id || "",
                    alignment: deity ? alignment : prev.alignment
                  }));
                }}
              />
              {character.deityId && (
                <p className="text-xs text-gray-500 mt-2">
                  💡 选择神祇后，角色阵营已自动设置为神祇的阵营
                </p>
              )}
            </div>
          )}

          {/* Alignment */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              阵营 *
              {character.deityId && (
                <span className="text-xs text-amber-400 ml-2">
                  (已由神祇锁定)
                </span>
              )}
            </label>
            <div className="grid grid-cols-3 gap-2">
              {ALIGNMENTS.map(alignment => (
                <button
                  key={alignment.id}
                  disabled={!!character.deityId}
                  className={`p-3 rounded border-2 transition-all text-left ${
                    character.alignment === alignment.id
                      ? "border-amber-400 bg-amber-400/10"
                      : "border-gray-700 hover:border-gray-600"
                  } ${character.deityId ? "opacity-50 cursor-not-allowed" : ""}`}
                  onClick={() => !character.deityId && setCharacter(prev => ({ ...prev, alignment: alignment.id }))}
                >
                  <div className={`text-sm font-medium ${
                    character.alignment === alignment.id ? "text-amber-400" : "text-gray-300"
                  }`}>
                    {alignment.name}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{alignment.nameEn}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Background */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">背景 *</label>
            <select
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none"
              value={character.backgroundId}
              onChange={(e) => {
                const selectedBackground = backgrounds.find((b: any) => b.id === e.target.value);
                if (selectedBackground) {
                  setCharacter(prev => {
                    // Auto-add background skills to selectedSkills (avoid duplicates)
                    const newSkills = [...prev.selectedSkills];
                    selectedBackground.skillProficiencies.forEach((skill: string) => {
                      if (!newSkills.includes(skill)) {
                        newSkills.push(skill);
                      }
                    });

                    // Auto-add background equipment
                    const backgroundEquipment: any[] = [];
                    if (selectedBackground.equipment && Array.isArray(selectedBackground.equipment)) {
                      selectedBackground.equipment.forEach((itemRef: string) => {
                        // Handle quantity notation (e.g., "incense:5")
                        const [itemId, qtyStr] = itemRef.split(":");
                        const quantity = qtyStr ? parseInt(qtyStr, 10) : 1;

                        const item = findEquipmentById(itemId);
                        if (item) {
                          backgroundEquipment.push({
                            ...item,
                            quantity,
                            category: "item",
                          });
                        }
                      });
                    }

                    return {
                      ...prev,
                      backgroundId: e.target.value,
                      backgroundFeature: selectedBackground.feature.name || "",
                      selectedSkills: newSkills,
                      backgroundEquipment: [...backgroundEquipment], // Store background equipment separately for merging
                      equipment: [...backgroundEquipment] // Also set equipment for immediate display
                    };
                  });
                } else {
                  setCharacter(prev => ({
                    ...prev,
                    backgroundId: e.target.value,
                    backgroundFeature: "",
                    backgroundEquipment: [],
                    equipment: []
                  }));
                }
              }}
            >
              <option value="">-- 选择背景 --</option>
              {backgrounds.map((bg: any) => (
                <option key={bg.id} value={bg.id}>
                  {bg.name} ({bg.nameEn})
                </option>
              ))}
            </select>

            {/* Background Description */}
            {character.backgroundId && (() => {
              const selectedBg = backgrounds.find((b: any) => b.id === character.backgroundId);
              if (!selectedBg) return null;

              return (
                <div className="mt-3 p-3 bg-gray-900/50 border border-gray-700 rounded space-y-2">
                  <p className="text-sm text-gray-300">{selectedBg.description}</p>

                  <div className="pt-2 border-t border-gray-700">
                    <div className="text-xs text-amber-400 font-semibold mb-1">
                      背景特性：{selectedBg.feature.name}
                    </div>
                    <p className="text-xs text-gray-400">{selectedBg.feature.description}</p>
                  </div>

                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-700 text-xs">
                    <div>
                      <span className="text-gray-500">技能熟练：</span>
                      <span className="text-gray-300">
                        {selectedBg.skillProficiencies.map((s: string) => {
                          const skillMap: Record<string, string> = {
                            insight: "洞悉", religion: "宗教", deception: "欺瞒", stealth: "隐匿",
                            animal_handling: "驯兽", survival: "求生", history: "历史", persuasion: "游说",
                            arcana: "奥秘", athletics: "运动", intimidation: "威吓", acrobatics: "体操",
                            performance: "表演", medicine: "医药", perception: "察觉", sleight_of_hand: "巧手"
                          };
                          return skillMap[s] || s;
                        }).join("、")}
                      </span>
                    </div>
                    <div>
                      <span className="text-gray-500">语言：</span>
                      <span className="text-gray-300">
                        {selectedBg.languages > 0 ? `${selectedBg.languages}门自选语言` : "无"}
                      </span>
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        </div>

        {/* Right Column - Personality */}
        <div className="space-y-4">
          <h3 className="text-lg font-semibold text-amber-400 border-b border-gray-700 pb-2">
            个性特征（可选）
          </h3>

          {/* Personality Traits */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              性格特质
              <span className="text-xs text-gray-500 ml-2">（多个特质用逗号分隔）</span>
            </label>
            <textarea
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none resize-none"
              placeholder="例如：勇敢、好奇、谨慎..."
              rows={2}
              value={character.personality.traits.join(", ")}
              onChange={(e) => {
                const traits = e.target.value.split(",").map(t => t.trim()).filter(t => t);
                setCharacter(prev => ({
                  ...prev,
                  personality: { ...prev.personality, traits }
                }));
              }}
            />
          </div>

          {/* Ideals */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              理想信念
            </label>
            <textarea
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none resize-none"
              placeholder="角色深信的信念或原则..."
              rows={2}
              value={character.personality.ideals}
              onChange={(e) => setCharacter(prev => ({
                ...prev,
                personality: { ...prev.personality, ideals: e.target.value }
              }))}
            />
          </div>

          {/* Bonds */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              羁绊
            </label>
            <textarea
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none resize-none"
              placeholder="角色在乎的人、物或组织..."
              rows={2}
              value={character.personality.bonds}
              onChange={(e) => setCharacter(prev => ({
                ...prev,
                personality: { ...prev.personality, bonds: e.target.value }
              }))}
            />
          </div>

          {/* Flaws */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              缺陷
            </label>
            <textarea
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none resize-none"
              placeholder="角色的弱点或不良习惯..."
              rows={2}
              value={character.personality.flaws}
              onChange={(e) => setCharacter(prev => ({
                ...prev,
                personality: { ...prev.personality, flaws: e.target.value }
              }))}
            />
          </div>

          {/* Other Traits */}
          <div>
            <label className="text-sm text-gray-400 mb-2 block">
              其他特性特质
            </label>
            <textarea
              className="w-full px-3 py-2 bg-gray-900 border border-gray-700 rounded text-gray-300 focus:border-amber-400 focus:outline-none resize-none"
              placeholder="其他值得注意的特性或习惯..."
              rows={2}
              value={character.otherTraits}
              onChange={(e) => setCharacter(prev => ({
                ...prev,
                otherTraits: e.target.value
              }))}
            />
          </div>

          {/* Backstory */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm text-gray-400">
                背景故事
              </label>
              <button
                className="px-3 py-1.5 bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-700 hover:to-orange-700 text-white rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
                onClick={handleGenerateBackstory}
                disabled={generatingBackstory || !character.raceId || !character.classId}
                title="使用快速语言模型生成角色背景故事"
              >
                {generatingBackstory ? (
                  <>
                    <span className="animate-spin">⚙️</span>
                    <span>生成中...</span>
                  </>
                ) : (
                  <>
                    <span>🎭</span>
                    <span>AI 生成背景故事</span>
                  </>
                )}
              </button>
            </div>
            <TextArea
              ref={backstoryTextareaRef}
              size="2"
              variant="surface"
              placeholder="角色的过去经历和成长故事..."
              value={character.backstory}
              onChange={(e) => setCharacter(prev => ({
                ...prev,
                backstory: e.target.value
              }))}
              style={{
                minHeight: "120px",
                backgroundColor: "rgb(17 24 39)",
                border: "1px solid rgb(55 65 81)",
                color: "rgb(209 213 219)",
                resize: "vertical",
                overflow: "hidden"
              }}
            />
          </div>
        </div>
      </div>

      {/* Hint */}
      <div className="bg-blue-900/20 border border-blue-700/50 rounded-lg p-3">
        <div className="flex items-start gap-2">
          <span className="text-blue-400 text-lg">💡</span>
          <div className="text-sm text-gray-300">
            <strong className="text-blue-400">提示：</strong>
            个性特征是可选的，但填写后会让你的角色更加生动。你可以参考选择的阵营和背景来思考角色的性格特点。
          </div>
        </div>
      </div>
    </div>
  );
}


export { Step5CharacterDescription };
