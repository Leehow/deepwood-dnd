import { useCallback, useEffect, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from "react";
import type React from "react";

import type { SpellOption } from "../SelectionContextMenu";
import type { AreaSpellModeState } from "./useMapAreaSpellController";
import { GRID_SIZE, type Position, type Token } from "../types/TacticalMapTypes";
import { subscribeAppEvent } from "~/events/appEventBus";

type ShowToast = (
  message: string,
  type?: "success" | "error" | "info" | "warning",
  duration?: number,
) => void;

interface BreathWeaponShape {
  shape: string;
  size: string;
  save: string;
  saveCn: string;
  shapeCn: string;
}

interface StartBreathWeaponDetail {
  sourceCharacterId: number;
  breathWeapon: BreathWeaponShape;
  damageType: string;
  damageTypeCn: string;
  damageDice: string;
  subraceName: string;
  saveDC: number;
}

interface StartMonsterAreaActionDetail {
  sourceTokenId: number;
  actionName: string;
  breathWeapon: BreathWeaponShape;
  damageType: string;
  damageTypeCn: string;
  damageDice: string;
  saveDC: number;
  saveEffect: string;
}

interface UseMapAreaSpellRuntimeControllerArgs {
  areaSpellMode: AreaSpellModeState | null;
  setAreaSpellMode: Dispatch<SetStateAction<AreaSpellModeState | null>>;
  tokens: Token[];
  containerRef: RefObject<HTMLDivElement>;
  stagePosRef: MutableRefObject<Position>;
  stageScaleRef: MutableRefObject<number>;
  showToast: ShowToast;
  handleAreaSpellSelect: (
    spell: SpellOption,
    sourceTokenId: number,
    slotLevel: number,
    freecast?: boolean,
    illusionImageUrl?: string,
    illusionDesc?: string,
    illusionDisplayName?: string,
    selectedOption?: string,
    materialId?: string,
    ritualCast?: boolean,
  ) => void;
  handleAreaSpellMouseMove: (gridX: number, gridY: number) => void;
  handleTouchMoveForContextMenu: (e: React.TouchEvent) => void;
  snapAreaSpellPos: (
    rawX: number,
    rawY: number,
    shape: NonNullable<AreaSpellModeState>["shapeType"],
    sizeFeet: number,
  ) => { x: number; y: number };
}

function parseAreaSize(sizeLabel: string, fallback = 15): number {
  const sizeMatch = sizeLabel.match(/(\d+)/);
  return sizeMatch ? parseInt(sizeMatch[1], 10) : fallback;
}

function createPseudoAreaSpell(
  sourceName: string,
  shape: string,
  sizeFeet: number,
  damageType: string,
  damageTypeCn: string,
  damageDice: string,
  saveType: string,
  saveTypeCn: string,
  saveDC: number,
  saveEffect: "none" | "half",
): SpellOption {
  return {
    id: `runtime_area_${damageType}_${sourceName}`,
    name: sourceName,
    nameEn: sourceName,
    level: 0,
    school: "evocation",
    damage: damageDice,
    damageType,
    damageTypeCn,
    attackType: "save",
    saveType: saveType.substring(0, 3),
    saveTypeCn,
    saveEffect,
    range: "自身",
    spellSaveDC: saveDC,
    areaOfEffect: { type: shape, size: sizeFeet },
  } as SpellOption;
}

export function useMapAreaSpellRuntimeController({
  areaSpellMode,
  setAreaSpellMode,
  tokens,
  containerRef,
  stagePosRef,
  stageScaleRef,
  showToast,
  handleAreaSpellSelect,
  handleAreaSpellMouseMove,
  handleTouchMoveForContextMenu,
  snapAreaSpellPos,
}: UseMapAreaSpellRuntimeControllerArgs) {
  useEffect(() => {
    return subscribeAppEvent("startBreathWeapon", (detail: StartBreathWeaponDetail) => {
      const sourceToken = tokens.find((token) => token.character_id === detail.sourceCharacterId);
      if (!sourceToken) {
        showToast("找不到角色的地图标记", "warning");
        return;
      }

      const shapeType = detail.breathWeapon.shape === "line" ? "line" : "cone";
      const pseudoSpell = createPseudoAreaSpell(
        `吐息武器（${detail.damageTypeCn}）`,
        shapeType,
        parseAreaSize(detail.breathWeapon.size),
        detail.damageType,
        detail.damageTypeCn,
        detail.damageDice,
        detail.breathWeapon.save,
        detail.breathWeapon.saveCn,
        detail.saveDC,
        "half",
      );

      handleAreaSpellSelect(pseudoSpell, sourceToken.id, 0);
    });
  }, [tokens, handleAreaSpellSelect, showToast]);

  useEffect(() => {
    return subscribeAppEvent("startMonsterAreaAction", (detail: StartMonsterAreaActionDetail) => {
      const sourceToken = tokens.find((token) => token.id === detail.sourceTokenId);
      if (!sourceToken) {
        showToast("找不到怪物的地图标记", "warning");
        return;
      }

      const shapeType = detail.breathWeapon.shape === "line" ? "line" : "cone";
      const pseudoSpell = createPseudoAreaSpell(
        detail.actionName,
        shapeType,
        parseAreaSize(detail.breathWeapon.size),
        detail.damageType,
        detail.damageTypeCn,
        detail.damageDice,
        detail.breathWeapon.save,
        detail.breathWeapon.saveCn,
        detail.saveDC,
        detail.saveEffect === "none" ? "none" : "half",
      );

      handleAreaSpellSelect(pseudoSpell, sourceToken.id, 0);
    });
  }, [tokens, handleAreaSpellSelect, showToast]);

  const handleMapTouchMove = useCallback((e: React.TouchEvent) => {
    if (areaSpellMode && e.touches.length === 1) {
      const touch = e.touches[0];
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) {
        const clientX = touch.clientX - rect.left;
        const clientY = touch.clientY - rect.top;
        const mapX = (clientX - stagePosRef.current.x) / stageScaleRef.current;
        const mapY = (clientY - stagePosRef.current.y) / stageScaleRef.current;
        const gridX = mapX / GRID_SIZE;
        const gridY = mapY / GRID_SIZE;
        const isDirectional = areaSpellMode.shapeType === "cone" || areaSpellMode.shapeType === "line";

        if (!isDirectional && areaSpellMode.centerPos) {
          const sizeFeet = areaSpellMode.spell?.areaOfEffect?.size || 20;
          const snapped = snapAreaSpellPos(gridX, gridY, areaSpellMode.shapeType, sizeFeet);
          setAreaSpellMode((previous) => (
            previous ? { ...previous, centerPos: snapped, previewPos: snapped } : null
          ));
        } else {
          handleAreaSpellMouseMove(gridX, gridY);
        }
      }
      return;
    }

    handleTouchMoveForContextMenu(e);
  }, [
    areaSpellMode,
    containerRef,
    handleAreaSpellMouseMove,
    handleTouchMoveForContextMenu,
    setAreaSpellMode,
    snapAreaSpellPos,
    stagePosRef,
    stageScaleRef,
  ]);

  return {
    handleMapTouchMove,
  };
}
