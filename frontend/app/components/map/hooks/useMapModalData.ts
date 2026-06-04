import { useMemo } from "react";

import type { PlayerAvatar, Token } from "../types/TacticalMapTypes";

interface ChestModalCharacter {
  id: number;
  name: string;
  user_id: string;
}

interface UseMapModalDataArgs {
  tokens: Token[];
  playerAvatars: PlayerAvatar[];
  playerNoteTokenId: number | null;
  illusionEditTokenId: number | null;
  itemDetailTokenId: number | null;
  lootBagTokenId: number | null;
  shopTokenModalId: number | null;
}

export function buildChestModalCharacters(
  playerAvatars: PlayerAvatar[],
  tokens: Token[],
): ChestModalCharacter[] {
  const playerCharacters =
    playerAvatars.length > 0
      ? playerAvatars
      : tokens
          .filter((token) => token.character_id && token.character_name)
          .reduce((acc, token) => {
            if (!acc.find((avatar) => avatar.id === token.character_id)) {
              acc.push({
                id: token.character_id!,
                name: token.character_name!,
                type: "player" as const,
                userId: token.user_id ? parseInt(token.user_id, 10) : undefined,
              });
            }
            return acc;
          }, [] as PlayerAvatar[]);

  return playerCharacters
    .filter((player) => player.type !== "monster" && typeof player.id === "number")
    .map((player) => ({
      id: player.id as number,
      name: player.name,
      user_id: String(player.userId || ""),
    }));
}

export function useMapModalData({
  tokens,
  playerAvatars,
  playerNoteTokenId,
  illusionEditTokenId,
  itemDetailTokenId,
  lootBagTokenId,
  shopTokenModalId,
}: UseMapModalDataArgs) {
  const playerNoteToken = useMemo(
    () => tokens.find((token) => token.id === playerNoteTokenId) || null,
    [playerNoteTokenId, tokens],
  );

  const illusionEditToken = useMemo(
    () => tokens.find((token) => token.id === illusionEditTokenId) || null,
    [illusionEditTokenId, tokens],
  );

  const itemDetailToken = useMemo(
    () => tokens.find((token) => token.id === itemDetailTokenId) || null,
    [itemDetailTokenId, tokens],
  );

  const lootBagToken = useMemo(
    () => tokens.find((token) => token.id === lootBagTokenId) || null,
    [lootBagTokenId, tokens],
  );

  const shopToken = useMemo(
    () => tokens.find((token) => token.id === shopTokenModalId) || null,
    [shopTokenModalId, tokens],
  );

  const chestModalCharacters = useMemo(
    () => buildChestModalCharacters(playerAvatars, tokens),
    [playerAvatars, tokens],
  );

  return {
    chestModalCharacters,
    illusionEditToken,
    itemDetailToken,
    lootBagToken,
    playerNoteToken,
    shopToken,
  };
}
