#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
DND 5E Monster Manual Parser
Extracts all monsters from the DND 5E Monster Manual markdown file
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Any, Optional


class MonsterParser:
    def __init__(self, source_file: str):
        self.source_file = Path(source_file)
        self.monsters = []
        self.total_monsters = 0

        # Patterns for parsing
        self.monster_header_pattern = re.compile(r'^##\s+([^#\n]+?)\s+([A-Z][a-zA-Z\s,\-\']+?)(?:\s*$)', re.MULTILINE)
        self.stat_block_pattern = re.compile(r'(大型|中型|小型|微型|超微型|超大型|巨型)(异怪|天界生物|野兽|龙|元素|精类|邪魔|巨人|人形生物|魔物|泥怪|植物|不死生物|构装体)', re.MULTILINE)

        # Size mappings
        self.size_map = {
            '超微型': 'Tiny', '微型': 'Tiny', '小型': 'Small', '中型': 'Medium',
            '大型': 'Large', '超大型': 'Huge', '巨型': 'Gargantuan'
        }

        # Type mappings
        self.type_map = {
            '异怪': 'aberration', '天界生物': 'celestial', '野兽': 'beast',
            '龙': 'dragon', '元素': 'elemental', '精类': 'fey', '邪魔': 'fiend',
            '巨人': 'giant', '人形生物': 'humanoid', '魔物': 'monstrosity',
            '泥怪': 'ooze', '植物': 'plant', '不死生物': 'undead', '构装体': 'construct'
        }

        # Alignment mappings
        self.alignment_map = {
            '守序善良': 'LG', '中立善良': 'NG', '混乱善良': 'CG',
            '守序中立': 'LN', '绝对中立': 'N', '混乱中立': 'CN',
            '守序邪恶': 'LE', '中立邪恶': 'NE', '混乱邪恶': 'CE',
            '无阵营': 'unaligned', '任意阵营': 'any', '任意非善良': 'any non-good',
            '任意非守序': 'any non-lawful', '任意邪恶': 'any evil'
        }

    def parse(self):
        """Main parsing method"""
        print("Reading source file...")
        content = self.source_file.read_text(encoding='utf-8')

        # Find where monsters start (line 611)
        lines = content.split('\n')
        monster_start = 0
        for i, line in enumerate(lines):
            if '阿兰寇拉鹰人 Aarakocra' in line and line.startswith('##'):
                monster_start = i
                break

        if monster_start == 0:
            print("Warning: Could not find monster start marker")
            monster_start = 611

        print(f"Starting monster extraction from line {monster_start}...")
        monster_content = '\n'.join(lines[monster_start:])

        # Split into monster sections
        self.extract_monsters(monster_content)

        print(f"Total monsters extracted: {len(self.monsters)}")
        return self.monsters

    def extract_monsters(self, content: str):
        """Extract all monsters from content"""
        # Split by ## headers
        sections = re.split(r'\n(?=##\s+[^#])', content)

        current_monster = None

        for section in sections:
            if not section.strip():
                continue

            lines = section.split('\n')
            first_line = lines[0].strip()

            # Check if this is a monster header
            if first_line.startswith('##') and not first_line.startswith('###'):
                # Try to parse monster name
                monster_info = self.parse_monster_header(first_line)
                if monster_info:
                    # If we have a current monster, save it
                    if current_monster:
                        self.monsters.append(current_monster)

                    # Start new monster
                    current_monster = monster_info
                    current_monster['raw_text'] = section

                    # Parse the rest of the stat block
                    self.parse_stat_block(current_monster, section)

        # Don't forget the last monster
        if current_monster:
            self.monsters.append(current_monster)

    def parse_monster_header(self, header: str) -> Optional[Dict]:
        """Parse monster header to extract Chinese and English names"""
        header = header.replace('##', '').strip()

        # Skip section headers
        skip_keywords = ['动作', '传奇动作', '巢穴动作', '区域效应', '特性', '反应']
        if any(keyword in header for keyword in skip_keywords):
            return None

        # Try to extract Chinese and English names
        # Pattern: Chinese Name English Name
        parts = header.split()
        if len(parts) < 2:
            return None

        # Find where English starts (first uppercase letter after Chinese)
        chinese_name = ""
        english_name = ""

        # Simple heuristic: everything before first all-caps English word is Chinese
        for i, part in enumerate(parts):
            if re.match(r'^[A-Z][a-zA-Z\-\']*', part):
                chinese_name = ' '.join(parts[:i]).strip()
                english_name = ' '.join(parts[i:]).strip()
                break

        if not chinese_name or not english_name:
            return None

        # Generate ID from English name
        monster_id = re.sub(r'[^a-z0-9]+', '-', english_name.lower()).strip('-')

        return {
            'id': monster_id,
            'name': chinese_name,
            'nameEn': english_name
        }

    def parse_stat_block(self, monster: Dict, content: str):
        """Parse the full stat block of a monster"""
        lines = content.split('\n')

        # Initialize default values
        monster.update({
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
        })

        current_section = 'header'
        current_action_list = 'traits'

        for i, line in enumerate(lines):
            line = line.strip()

            # Section markers
            if line.startswith('## 动作') or line.startswith('##动作'):
                current_section = 'actions'
                current_action_list = 'actions'
                continue
            elif line.startswith('## 传奇动作'):
                current_section = 'legendary'
                current_action_list = 'legendaryActions'
                continue
            elif line.startswith('## 巢穴动作'):
                current_section = 'lair'
                current_action_list = 'lairActions'
                continue
            elif line.startswith('## 区域效应'):
                current_section = 'regional'
                continue
            elif line.startswith('## 反应'):
                current_section = 'reactions'
                current_action_list = 'reactions'
                continue

            # Parse size, type, alignment (first occurrence)
            if not monster['size'] and ('大型' in line or '中型' in line or '小型' in line or
                                        '微型' in line or '超微型' in line or '超大型' in line or '巨型' in line):
                self.parse_size_type_alignment(monster, line)

            # Parse AC
            if 'AC:' in line or 'AC：' in line:
                self.parse_ac(monster, line)

            # Parse HP
            if 'HP:' in line or 'HP：' in line:
                self.parse_hp(monster, line)

            # Parse Speed
            if '速度:' in line or '速度：' in line:
                self.parse_speed(monster, line)

            # Parse ability scores (look for the table format)
            if '力量' in line and '敏捷' in line and '体质' in line:
                self.parse_abilities(monster, line, lines[i:i+3])

            # Parse saving throws
            if '豁免:' in line or '豁免：' in line:
                self.parse_saves(monster, line)

            # Parse skills
            if '技能:' in line or '技能：' in line:
                self.parse_skills(monster, line)

            # Parse damage vulnerabilities
            if '伤害易伤:' in line or '伤害易伤：' in line:
                self.parse_damage_mods(monster, line, 'damageVulnerabilities')

            # Parse damage resistances
            if '伤害抗性:' in line or '伤害抗性：' in line:
                self.parse_damage_mods(monster, line, 'damageResistances')

            # Parse damage immunities
            if '伤害免疫:' in line or '伤害免疫：' in line:
                self.parse_damage_mods(monster, line, 'damageImmunities')

            # Parse condition immunities
            if '状态免疫:' in line or '状态免疫：' in line:
                self.parse_condition_immunities(monster, line)

            # Parse senses
            if '感官:' in line or '感官：' in line:
                self.parse_senses(monster, line)

            # Parse languages
            if '语言:' in line or '语言：' in line:
                self.parse_languages(monster, line)

            # Parse CR
            if '挑战等级:' in line or '挑战等级：' in line:
                self.parse_cr(monster, line)

            # Parse traits and actions
            if current_section in ['header', 'actions', 'legendary', 'lair', 'reactions']:
                self.parse_ability(monster, line, current_action_list)

        # Clean up empty fields
        self.clean_monster_data(monster)

    def parse_size_type_alignment(self, monster: Dict, line: str):
        """Parse size, type, and alignment from line"""
        # Extract size
        for size_cn, size_en in self.size_map.items():
            if size_cn in line:
                monster['size'] = size_cn
                monster['sizeEn'] = size_en
                break

        # Extract type
        for type_cn, type_en in self.type_map.items():
            if type_cn in line:
                monster['type'] = type_cn
                monster['typeEn'] = type_en
                break

        # Extract alignment
        for align_cn, align_en in self.alignment_map.items():
            if align_cn in line:
                monster['alignment'] = align_cn
                monster['alignmentEn'] = align_en
                break

    def parse_ac(self, monster: Dict, line: str):
        """Parse armor class"""
        match = re.search(r'AC[：:]\s*(\d+)', line)
        if match:
            monster['ac'] = int(match.group(1))

        # Check for AC note (like "天生护甲")
        if '(' in line:
            note_match = re.search(r'\(([^)]+)\)', line)
            if note_match:
                monster['acNote'] = note_match.group(1)

    def parse_hp(self, monster: Dict, line: str):
        """Parse hit points"""
        match = re.search(r'HP[：:]\s*(\d+)', line)
        if match:
            monster['hp'] = int(match.group(1))

        # Extract HP formula
        formula_match = re.search(r'\((\d+d\d+[+\-]?\d*)\)', line)
        if formula_match:
            monster['hpFormula'] = formula_match.group(1)

    def parse_speed(self, monster: Dict, line: str):
        """Parse speed"""
        speed = {}

        # Extract various speed types
        walk_match = re.search(r'(\d+)\s*尺(?:[,，]|$)', line)
        if walk_match:
            speed['walk'] = int(walk_match.group(1))

        fly_match = re.search(r'飞行\s*(\d+)', line)
        if fly_match:
            speed['fly'] = int(fly_match.group(1))

        swim_match = re.search(r'游泳\s*(\d+)', line)
        if swim_match:
            speed['swim'] = int(swim_match.group(1))

        climb_match = re.search(r'攀爬\s*(\d+)', line)
        if climb_match:
            speed['climb'] = int(climb_match.group(1))

        burrow_match = re.search(r'掘穴\s*(\d+)', line)
        if burrow_match:
            speed['burrow'] = int(burrow_match.group(1))

        monster['speed'] = speed

    def parse_abilities(self, monster: Dict, line: str, context_lines: List[str]):
        """Parse ability scores"""
        abilities = {}

        # Try to extract from the line
        ability_pattern = r'力量\s*(\d+)\s*\(([+\-]?\d+)\)'
        matches = {
            'str': r'力量\s*(\d+)\s*\(([+\-]?\d+)\)',
            'dex': r'敏捷\s*(\d+)\s*\(([+\-]?\d+)\)',
            'con': r'体质\s*(\d+)\s*\(([+\-]?\d+)\)',
            'int': r'智力\s*(\d+)\s*\(([+\-]?\d+)\)',
            'wis': r'感知\s*(\d+)\s*\(([+\-]?\d+)\)',
            'cha': r'魅力\s*(\d+)\s*\(([+\-]?\d+)\)'
        }

        full_text = ' '.join(context_lines)

        for key, pattern in matches.items():
            match = re.search(pattern, full_text)
            if match:
                abilities[key] = int(match.group(1))
                abilities[f"{key}Mod"] = int(match.group(2))

        monster['abilityScores'] = abilities

    def parse_saves(self, monster: Dict, line: str):
        """Parse saving throws"""
        saves = {}
        line = line.split('豁免')[-1]

        save_map = {
            '力量': 'str', '敏捷': 'dex', '体质': 'con',
            '智力': 'int', '感知': 'wis', '魅力': 'cha'
        }

        for cn, en in save_map.items():
            pattern = rf'{cn}\s*[+\-]?(\d+)'
            match = re.search(pattern, line)
            if match:
                saves[en] = int(match.group(1))

        monster['savingThrows'] = saves

    def parse_skills(self, monster: Dict, line: str):
        """Parse skills"""
        skills = {}
        line = line.split('技能')[-1]

        # Common skills
        skill_map = {
            '体操': 'acrobatics', '驯兽': 'animalHandling', '奥秘': 'arcana',
            '运动': 'athletics', '欺瞒': 'deception', '历史': 'history',
            '洞悉': 'insight', '威吓': 'intimidation', '调查': 'investigation',
            '医药': 'medicine', '自然': 'nature', '察觉': 'perception',
            '表演': 'performance', '游说': 'persuasion', '宗教': 'religion',
            '巧手': 'sleightOfHand', '隐匿': 'stealth', '求生': 'survival'
        }

        for cn, en in skill_map.items():
            pattern = rf'{cn}\s*[+\-]?(\d+)'
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
        line = line.split('状态免疫')[-1].replace(':', '').replace('：', '')
        conditions = [c.strip() for c in re.split(r'[,，、]', line) if c.strip()]
        monster['conditionImmunities'] = conditions

    def parse_senses(self, monster: Dict, line: str):
        """Parse senses"""
        senses = {}

        # Darkvision
        dark_match = re.search(r'黑暗视觉\s*(\d+)', line)
        if dark_match:
            senses['darkvision'] = int(dark_match.group(1))

        # Blindsight
        blind_match = re.search(r'盲视\s*(\d+)', line)
        if blind_match:
            senses['blindsight'] = int(blind_match.group(1))

        # Truesight
        true_match = re.search(r'真实视觉\s*(\d+)', line)
        if true_match:
            senses['truesight'] = int(true_match.group(1))

        # Tremorsense
        tremor_match = re.search(r'颤动感知\s*(\d+)', line)
        if tremor_match:
            senses['tremorsense'] = int(tremor_match.group(1))

        # Passive Perception
        passive_match = re.search(r'被动察觉\s*(\d+)', line)
        if passive_match:
            senses['passivePerception'] = int(passive_match.group(1))

        monster['senses'] = senses

    def parse_languages(self, monster: Dict, line: str):
        """Parse languages"""
        line = line.split('语言')[-1].replace(':', '').replace('：', '').strip()

        # Split by comma or other delimiters
        languages = [lang.strip() for lang in re.split(r'[,，、]', line) if lang.strip() and '心灵感应' not in lang]

        monster['languages'] = languages
        monster['languagesEn'] = languages  # TODO: Could add English translations

    def parse_cr(self, monster: Dict, line: str):
        """Parse challenge rating and XP"""
        cr_match = re.search(r'挑战等级[：:]\s*([0-9/]+)', line)
        if cr_match:
            monster['cr'] = cr_match.group(1)

        xp_match = re.search(r'\(?\s*(\d+)\s*XP', line, re.IGNORECASE)
        if xp_match:
            monster['xp'] = int(xp_match.group(1))

    def parse_ability(self, monster: Dict, line: str, ability_list: str):
        """Parse traits, actions, reactions, etc."""
        # Look for ability name pattern: "Name 中文 English. Description"
        if not line or line.startswith('#') or line.startswith('-'):
            return

        # Check if line contains an ability definition
        ability_match = re.match(r'^([^。.]+?)\s+([A-Z][a-zA-Z\s\-\']+?)(?:[。.])\s*(.+)$', line)
        if ability_match:
            name_cn = ability_match.group(1).strip()
            name_en = ability_match.group(2).strip()
            description = ability_match.group(3).strip()

            ability = {
                'name': name_cn,
                'nameEn': name_en,
                'description': description
            }

            if ability_list == 'traits':
                monster['traits'].append(ability)
            elif ability_list == 'actions':
                monster['actions'].append(ability)
            elif ability_list == 'reactions':
                monster['reactions'].append(ability)
            elif ability_list == 'legendaryActions':
                monster['legendaryActions'].append(ability)

    def clean_monster_data(self, monster: Dict):
        """Clean up monster data, removing empty fields"""
        # Remove raw_text
        if 'raw_text' in monster:
            del monster['raw_text']

        # Clean empty lists
        for key in ['traits', 'actions', 'reactions', 'legendaryActions',
                    'lairActions', 'regionalEffects']:
            if not monster[key]:
                monster[key] = []

    def save_to_json(self, output_file: str):
        """Save monsters to JSON file"""
        output = {
            'overview': {
                'description': 'DND 5E怪物图鉴完整数据',
                'descriptionEn': 'DND 5E Monster Manual Complete Data',
                'totalMonsters': len(self.monsters),
                'source': 'Monster Manual'
            },
            'monsters': self.monsters
        }

        output_path = Path(output_file)
        output_path.parent.mkdir(parents=True, exist_ok=True)

        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump(output, f, ensure_ascii=False, indent=2)

        print(f"Saved {len(self.monsters)} monsters to {output_file}")
        print(f"File size: {output_path.stat().st_size / 1024:.2f} KB")

        return output_path


def main():
    source_file = "/Users/haoli/leehow/code/dw/trpg/DND_5E_怪物图鉴CN_2025-10-27-11_59_20/DND_5E_怪物图鉴CN.md"
    output_file = "/Users/haoli/leehow/code/dw/dnd-platform/configs/monsters.json"

    parser = MonsterParser(source_file)
    monsters = parser.parse()
    parser.save_to_json(output_file)

    # Print statistics
    print("\n=== Extraction Statistics ===")
    print(f"Total monsters extracted: {len(monsters)}")

    # Sample some monster names
    print("\nSample monsters:")
    for i, monster in enumerate(monsters[:10]):
        print(f"  {i+1}. {monster['name']} ({monster['nameEn']})")

    # Count by CR
    cr_counts = {}
    for monster in monsters:
        cr = monster.get('cr', 'Unknown')
        cr_counts[cr] = cr_counts.get(cr, 0) + 1

    print(f"\nCR distribution (top 10):")
    for cr, count in sorted(cr_counts.items(), key=lambda x: x[1], reverse=True)[:10]:
        print(f"  CR {cr}: {count} monsters")


if __name__ == '__main__':
    main()
