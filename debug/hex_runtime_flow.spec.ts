import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

const BASE_URL = process.env.PHASE3_BASE_URL ?? "http://localhost:5174";
const API_ORIGIN = process.env.PHASE3_API_ORIGIN ?? "http://localhost:8174";
const CAMPAIGN_ID = process.env.PHASE3_CAMPAIGN_ID ?? "7";
const TEST_EMAIL = process.env.PHASE3_TEST_EMAIL ?? "admin@deepwood.cn";
const TEST_PASSWORD = process.env.PHASE3_TEST_PASSWORD ?? "Test@123456";
const HEX_CASTER_CHARACTER_ID = Number(process.env.HEX_TEST_CHARACTER_ID ?? "8");
const HEX_OPTION_KEY = process.env.HEX_TEST_OPTION_KEY ?? "dexterity";
const HEX_OPTION_LABEL = process.env.HEX_TEST_OPTION_LABEL ?? "敏捷";
const HEX_TARGET_NAME = process.env.HEX_TARGET_NAME ?? "奸邪之翼 1";
const COMPONENT_POUCH_ID = "component_pouch";

type AuthPayload = {
  access_token: string;
  user: Record<string, unknown>;
};

type CampaignPayload = {
  current_map_url?: string | null;
};

type CharacterPayload = {
  equipment?: Array<Record<string, unknown>>;
};

type CharacterSheetAction = {
  id: string;
  name: string;
  damage_dice?: string | null;
  damage_type?: string | null;
  range?: { normal?: number; long?: number } | string | null;
};

type CharacterSheetPayload = {
  character: {
    id: number;
    name: string;
    level: number;
    class_id?: string | null;
    subclass_id?: string | null;
    race_id?: string | null;
    ability_scores: Record<string, number>;
  };
  actions: CharacterSheetAction[];
};

type MonsterInstancePayload = {
  id: number;
  armor_class: number;
  current_hp?: number | null;
  hit_points?: number | null;
  ability_scores: Record<string, number>;
};

type CombatAttackResponse = {
  success: boolean;
  error?: string | null;
  result?: {
    hit: boolean;
    extra_damage_dealt?: number | null;
    extra_damage_type?: string | null;
    extra_damage_roll?: { dice?: string | null; rolls?: number[] | null } | null;
  } | null;
};

type AbilityCheckResponse = {
  success: boolean;
  error?: string | null;
  result?: {
    ability_used?: string | null;
    had_disadvantage?: boolean;
    check_roll?: { rolls?: number[] | null } | null;
    advantage_reasons?: string[] | null;
  } | null;
};

type RuntimeOverlay = {
  label?: string | null;
  target_name?: string | null;
};

type RuntimeAction = {
  runtime_instance_id: number;
  action_id: string;
  action_name: string;
  available?: boolean;
  requires_target?: boolean;
};

type MapToken = {
  id: number;
  character_id?: number | null;
  monster_name?: string | null;
  monster_name_cn?: string | null;
  instance_name?: string | null;
  current_hp?: number | null;
  faction?: string | null;
  concentration_spell?: { spell_id?: string | null } | null;
  spell_overlays?: RuntimeOverlay[] | null;
  granted_actions_ui?: RuntimeAction[] | null;
};

type MapBulkDataPayload = {
  tokens?: MapToken[];
};

type CapturedTargetingEvent = {
  spellId?: string;
  spellName?: string;
  selectedOption?: string;
  characterId?: number;
  runtimeActionId?: string | null;
  sourceSpellName?: string | null;
};

function tokenDisplayName(token: MapToken): string {
  return token.instance_name || token.monster_name_cn || token.monster_name || `Token ${token.id}`;
}

function getRuntimeAction(token: MapToken, actionId: string): RuntimeAction | undefined {
  return (token.granted_actions_ui || []).find((action) => action.action_id === actionId);
}

