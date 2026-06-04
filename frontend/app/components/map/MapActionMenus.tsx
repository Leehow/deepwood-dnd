import {
  type CampaignItemSummary,
  type ContextMenuState,
  type MenuMonster,
  type MenuNpc,
  type MenuShop,
  type MobileActionModalState,
  type PlayerContextMenuState,
  type PlayerReactionState,
  type PlayerSpellDataState,
  type TokenContextMenuState,
} from "./hooks/useMapInteractionController";
import { MapContextMenu } from "./MapContextMenu";
import { MobileActionModal } from "./MobileActionModal";
import { PlayerContextMenu } from "./PlayerContextMenu";
import type { PlayerAvatar, Token } from "./types/TacticalMapTypes";
import { findPlayerControlledToken, tokenHasZoneSpellOnMap } from "./utils/mapMenuUtils";

interface MapActionMenusProps {
  isDM: boolean;
  userId?: string;
  selectedCharacterId?: number | null;
  currentMapUrl?: string | null;
  tokens: Token[];
  contextMenu: ContextMenuState | null;
  mobileActionModal: MobileActionModalState | null;
  tokenContextMenu: TokenContextMenuState | null;
  playerContextMenu: PlayerContextMenuState | null;
  monsters: MenuMonster[];
  campaignItems: CampaignItemSummary[];
  npcs: MenuNpc[];
  shops: MenuShop[];
  playerCharacters: PlayerAvatar[];
  playerSpellData: PlayerSpellDataState;
  playerAbilities: any[];
  playerReactions: PlayerReactionState[];
  openTokenPanel: (tokenId: number) => void;
  setContextMenu: (value: ContextMenuState | null) => void;
  setMobileActionModal: (value: MobileActionModalState | null) => void;
  setTokenContextMenu: (value: TokenContextMenuState | null) => void;
  setPlayerContextMenu: (value: PlayerContextMenuState | null) => void;
  setZoneSpellSettlementCasterId: (tokenId: number | undefined) => void;
  setZoneSpellSettlementOpen: (open: boolean) => void;
  handlePlaceMonster: (...args: any[]) => void;
  handlePlaceCurrency: (...args: any[]) => void;
  handlePlaceItem: (...args: any[]) => void;
  handlePlaceNPC: (...args: any[]) => void;
  handlePlaceShop: (...args: any[]) => void;
  handlePlaceCharacter: (...args: any[]) => void;
  handleRemoveToken: (tokenId: number) => void;
  handlePlayerMove: (...args: any[]) => void;
  handlePlayerCastSpell: (...args: any[]) => void;
  handlePlayerUseAbility: (...args: any[]) => void;
  handlePlayerToggleReaction: (...args: any[]) => void;
}

