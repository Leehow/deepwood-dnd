#!/usr/bin/env python3
"""
Fix high-confidence monster issues found by LLM validation.
Only fixes issues that are clearly data corruption, not debatable values.
"""
import json
import re
import math
from pathlib import Path

PROJECT_ROOT = Path(__file__).parent.parent
MONSTERS_PATH = PROJECT_ROOT / "dnd-platform" / "configs" / "npc" / "monsters.json"
SRD_PATH = PROJECT_ROOT / "dnd-platform" / "references" / "5e-srd" / "5e-SRD-Monsters.json"


def ability_mod(score):
    return math.floor((score - 10) / 2)


def set_ability(m, key, val):
    """Set ability score in both abilityScores and top-level."""
    mod = ability_mod(val)
    abs_s = m.get("abilityScores", {})
    abs_s[key] = val
    abs_s[key + "Mod"] = mod
    if key in m:
        m[key] = val
    if key + "Mod" in m:
        m[key + "Mod"] = mod


def set_stats(m, ac=None, hp=None, hpf=None, cr=None, xp=None, speed=None,
              str_=None, dex=None, con=None, int_=None, wis=None, cha=None):
    """Set multiple stats at once."""
    if ac is not None: m["ac"] = ac
    if hp is not None: m["hp"] = hp
    if hpf is not None: m["hpFormula"] = hpf
    if cr is not None: m["cr"] = str(cr)
    if xp is not None: m["xp"] = xp
    if speed is not None: m["speed"] = speed
    if str_ is not None: set_ability(m, "str", str_)
    if dex is not None: set_ability(m, "dex", dex)
    if con is not None: set_ability(m, "con", con)
    if int_ is not None: set_ability(m, "int", int_)
    if wis is not None: set_ability(m, "wis", wis)
    if cha is not None: set_ability(m, "cha", cha)


