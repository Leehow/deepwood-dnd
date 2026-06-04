#!/usr/bin/env python3
"""
全量法术效果测试脚本
对 361 个法术逐一调用 POST /api/spells/cast，
用 LLM 评判每个结果是否合理。
"""
import sys, os, json, time, asyncio, httpx, re
from pathlib import Path
from dataclasses import dataclass, field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from app.utils.rules_cache import get_all_spells

# ── 配置 ──
API_BASE = "http://localhost:8174"
LLM_URL = "https://yunwu.ai/v1/chat/completions"
LLM_KEY = "REDACTED_API_KEY"
LLM_MODEL = "gpt-5.2"

# Token IDs (campaign=2)
CASTER = 161       # 艾利安·晨语 (wizard, char_id=21)
ENEMY = 369        # 灰矮人灵刃使 (monster)
ENEMY2 = 373       # 灰矮人灵刃使 3
ALLY = 36          # 铁锤·雷岩 (character)
CAMPAIGN = 2

CLEAN_SQL = """
UPDATE tokens SET active_effects = '[]'::jsonb, concentration_spell = NULL, temp_hp = NULL
WHERE id IN (161, 369, 373, 36);
UPDATE tokens SET current_hp = 18 WHERE id IN (369, 373);
UPDATE tokens SET current_hp = 13 WHERE id = 36;
UPDATE tokens SET current_hp = 59 WHERE id = 161;
"""

# ── 数据结构 ──
@dataclass
class SpellTestResult:
    spell_id: str
    spell_name: str
    level: int
    category: str  # self_buff / self_area / touch / ranged_single / ranged_area
    api_success: bool
    api_error: str = ""
    total_damage: int = 0
    total_healing: int = 0
    concentration_set: bool = False
    results_summary: str = ""
    llm_verdict: str = ""  # PASS / WARN / FAIL
    llm_reason: str = ""


def classify_spell(s: dict) -> str:
    rng = s.get("range", "")
    area = s.get("areaOfEffect")
    if rng == "自身" and not area:
        return "self_buff"
    if "自身" in rng and area:
        return "self_area"
    if rng == "触及":
        return "touch"
    if area:
        return "ranged_area"
    return "ranged_single"


def pick_targets(spell: dict, cat: str) -> list[int]:
    """Pick appropriate target token IDs based on spell type."""
    # Healing / buff spells → ally or self
    effects = spell.get("effects", [])
    effect_types = set()
    for phase in effects:
        for e in phase.get("effects", []):
            effect_types.add(e.get("type", ""))

    is_beneficial = bool(effect_types & {
        "heal", "grant_temp_hp", "modify_stat", "modify_roll",
        "grant_resistance", "grant_advantage",
    }) and "deal_damage" not in effect_types and "apply_condition" not in effect_types

    if cat == "self_buff":
        return [CASTER]
    if cat == "self_area":
        return [ENEMY]
    if cat == "touch":
        return [ALLY] if is_beneficial else [ENEMY]
    if cat == "ranged_area":
        return [ENEMY, ENEMY2]
    # ranged_single
    return [ALLY] if is_beneficial else [ENEMY]


def summarize_results(d: dict) -> str:
    """Build a compact summary string of spell results."""
    parts = []
    for r in d.get("results", []):
        t = r["type"]
        if t == "narrative":
            continue
        p = [t]
        if r.get("damage_dealt"): p.append(f"dmg={r['damage_dealt']}")
        if r.get("healing_done"): p.append(f"heal={r['healing_done']}")
        if r.get("temp_hp_granted"): p.append(f"thp={r['temp_hp_granted']}")
        if r.get("condition_applied"): p.append(f"cond={r['condition_applied']}")
        if r.get("condition_immune"): p.append("IMMUNE")
        if r.get("save_rolled"):
            p.append(f"save={'OK' if r['save_succeeded'] else 'FAIL'}")
        if r.get("attack_rolled"):
            p.append(f"atk={'HIT' if r['attack_hit'] else 'MISS'}")
        if r.get("formula_breakdown"):
            p.append(r["formula_breakdown"])
        parts.append(" ".join(p))
    return "; ".join(parts) if parts else "(no mechanic results)"


