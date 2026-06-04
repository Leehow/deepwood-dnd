import { useMemo, useState, useEffect, useRef } from "react";
import * as Dialog from "@radix-ui/react-dialog";

import { getAuthUser } from "~/utils/auth";
import racesData from "~/data/rules/races.json";
import classesData from "~/data/rules/classes_with_structured_subclass_features.json";
import spellsJsonForCtx from "~/data/rules/spells.json";
import { getPassiveFeatures } from "~/hooks/usePassiveFeatures";
import { getRacialSpells } from "~/components/character/CharacterDisplay/utils/spellcasting";
import { useRuleOptions } from "~/hooks/useRuleOptions";
import { useModalContextStore } from "~/stores/modalContextStore";
import { isClickInsideFloatingChat } from "~/utils/floatingChatGuard";

import { CharacterState, CharacterWizardProps, Race } from "./types";
import { Step1RaceSelection } from "./Step1RaceSelection";
import { Step2ClassSelection } from "./Step2ClassSelection";
import { Step3ClassFeatures } from "./Step3ClassFeatures";
import { Step4AbilityScores } from "./Step4AbilityScores";
import { Step5CharacterDescription } from "./Step5CharacterDescription";
import { Step5EquipmentSelection as Step6EquipmentSelection } from "./Step5EquipmentSelection";
import { Step6ReviewFinalize as Step7ReviewFinalize } from "./Step6ReviewFinalize";

const STEPS = [
  { id: 1, name: "选择种族" },
  { id: 2, name: "选择职业" },
  { id: 3, name: "职业特性" },
  { id: 4, name: "决定属性" },
  { id: 5, name: "描述角色" },
  { id: 6, name: "选择装备" },
  { id: 7, name: "审核完成" },
];

const initialCharacterState: CharacterState = {
  // Step 1
  raceId: "",
  subraceId: "",
  // Step 2
  classId: "",
  subclassId: "",
  selectedSkills: [],
  // Step 3
  fightingStyle: "",
  selectedCantrips: [],
  selectedSpells: [],
  preparedSpells: [],
  expertiseSkills: [],
  expertiseThievesTools: false,
  favoredEnemy: "",
  favoredHumanoidRaces: [],
  favoredTerrain: "",
  eldritchInvocations: [],
  subclassChoices: {},
  raceChoices: {},
  // Step 4
  abilityScores: {
    strength: 10,
    dexterity: 10,
    constitution: 10,
    intelligence: 10,
    wisdom: 10,
    charisma: 10,
  },
  // Step 5
  name: "",
  age: 18,
  gender: "",
  alignment: "", // Empty string to force user selection
  deityId: "",
  appearance: {
    height: "",
    weight: "",
    eyes: "",
    skin: "",
    hair: "",
    distinguishingMarks: "",
  },
  personality: {
    traits: [],
    ideals: "",
    bonds: "",
    flaws: "",
  },
  otherTraits: "",
  backstory: "",
  backgroundId: "",
  backgroundFeature: "",
  // Step 6
  equipment: [],
  level: 1,
};

// Debug: 预填角色数据，跳到指定步骤
const DEBUG_CHARACTER: CharacterState = {
  raceId: "human", subraceId: "",
  classId: "fighter", subclassId: "",
  selectedSkills: ["athletics", "intimidation"],
  fightingStyle: "defense",
  selectedCantrips: [], selectedSpells: [], preparedSpells: [],
  expertiseSkills: [], expertiseThievesTools: false,
  favoredEnemy: "", favoredHumanoidRaces: [], favoredTerrain: "",
  eldritchInvocations: [], subclassChoices: {}, raceChoices: {},
  abilityScores: { strength: 15, dexterity: 14, constitution: 13, intelligence: 12, wisdom: 10, charisma: 8 },
  name: "测试战士", age: 25, gender: "男性", alignment: "lawful_neutral",
  deityId: "", appearance: { height: "180cm", weight: "85kg", eyes: "棕色", skin: "古铜色", hair: "黑色短发", distinguishingMarks: "左脸一道刀疤" },
  personality: { traits: ["我从不拒绝一场挑战"], ideals: "荣耀", bonds: "我的战友就是我的家人", flaws: "太过自信" },
  otherTraits: "", backstory: "曾是佣兵团的队长", backgroundId: "soldier", backgroundFeature: "",
  equipment: [], level: 1,
};

