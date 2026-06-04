import type { SelectionContextMenuState } from "../hooks/useMapInteractionController";
import type { Token } from "../types/TacticalMapTypes";

export function tokenHasZoneSpellOnMap(
  token: Token | null | undefined,
  currentMapUrl: string | null | undefined,
): boolean {
  if (!token || !currentMapUrl) {
    return false;
  }

  return (
    token.concentration_spell?.area_effect?.map_url === currentMapUrl ||
    (token.active_effects || []).some(
      (effect) => effect.spell_buff && effect.area_effect?.map_url === currentMapUrl,
    )
  );
}

export function findPlayerControlledToken(
  tokens: Token[],
  selectedCharacterId?: number | null,
  userId?: string,
): Token | null {
  return (
    tokens.find(
      (token) =>
        token.character_id &&
        ((selectedCharacterId && token.character_id === selectedCharacterId) ||
          (userId && token.user_id === userId)),
    ) || null
  );
}

export function buildSelectionCompanionTokens(
  isDM: boolean,
  selectionContextMenu: SelectionContextMenuState | null,
  tokens: Token[],
): Token[] {
  if (isDM || !selectionContextMenu?.sourceToken.character_id) {
    return [];
  }

  return tokens.filter(
    (token) =>
      token.monster_instance_id &&
      token.control_type &&
      token.controller_character_id === selectionContextMenu.sourceToken.character_id,
  );
}