async def cast_spell(client: httpx.AsyncClient, spell_id: str, slot_level: int, targets: list[int]) -> dict:
    try:
        resp = await client.post(f"{API_BASE}/api/spells/cast", json={
            "spell_id": spell_id,
            "slot_level": slot_level,
            "caster_token_id": CASTER,
            "target_token_ids": targets,
            "campaign_id": CAMPAIGN,
        }, timeout=10)
        if resp.status_code == 200:
            return resp.json()
        # Extract last line of traceback
        text = resp.text
        lines = text.strip().split("\n")
        err = lines[-1] if lines else text[:200]
        return {"success": False, "error": err}
    except Exception as e:
        return {"success": False, "error": str(e)}


async def clean_db(client: httpx.AsyncClient):
    """Reset test tokens via raw SQL through a quick Python call."""
    from sqlalchemy import text as sql_text
    from app.db.session import async_session_maker
    async with async_session_maker() as db:
        for stmt in CLEAN_SQL.strip().split(";"):
            stmt = stmt.strip()
            if stmt:
                await db.execute(sql_text(stmt))
        await db.commit()


async def llm_judge_batch(client: httpx.AsyncClient, batch: list[tuple[dict, SpellTestResult]]) -> None:
    """Send a batch of spell results to LLM for evaluation."""
    prompt_parts = []
    for spell_data, result in batch:
        desc_en = spell_data.get("descriptionEn", "")[:200]
        prompt_parts.append(
            f"Spell: {result.spell_name} (Lv{result.level}, {result.category})\n"
            f"Description: {desc_en}\n"
            f"API result: success={result.api_success}, dmg={result.total_damage}, "
            f"heal={result.total_healing}, conc={result.concentration_set}\n"
            f"Effects: {result.results_summary}\n"
        )

    system = (
        "You are a D&D 5E rules expert reviewing automated spell effect test results. "
        "For each spell, judge if the API result is reasonable:\n"
        "- PASS: effects match the spell description (damage type, save type, healing, conditions, buffs are correct)\n"
        "- WARN: minor issue (e.g. damage seems low/high but within variance, missing flavor)\n"
        "- FAIL: clearly wrong (wrong damage type, wrong save, heal spell doing damage, etc.)\n"
        "Note: attack/save rolls are random, so MISS or save-SUCCESS is normal.\n"
        "Note: '(no mechanic results)' is OK for pure-narrative/deferred spells (smites, polymorph, etc.)\n\n"
        "Reply with EXACTLY one line per spell in format:\n"
        "SPELL_ID: VERDICT | brief reason\n"
        "Example: fireball: PASS | 8d6 fire damage with DEX save is correct\n"
    )

    try:
        resp = await client.post(LLM_URL, headers={
            "Authorization": f"Bearer {LLM_KEY}",
            "Content-Type": "application/json",
        }, json={
            "model": LLM_MODEL,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": "\n---\n".join(prompt_parts)},
            ],
            "temperature": 0.1,
            "max_tokens": 2000,
        }, timeout=60)
        if resp.status_code != 200:
            for _, result in batch:
                result.llm_verdict = "ERROR"
                result.llm_reason = f"LLM API {resp.status_code}"
            return

        content = resp.json()["choices"][0]["message"]["content"]
        # Parse line by line
        verdicts = {}
        for line in content.strip().split("\n"):
            line = line.strip()
            if not line:
                continue
            # Try to match "spell_id: VERDICT | reason" or similar
            m = re.match(r"[*\-\d.]*\s*[`]?(\S+?)[`]?\s*:\s*(PASS|WARN|FAIL)\s*\|\s*(.*)", line, re.I)
            if m:
                sid = m.group(1).lower().strip()
                verdicts[sid] = (m.group(2).upper(), m.group(3).strip())

        for spell_data, result in batch:
            v = verdicts.get(result.spell_id) or verdicts.get(result.spell_name)
            if v:
                result.llm_verdict, result.llm_reason = v
            else:
                result.llm_verdict = "N/A"
                result.llm_reason = "LLM did not return verdict"

    except Exception as e:
        for _, result in batch:
            result.llm_verdict = "ERROR"
            result.llm_reason = str(e)[:100]


