import { ChestInteractionModal } from "../campaign/ChestInteractionModal";
import { ChestInventoryModal } from "../campaign/ChestInventoryModal";
import { ShopTransactionModal } from "../campaign/ShopTransactionModal";
import { SpellDetailModal } from "~/components/spell/SpellSelectableCard";

import { DampenElementsModal } from "./DampenElementsModal";
import { IllusionEditModal } from "./IllusionEditModal";
import { InvokeDuplicityModal } from "./InvokeDuplicityModal";
import { ItemTokenModal } from "./ItemTokenModal";
import { KnowledgeOfTheAgesModal } from "./KnowledgeOfTheAgesModal";
import { LootBagModal } from "./LootBagModal";
import { PlayerNoteModal } from "./PlayerNoteModal";
import { PreserveLifeModal } from "./PreserveLifeModal";
import { ShopTokenModal } from "./ShopTokenModal";
import { ToolCheckModal } from "./ToolCheckModal";
import { TransformationModal } from "./TransformationModal";
import { VisionsOfThePastModal } from "./VisionsOfThePastModal";
import { WrathOfTheStormModal } from "./WrathOfTheStormModal";
import { ZoneSpellSettlementModal } from "./ZoneSpellSettlementModal";
import type { PlayerAvatar, Token } from "./types/TacticalMapTypes";

interface MapSpecialActionDialogsProps {
  isDM: boolean;
  campaignId: string;
  userId?: string;
  selectedCharacterId?: number | null;
  currentMapUrl?: string | null;
  gridUnitLength: number;
  tokens: Token[];
  playerAvatars: PlayerAvatar[];
  playerNoteTokenId: number | null;
  playerNoteToken: Token | null;
  setPlayerNoteTokenId: (tokenId: number | null) => void;
  illusionEditTokenId: number | null;
  illusionEditToken: Token | null;
  setIllusionEditTokenId: (tokenId: number | null) => void;
  setTokens: Dispatch<SetStateAction<Token[]>>;
  itemDetailToken: Token | null;
  setItemDetailTokenId: (tokenId: number | null) => void;
  handlePickupItem: (tokenId: number, characterId?: number) => void;
  handleDeleteItem: (tokenId: number) => void;
  lootBagToken: Token | null;
  setLootBagTokenId: (tokenId: number | null) => void;
  handleLootFromBag: (...args: any[]) => void;
  handleDeleteLootBag: (tokenId: number) => void;
  shopToken: Token | null;
  setShopTokenModalId: (tokenId: number | null) => void;
  handleDeleteShopToken: (tokenId: number) => void;
  shopTxnOpen: boolean;
  handleShopTxnOpenChange: (open: boolean) => void;
  shopTxnShop: any;
  shopTxnTokenId: number | null;
  chestModalOpen: boolean;
  handleChestModalOpenChange: (open: boolean) => void;
  chestModalChest: any;
  chestModalCharacters: Array<{ id: number; name: string; user_id: string }>;
  setChestModalChest: (value: any) => void;
  chestManageModalOpen: boolean;
  handleChestManageModalOpenChange: (open: boolean) => void;
  chestManageChest: any;
  transformModalOpen: boolean;
  setTransformModalOpen: (open: boolean) => void;
  transformTokenId: number | null;
  setTransformTokenId: (tokenId: number | null) => void;
  transformTokenIdRef: MutableRefObject<number | null>;
  transformConfigId: string;
  handleTransformComplete: (...args: any[]) => void;
  sourceCharacterData: any;
  preserveLifeModal: any;
  setPreserveLifeModal: (value: any) => void;
  handlePreserveLifeConfirm: (...args: any[]) => void;
  dampenElementsModal: any;
  setDampenElementsModal: (value: any) => void;
  handleDampenElementsConfirm: (...args: any[]) => void;
  wrathOfTheStormModal: any;
  setWrathOfTheStormModal: (value: any) => void;
  handleWrathOfTheStormConfirm: (...args: any[]) => void;
  toolCheckRequest: any;
  setToolCheckRequest: (value: any) => void;
  handleSubmitToolCheck: (...args: any[]) => void;
  knowledgeOfTheAgesModal: any;
  setKnowledgeOfTheAgesModal: (value: any) => void;
  handleKnowledgeOfTheAgesConfirm: (...args: any[]) => void;
  visionsOfThePastModal: any;
  setVisionsOfThePastModal: (value: any) => void;
  handleVisionsOfThePastConfirm: (...args: any[]) => void;
  invokeDuplicityModal: any;
  setInvokeDuplicityModal: (value: any) => void;
  handleInvokeDuplicityModalConfirm: (count: number) => void;
  zoneSpellSettlementOpen: boolean;
  setZoneSpellSettlementOpen: (open: boolean) => void;
  zoneSpellSettlementCasterId?: number;
  setZoneSpellSettlementCasterId: (tokenId: number | undefined) => void;
  sendMessage: (message: any) => void;
  concentrationSpellDetail: any;
  setConcentrationSpellDetail: (value: any) => void;
}

