#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DND 5E Monster Manual Parser v2
Extracts all monsters from the DND 5E Monster Manual markdown file
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Any, Optional


class MonsterParserV2:
    def __init__(self, source_file: str):
        self.source_file = Path(source_file)
        self.monsters = []

        # Mappings
        self.size_map = {
            '超微型': 'Tiny', '微型': 'Tiny', '小型': 'Small', '中型': 'Medium',
            '大型': 'Large', '超大型': 'Huge', '巨型': 'Gargantuan'
        }

        self.type_map = {
            '异怪': 'aberration', '天界生物': 'celestial', '野兽': 'beast',
            '龙': 'dragon', '元素': 'elemental', '精类': 'fey', '邪魔': 'fiend',
            '巨人': 'giant', '人形生物': 'humanoid', '类人生物': 'humanoid',
            '魔物': 'monstrosity', '泥怪': 'ooze', '植物': 'plant',
            '不死生物': 'undead', '构装体': 'construct'
        }

        self.alignment_map = {
            '守序善良': 'LG', '中立善良': 'NG', '混乱善良': 'CG',
            '守序中立': 'LN', '绝对中立': 'N', '中立': 'N', '混乱中立': 'CN',
            '守序邪恶': 'LE', '中立邪恶': 'NE', '混乱邪恶': 'CE',
            '无阵营': 'unaligned', '任意阵营': 'any', '任意非善良': 'any non-good',
            '任意非守序': 'any non-lawful', '任意邪恶': 'any evil'
        }

    def parse(self):
        """Main parsing method"""
        print("Reading source file...")
        content = self.source_file.read_text(encoding='utf-8')
        lines = content.split('\n')

        # Find the first stat block (Aarakocra at line 583)
        start_line = 0
        for i, line in enumerate(lines):
            if '阿兰寇拉鹰人 Aarakocra' in line and not line.startswith('#'):
                start_line = i
                break

        print(f"Starting monster extraction from line {start_line}...")

        # Parse monsters
        i = start_line
        while i < len(lines):
            monster = self.try_parse_monster_at_line(lines, i)
            if monster:
                self.monsters.append(monster)
                # Skip ahead - rough estimate
                i += 20
            else:
                i += 1

        print(f"Total monsters extracted: {len(self.monsters)}")
        return self.monsters

    def try_parse_monster_at_line(self, lines: List[str], start_idx: int) -> Optional[Dict]:
        """Try to parse a monster starting from a given line"""
        # Look for pattern: "Name English" followed by stat block
        line = lines[start_idx].strip()

        # Skip if empty, starts with #, or looks like a section header
        if not line or line.startswith('#') or line.startswith('-') or line.startswith('!['):
            return None

        # Check if next few lines look like a stat block
        # A stat block typically has: Size Type, Alignment; AC; HP; Speed; Abilities
        has_size_type = False
        has_ac = False
        has_hp = False

        for i in range(start_idx, min(start_idx + 10, len(lines))):
            check_line = lines[i].strip()
            if any(size in check_line for size in self.size_map.keys()):
                if any(typ in check_line for typ in self.type_map.keys()):
                    has_size_type = True
            if check_line.startswith('AC') or check_line.startswith('AC:') or check_line.startswith('AC：'):
                has_ac = True
            if check_line.startswith('HP') or check_line.startswith('HP:') or check_line.startswith('HP：'):
                has_hp = True

        # This looks like a stat block!
        if has_size_type and has_ac and has_hp:
            return self.parse_full_monster(lines, start_idx)

        return None

    def parse_full_monster(self, lines: List[str], start_idx: int) -> Dict:
        """Parse a complete monster starting from the name line"""
        # Extract name
        name_line = lines[start_idx].strip()
        chinese_name, english_name = self.extract_names(name_line)

        if not chinese_name or not english_name:
            # Fallback
            parts = name_line.split()
            chinese_name = parts[0] if parts else "Unknown"
            english_name = parts[-1] if len(parts) > 1 else chinese_name

        monster_id = re.sub(r'[^a-z0-9]+', '-', english_name.lower()).strip('-')

        monster = {
            'id': monster_id,
            'name': chinese_name,
            'nameEn': english_name,
            'size': '', 'sizeEn': '', 'type': '', 'typeEn': '',
            'subtype': '', 'subtypeEn': '', 'alignment': '', 'alignmentEn': '',
            'ac': 0, 'acNote': '', 'hp': 0, 'hpFormula': '',
            'speed': {}, 'abilityScores': {}, 'savingThrows': {},
            'skills': {}, 'damageVulnerabilities': [], 'damageResistances': [],
            'damageImmunities': [], 'conditionImmunities': [], 'senses': {},
            'languages': [], 'languagesEn': [], 'cr': '', 'xp': 0,
            'traits': [], 'actions': [], 'reactions': [],
            'legendaryActions': [], 'lairActions': [], 'regionalEffects': [],
            'lore': ''
        }

        # Parse stat block (next ~30-50 lines typically)
        current_section = 'stats'
        current_trait = None
        i = start_idx + 1

        while i < len(lines) and i < start_idx + 200:  # Max 200 lines per monster
            line = lines[i].strip()

            # Stop if we hit another monster (name line followed by stat block pattern)
            if i > start_idx + 10:  # Give at least 10 lines
                next_monster = self.try_parse_monster_at_line(lines, i)
                if next_monster:
                    break

            # Stop if we hit a new major section starting with ##
            if line.startswith('## ') and i > start_idx + 15:
                # Check if this is a subsection for this monster or a new monster
                if not any(keyword in line for keyword in ['动作', '传奇动作', '巢穴动作', '区域效应', '反应', '特性']):
                    # Likely a new monster or lore section
                    break

            # Section markers
            if line.startswith('## 动作') or line == '动作':
                current_section = 'actions'
                i += 1
                continue
            elif line.startswith('## 传奇动作'):
                current_section = 'legendaryActions'
                i += 1
                continue
            elif line.startswith('## 巢穴动作'):
                current_section = 'lairActions'
                i += 1
                continue
            elif line.startswith('## 区域效应'):
                current_section = 'regionalEffects'
                i += 1
                continue
            elif line.startswith('## 反应'):
                current_section = 'reactions'
                i += 1
                continue

            # Parse size, type, alignment
            if not monster['size']:
                self.parse_size_type_alignment(monster, line)

            # Parse AC
            if line.startswith('AC'):
                self.parse_ac(monster, line)

            # Parse HP
            if line.startswith('HP'):
                self.parse_hp(monster, line)

            # Parse Speed
            if '速度' in line and ':' in line:
                self.parse_speed(monster, line)

            # Parse ability scores
            if '力量' in line and '敏捷' in line:
                self.parse_abilities(monster, line)

            # Parse saving throws
            if '豁免' in line and not '豁免失败' in line and not '豁免成功' in line:
                self.parse_saves(monster, line)

            # Parse skills
            if '技能' in line and ':' in line:
                self.parse_skills(monster, line)

            # Parse damage modifiers
            if '伤害易伤' in line:
                self.parse_damage_mods(monster, line, 'damageVulnerabilities')
            if '伤害抗性' in line:
                self.parse_damage_mods(monster, line, 'damageResistances')
            if '伤害免疫' in line:
                self.parse_damage_mods(monster, line, 'damageImmunities')

            # Parse condition immunities
            if '状态免疫' in line:
                self.parse_condition_immunities(monster, line)

            # Parse senses
            if '感官' in line and ':' in line:
                self.parse_senses(monster, line)

            # Parse languages
            if '语言' in line and ':' in line and '语言成分' not in line:
                self.parse_languages(monster, line)

            # Parse CR
            if '挑战等级' in line:
                self.parse_cr(monster, line)

            # Parse traits, actions, etc.
            if current_section == 'stats' and monster['cr']:
                # After CR, we're in traits section
                self.parse_trait_or_action(monster, line, 'traits')
            elif current_section == 'actions':
                self.parse_trait_or_action(monster, line, 'actions')
            elif current_section == 'reactions':
                self.parse_trait_or_action(monster, line, 'reactions')
            elif current_section == 'legendaryActions':
                self.parse_trait_or_action(monster, line, 'legendaryActions')

            i += 1

        return monster

    def extract_names(self, line: str) -> tuple:
        """Extract Chinese and English names from a line"""
        # Pattern: starts with Chinese, then English (capitalized)
        # Example: "阿兰寇拉鹰人 Aarakocra"

        parts = line.split()
        if len(parts) < 2:
            return line, line

        chinese = []
        english = []

        found_english = False
        for part in parts:
            if re.match(r'^[A-Z][a-zA-Z\'\-]*', part):
                found_english = True

            if found_english:
                english.append(part)
            else:
                chinese.append(part)

        chinese_name = ' '.join(chinese)
        english_name = ' '.join(english)

        return chinese_name, english_name

    def parse_size_type_alignment(self, monster: Dict, line: str):
        """Parse size, type, and alignment"""
        # Extract size
        for size_cn, size_en in self.size_map.items():
            if size_cn in line:
                monster['size'] = size_cn
                monster['sizeEn'] = size_en
                break

        # Extract type (and possibly subtype in parentheses)
        for type_cn, type_en in self.type_map.items():
            if type_cn in line:
                monster['type'] = type_cn
                monster['typeEn'] = type_en

                # Check for subtype in parentheses
                if '(' in line and ')' in line:
                    subtype_match = re.search(r'\(([^)]+)\)', line)
                    if subtype_match:
                        monster['subtype'] = subtype_match.group(1)
                        monster['subtypeEn'] = subtype_match.group(1)
                break

        # Extract alignment
        for align_cn, align_en in self.alignment_map.items():
            if align_cn in line:
                monster['alignment'] = align_cn
                monster['alignmentEn'] = align_en
                break

    def parse_ac(self, monster: Dict, line: str):
        """Parse armor class"""
        match = re.search(r'(\d+)', line)
        if match:
            monster['ac'] = int(match.group(1))

        if '(' in line:
            note_match = re.search(r'\(([^)]+)\)', line)
            if note_match:
                monster['acNote'] = note_match.group(1)

    def parse_hp(self, monster: Dict, line: str):
        """Parse hit points"""
        match = re.search(r'(\d+)', line)
        if match:
            monster['hp'] = int(match.group(1))

        formula_match = re.search(r'\((\d+d\d+[+\-]?\d*)\)', line)
        if formula_match:
            monster['hpFormula'] = formula_match.group(1)

    def parse_speed(self, monster: Dict, line: str):
        """Parse speed"""
        speed = {}

        # Remove "速度:" prefix
        line = re.sub(r'速度[：:]', '', line)

        # Walk speed (first number without keyword)
        walk_match = re.search(r'(\d+)\s*尺', line)
        if walk_match:
            speed['walk'] = int(walk_match.group(1))

        # Other movement types
        if '飞行' in line:
            fly_match = re.search(r'飞行\s*(\d+)', line)
            if fly_match:
                speed['fly'] = int(fly_match.group(1))

        if '游泳' in line:
            swim_match = re.search(r'游泳\s*(\d+)', line)
            if swim_match:
                speed['swim'] = int(swim_match.group(1))

        if '攀爬' in line:
            climb_match = re.search(r'攀爬\s*(\d+)', line)
            if climb_match:
                speed['climb'] = int(climb_match.group(1))

        if '掘穴' in line:
            burrow_match = re.search(r'掘穴\s*(\d+)', line)
            if burrow_match:
                speed['burrow'] = int(burrow_match.group(1))

        monster['speed'] = speed

    def parse_abilities(self, monster: Dict, line: str):
        """Parse ability scores"""
        abilities = {}

        # Pattern: 力量 10 (+0)
        patterns = {
            'str': r'力量\s*(\d+)\s*\(([+\-]?\d+)\)',
            'dex': r'敏捷\s*(\d+)\s*\(([+\-]?\d+)\)',
            'con': r'体质\s*(\d+)\s*\(([+\-]?\d+)\)',
            'int': r'智力\s*(\d+)\s*\(([+\-]?\d+)\)',
            'wis': r'感知\s*(\d+)\s*\(([+\-]?\d+)\)',
            'cha': r'魅力\s*(\d+)\s*\(([+\-]?\d+)\)'
        }

        for key, pattern in patterns.items():
            match = re.search(pattern, line)
            if match:
                abilities[key] = int(match.group(1))
                abilities[f"{key}Mod"] = int(match.group(2))

        monster['abilityScores'] = abilities

    def parse_saves(self, monster: Dict, line: str):
        """Parse saving throws"""
        saves = {}
        line = re.sub(r'豁免[：:]', '', line)

        save_map = {
            '力量': 'str', '敏捷': 'dex', '体质': 'con',
            '智力': 'int', '感知': 'wis', '魅力': 'cha'
        }

        for cn, en in save_map.items():
            pattern = rf'{cn}\s*[+\-](\d+)'
            match = re.search(pattern, line)
            if match:
                saves[en] = int(match.group(1))

        monster['savingThrows'] = saves

    def parse_skills(self, monster: Dict, line: str):
        """Parse skills"""
        skills = {}
        line = re.sub(r'技能[：:]', '', line)

        skill_map = {
            '体操': 'acrobatics', '驯兽': 'animalHandling', '奥秘': 'arcana',
            '运动': 'athletics', '欺瞒': 'deception', '历史': 'history',
            '洞悉': 'insight', '威吓': 'intimidation', '调查': 'investigation',
            '医药': 'medicine', '自然': 'nature', '察觉': 'perception',
            '表演': 'performance', '游说': 'persuasion', '宗教': 'religion',
            '巧手': 'sleightOfHand', '隐匿': 'stealth', '求生': 'survival'
        }

        for cn, en in skill_map.items():
            pattern = rf'{cn}\s*[+\-](\d+)'
            match = re.search(pattern, line)
            if match:
                skills[en] = int(match.group(1))

        monster['skills'] = skills

    def parse_damage_mods(self, monster: Dict, line: str, field: str):
        """Parse damage vulnerabilities, resistances, or immunities"""
        line = re.split(r'伤害[易伤抗性免疫]+[：:]', line)[-1]
        damages = [d.strip() for d in re.split(r'[,，、]', line) if d.strip()]
        monster[field] = damages

    def parse_condition_immunities(self, monster: Dict, line: str):
        """Parse condition immunities"""
        line = re.sub(r'状态免疫[：:]', '', line)
        conditions = [c.strip() for c in re.split(r'[,，、]', line) if c.strip()]
        monster['conditionImmunities'] = conditions

    def parse_senses(self, monster: Dict, line: str):
        """Parse senses"""
        senses = {}

        # Darkvision
        if '黑暗视觉' in line:
            dark_match = re.search(r'黑暗视觉\s*(\d+)', line)
            if dark_match:
                senses['darkvision'] = int(dark_match.group(1))

        # Blindsight
        if '盲视' in line:
            blind_match = re.search(r'盲视\s*(\d+)', line)
            if blind_match:
                senses['blindsight'] = int(blind_match.group(1))

        # Truesight
        if '真实视觉' in line:
            true_match = re.search(r'真实视觉\s*(\d+)', line)
            if true_match:
                senses['truesight'] = int(true_match.group(1))

        # Tremorsense
        if '颤动感知' in line:
            tremor_match = re.search(r'颤动感知\s*(\d+)', line)
            if tremor_match:
                senses['tremorsense'] = int(tremor_match.group(1))

        # Passive Perception
        if '被动察觉' in line:
            passive_match = re.search(r'被动察觉\s*(\d+)', line)
            if passive_match:
                senses['passivePerception'] = int(passive_match.group(1))

        monster['senses'] = senses

    def parse_languages(self, monster: Dict, line: str):
        """Parse languages"""
        line = re.sub(r'语言[：:]', '', line)

        # Remove telepathy info
        line = re.sub(r'心灵感应.*', '', line)

        languages = [lang.strip() for lang in re.split(r'[,，、]', line) if lang.strip()]

        monster['languages'] = languages
        monster['languagesEn'] = languages

    def parse_cr(self, monster: Dict, line: str):
        """Parse challenge rating and XP"""
        cr_match = re.search(r'挑战等级[：:]\s*([0-9/]+)', line)
        if cr_match:
            monster['cr'] = cr_match.group(1)

        xp_match = re.search(r'\(?\s*(\d+)\s*XP', line, re.IGNORECASE)
        if xp_match:
            monster['xp'] = int(xp_match.group(1))

    def parse_trait_or_action(self, monster: Dict, line: str, section: str):
        """Parse a trait or action"""
        if not line or line.startswith('#') or line.startswith('-') or line.startswith('!['):
            return

        # Pattern: "Chinese Name English Name. Description"
        # Or: "Chinese Name English Name (uses). Description"
        match = re.match(r'^([^。.]+?)\s+([A-Z][a-zA-Z\s\'\-()]+?)(?:[。.])\s*(.+)', line)

        if match:
            name_cn = match.group(1).strip()
            name_en = match.group(2).strip()
            description = match.group(3).strip()

            # Extract uses if present (like "3/日" or "1/回合")
            uses = ''
            uses_match = re.search(r'\((\d+/[^)]+)\)', name_cn)
            if uses_match:
                uses = uses_match.group(1)
                name_cn = re.sub(r'\s*\([^)]+\)', '', name_cn)

            trait = {
                'name': name_cn,
                'nameEn': name_en,
                'description': description
            }

            if uses:
                trait['uses'] = uses

            # Try to parse attack information if this looks like an attack
            if '攻击' in description or '命中' in description:
                self.parse_attack_info(trait, description)

            monster[section].append(trait)

    def parse_attack_info(self, trait: Dict, description: str):
        """Parse attack information from description"""
        # Attack bonus
        hit_match = re.search(r'命中\s*[+\-](\d+)', description)
        if hit_match:
            trait['attackBonus'] = int(hit_match.group(1))

        # Reach
        reach_match = re.search(r'触及\s*(\d+)\s*尺', description)
        if reach_match:
            trait['reach'] = int(reach_match.group(1))

        # Range
        range_match = re.search(r'射程\s*(\d+)/(\d+)', description)
        if range_match:
            trait['rangeNormal'] = int(range_match.group(1))
            trait['rangeLong'] = int(range_match.group(2))

        # Damage
        damage_match = re.search(r'伤害[：:]\s*(\d+)\s*\(([^)]+)\)\s*(?:点\s*)?([^。.]+)', description)
        if damage_match:
            trait['damageAvg'] = int(damage_match.group(1))
            trait['damageDice'] = damage_match.group(2)
            trait['damageType'] = damage_match.group(3).strip()

    def save_to_json(self, output_file: str):
        """Save monsters to JSON file"""
        output = {
            'overview': {
                'description': 'DND 5E怪物图鉴完整数据',
                'descriptionEn': 'DND 5E Monster Manual Complete Data',
                'totalMonsters': len(self.monsters),
                'source': 'Monster Manual',
                'extractedAt': '2025-10-27'
            },
            'monsters': self.monsters
        }

        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        file_size_kb = output_path.stat().st_size / 1024
        print(f"\nSaved {len(self.monsters)} monsters to {output_file}")
        print(f"File size: {file_size_kb:.2f} KB")

        return output_path