export function MapActionMenus({
  isDM,
  userId,
  selectedCharacterId,
  currentMapUrl,
  tokens,
  contextMenu,
  mobileActionModal,
  tokenContextMenu,
  playerContextMenu,
  monsters,
  campaignItems,
  npcs,
  shops,
  playerCharacters,
  playerSpellData,
  playerAbilities,
  playerReactions,
  openTokenPanel,
  setContextMenu,
  setMobileActionModal,
  setTokenContextMenu,
  setPlayerContextMenu,
  setZoneSpellSettlementCasterId,
  setZoneSpellSettlementOpen,
  handlePlaceMonster,
  handlePlaceCurrency,
  handlePlaceItem,
  handlePlaceNPC,
  handlePlaceShop,
  handlePlaceCharacter,
  handleRemoveToken,
  handlePlayerMove,
  handlePlayerCastSpell,
  handlePlayerUseAbility,
  handlePlayerToggleReaction,
}: MapActionMenusProps) {
  const tokenMenuToken = tokenContextMenu
    ? tokens.find((token) => token.id === tokenContextMenu.tokenId) || null
    : null;
  const hasCurrentTokenZoneSpell = tokenHasZoneSpellOnMap(tokenMenuToken, currentMapUrl);
  const hasAnyZoneSpells = tokens.some((token) => tokenHasZoneSpellOnMap(token, currentMapUrl));
  const playerToken = findPlayerControlledToken(tokens, selectedCharacterId, userId);
  const playerHasActiveZoneSpells = tokenHasZoneSpellOnMap(playerToken, currentMapUrl);

  return (
    <>
      {contextMenu && (
        <MapContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          gridX={contextMenu.gridX}
          gridY={contextMenu.gridY}
          onClose={() => setContextMenu(null)}
          onPlaceMonster={handlePlaceMonster}
          onPlaceCurrency={handlePlaceCurrency}
          onPlaceItem={handlePlaceItem}
          onPlaceNPC={handlePlaceNPC}
          onPlaceShop={handlePlaceShop}
          onPlaceCharacter={handlePlaceCharacter}
          monsters={monsters}
          campaignItems={campaignItems}
          npcs={npcs}
          shops={shops}
          playerCharacters={playerCharacters}
        />
      )}

      {isDM && mobileActionModal && (
        <MobileActionModal
          isOpen={true}
          onClose={() => setMobileActionModal(null)}
          gridX={mobileActionModal.gridX}
          gridY={mobileActionModal.gridY}
          onPlaceMonster={handlePlaceMonster}
          onPlaceCurrency={handlePlaceCurrency}
          onPlaceItem={handlePlaceItem}
          onPlaceNPC={handlePlaceNPC}
          onPlaceShop={handlePlaceShop}
          onPlaceCharacter={handlePlaceCharacter}
          monsters={monsters}
          campaignItems={campaignItems}
          npcs={npcs}
          shops={shops}
          playerCharacters={playerCharacters}
        />
      )}

      {isDM && tokenContextMenu && (
        <div
          className="fixed bg-gray-900 border border-gray-600 rounded-lg shadow-xl z-[10000] min-w-[140px]"
          style={{
            left: Math.min(tokenContextMenu.x, window.innerWidth - 160),
            top: Math.min(tokenContextMenu.y, window.innerHeight - 200),
          }}
          onMouseDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
        >
          <button
            className="w-full px-4 py-2 text-left text-white hover:bg-gray-700 flex items-center gap-2"
            onClick={() => {
              openTokenPanel(tokenContextMenu.tokenId);
              setTokenContextMenu(null);
            }}
          >
            <span>✏️</span>
            <span>编辑</span>
          </button>
          {hasCurrentTokenZoneSpell && (
            <button
              className="w-full px-4 py-2 text-left text-cyan-400 hover:bg-gray-700 flex items-center gap-2"
              onClick={() => {
                setZoneSpellSettlementCasterId(tokenContextMenu.tokenId);
                setZoneSpellSettlementOpen(true);
                setTokenContextMenu(null);
              }}
            >
              <span>🌫️</span>
              <span>结算环境法术</span>
            </button>
          )}
          {hasAnyZoneSpells && (
            <button
              className="w-full px-4 py-2 text-left text-amber-400 hover:bg-gray-700 flex items-center gap-2"
              onClick={() => {
                setZoneSpellSettlementCasterId(undefined);
                setZoneSpellSettlementOpen(true);
                setTokenContextMenu(null);
              }}
            >
              <span>🌍</span>
              <span>结算全部环境法术</span>
            </button>
          )}
          <button
            className="w-full px-4 py-2 text-left text-red-400 hover:bg-gray-700 flex items-center gap-2"
            onClick={() => {
              handleRemoveToken(tokenContextMenu.tokenId);
              setTokenContextMenu(null);
            }}
          >
            <span>🗑️</span>
            <span>删除</span>
          </button>
        </div>
      )}

      {!isDM && playerContextMenu && (
        <PlayerContextMenu
          x={playerContextMenu.x}
          y={playerContextMenu.y}
          gridX={playerContextMenu.gridX}
          gridY={playerContextMenu.gridY}
          mode={playerContextMenu.mode}
          onClose={() => setPlayerContextMenu(null)}
          onMove={handlePlayerMove}
          onCastSpell={handlePlayerCastSpell}
          onUseAbility={handlePlayerUseAbility}
          onToggleReaction={handlePlayerToggleReaction}
          onSettleZoneSpells={() => {
            if (playerToken) {
              setZoneSpellSettlementCasterId(playerToken.id);
              setZoneSpellSettlementOpen(true);
            }
          }}
          preparedSpells={playerSpellData.preparedSpells}
          cantrips={playerSpellData.cantrips}
          abilities={playerAbilities}
          spellSlots={playerSpellData.spellSlots}
          reactions={playerReactions}
          hasActiveZoneSpells={playerHasActiveZoneSpells}
        />
      )}
    </>
  );
}