export function MapSpecialActionDialogs({
  isDM,
  campaignId,
  userId,
  selectedCharacterId,
  currentMapUrl,
  gridUnitLength,
  tokens,
  playerAvatars,
  playerNoteTokenId,
  playerNoteToken,
  setPlayerNoteTokenId,
  illusionEditTokenId,
  illusionEditToken,
  setIllusionEditTokenId,
  setTokens,
  itemDetailToken,
  setItemDetailTokenId,
  handlePickupItem,
  handleDeleteItem,
  lootBagToken,
  setLootBagTokenId,
  handleLootFromBag,
  handleDeleteLootBag,
  shopToken,
  setShopTokenModalId,
  handleDeleteShopToken,
  shopTxnOpen,
  handleShopTxnOpenChange,
  shopTxnShop,
  shopTxnTokenId,
  chestModalOpen,
  handleChestModalOpenChange,
  chestModalChest,
  chestModalCharacters,
  setChestModalChest,
  chestManageModalOpen,
  handleChestManageModalOpenChange,
  chestManageChest,
  transformModalOpen,
  setTransformModalOpen,
  transformTokenId,
  setTransformTokenId,
  transformTokenIdRef,
  transformConfigId,
  handleTransformComplete,
  sourceCharacterData,
  preserveLifeModal,
  setPreserveLifeModal,
  handlePreserveLifeConfirm,
  dampenElementsModal,
  setDampenElementsModal,
  handleDampenElementsConfirm,
  wrathOfTheStormModal,
  setWrathOfTheStormModal,
  handleWrathOfTheStormConfirm,
  toolCheckRequest,
  setToolCheckRequest,
  handleSubmitToolCheck,
  knowledgeOfTheAgesModal,
  setKnowledgeOfTheAgesModal,
  handleKnowledgeOfTheAgesConfirm,
  visionsOfThePastModal,
  setVisionsOfThePastModal,
  handleVisionsOfThePastConfirm,
  invokeDuplicityModal,
  setInvokeDuplicityModal,
  handleInvokeDuplicityModalConfirm,
  zoneSpellSettlementOpen,
  setZoneSpellSettlementOpen,
  zoneSpellSettlementCasterId,
  setZoneSpellSettlementCasterId,
  sendMessage,
  concentrationSpellDetail,
  setConcentrationSpellDetail,
}: MapSpecialActionDialogsProps) {
  const transformToken = transformTokenId
    ? tokens.find((token) => token.id === transformTokenId) || null
    : null;
  const transformLevel = transformToken?.character_level ?? undefined;
  const transformSubclass = sourceCharacterData?.subclass_id;

  return (
    <>
      <PlayerNoteModal
        token={playerNoteToken}
        isOpen={playerNoteTokenId !== null}
        campaignId={campaignId}
        onClose={() => setPlayerNoteTokenId(null)}
      />

      {illusionEditTokenId && (
        <IllusionEditModal
          token={illusionEditToken}
          campaignId={campaignId}
          disguiseMode={!!(illusionEditToken?.disguise_data && !illusionEditToken?.item_data?.type)}
          onClose={() => setIllusionEditTokenId(null)}
          onUpdated={(tokenId, imageUrl, displayName) => {
            setTokens((previous) =>
              previous.map((token) => {
                if (token.id !== tokenId) return token;
                if (token.disguise_data && !token.item_data?.type) {
                  return {
                    ...token,
                    disguise_data: {
                      ...token.disguise_data,
                      disguise_avatar: imageUrl,
                      description: displayName || token.disguise_data.description,
                    },
                  };
                }
                if (!token.item_data) return token;
                return {
                  ...token,
                  instance_name: displayName || token.instance_name,
                  item_data: {
                    ...token.item_data,
                    icon: imageUrl,
                    avatar_url: imageUrl,
                    avatar_url_large: imageUrl,
                  },
                };
              }),
            );
          }}
        />
      )}

      <ItemTokenModal
        token={itemDetailToken}
        isDM={isDM}
        userId={userId}
        campaignId={campaignId}
        campaignCharacters={playerAvatars.filter((avatar) => avatar.type !== "monster")}
        onClose={() => setItemDetailTokenId(null)}
        onPickup={handlePickupItem}
        onPickupToCharacter={(tokenId, characterId) =>
          handlePickupItem(tokenId, typeof characterId === "number" ? characterId : Number(characterId))
        }
        onDelete={handleDeleteItem}
      />

      <LootBagModal
        token={lootBagToken}
        isDM={isDM}
        characterId={selectedCharacterId ?? undefined}
        campaignId={campaignId}
        onClose={() => setLootBagTokenId(null)}
        onLoot={async (...args) => {
          await handleLootFromBag(...args);
        }}
        onDelete={async (tokenId) => {
          await handleDeleteLootBag(tokenId);
        }}
      />

      <ShopTokenModal
        token={shopToken}
        isDM={isDM}
        onClose={() => setShopTokenModalId(null)}
        onDelete={handleDeleteShopToken}
      />

      <ShopTransactionModal
        open={shopTxnOpen}
        onOpenChange={handleShopTxnOpenChange}
        shop={shopTxnShop}
        defaultCharacterId={selectedCharacterId ?? undefined}
        campaignId={campaignId}
        isDM={isDM}
        tokenId={shopTxnTokenId ?? undefined}
        onDeleteToken={(tokenId) => handleDeleteShopToken(tokenId)}
      />

      <ChestInteractionModal
        open={chestModalOpen}
        onOpenChange={handleChestModalOpenChange}
        chest={chestModalChest}
        campaignId={campaignId}
        characters={chestModalCharacters}
        currentUserId={userId}
        isDM={isDM}
        onChestUpdated={(updatedChest) => setChestModalChest(updatedChest)}
      />

      <ChestInventoryModal
        open={chestManageModalOpen}
        onOpenChange={handleChestManageModalOpenChange}
        campaignId={campaignId}
        chest={chestManageChest}
        onUpdated={() => {}}
      />

      <TransformationModal
        isOpen={transformModalOpen}
        onClose={() => {
          setTransformModalOpen(false);
          setTransformTokenId(null);
          transformTokenIdRef.current = null;
        }}
        onSelectCreature={handleTransformComplete}
        configId={transformConfigId}
        characterLevel={transformLevel ?? sourceCharacterData?.level ?? 2}
        subclassId={transformConfigId === "wild_shape" ? transformSubclass : undefined}
        targetLevel={transformLevel}
        casterCharacterId={sourceCharacterData?.id}
        casterName={sourceCharacterData?.name}
      />

      <PreserveLifeModal
        open={!!preserveLifeModal}
        sourceName={preserveLifeModal?.sourceName || "生命牧师"}
        totalPool={preserveLifeModal?.totalPool || 0}
        channelDivinityCurrent={preserveLifeModal?.channelDivinityCurrent || 0}
        channelDivinityMax={preserveLifeModal?.channelDivinityMax || 0}
        targets={preserveLifeModal?.targets || []}
        onCancel={() => setPreserveLifeModal(null)}
        onConfirm={handlePreserveLifeConfirm}
      />

      <DampenElementsModal
        open={!!dampenElementsModal}
        sourceName={dampenElementsModal?.sourceName || "自然牧师"}
        targetName={dampenElementsModal?.targetName || "目标"}
        onCancel={() => setDampenElementsModal(null)}
        onConfirm={handleDampenElementsConfirm}
      />

      <WrathOfTheStormModal
        open={!!wrathOfTheStormModal}
        sourceName={wrathOfTheStormModal?.sourceName || "风暴牧师"}
        targetName={wrathOfTheStormModal?.targetName || "目标"}
        onCancel={() => setWrathOfTheStormModal(null)}
        onConfirm={handleWrathOfTheStormConfirm}
      />

      <ToolCheckModal
        open={!!toolCheckRequest}
        request={toolCheckRequest}
        characterData={
          toolCheckRequest?.characterId && sourceCharacterData?.id === toolCheckRequest.characterId
            ? sourceCharacterData
            : null
        }
        onOpenChange={(open) => {
          if (!open) {
            setToolCheckRequest(null);
          }
        }}
        onSubmit={handleSubmitToolCheck}
      />

      <KnowledgeOfTheAgesModal
        open={!!knowledgeOfTheAgesModal}
        sourceName={knowledgeOfTheAgesModal?.sourceName || "知识牧师"}
        characterData={
          knowledgeOfTheAgesModal?.sourceCharacterId &&
          sourceCharacterData?.id === knowledgeOfTheAgesModal.sourceCharacterId
            ? sourceCharacterData
            : null
        }
        onCancel={() => setKnowledgeOfTheAgesModal(null)}
        onConfirm={handleKnowledgeOfTheAgesConfirm}
      />

      <VisionsOfThePastModal
        open={!!visionsOfThePastModal}
        sourceName={visionsOfThePastModal?.sourceName || "知识牧师"}
        suggestedMode={visionsOfThePastModal?.suggestedMode || "area"}
        suggestedFocus={visionsOfThePastModal?.suggestedFocus || ""}
        onCancel={() => setVisionsOfThePastModal(null)}
        onConfirm={handleVisionsOfThePastConfirm}
      />

      <InvokeDuplicityModal
        open={!!invokeDuplicityModal}
        sourceName={invokeDuplicityModal?.sourceName || "诡术牧师"}
        maxDuplicates={invokeDuplicityModal?.maxDuplicates || 1}
        onCancel={() => setInvokeDuplicityModal(null)}
        onConfirm={handleInvokeDuplicityModalConfirm}
      />

      <ZoneSpellSettlementModal
        open={zoneSpellSettlementOpen}
        onClose={() => {
          setZoneSpellSettlementOpen(false);
          setZoneSpellSettlementCasterId(undefined);
        }}
        campaignId={campaignId}
        tokens={tokens}
        currentMapUrl={currentMapUrl}
        gridUnitLength={gridUnitLength}
        isDM={isDM}
        userId={userId}
        filterCasterTokenId={zoneSpellSettlementCasterId}
        onSettlementComplete={(results) => {
          if (results && results.length > 0) {
            sendMessage({
              type: "zone_spell_settled",
              data: { results },
            });
          }
        }}
      />

      <SpellDetailModal
        spell={concentrationSpellDetail}
        onClose={() => setConcentrationSpellDetail(null)}
      />
    </>
  );
}
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