def main():
    source_file = "/Users/haoli/leehow/code/dw/trpg/DND_5E_怪物图鉴CN_2025-10-27-11_59_20/DND_5E_怪物图鉴CN.md"
    output_file = "/Users/haoli/leehow/code/dw/dnd-platform/configs/monsters.json"

    parser = MonsterParserV2(source_file)
    monsters = parser.parse()
    parser.save_to_json(output_file)

    # Statistics
    print("\n=== Extraction Statistics ===")
    print(f"Total monsters extracted: {len(monsters)}")

    # Count valid monsters (with CR)
    valid_monsters = [m for m in monsters if m['cr']]
    print(f"Monsters with CR: {len(valid_monsters)}")

    # Sample monsters
    print("\nFirst 15 monsters:")
    for i, monster in enumerate(monsters[:15]):
        cr_info = f"CR {monster['cr']}" if monster['cr'] else "No CR"
        print(f"  {i+1}. {monster['name']} ({monster['nameEn']}) - {cr_info}")

    # CR distribution
    cr_counts = {}
    for monster in monsters:
        if monster['cr']:
            cr = monster['cr']
            cr_counts[cr] = cr_counts.get(cr, 0) + 1

    print(f"\nCR distribution:")
    for cr in sorted(cr_counts.keys(), key=lambda x: (0 if '/' in x else 100, x)):
        print(f"  CR {cr}: {cr_counts[cr]} monsters")

    # Type distribution
    type_counts = {}
    for monster in monsters:
        if monster['typeEn']:
            typ = monster['typeEn']
            type_counts[typ] = type_counts.get(typ, 0) + 1

    print(f"\nType distribution:")
    for typ, count in sorted(type_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  {typ}: {count} monsters")


if __name__ == '__main__':
    main()