export function CharacterCreationWizardV2({ open, onOpenChange, onCharacterCreated, campaignId, enableDeitySystem = true, initialDraft, onDraftChange, onDraftStepChange }: CharacterWizardProps) {
  const [character, setCharacter] = useState<CharacterState>(initialCharacterState);
  const [currentStep, setCurrentStep] = useState<number>(1);
  const [visitedSteps, setVisitedSteps] = useState<Set<number>>(new Set([1]));
  const [saving, setSaving] = useState(false);

  // Campaign-scoped rule filtering
  const { ruleOpts } = useRuleOptions(campaignId);

  // Reset wizard when opened — restore from draft if available
  useEffect(() => {
    if (open) {
      if (initialDraft?.wizard_state) {
        setCharacter(initialDraft.wizard_state);
        const step = initialDraft.current_step || 1;
        setCurrentStep(step);
        // Mark all steps up to current as visited
        setVisitedSteps(new Set(Array.from({ length: step }, (_, i) => i + 1)));
      } else {
        setCharacter(initialCharacterState);
        setCurrentStep(1);
        setVisitedSteps(new Set([1]));
      }
      setSaving(false);
    }
  }, [open, initialDraft]);

  // Register modal context for AI chat awareness
  const setModalContext = useModalContextStore(s => s.setModalContext);
  const clearModalContext = useModalContextStore(s => s.clearModalContext);
  useEffect(() => {
    if (open) {
      const stepName = STEPS.find(s => s.id === currentStep)?.name || '';
      const race = character.raceId ? (racesData.races as any[]).find((r: any) => r.id === character.raceId) : null;
      const cls = character.classId ? (classesData.classes as any[]).find((c: any) => c.id === character.classId) : null;
      const subrace = race?.subraces?.find((sr: any) => sr.id === character.subraceId);

      const parts = [`正在创建角色，当前步骤(${currentStep}/7)：${stepName}`];

      // 已做选择摘要
      if (race) parts.push(`种族：${race.name}`);
      if (subrace) parts.push(`亚种：${subrace.name}`);
      if (cls) parts.push(`职业：${cls.name}`);
      if (character.subclassId) {
        const sc = cls?.subclasses?.find((s: any) => s.id === character.subclassId);
        if (sc) parts.push(`子职业：${sc.name}`);
      }
      if (character.name) parts.push(`角色名：${character.name}`);

      // 按步骤补充当前界面可见的关键数据
      if (currentStep === 2 && cls) {
        // 技能选择步骤：传入可选技能列表和已选
        const avail = cls.proficiencies?.skillsAvailable || [];
        const max = cls.proficiencies?.skillChoices || 0;
        parts.push(`可选技能(选${max}个)：${avail.join('、')}`);
        if (character.selectedSkills.length > 0) {
          parts.push(`已选技能：${character.selectedSkills.join('、')}`);
        }
      }
      if (currentStep === 3) {
        // 职业特性步骤
        if (character.selectedCantrips.length > 0) {
          const cnNames = character.selectedCantrips.map((id: string) => (spellsJsonForCtx as any).spells?.find((s: any) => s.id === id)?.name || id);
          parts.push(`已选戏法：${cnNames.join('、')}`);
        }
        if (character.selectedSpells.length > 0) {
          const cnNames = character.selectedSpells.map((id: string) => (spellsJsonForCtx as any).spells?.find((s: any) => s.id === id)?.name || id);
          parts.push(`已选法术：${cnNames.join('、')}`);
        }        if (character.fightingStyle) parts.push(`战斗风格：${character.fightingStyle}`);
        if (character.expertiseSkills.length > 0) parts.push(`专精技能：${character.expertiseSkills.join('、')}`);
        if (character.favoredEnemy) parts.push(`宿敌：${character.favoredEnemy}`);
        if (character.favoredTerrain) parts.push(`擅长地形：${character.favoredTerrain}`);
      }
      if (currentStep === 4) {
        const as = character.abilityScores;
        parts.push(`属性值：力${as.strength} 敏${as.dexterity} 体${as.constitution} 智${as.intelligence} 感${as.wisdom} 魅${as.charisma}`);
      }
      if (currentStep === 5) {
        if (character.backgroundId) parts.push(`背景：${character.backgroundId}`);
        if (character.alignment) parts.push(`阵营：${character.alignment}`);
      }

      setModalContext('character-creation', parts.join('。'));
    } else {
      clearModalContext('character-creation');
    }
  }, [open, currentStep, character, setModalContext, clearModalContext]);

  // Auto-save draft on character state changes (debounced by parent hook)
  const isInitialMount = useRef(true);
  useEffect(() => {
    if (!open) return;
    // Skip the initial mount to avoid saving the default/restored state immediately
    if (isInitialMount.current) {
      isInitialMount.current = false;
      return;
    }
    onDraftChange?.(currentStep, character);
  }, [character]); // eslint-disable-line react-hooks/exhaustive-deps

  // Reset mount flag when dialog closes
  useEffect(() => {
    if (!open) isInitialMount.current = true;
  }, [open]);

  // Debug: 一键填充所有数据并跳到指定步骤
  const debugFillAndJump = (targetStep: number = 7) => {
    setCharacter(DEBUG_CHARACTER);
    setVisitedSteps(new Set([1, 2, 3, 4, 5, 6, 7]));
    setCurrentStep(targetStep);
  };

  const allRaces: Race[] = (racesData as any).races;
  const allClasses: any[] = (classesData as any).classes;

  // Filter by campaign rule options (fallback to full list when ruleOpts is null)
  const races = useMemo(() => {
    if (!ruleOpts?.allowedRaceIds) return allRaces;
    return allRaces.filter(r => ruleOpts.allowedRaceIds.has(r.id));
  }, [allRaces, ruleOpts]);

  const classes = useMemo(() => {
    if (!ruleOpts?.allowedClassIds) return allClasses;
    return allClasses.filter(c => ruleOpts.allowedClassIds.has(c.id));
  }, [allClasses, ruleOpts]);

  // Deity system: ruleOpts takes priority, then fall back to prop
  const effectiveDeitySystem = ruleOpts ? ruleOpts.enableDeitySystem : enableDeitySystem;

  const currentRace = useMemo(() => races.find(r => r.id === character.raceId), [races, character.raceId]);
  const currentSubrace = useMemo(() => currentRace?.subraces?.find(sr => sr.id === character.subraceId), [currentRace, character.subraceId]);
  const currentClass = useMemo(() => classes.find(c => c.id === character.classId), [classes, character.classId]);

  const isLastStep = currentStep >= 7;
  const isFirstStep = currentStep <= 1;

  // Validation for each step
  const getStepValidationError = (): string => {
    switch (currentStep) {
      case 1: { // Race Selection
        if (!character.raceId) return "请选择一个种族";
        const race = races.find(r => r.id === character.raceId);
        if (race?.subraces && race.subraces.length > 0 && !character.subraceId) {
          return "请选择一个亚种";
        }
        // Dwarf tool choice
        if (character.raceId === "dwarf" && !character.raceChoices.tool) {
          return "请选择一个工匠工具熟练项";
        }
        // Half-Elf choices
        if (character.raceId === "half_elf") {
          if (!character.raceChoices.skills || character.raceChoices.skills.length < 2) {
            return "请选择两项技能熟练项（半精灵 技能多才）";
          }
          if (!character.raceChoices.abilityScores || character.raceChoices.abilityScores.length < 2) {
            return "请选择两项额外属性加值（半精灵）";
          }
          if (!character.raceChoices.language) {
            return "请选择一门额外语言（半精灵）";
          }
        }
        // High Elf choices
        if (character.subraceId === "high_elf") {
          if (!character.raceChoices.cantrip) {
            return "请选择一个法师戏法（高等精灵）";
          }
          if (!character.raceChoices.language) {
            return "请选择一门额外语言（高等精灵）";
          }
        }
        return "";
      }
      case 2: // Class Selection
        if (!character.classId) return "请选择一个职业";
        return "";
      case 5: // Character Description
        if (!character.name || character.name.trim() === "") {
          return "请输入角色名称";
        }
        if (!character.alignment) {
          return "请选择阵营";
        }
        if (!character.backgroundId) {
          return "请选择背景";
        }
        return "";
      default:
        return "";
    }
  };

  const nextStep = () => {
    const error = getStepValidationError();
    if (error) {
      alert(error);
      return;
    }

    setCurrentStep((s) => {
      const next = Math.min(7, s + 1);
      setVisitedSteps((prev) => new Set(prev).add(next));
      onDraftStepChange?.(next, character);
      return next;
    });
  };
  const prevStep = () => {
    setCurrentStep((s) => {
      const prev = Math.max(1, s - 1);
      onDraftStepChange?.(prev, character);
      return prev;
    });
  };
  const goToStep = (stepNumber: number) => {
    if (visitedSteps.has(stepNumber)) {
      setCurrentStep(stepNumber);
      onDraftStepChange?.(stepNumber, character);
    }
  };

  // Minimal validation only on final submit
  const canFinish = () => {
    return Boolean(character.name && character.raceId && character.classId);
  };

  const handleFinish = async () => {
    if (!canFinish()) {
      alert("请至少填写角色名称、选择种族与职业");
      return;
    }
    if (saving) return; // Prevent double-click

    setSaving(true);
    try {
      // Merge subclass expertise skills (e.g., Knowledge Domain's Blessing of Knowledge)
      // Check passive-features data for any expertise-type feature matching this class/subclass
      const finalCharacter = { ...character };
      if (character.classId && character.subclassId && character.subclassChoices?.skill?.length) {
        const passive = getPassiveFeatures({
          classId: character.classId,
          subclassId: character.subclassId,
          level: character.level || 1,
        });
        const hasExpertiseFeature = passive.expertise.length > 0;
        if (hasExpertiseFeature) {
          // Merge subclass skill choices into expertiseSkills (deduplicated)
          const existing = new Set(finalCharacter.expertiseSkills || []);
          for (const skill of character.subclassChoices.skill) {
            existing.add(skill);
          }
          finalCharacter.expertiseSkills = Array.from(existing);
        }
      }

      // Merge racial cantrips (e.g., Forest Gnome's Minor Illusion) into selectedCantrips
      const racialCantrips = getRacialSpells(
        finalCharacter.raceId, finalCharacter.subraceId ?? null, 1, finalCharacter.raceChoices
      ).filter(rs => rs.level === 0).map(rs => rs.id);
      if (racialCantrips.length > 0) {
        const existing = new Set(finalCharacter.selectedCantrips || []);
        for (const c of racialCantrips) existing.add(c);
        finalCharacter.selectedCantrips = Array.from(existing);
      }

      // Merge subclass bonus cantrips (e.g., Illusion wizard's Minor Illusion) into selectedCantrips
      if (finalCharacter.classId && finalCharacter.subclassId) {
        const cls = (classesData as any).classes?.find((c: any) => c.id === finalCharacter.classId);
        const sc = cls?.subclasses?.find((s: any) => s.id === finalCharacter.subclassId);
        if (sc?.level1Features) {
          const bonusCantrips: string[] = [];
          for (const f of sc.level1Features) {
            if (f.structuredData?.bonusCantrips?.length) {
              bonusCantrips.push(...f.structuredData.bonusCantrips);
            }
          }
          if (bonusCantrips.length > 0) {
            const existing = new Set(finalCharacter.selectedCantrips || []);
            for (const c of bonusCantrips) existing.add(c);
            finalCharacter.selectedCantrips = Array.from(existing);
          }
        }
      }

      // Delegate persistence to parent (route) to POST /api/characters
      const result = await onCharacterCreated?.(finalCharacter);
      // If callback returns false, there was an error (alert shown by parent)
      // If true or void, success - dialog closed by parent
      if (result === false) {
        setSaving(false);
      }
    } catch (error) {
      console.error("Character creation failed:", error);
      alert("创建角色失败，请重试");
      setSaving(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-0 z-50 flex items-center justify-center p-[5dvh_2.5vw]"
          onPointerDownOutside={(e) => e.preventDefault()}
          onInteractOutside={(e) => e.preventDefault()}
        >
          <div className="bg-gray-800 border border-gray-700 rounded-lg shadow-2xl w-full max-w-6xl max-h-full flex flex-col">
            {/* Header — fixed at top */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700 shrink-0">
              <Dialog.Title className="text-2xl font-fantasy text-amber-400">创建角色卡</Dialog.Title>
              <div className="flex items-center gap-3 text-sm text-gray-400">
                {getAuthUser()?.role === "admin" && (
                  <button
                    type="button"
                    onClick={() => debugFillAndJump(7)}
                    className="px-2 py-1 text-xs bg-red-900/50 hover:bg-red-800/50 text-red-300 border border-red-700/50 rounded"
                    title="Debug: 预填人类战士数据，跳到审核页"
                  >
                    DEV 跳到最后
                  </button>
                )}
                <span>步骤 {currentStep} / 7</span>
                <Dialog.Close className="text-gray-400 hover:text-gray-300 text-2xl leading-none">×</Dialog.Close>
              </div>
            </div>

            {/* Scrollable body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
            {/* Progress Bar */}
            <div className="flex items-center gap-2">
              {STEPS.map((step, index) => (
                <div key={step.id} className="flex items-center flex-1">
                  <div className="flex flex-col items-center flex-1">
                    <button
                      className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold border-2 transition-colors ${
                        step.id === currentStep
                          ? "border-amber-400 bg-amber-400 text-gray-900"
                          : step.id < currentStep
                            ? "border-green-500 bg-green-500 text-white"
                            : "border-gray-600 bg-gray-800 text-gray-400"
                      } ${visitedSteps.has(step.id) ? "cursor-pointer hover:opacity-80" : "cursor-not-allowed opacity-50"}`}
                      onClick={() => goToStep(step.id)}
                      disabled={!visitedSteps.has(step.id)}
                      title={visitedSteps.has(step.id) ? `跳转到：${step.name}` : "尚未解锁"}
                    >
                      {step.id < currentStep ? "✓" : step.id}
                    </button>
                    <div className="text-xs text-center mt-2 hidden md:block">
                      <div className={`font-medium ${step.id === currentStep ? "text-amber-400" : "text-gray-400"}`}>
                        {step.name}
                      </div>
                    </div>
                  </div>
                  {index < STEPS.length - 1 && (
                    <div className={`h-0.5 flex-1 mx-2 transition-colors ${step.id < currentStep ? "bg-green-500" : "bg-gray-700"}`} />
                  )}
                </div>
              ))}
            </div>

            {/* Step Content */}
            <div className="space-y-6">
              {currentStep === 1 && (
                <Step1RaceSelection
                  character={character}
                  setCharacter={setCharacter}
                  races={races}
                  currentRace={currentRace}
                />
              )}

              {currentStep === 2 && (
                <Step2ClassSelection
                  character={character}
                  setCharacter={setCharacter}
                  classes={classes}
                />
              )}

              {currentStep === 3 && (
                <Step3ClassFeatures
                  character={character}
                  setCharacter={setCharacter}
                  currentClass={currentClass}
                />
              )}

              {currentStep === 4 && (
                <Step4AbilityScores
                  character={character}
                  setCharacter={setCharacter}
                  currentRace={currentRace}
                  currentSubrace={currentSubrace}
                />
              )}

              {currentStep === 5 && (
                <Step5CharacterDescription
                  character={character}
                  setCharacter={setCharacter}
                  enableDeitySystem={effectiveDeitySystem}
                  allowedDeityIds={ruleOpts?.allowedDeityIds ?? null}
                  allowedBackgroundIds={ruleOpts?.allowedBackgroundIds ?? null}
                />
              )}

              {currentStep === 6 && (
                <Step6EquipmentSelection
                  character={character}
                  setCharacter={setCharacter}
                  selectedClass={currentClass}
                />
              )}

              {currentStep === 7 && (
                <Step7ReviewFinalize character={character} setCharacter={setCharacter} setCurrentStep={setCurrentStep} />
              )}
            </div>
            </div>

            {/* Footer Actions — fixed at bottom */}
            <div className="flex items-center gap-3 px-6 py-4 border-t border-gray-700 shrink-0">
              <button
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-50"
                onClick={prevStep}
                disabled={isFirstStep || saving}
              >
                上一步
              </button>

              {!isLastStep ? (
                <button
                  className="ml-auto px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded"
                  onClick={nextStep}
                >
                  下一步
                </button>
              ) : (
                <button
                  className="ml-auto px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white rounded disabled:opacity-50 flex items-center gap-2"
                  onClick={handleFinish}
                  disabled={!canFinish() || saving}
                >
                  {saving ? (
                    <>
                      <span className="inline-block w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      正在创建...
                    </>
                  ) : (
                    "完成创建 ✓"
                  )}
                </button>
              )}

              <button
                className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 rounded disabled:opacity-50"
                onClick={() => onOpenChange(false)}
                disabled={saving}
              >
                取消
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