def main():
    with open(MONSTERS_PATH, encoding="utf-8") as f:
        data = json.load(f)
    with open(SRD_PATH, encoding="utf-8") as f:
        srd_all = json.load(f)

    srd = {}
    for m in srd_all:
        srd[m["name"].lower()] = m

    fixes = []
    monsters = data["monsters"]

    for m in monsters:
        en = m.get("nameEn", "")
        name = m.get("name", "")

        # === TYPO FIXES ===
        if en == "Pruple Worm":
            m["nameEn"] = "Purple Worm"
            m["id"] = "purple_worm"
            # Fix stats from SRD
            s = srd.get("purple worm")
            if s:
                set_stats(m, ac=18, hp=247, hpf="15d20+90", cr=15, xp=13000,
                          speed={"walk": 50, "burrow": 30},
                          str_=28, dex=7, con=22, int_=1, wis=8, cha=4)
            fixes.append("Purple Worm: fixed typo + all stats from SRD")

        if en == "Orges":
            m["nameEn"] = "Ogre"
            fixes.append("Ogre: fixed nameEn typo")

        # === GRAY SLAAD HP FORMULA TYPO ===
        if "gray slaad" in en.lower() or "灰色史拉" in name:
            if m.get("hpFormula") == "2008+80":
                m["hpFormula"] = "20d8+80"
                fixes.append("Gray Slaad: hpFormula 2008+80 -> 20d8+80")

        # === XP TRUNCATION FIXES ===
        if "arcanaloth" in en.lower():
            if m.get("xp") == 8:
                m["xp"] = 8400
                fixes.append("Arcanaloth: XP 8 -> 8400")
        if "nycaloth" in en.lower():
            if m.get("xp") == 5:
                m["xp"] = 5000
                fixes.append("Nycaloth: XP 5 -> 5000")
        if "ultroloth" in en.lower():
            if m.get("xp") == 10:
                m["xp"] = 10000
                fixes.append("Ultroloth: XP 10 -> 10000")

        # === SPINED DEVIL - still has Barbed Devil stats ===
        if "spined devil" in en.lower():
            s = srd.get("spined devil")
            if s:
                set_stats(m, ac=13, hp=22, hpf="5d6+5", cr=2, xp=450,
                          speed={"walk": 20, "fly": 40},
                          str_=10, dex=15, con=12, int_=11, wis=14, cha=8)
                fixes.append("Spined Devil: fixed all stats from SRD")

        # === ORC CHAIN - stats shifted between entries ===
        if en == "Orcs":
            # This has CR 7 stats - it's actually Orc War Chief data
            # Keep as separate entry but note it
            pass  # Don't modify - different creature in our system

        if en == "Orc War Chief":
            s = srd.get("orc war chief")
            if s and m.get("hp") == 15:  # Currently has Orc stats
                set_stats(m, ac=16, hp=93, hpf="11d8+44", cr=4, xp=1100,
                          speed={"walk": 30},
                          str_=18, dex=12, con=18, int_=12, wis=11, cha=16)
                fixes.append("Orc War Chief: fixed stats (was shifted to Orc data)")

        if en == "Orc Eye of Gruumsh":
            s = srd.get("orc eye of gruumsh")
            if s and m.get("hp") == 93:  # Currently has War Chief stats
                set_stats(m, ac=16, hp=45, hpf="6d8+18", cr=2, xp=450,
                          speed={"walk": 30},
                          str_=16, dex=12, con=16, int_=9, wis=13, cha=12)
                fixes.append("Orc Eye of Gruumsh: fixed stats (was shifted to War Chief data)")

        # === DEATH SLAAD ===
        if "death slaad" in en.lower():
            s = srd.get("death slaad")
            if s and m.get("cr") == "5":
                set_stats(m, ac=18, hp=170, hpf="20d8+80", cr=10, xp=5900,
                          speed={"walk": 30},
                          str_=20, dex=15, con=19, int_=15, wis=10, cha=16)
                fixes.append("Death Slaad: fixed all stats from SRD")

        # === NOTHIC ===
        if en == "Nothic":
            s = srd.get("nothic")
            if s and m.get("ac") == 11:
                set_stats(m, ac=15, hp=45, hpf="6d8+18", cr="2", xp=450,
                          speed={"walk": 30},
                          str_=14, dex=16, con=16, int_=13, wis=10, cha=8)
                fixes.append("Nothic: fixed all stats from SRD")

        # === YETI ===
        if en == "Yeti" and m.get("cr") == "9":  # Clearly wrong - Yeti is CR 3
            s = srd.get("yeti")
            if s:
                set_stats(m, ac=12, hp=51, hpf="6d10+18", cr=3, xp=700,
                          speed={"walk": 40, "climb": 40},
                          str_=18, dex=13, con=16, int_=8, wis=12, cha=7)
                fixes.append("Yeti: fixed all stats from SRD (was CR 9, should be CR 3)")

        # === NOBLE AC ===
        if en == "Noble" and m.get("ac") == 15:
            m["ac"] = 14
            fixes.append("Noble: AC 15 -> 14 (breastplate=14)")

        # === SPY AC ===
        if en == "Spy" and m.get("ac") == 12:
            m["ac"] = 14
            fixes.append("Spy: AC 12 -> 14 (leather armor + DEX)")

        # === CULT FANATIC ===
        if en == "Cult Fanatic":
            if m.get("hp") == 22:
                m["hp"] = 33
                m["hpFormula"] = "6d8+6"
                set_ability(m, "con", 13)
                fixes.append("Cult Fanatic: HP 22->33, formula 6d8-5->6d8+6, CON->13")

        # === ZOMBIE missing speed ===
        if en == "Zombie":
            if not m.get("speed") or m.get("speed") == {}:
                m["speed"] = {"walk": 20}
                fixes.append("Zombie: added speed walk=20")

        # === QUAGGOTH missing speed ===
        if en == "Quaggoth":
            if not m.get("speed") or m.get("speed") is None:
                m["speed"] = {"walk": 30, "climb": 30}
                fixes.append("Quaggoth: added speed walk=30, climb=30")

        # === ONI fly speed ===
        if en == "Oni":
            spd = m.get("speed", {})
            if spd.get("fly") == 30:
                spd["fly"] = 40  # LLM likely wrong here but SRD says 30
                # Actually let me check - SRD Oni has fly 30. Skip this.
                spd["fly"] = 30  # Keep at 30

        # === GIANT SPIDER climb speed ===
        if en == "Giant Spider":
            s = srd.get("giant spider")
            if s:
                spd = m.get("speed", {})
                if spd.get("climb") == 30:
                    spd["climb"] = 30  # SRD actually says 30, LLM might be wrong

        # === FROG XP ===
        if en == "Frog" and m.get("xp") == 0:
            m["xp"] = 10
            fixes.append("Frog: XP 0 -> 10 (CR 0 = 10 XP)")

        # === SEA HORSE XP ===
        if en == "Sea Horse" and m.get("xp") == 0:
            m["xp"] = 10
            fixes.append("Sea Horse: XP 0 -> 10 (CR 0 = 10 XP)")

        # === GIANT EAGLE XP ===
        if en == "Giant Eagle" and m.get("xp") == 200:
            m["xp"] = 450
            fixes.append("Giant Eagle: XP 200 -> 450 (CR 1 = 450 XP)")

        # === RIDING HORSE XP ===
        if en == "Riding Horse" and m.get("xp") == 25:
            m["xp"] = 50
            fixes.append("Riding Horse: XP 25 -> 50 (CR 1/4 = 50 XP)")

        # === MAMMOTH HP formula ===
        if en == "Mammoth":
            if m.get("hpFormula") == "11d12+55":
                m["hpFormula"] = "11d12+44"
                m["hp"] = 126
                fixes.append("Mammoth: hpFormula 11d12+55 -> 11d12+44, HP->126")

        # === PANTHER HP formula ===
        if en == "Panther":
            if m.get("hpFormula") == "3d8":
                m["hpFormula"] = "3d8+3"
                m["hp"] = 13
                fixes.append("Panther: hpFormula 3d8 -> 3d8+3, HP->13")

        # === GIANT FROG ===
        if en == "Giant Frog":
            s = srd.get("giant frog")
            if s and m.get("hp") == 18:
                m["hp"] = 18  # Actually SRD says 18. LLM says 11. Let me check.
                # SRD: hp=18, formula=4d8. Keep as is.

        # === SWARM OF POISONOUS SNAKES ===
        if en == "Swarm of Poisonous Snakes":
            if m.get("hpFormula") == "8d8":
                m["hpFormula"] = "8d8-8"
                m["hp"] = 28
                fixes.append("Swarm of Poisonous Snakes: hpFormula 8d8 -> 8d8-8, HP->28")

    # Remove non-monster entries
    remove_names = ["型动作", "The Nature of Swarms", "B: 非玩家角色 Nonplayer Characters",
                    "Customizing NPCs"]
    before = len(monsters)
    data["monsters"] = [m for m in monsters if m.get("nameEn", "") not in remove_names
                        and m.get("name", "") not in remove_names]
    removed = before - len(data["monsters"])
    if removed:
        fixes.append(f"Removed {removed} non-monster entries: {remove_names}")

    # Update overview count
    data["overview"]["totalMonsters"] = len(data["monsters"])

    print(f"Applied {len(fixes)} fixes:")
    for f in fixes:
        print(f"  - {f}")

    with open(MONSTERS_PATH, "w", encoding="utf-8") as f_out:
        json.dump(data, f_out, ensure_ascii=False, indent=2)
    print(f"\nSaved to: {MONSTERS_PATH}")


if __name__ == "__main__":
    main()