async def main():
    spells = get_all_spells()
    spells.sort(key=lambda s: (s.get("level", 0), s.get("id", "")))
    total = len(spells)
    print(f"Testing {total} spells...\n")

    results: list[SpellTestResult] = []
    pending_judge: list[tuple[dict, SpellTestResult]] = []
    BATCH_SIZE = 15
    CLEAN_EVERY = 20  # clean DB every N spells to avoid state buildup

    async with httpx.AsyncClient() as client:
        for i, spell in enumerate(spells):
            sid = spell["id"]
            name = spell["name"]
            level = spell.get("level", 0)
            cat = classify_spell(spell)
            slot = max(level, 1) if level > 0 else 0
            targets = pick_targets(spell, cat)

            # Call API
            d = await cast_spell(client, sid, slot, targets)
            tr = SpellTestResult(
                spell_id=sid, spell_name=name, level=level, category=cat,
                api_success=d.get("success", False),
                api_error=d.get("error", ""),
                total_damage=d.get("total_damage", 0),
                total_healing=d.get("total_healing", 0),
                concentration_set=d.get("concentration_set", False),
                results_summary=summarize_results(d) if d.get("success") else d.get("error", ""),
            )
            results.append(tr)
            pending_judge.append((spell, tr))

            status = "OK" if tr.api_success else "FAIL"
            symbol = "✓" if tr.api_success else "✗"
            compact = f"dmg={tr.total_damage} heal={tr.total_healing}" if tr.api_success else tr.api_error[:60]
            print(f"  [{i+1:3d}/{total}] {symbol} {sid:40s} Lv{level} {cat:15s} {compact}")

            # Batch LLM judge
            if len(pending_judge) >= BATCH_SIZE:
                await llm_judge_batch(client, pending_judge)
                for _, r in pending_judge:
                    if r.llm_verdict in ("WARN", "FAIL"):
                        print(f"         ⚠ {r.spell_id}: {r.llm_verdict} — {r.llm_reason}")
                pending_judge = []

            # Periodic DB cleanup
            if (i + 1) % CLEAN_EVERY == 0:
                try:
                    await clean_db(client)
                except:
                    pass

        # Final batch
        if pending_judge:
            await llm_judge_batch(client, pending_judge)
            for _, r in pending_judge:
                if r.llm_verdict in ("WARN", "FAIL"):
                    print(f"         ⚠ {r.spell_id}: {r.llm_verdict} — {r.llm_reason}")

        # Final cleanup
        try:
            await clean_db(client)
        except:
            pass

    # ── Summary ──
    api_ok = sum(1 for r in results if r.api_success)
    api_fail = total - api_ok
    verdicts = {"PASS": 0, "WARN": 0, "FAIL": 0, "N/A": 0, "ERROR": 0}
    for r in results:
        v = r.llm_verdict if r.llm_verdict in verdicts else "N/A"
        verdicts[v] += 1

    print(f"\n{'='*70}")
    print(f"  SUMMARY: {total} spells tested")
    print(f"{'='*70}")
    print(f"  API:  {api_ok} OK / {api_fail} FAIL")
    print(f"  LLM:  {verdicts['PASS']} PASS / {verdicts['WARN']} WARN / {verdicts['FAIL']} FAIL / {verdicts['N/A']} N/A / {verdicts['ERROR']} ERROR")

    # List failures
    if api_fail:
        print(f"\n  --- API Failures ({api_fail}) ---")
        for r in results:
            if not r.api_success:
                print(f"  {r.spell_id} (Lv{r.level}): {r.api_error[:100]}")

    warns = [r for r in results if r.llm_verdict == "WARN"]
    fails = [r for r in results if r.llm_verdict == "FAIL"]
    if fails:
        print(f"\n  --- LLM FAIL ({len(fails)}) ---")
        for r in fails:
            print(f"  {r.spell_id} (Lv{r.level}): {r.llm_reason}")
    if warns:
        print(f"\n  --- LLM WARN ({len(warns)}) ---")
        for r in warns:
            print(f"  {r.spell_id} (Lv{r.level}): {r.llm_reason}")

    # Save full results to JSON
    out_path = Path(__file__).parent / "test_output" / "spell_test_results.json"
    out_path.parent.mkdir(exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump([{
            "spell_id": r.spell_id, "name": r.spell_name, "level": r.level,
            "category": r.category, "api_ok": r.api_success, "api_error": r.api_error,
            "dmg": r.total_damage, "heal": r.total_healing, "conc": r.concentration_set,
            "effects": r.results_summary, "verdict": r.llm_verdict, "reason": r.llm_reason,
        } for r in results], f, ensure_ascii=False, indent=2)
    print(f"\n  Full results saved to: {out_path}")


if __name__ == "__main__":
    asyncio.run(main())