async function apiGet<T>(
  request: APIRequestContext,
  accessToken: string,
  path: string,
): Promise<T> {
  const response = await request.get(`${API_ORIGIN}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  expect(response.ok(), `GET ${path} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function apiPost<T>(
  request: APIRequestContext,
  accessToken: string,
  path: string,
  data: Record<string, unknown>,
): Promise<T> {
  const response = await request.post(`${API_ORIGIN}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    data,
  });
  expect(response.ok(), `POST ${path} should succeed`).toBeTruthy();
  return (await response.json()) as T;
}

async function ensureLoggedIn(page: Page): Promise<AuthPayload> {
  const response = await page.request.post(`${API_ORIGIN}/api/auth/login`, {
    data: {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
  const authPayload = (await response.json()) as AuthPayload;

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((payload: AuthPayload) => {
    localStorage.setItem("dnd_auth_token", payload.access_token);
    localStorage.setItem("dnd_auth_user", JSON.stringify(payload.user));
  }, authPayload);

  return authPayload;
}

async function getCurrentMapUrl(
  request: APIRequestContext,
  accessToken: string,
): Promise<string> {
  const campaign = await apiGet<CampaignPayload>(
    request,
    accessToken,
    `/api/campaigns/${CAMPAIGN_ID}`,
  );
  expect(campaign.current_map_url, "campaign should have a current map").toBeTruthy();
  return String(campaign.current_map_url);
}

async function getSelectedCharacterId(
  request: APIRequestContext,
  accessToken: string,
): Promise<number | null> {
  const payload = await apiGet<{ selected_character_id?: number | null }>(
    request,
    accessToken,
    `/api/campaigns/${CAMPAIGN_ID}/members/me/selected-character`,
  );
  return payload.selected_character_id ?? null;
}

async function getCharacter(
  request: APIRequestContext,
  accessToken: string,
  characterId: number,
): Promise<CharacterPayload> {
  return apiGet<CharacterPayload>(request, accessToken, `/api/characters/${characterId}`);
}

async function getCharacterSheet(
  request: APIRequestContext,
  accessToken: string,
  characterId: number,
): Promise<CharacterSheetPayload> {
  return apiGet<CharacterSheetPayload>(request, accessToken, `/api/characters/${characterId}/sheet`);
}

async function getMonsterInstance(
  request: APIRequestContext,
  accessToken: string,
  monsterInstanceId: number,
): Promise<MonsterInstancePayload> {
  return apiGet<MonsterInstancePayload>(
    request,
    accessToken,
    `/api/monster-instances/${monsterInstanceId}`,
  );
}

async function setSelectedCharacterId(
  request: APIRequestContext,
  accessToken: string,
  characterId: number,
): Promise<void> {
  await apiPost(
    request,
    accessToken,
    `/api/campaigns/${CAMPAIGN_ID}/members/me/selected-character`,
    { character_id: characterId },
  );
}

async function updateCharacterEquipment(
  request: APIRequestContext,
  accessToken: string,
  characterId: number,
  equipment: Array<Record<string, unknown>>,
): Promise<void> {
  await apiPost(
    request,
    accessToken,
    `/api/characters/${characterId}`,
    { equipment },
  );
}

async function getMapTokens(
  request: APIRequestContext,
  accessToken: string,
  mapUrl: string,
): Promise<MapToken[]> {
  const payload = await apiGet<MapBulkDataPayload>(
    request,
    accessToken,
    `/api/campaigns/${CAMPAIGN_ID}/map-bulk-data?map_url=${encodeURIComponent(mapUrl)}`,
  );
  return payload.tokens || [];
}

async function waitForTokens(
  request: APIRequestContext,
  accessToken: string,
  mapUrl: string,
  predicate: (tokens: MapToken[]) => boolean,
): Promise<MapToken[]> {
  let latest: MapToken[] = [];

  await expect
    .poll(async () => {
      latest = await getMapTokens(request, accessToken, mapUrl);
      return predicate(latest);
    }, {
      timeout: 30_000,
      intervals: [500, 1_000, 2_000],
    })
    .toBeTruthy();

  return latest;
}

async function installTargetingEventCapture(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type TargetingWindow = Window & {
      __hexTargetingEvents?: Array<Record<string, unknown>>;
      __hexTargetingListenerInstalled?: boolean;
    };

    const targetWindow = window as TargetingWindow;
    targetWindow.__hexTargetingEvents = [];
    if (targetWindow.__hexTargetingListenerInstalled) {
      return;
    }

    window.addEventListener("startSpellTargeting", (event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const spell = (detail.spell || {}) as Record<string, unknown>;
      const spellRuntimeAction = (spell.__runtimeAction || {}) as Record<string, unknown>;
      const runtimeAction = (
        detail.runtimeAction
        || spellRuntimeAction
        || {}
      ) as Record<string, unknown>;
      targetWindow.__hexTargetingEvents?.push({
        spellId: spell.id ?? null,
        spellName: spell.name ?? null,
        selectedOption: detail.selectedOption ?? null,
        characterId: detail.characterId ?? null,
        runtimeActionId: runtimeAction.actionId ?? runtimeAction.action_id ?? null,
        sourceSpellName: detail.sourceSpellName ?? null,
      });
    });

    targetWindow.__hexTargetingListenerInstalled = true;
  });

  await page.evaluate(() => {
    type TargetingWindow = Window & {
      __hexTargetingEvents?: Array<Record<string, unknown>>;
      __hexTargetingListenerInstalled?: boolean;
    };

    const targetWindow = window as TargetingWindow;
    targetWindow.__hexTargetingEvents = [];
    if (targetWindow.__hexTargetingListenerInstalled) {
      return;
    }

    window.addEventListener("startSpellTargeting", (event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail || {};
      const spell = (detail.spell || {}) as Record<string, unknown>;
      const spellRuntimeAction = (spell.__runtimeAction || {}) as Record<string, unknown>;
      const runtimeAction = (
        detail.runtimeAction
        || spellRuntimeAction
        || {}
      ) as Record<string, unknown>;
      targetWindow.__hexTargetingEvents?.push({
        spellId: spell.id ?? null,
        spellName: spell.name ?? null,
        selectedOption: detail.selectedOption ?? null,
        characterId: detail.characterId ?? null,
        runtimeActionId: runtimeAction.actionId ?? runtimeAction.action_id ?? null,
        sourceSpellName: detail.sourceSpellName ?? null,
      });
    });

    targetWindow.__hexTargetingListenerInstalled = true;
  });
}

async function drainTargetingEvents(page: Page): Promise<CapturedTargetingEvent[]> {
  return page.evaluate(() => {
    type TargetingWindow = Window & {
      __hexTargetingEvents?: Array<Record<string, unknown>>;
    };

    const targetWindow = window as TargetingWindow;
    const events = [...(targetWindow.__hexTargetingEvents || [])];
    targetWindow.__hexTargetingEvents = [];
    return events as CapturedTargetingEvent[];
  });
}

async function getCapturedTargetingEventCount(page: Page): Promise<number> {
  return page.evaluate(() => {
    type TargetingWindow = Window & {
      __hexTargetingEvents?: Array<Record<string, unknown>>;
    };

    return ((window as TargetingWindow).__hexTargetingEvents || []).length;
  });
}

async function waitForNextTargetingEvent(page: Page): Promise<CapturedTargetingEvent> {
  await expect
    .poll(async () => getCapturedTargetingEventCount(page), {
      timeout: 15_000,
      intervals: [250, 500, 1_000],
    })
    .toBeGreaterThan(0);

  const events = await drainTargetingEvents(page);
  expect(events.length, "应至少捕获到一个 startSpellTargeting 事件").toBeGreaterThan(0);
  return events[events.length - 1];
}

test.describe("Hex runtime flow", () => {
  test("脆弱诅咒支持选项施法、runtime 投影和转移入口", async ({ page }) => {
    test.slow();

    const authPayload = await ensureLoggedIn(page);
    const accessToken = authPayload.access_token;
    const currentMapUrl = await getCurrentMapUrl(page.request, accessToken);
    const originalSelectedCharacterId = await getSelectedCharacterId(page.request, accessToken);
    const originalCharacter = await getCharacter(page.request, accessToken, HEX_CASTER_CHARACTER_ID);
    const originalEquipment = [...(originalCharacter.equipment || [])];
    const testEquipment = originalEquipment.map((item) => {
      if (item.equippedSlot === "main_hand" || item.equippedSlot === "off_hand") {
        return {
          ...item,
          equippedSlot: null,
          equipped: false,
          gripMode: null,
        };
      }
      return item;
    });

    let sourceTokenId: number | null = null;
    let targetTokenId: number | null = null;
    let targetOriginalHp: number | null = null;

    try {
      await updateCharacterEquipment(
        page.request,
        accessToken,
        HEX_CASTER_CHARACTER_ID,
        testEquipment,
      );

      await setSelectedCharacterId(page.request, accessToken, HEX_CASTER_CHARACTER_ID);

      await page.goto(`${BASE_URL}/campaign/${CAMPAIGN_ID}/player`, {
        waitUntil: "domcontentloaded",
      });
      await installTargetingEventCapture(page);
      await drainTargetingEvents(page);

      const tokensAfterSelection = await waitForTokens(
        page.request,
        accessToken,
        currentMapUrl,
        (tokens) => tokens.some((token) => token.character_id === HEX_CASTER_CHARACTER_ID),
      );
      const sourceToken = tokensAfterSelection.find((token) => token.character_id === HEX_CASTER_CHARACTER_ID);
      expect(sourceToken, "Hex 测试施法者 token 应存在").toBeTruthy();
      sourceTokenId = sourceToken!.id;

      expect(
        sourceToken?.concentration_spell?.spell_id
          && sourceToken.concentration_spell.spell_id !== "hex",
        "本地测试角色当前已专注其他法术，无法安全复用为 Hex 浏览器回归",
      ).toBeFalsy();

      if (sourceToken?.concentration_spell?.spell_id === "hex") {
        await apiPost(
          page.request,
          accessToken,
          `/api/tokens/${sourceToken.id}/concentration`,
          { concentration_spell: null },
        );
      }

      const initialTokens = await getMapTokens(page.request, accessToken, currentMapUrl);
      const primaryTarget = initialTokens.find((token) =>
        (token.instance_name || token.monster_name_cn || token.monster_name) === HEX_TARGET_NAME,
      );
      expect(primaryTarget, `应能在地图上找到 Hex 目标 ${HEX_TARGET_NAME}`).toBeTruthy();
      expect((primaryTarget?.current_hp || 0) > 0, "Hex 目标应处于存活状态").toBeTruthy();
      targetTokenId = primaryTarget!.id;
      targetOriginalHp = primaryTarget!.current_hp ?? null;

      const secondTarget = initialTokens.find((token) => {
        if (token.id === targetTokenId) return false;
        if (token.character_id) return false;
        return (token.current_hp || 0) > 0;
      });
      expect(secondTarget, "应有第二个活着的敌方目标用于转移验证").toBeTruthy();

      const hexEntry = page.getByText("脆弱诅咒", { exact: true }).first();
      await expect(hexEntry).toBeVisible({ timeout: 30_000 });
      await hexEntry.click();

      const castButton = page.getByRole("button", { name: "选择目标并施放" });
      await expect(page.getByRole("button", { name: "力量" })).toBeVisible();
      await expect(page.getByRole("button", { name: "敏捷" })).toBeVisible();
      await expect(page.getByRole("button", { name: "体质" })).toBeVisible();
      await expect(page.getByRole("button", { name: "智力" })).toBeVisible();
      await expect(page.getByRole("button", { name: "感知" })).toBeVisible();
      await expect(page.getByRole("button", { name: "魅力" })).toBeVisible();
      await expect(castButton).toBeDisabled();

      await page.getByRole("button", { name: HEX_OPTION_LABEL }).click();
      await expect(castButton).toBeEnabled();
      await castButton.click();

      const castTargetingEvent = await waitForNextTargetingEvent(page);
      expect(castTargetingEvent.spellId).toBe("hex");
      expect(castTargetingEvent.spellName).toBe("脆弱诅咒");
      expect(castTargetingEvent.selectedOption).toBe(HEX_OPTION_KEY);
      expect(castTargetingEvent.characterId).toBe(HEX_CASTER_CHARACTER_ID);

      await apiPost(
        page.request,
        accessToken,
        "/api/spells/cast",
        {
          spell_id: "hex",
          slot_level: 1,
          caster_token_id: sourceTokenId,
          target_token_ids: [targetTokenId],
          campaign_id: Number(CAMPAIGN_ID),
          selected_option: HEX_OPTION_KEY,
          material_id: COMPONENT_POUCH_ID,
        },
      );

      await waitForTokens(
        page.request,
        accessToken,
        currentMapUrl,
        (tokens) => {
          const source = tokens.find((token) => token.id === sourceTokenId);
          const target = tokens.find((token) => token.id === targetTokenId);
          return Boolean(
            source?.spell_overlays?.some((overlay) =>
              overlay.label?.includes(`脆弱诅咒 -> ${HEX_TARGET_NAME}（${HEX_OPTION_LABEL}）`),
            )
            && target?.spell_overlays?.some((overlay) =>
              overlay.label?.includes(`脆弱诅咒（${HEX_OPTION_LABEL}）`),
            ),
          );
        },
      );

      expect(primaryTarget?.monster_instance_id, "Hex 目标需要关联 monster instance 供战斗/检定回归使用").toBeTruthy();
      const targetMonster = await getMonsterInstance(
        page.request,
        accessToken,
        primaryTarget!.monster_instance_id!,
      );
      const characterSheet = await getCharacterSheet(
        page.request,
        accessToken,
        HEX_CASTER_CHARACTER_ID,
      );
      const attackAction = (
        characterSheet.actions.find((action) =>
          Boolean(action.damage_dice && action.range && typeof action.range === "object" && action.range.normal),
        )
        || characterSheet.actions.find((action) => Boolean(action.damage_dice))
      );
      expect(attackAction, "Hex 浏览器回归需要至少一个可用武器攻击动作").toBeTruthy();

      const attackResponse = await apiPost<CombatAttackResponse>(
        page.request,
        accessToken,
        "/api/combat/attack",
        {
          campaign_id: Number(CAMPAIGN_ID),
          attacker_token_id: sourceTokenId,
          attacker_character_id: HEX_CASTER_CHARACTER_ID,
          target_token_id: targetTokenId,
          attack: {
            key: attackAction!.id,
            name: attackAction!.name,
            damage: attackAction!.damage_dice,
            damage_type: attackAction!.damage_type,
            normal_range: typeof attackAction!.range === "object" ? attackAction!.range?.normal : undefined,
            max_range: typeof attackAction!.range === "object" ? attackAction!.range?.long : undefined,
            is_special: false,
            weapon_proficient: true,
            is_off_hand: false,
          },
          distance_feet: 25,
          attacker: {
            name: characterSheet.character.name,
            level: characterSheet.character.level,
            class_id: characterSheet.character.class_id,
            subclass_id: characterSheet.character.subclass_id,
            race_id: characterSheet.character.race_id,
            ability_scores: characterSheet.character.ability_scores,
            proficiency_bonus: Math.floor((characterSheet.character.level - 1) / 4) + 2,
            crit_range: 20,
          },
          target: {
            name: HEX_TARGET_NAME,
            ac: targetMonster.armor_class,
            current_hp: targetMonster.current_hp,
            max_hp: targetMonster.hit_points,
            damage_resistances: [],
            damage_immunities: [],
          },
          auto_apply: true,
          forced_d20: 18,
        },
      );
      expect(attackResponse.success, attackResponse.error || "Hex 攻击应成功").toBe(true);
      expect(attackResponse.result?.hit).toBe(true);
      expect(attackResponse.result?.extra_damage_roll?.dice).toBe("1d6");
      expect(attackResponse.result?.extra_damage_dealt || 0).toBeGreaterThan(0);
      expect(attackResponse.result?.extra_damage_type).toBeTruthy();

      const abilityCheckResponse = await apiPost<AbilityCheckResponse>(
        page.request,
        accessToken,
        "/api/combat/ability-check",
        {
          campaign_id: Number(CAMPAIGN_ID),
          participant: {
            name: HEX_TARGET_NAME,
            token_id: targetTokenId,
            monster_instance_id: primaryTarget!.monster_instance_id,
            ability_scores: {
              strength: targetMonster.ability_scores.strength,
              dexterity: targetMonster.ability_scores.dexterity,
              constitution: targetMonster.ability_scores.constitution,
              intelligence: targetMonster.ability_scores.intelligence,
              wisdom: targetMonster.ability_scores.wisdom,
              charisma: targetMonster.ability_scores.charisma,
            },
            level: 1,
            proficiency_bonus: 2,
          },
          check_type: HEX_OPTION_KEY,
          description: "Hex runtime 浏览器回归",
        },
      );
      expect(abilityCheckResponse.success, abilityCheckResponse.error || "Hex 属性检定应成功").toBe(true);
      expect(abilityCheckResponse.result?.ability_used).toBe(HEX_OPTION_KEY);
      expect(abilityCheckResponse.result?.had_disadvantage).toBe(true);
      expect(abilityCheckResponse.result?.check_roll?.rolls?.length).toBe(2);

      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByText(/脆弱诅咒.*专注/).first()).toBeVisible({ timeout: 30_000 });

      await apiPost(
        page.request,
        accessToken,
        `/api/tokens/${targetTokenId}/hp`,
        {
          current_hp: 0,
          force: true,
        },
      );

      const unlockedTokens = await waitForTokens(
        page.request,
        accessToken,
        currentMapUrl,
        (tokens) => {
          const source = tokens.find((token) => token.id === sourceTokenId);
          return Boolean(getRuntimeAction(source || { id: -1 }, "transfer_hex")?.available);
        },
      );

      const unlockedSource = unlockedTokens.find((token) => token.id === sourceTokenId);
      const transferAction = getRuntimeAction(unlockedSource || { id: -1 }, "transfer_hex");
      expect(transferAction?.requires_target).toBe(true);

      await page.reload({ waitUntil: "domcontentloaded" });
      const spellActionsButton = page.getByText(/法术动作\s*1/).first();
      await expect(spellActionsButton).toBeVisible({ timeout: 30_000 });
      await spellActionsButton.click();
      const transferActionButton = page.getByText(/转移诅咒/).first();
      await expect(transferActionButton).toBeVisible();
      await transferActionButton.click();

      const transferTargetingEvent = await waitForNextTargetingEvent(page);
      expect(transferTargetingEvent.spellName).toContain("转移诅咒");
      expect(transferTargetingEvent.sourceSpellName).toBe("脆弱诅咒");
      await expect(page.getByText("选择攻击目标 — 💀 转移诅咒")).toBeVisible();

      await apiPost(
        page.request,
        accessToken,
        "/api/spells/runtime-actions/execute",
        {
          runtime_instance_id: transferAction?.runtime_instance_id,
          action_id: transferAction?.action_id,
          actor_token_id: sourceTokenId,
          target_token_id: secondTarget!.id,
        },
      );

      await waitForTokens(
        page.request,
        accessToken,
        currentMapUrl,
        (tokens) => {
          const source = tokens.find((token) => token.id === sourceTokenId);
          const originalTarget = tokens.find((token) => token.id === targetTokenId);
          const newTarget = tokens.find((token) => token.id === secondTarget!.id);
          return Boolean(
            source?.spell_overlays?.some((overlay) =>
              overlay.label?.includes(`脆弱诅咒 -> ${tokenDisplayName(secondTarget!)}（${HEX_OPTION_LABEL}）`),
            )
            && !getRuntimeAction(source || { id: -1 }, "transfer_hex")?.available
            && !(originalTarget?.spell_overlays || []).some((overlay) => overlay.label?.includes("脆弱诅咒"))
            && (newTarget?.spell_overlays || []).some((overlay) => overlay.label?.includes(`脆弱诅咒（${HEX_OPTION_LABEL}）`))
          );
        },
      );
    } finally {
      await page.request.post(`${API_ORIGIN}/api/characters/${HEX_CASTER_CHARACTER_ID}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        data: {
          equipment: originalEquipment,
        },
      });

      if (targetTokenId && targetOriginalHp !== null) {
        await page.request.post(`${API_ORIGIN}/api/tokens/${targetTokenId}/hp`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          data: {
            current_hp: targetOriginalHp,
            force: true,
          },
        });
      }

      if (
        originalSelectedCharacterId !== null
        && originalSelectedCharacterId !== HEX_CASTER_CHARACTER_ID
      ) {
        await page.request.post(`${API_ORIGIN}/api/campaigns/${CAMPAIGN_ID}/members/me/selected-character`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          data: {
            character_id: originalSelectedCharacterId,
          },
        });
      } else if (sourceTokenId) {
        await page.request.post(`${API_ORIGIN}/api/tokens/${sourceTokenId}/concentration`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          data: {
            concentration_spell: null,
          },
        });
      }
    }
  });
});
