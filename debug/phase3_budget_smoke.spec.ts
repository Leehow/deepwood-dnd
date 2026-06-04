import { expect, test, type Page, type Request } from "@playwright/test";

const BASE_URL = process.env.PHASE3_BASE_URL ?? "http://localhost:5174";
const API_ORIGIN = process.env.PHASE3_API_ORIGIN ?? "http://localhost:8174";
const CAMPAIGN_ID = process.env.PHASE3_CAMPAIGN_ID ?? "7";
const TEST_EMAIL = process.env.PHASE3_TEST_EMAIL ?? "admin@deepwood.cn";
const TEST_PASSWORD = process.env.PHASE3_TEST_PASSWORD ?? "Test@123456";
const BUDGET_WINDOW_MS = 5_000;

type BudgetCounters = {
  campaign: number;
  mapSettings: number;
  combatCurrent: number;
  mapBulkData: number;
  tokensByMap: number;
  chatMessages: number;
};

function createEmptyCounters(): BudgetCounters {
  return {
    campaign: 0,
    mapSettings: 0,
    combatCurrent: 0,
    mapBulkData: 0,
    tokensByMap: 0,
    chatMessages: 0,
  };
}

function trackBudgetRequest(
  reqUrl: string,
  counters: BudgetCounters,
  badIdentityParamUrls: string[],
) {
  let parsed: URL;
  try {
    parsed = new URL(reqUrl);
  } catch {
    return;
  }

  if (parsed.origin !== API_ORIGIN) return;

  const path = parsed.pathname;
  const params = parsed.searchParams;
  const hasLegacyIdentityParam = params.has("user_id") || params.has("role");

  const campaignPath = `/api/campaigns/${CAMPAIGN_ID}`;
  const mapSettingsPrefix = `/api/map-settings/${CAMPAIGN_ID}/`;
  const combatPath = `/api/campaigns/${CAMPAIGN_ID}/storage/combat/current`;
  const mapBulkPath = `/api/campaigns/${CAMPAIGN_ID}/map-bulk-data`;
  const tokensByMapPath = `/api/tokens/campaign/${CAMPAIGN_ID}/map`;
  const chatMessagesPath = `/api/campaigns/${CAMPAIGN_ID}/chat/messages`;

  if (path === campaignPath) {
    counters.campaign += 1;
  } else if (path.startsWith(mapSettingsPrefix)) {
    counters.mapSettings += 1;
  } else if (path === combatPath) {
    counters.combatCurrent += 1;
  } else if (path === mapBulkPath) {
    counters.mapBulkData += 1;
  } else if (path === tokensByMapPath) {
    counters.tokensByMap += 1;
  } else if (path === chatMessagesPath) {
    counters.chatMessages += 1;
  } else {
    return;
  }

  if (hasLegacyIdentityParam) {
    badIdentityParamUrls.push(parsed.toString());
  }
}

async function ensureLoggedIn(page: Page) {
  const response = await page.request.post(`${API_ORIGIN}/api/auth/login`, {
    data: {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    },
  });
  expect(response.ok()).toBeTruthy();
  const authPayload = (await response.json()) as {
    access_token: string;
    user: Record<string, unknown>;
  };

  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
  await page.evaluate((payload) => {
    localStorage.setItem("dnd_auth_token", payload.access_token);
    localStorage.setItem("dnd_auth_user", JSON.stringify(payload.user));
  }, authPayload);
}

async function runBudgetSmoke(
  page: Page,
  routeRole: "dm" | "player",
) {
  const counters = createEmptyCounters();
  const badIdentityParamUrls: string[] = [];
  const consoleErrors: string[] = [];
  const startAt = Date.now();

  const onRequestFinished = (request: Request) => {
    if (Date.now() - startAt > BUDGET_WINDOW_MS) return;
    trackBudgetRequest(request.url(), counters, badIdentityParamUrls);
  };

  page.on("requestfinished", onRequestFinished);
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto(`${BASE_URL}/campaign/${CAMPAIGN_ID}/${routeRole}`, {
    waitUntil: "domcontentloaded",
  });
  await page.waitForTimeout(BUDGET_WINDOW_MS);

  page.off("requestfinished", onRequestFinished);

  return { counters, badIdentityParamUrls, consoleErrors };
}

test.describe("Phase 3 budget smoke", () => {
  test("DM 首屏预算与契约断言", async ({ page }) => {
    await ensureLoggedIn(page);
    const result = await runBudgetSmoke(page, "dm");
    await expect(page).toHaveURL(new RegExp(`/campaign/${CAMPAIGN_ID}/dm$`));

    expect(result.counters.campaign).toBeLessThanOrEqual(1);
    expect(result.counters.mapSettings).toBeLessThanOrEqual(1);
    expect(result.counters.combatCurrent).toBeLessThanOrEqual(1);
    expect(result.counters.mapBulkData).toBeLessThanOrEqual(1);
    expect(result.counters.tokensByMap).toBeLessThanOrEqual(1);
    expect(result.counters.chatMessages).toBeLessThanOrEqual(2);
    expect(result.badIdentityParamUrls).toEqual([]);
    expect(result.consoleErrors).toEqual([]);
  });

  test("Player 首屏预算与契约断言", async ({ page }) => {
    await ensureLoggedIn(page);
    const result = await runBudgetSmoke(page, "player");
    await expect(page).toHaveURL(new RegExp(`/campaign/${CAMPAIGN_ID}/player$`));

    expect(result.counters.campaign).toBeLessThanOrEqual(1);
    expect(result.counters.mapSettings).toBeLessThanOrEqual(1);
    expect(result.counters.combatCurrent).toBeLessThanOrEqual(1);
    expect(result.counters.mapBulkData).toBeLessThanOrEqual(1);
    expect(result.counters.tokensByMap).toBeLessThanOrEqual(1);
    expect(result.counters.chatMessages).toBeLessThanOrEqual(2);
    expect(result.badIdentityParamUrls).toEqual([]);
    expect(result.consoleErrors).toEqual([]);
  });
});
