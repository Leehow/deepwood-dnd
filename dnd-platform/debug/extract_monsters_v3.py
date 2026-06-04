#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DND 5E Monster Manual Parser v3 - Final Version
Extracts all monsters by finding CR lines and parsing backward
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Any, Optional


class MonsterParserV3:
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

        # Find all CR lines
        cr_lines = []
        for i, line in enumerate(lines):
            if i < 600:  # Skip intro content
                continue
            if re.search(r'挑战等级[：:]\s*\d', line):
                cr_lines.append(i)

        print(f"Found {len(cr_lines)} stat blocks with CR...")

        # Parse each monster by working backward from CR line
        for cr_idx in cr_lines:
            monster = self.parse_monster_from_cr(lines, cr_idx)
            if monster:
                self.monsters.append(monster)

        print(f"Total monsters extracted: {len(self.monsters)}")
        return self.monsters

    def parse_monster_from_cr(self, lines: List[str], cr_line_idx: int) -> Optional[Dict]:
        """Parse a monster starting from its CR line and working backward"""

        # Find the name line (work backward to find the first non-## header line that looks like a name)
        name_line_idx = None
        for i in range(cr_line_idx - 1, max(0, cr_line_idx - 20), -1):
            line = lines[i].strip()
            if not line or line.startswith('#') or line.startswith('![') or line.startswith('-'):
                continue

            # Check if this looks like a name line (has both Chinese and English)
            if self.looks_like_name_line(line):
                name_line_idx = i
                break

        if not name_line_idx:
            return None

        # Extract name
        name_line = lines[name_line_idx].strip()
        chinese_name, english_name = self.extract_names(name_line)

        if not chinese_name or not english_name:
            return None

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

        # Parse the stat block (from name to end of traits/actions)
        self.parse_stat_block(monster, lines, name_line_idx, cr_line_idx)

        # Parse actions and traits that come after CR
        self.parse_abilities_after_cr(monster, lines, cr_line_idx)

        return monster

    def looks_like_name_line(self, line: str) -> bool:
        """Check if a line looks like a monster name"""
        # Should have Chinese characters followed by English (capitalized)
        if not line:
            return False

        # Must have both Chinese and English
        has_chinese = bool(re.search(r'[\u4e00-\u9fff]', line))
        has_english = bool(re.search(r'[A-Z][a-z]+', line))

        # Should not be too long (names are usually short)
        if len(line) > 80:
            return False

        # Should not have common non-name patterns
        if any(word in line for word in ['AC:', 'HP:', '速度:', '伤害:', '攻击:', '。']):
            return False

        return has_chinese and has_english

    def extract_names(self, line: str) -> tuple:
        """Extract Chinese and English names from a line"""
        parts = line.split()
        if len(parts) < 2:
            return "", ""

        chinese = []
        english = []
        found_english = False

        for part in parts:
            if re.match(r'^[A-Z][a-zA-Z\'\-]*$', part):
                found_english = True

            if found_english:
                english.append(part)
            else:
                chinese.append(part)

        chinese_name = ' '.join(chinese)
        english_name = ' '.join(english)

        return chinese_name, english_name

    def parse_stat_block(self, monster: Dict, lines: List[str], start_idx: int, end_idx: int):
        """Parse the stat block between name and CR"""
        for i in range(start_idx + 1, end_idx + 1):
            line = lines[i].strip()

            # Size, type, alignment
            if not monster['size']:
                self.parse_size_type_alignment(monster, line)

            # AC
            if line.startswith('AC') or line.startswith('AC:') or line.startswith('AC：'):
                self.parse_ac(monster, line)

            # HP
            if line.startswith('HP') or line.startswith('HP:') or line.startswith('HP：'):
                self.parse_hp(monster, line)

            # Speed
            if '速度' in line and ':' in line:
                self.parse_speed(monster, line)

            # Ability scores
            if '力量' in line and '敏捷' in line:
                self.parse_abilities(monster, line)

            # Saving throws
            if '豁免' in line and not '豁免失败' in line and not '豁免成功' in line:
                self.parse_saves(monster, line)

            # Skills
            if line.startswith('技能') and ':' in line:
                self.parse_skills(monster, line)

            # Damage modifiers
            if '伤害易伤' in line:
                self.parse_damage_mods(monster, line, 'damageVulnerabilities')
            if '伤害抗性' in line:
                self.parse_damage_mods(monster, line, 'damageResistances')
            if '伤害免疫' in line:
                self.parse_damage_mods(monster, line, 'damageImmunities')

            # Condition immunities
            if '状态免疫' in line:
                self.parse_condition_immunities(monster, line)

            # Senses
            if line.startswith('感官') and ':' in line:
                self.parse_senses(monster, line)

            # Languages
            if line.startswith('语言') and ':' in line:
                self.parse_languages(monster, line)

            # CR
            if '挑战等级' in line:
                self.parse_cr(monster, line)

    def parse_abilities_after_cr(self, monster: Dict, lines: List[str], cr_idx: int):
        """Parse traits, actions, etc. that come after the CR line"""
        current_section = 'traits'

        i = cr_idx + 1
        while i < len(lines):
            line = lines[i].strip()

            # Stop if we hit another stat block (another CR line nearby)
            if i > cr_idx + 100:  # Max 100 lines per monster
                break

            if i > cr_idx + 20:
                # Check if we've hit another monster
                if re.search(r'挑战等级[：:]\s*\d', line):
                    break

            # Section markers
            if line.startswith('## 动作') or (line == '动作' and i == cr_idx + 2):
                current_section = 'actions'
                i += 1
                continue
            elif line.startswith('## 传奇动作'):
                current_section = 'legendaryActions'
                i += 1
                continue
            elif line.startswith('## 反应'):
                current_section = 'reactions'
                i += 1
                continue
            elif line.startswith('##') and not any(kw in line for kw in ['动作', '传奇', '反应', '巢穴', '区域']):
                # Hit next monster's lore section
                break

            # Parse abilities
            self.parse_trait_or_action(monster, line, current_section)

            i += 1

    def parse_size_type_alignment(self, monster: Dict, line: str):
        """Parse size, type, and alignment"""
        for size_cn, size_en in self.size_map.items():
            if size_cn in line:
                monster['size'] = size_cn
                monster['sizeEn'] = size_en
                break

        for type_cn, type_en in self.type_map.items():
            if type_cn in line:
                monster['type'] = type_cn
                monster['typeEn'] = type_en

                # Check for subtype in parentheses
                subtype_match = re.search(r'\(([^)]+)\)', line)
                if subtype_match:
                    monster['subtype'] = subtype_match.group(1)
                    monster['subtypeEn'] = subtype_match.group(1)
                break

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
        line = re.sub(r'速度[：:]', '', line)

        # Walk speed
        walk_match = re.search(r'(\d+)\s*尺', line)
        if walk_match:
            speed['walk'] = int(walk_match.group(1))

        # Other movement types
        for move_type, key in [('飞行', 'fly'), ('游泳', 'swim'), ('攀爬', 'climb'), ('掘穴', 'burrow')]:
            if move_type in line:
                match = re.search(rf'{move_type}\s*(\d+)', line)
                if match:
                    speed[key] = int(match.group(1))

        monster['speed'] = speed

    def parse_abilities(self, monster: Dict, line: str):
        """Parse ability scores"""
        abilities = {}
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

        sense_patterns = [
            ('darkvision', '黑暗视觉', r'黑暗视觉\s*(\d+)'),
            ('blindsight', '盲视', r'盲视\s*(\d+)'),
            ('truesight', '真实视觉', r'真实视觉\s*(\d+)'),
            ('tremorsense', '颤动感知', r'颤动感知\s*(\d+)'),
            ('passivePerception', '被动察觉', r'被动察觉\s*(\d+)')
        ]

        for key, chinese, pattern in sense_patterns:
            if chinese in line:
                match = re.search(pattern, line)
                if match:
                    senses[key] = int(match.group(1))

        monster['senses'] = senses

    def parse_languages(self, monster: Dict, line: str):
        """Parse languages"""
        line = re.sub(r'语言[：:]', '', line)
        line = re.sub(r'心灵感应.*', '', line)  # Remove telepathy
        languages = [lang.strip() for lang in re.split(r'[,，、]', line) if lang.strip()]
        monster['languages'] = languages
        monster['languagesEn'] = languages

    def parse_cr(self, monster: Dict, line: str):
        """Parse challenge rating and XP"""
        cr_match = re.search(r'挑战等级[：:]\s*([0-9/]+)', line)
        if cr_match:
            monster['cr'] = cr_match.group(1)

        xp_match = re.search(r'\(?\s*(\d+)\s*(?:XP|xp)', line, re.IGNORECASE)
        if xp_match:
            monster['xp'] = int(xp_match.group(1))

    def parse_trait_or_action(self, monster: Dict, line: str, section: str):
        """Parse a trait or action"""
        if not line or line.startswith('#') or line.startswith('-') or line.startswith('!['):
            return

        # Pattern: "Chinese Name English Name. Description"
        match = re.match(r'^([^。.]+?)\s+([A-Z][a-zA-Z\s\'\-()]+?)(?:[。.])\s*(.+)', line)

        if match:
            name_cn = match.group(1).strip()
            name_en = match.group(2).strip()
            description = match.group(3).strip()

            trait = {
                'name': name_cn,
                'nameEn': name_en,
                'description': description
            }

            # Try to parse attack information
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

    parser = MonsterParserV3(source_file)
    monsters = parser.parse()
    parser.save_to_json(output_file)

    # Statistics
    print("\n=== Extraction Statistics ===")
    print(f"Total monsters extracted: {len(monsters)}")

    # Sample monsters
    print("\nFirst 20 monsters:")
    for i, monster in enumerate(monsters[:20]):
        print(f"  {i+1}. {monster['name']} ({monster['nameEn']}) - CR {monster['cr']}")

    # CR distribution
    cr_counts = {}
    for monster in monsters:
        cr = monster.get('cr', 'Unknown')
        cr_counts[cr] = cr_counts.get(cr, 0) + 1

    print(f"\nCR distribution:")
    for cr in sorted(cr_counts.keys(), key=lambda x: (0 if '/' in str(x) else 100, str(x))):
        print(f"  CR {cr}: {cr_counts[cr]} monsters")

    # Type distribution
    type_counts = {}
    for monster in monsters:
        if monster.get('typeEn'):
            typ = monster['typeEn']
            type_counts[typ] = type_counts.get(typ, 0) + 1

    print(f"\nType distribution:")
    for typ, count in sorted(type_counts.items(), key=lambda x: x[1], reverse=True):
        print(f"  {typ}: {count} monsters")

    # Check data completeness
    complete = sum(1 for m in monsters if m['ac'] > 0 and m['hp'] > 0 and m['cr'])
    print(f"\nData completeness:")
    print(f"  Monsters with complete basic stats: {complete}/{len(monsters)} ({100*complete/len(monsters):.1f}%)")


if __name__ == '__main__':
    main()
