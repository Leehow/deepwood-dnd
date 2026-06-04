"""Character generation service with AI translation support"""
import json
import re
from typing import Dict, Any, Optional, List, AsyncGenerator
from app.services.ai_service import AIService


class CharacterGenerator:
    """Service for generating character information using AI"""

    @staticmethod
    async def translate_to_chinese(
        api_url: str,
        api_key: str,
        model: str,
        text: str,
        temperature: float = 0.3,
        max_tokens: int = 500
    ) -> str:
        """
        Translate English text to Chinese if needed

        Args:
            api_url: AI API URL
            api_key: AI API key
            model: Model name
            text: Text to translate
            temperature: LLM temperature (default 0.3)
            max_tokens: Max tokens (default 500)

        Returns:
            Translated Chinese text or original if already Chinese
        """
        # Check if text contains mostly English characters
        english_chars = sum(1 for c in text if ord(c) < 128 and c.isalpha())
        chinese_chars = sum(1 for c in text if '\u4e00' <= c <= '\u9fff')

        # If mostly Chinese, return as-is
        if chinese_chars > english_chars:
            return text

        # Translate to Chinese
        prompt = f"""Please translate the following English text to natural Chinese. Only return the translation, no explanation:

{text}"""

        translated = await AIService.generate_completion(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )

        return translated.strip()

    @staticmethod
    async def generate_background_only(
        api_url: str,
        api_key: str,
        model: str,
        race: str,
        subrace: Optional[str],
        character_class: str,
        alignment: str,
        name: str,
        age: int,
        gender: str,
        temperature: float = 0.8,
        max_tokens: int = 1000
    ) -> Dict[str, Any]:
        """
        Generate only background and personality traits

        Returns:
            Dict with background, traits, ideals, bonds, flaws (in Chinese)
        """
        character_context = f"""种族: {race}"""
        if subrace:
            character_context += f" ({subrace})"
        character_context += f"""
职业: {character_class}
阵营: {alignment}
姓名: {name}
年龄: {age}
性别: {gender}"""

        prompt = f"""你是D&D 5E角色背景生成专家。请根据以下角色信息，生成合理且富有创意的角色背景和个性特征。

角色信息：
{character_context}

请用中文以JSON格式返回，包含以下字段：
{{
  "background": "背景描述（如：贵族、学者、士兵等，1-2个词）",
  "traits": ["性格特质1", "性格特质2"],
  "ideals": "理想信念（一句话）",
  "bonds": "羁绊（一句话）",
  "flaws": "缺陷（一句话）"
}}

要求：
1. 必须返回有效的JSON格式，不要有任何markdown标记
2. 背景要符合角色的种族、职业和阵营
3. 性格特质要生动具体
4. 理想、羁绊和缺陷要相互关联，形成完整的人物形象
5. 所有内容必须用中文"""

        generated_content = await AIService.generate_completion(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )

        # Extract and parse JSON
        parsed_data = await CharacterGenerator._extract_and_parse_json(
            generated_content, api_url, api_key, model
        )

        # Translate if needed
        parsed_data["background"] = await CharacterGenerator.translate_to_chinese(
            api_url, api_key, model, parsed_data["background"]
        )

        # Translate traits
        translated_traits = []
        for trait in parsed_data["traits"]:
            translated = await CharacterGenerator.translate_to_chinese(
                api_url, api_key, model, trait
            )
            translated_traits.append(translated)
        parsed_data["traits"] = translated_traits

        # Translate other fields
        for field in ["ideals", "bonds", "flaws"]:
            parsed_data[field] = await CharacterGenerator.translate_to_chinese(
                api_url, api_key, model, parsed_data[field]
            )

        return parsed_data

    @staticmethod
    async def generate_full_character(
        api_url: str,
        api_key: str,
        model: str,
        race: str,
        subrace: Optional[str],
        character_class: str,
        alignment: str,
        age_range: tuple,  # (mature_age, max_age)
        temperature: float = 0.8,
        max_tokens: int = 1200
    ) -> Dict[str, Any]:
        """
        Generate complete character including name, age, gender, and background

        Returns:
            Dict with name, age, gender, background, traits, ideals, bonds, flaws (in Chinese)
        """
        context = f"""种族: {race}"""
        if subrace:
            context += f" ({subrace})"
        context += f"""
职业: {character_class}
阵营: {alignment}
年龄范围: {age_range[0]}岁成年，最大寿命{age_range[1]}岁"""

        prompt = f"""你是D&D 5E角色创建专家。请根据以下信息，创建一个完整的角色，包括姓名、年龄、性别、阵营、背景和个性。

角色信息：
{context}

请用中文以JSON格式返回，包含以下字段：
{{
  "name": "符合D&D西方奇幻风格的名字的中文音译（如人类：阿拉贡、伊欧温；精灵：莱戈拉斯、凯兰崔尔；矮人：吉姆利、索林；半身人：比尔博、佛罗多等，不要使用李明、王芳这类中国化名字）",
  "age": 合理的年龄数字（必须 >= {age_range[0]}岁且 <= {age_range[1]}岁），
  "gender": "男性或女性",
  "alignment": "九宫格阵营之一（守序善良/中立善良/混乱善良/守序中立/绝对中立/混乱中立/守序邪恶/中立邪恶/混乱邪恶）",
  "background": "背景描述（如：贵族、学者、士兵等）",
  "traits": ["性格特质1", "性格特质2"],
  "ideals": "理想信念（一句话）",
  "bonds": "羁绊（一句话）",
  "flaws": "缺陷（一句话）"
}}

要求：
1. 必须返回有效的JSON格式，不要有任何markdown标记
2. 姓名必须是西方奇幻风格英文名的中文音译，根据种族特色选择合适的命名风格：
   - 人类：如阿拉贡、伊欧温、博罗米尔（音译自Aragorn, Eowyn, Boromir）
   - 精灵：如莱戈拉斯、凯兰崔尔、埃尔隆德（音译自Legolas, Galadriel, Elrond）
   - 矮人：如吉姆利、索林、巴林（音译自Gimli, Thorin, Balin）
   - 半身人：如比尔博、佛罗多、山姆（音译自Bilbo, Frodo, Samwise）
   - 龙裔：如德拉克斯、萨拉什、克里夫（音译自Drax, Tharash, Kriv）
   - 侏儒：如埃尔登、格利姆、西博（音译自Eldon, Glim, Seebo）
   - 半兽人：如格罗姆、索洛克、登奇（音译自Grom, Throk, Dench）
   - 提夫林：如阿克塔、达玛雅、勒瑞莎（音译自Akta, Damaia, Lerissa）
3. 年龄必须在{age_range[0]}岁到{age_range[1]}岁之间（{age_range[0]}岁是该种族的成年年龄）
4. 阵营要符合职业和种族的典型特征
5. 所有特征要相互呼应，形成完整人物
6. 所有内容必须用中文"""

        generated_content = await AIService.generate_completion(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )

        # Extract and parse JSON
        parsed_data = await CharacterGenerator._extract_and_parse_json(
            generated_content, api_url, api_key, model, include_basic_info=True
        )

        # Validate and adjust age to ensure it's within valid range
        if "age" in parsed_data:
            age = parsed_data["age"]
            mature_age, max_age = age_range

            # If age is below mature age, adjust it
            if age < mature_age:
                # Set to a reasonable young adult age (mature age + 10% of lifespan)
                parsed_data["age"] = mature_age + int((max_age - mature_age) * 0.1)
            # If age exceeds max age, adjust it
            elif age > max_age:
                # Set to a reasonable elderly age (80% of lifespan)
                parsed_data["age"] = int(max_age * 0.8)

        # Ensure all text is in Chinese (including name which should be Chinese transliteration)
        for field in ["name", "alignment", "background", "ideals", "bonds", "flaws"]:
            if field in parsed_data:
                parsed_data[field] = await CharacterGenerator.translate_to_chinese(
                    api_url, api_key, model, str(parsed_data[field])
                )

        # Translate traits
        if "traits" in parsed_data:
            translated_traits = []
            for trait in parsed_data["traits"]:
                translated = await CharacterGenerator.translate_to_chinese(
                    api_url, api_key, model, trait
                )
                translated_traits.append(translated)
            parsed_data["traits"] = translated_traits

        return parsed_data

    @staticmethod
    async def generate_full_description(
        api_url: str,
        api_key: str,
        model: str,
        race: str,
        subrace: Optional[str],
        character_class: str,
        background: Optional[str],
        age_range: tuple,  # (mature_age, max_age)
        temperature: float = 0.8,
        max_tokens: int = 3000
    ) -> Dict[str, Any]:
        """
        Generate complete character description including name, age, gender, appearance, and personality
        For Cleric/Paladin, also generates deity selection

        Returns:
            Dict with name, age, gender, alignment, appearance fields, personality traits, and deity (in Chinese)
        """
        context = f"""种族: {race}"""
        if subrace:
            context += f" ({subrace})"
        context += f"""
职业: {character_class}"""
        if background:
            context += f"""
背景: {background}"""
        context += f"""
年龄范围: {age_range[0]}岁成年，最大寿命{age_range[1]}岁"""

        # Check if class should have deity
        # Warlock has patron instead of deity, so exclude it
        should_have_deity = character_class.lower() not in ["warlock", "术士"]

        deity_instruction = ""
        deity_note = ""
        if should_have_deity:
            # Cleric and Paladin strongly recommend deity
            if character_class.lower() in ["cleric", "paladin", "牧师", "圣武士"]:
                deity_instruction = """
  "deity": "推荐的神祇名称（英文，如：Lathander, Torm, Helm等）","""
                deity_note = " 以及信仰的神祇"
            else:
                # Other classes can have deity but it's optional
                deity_instruction = """
  "deity": "信仰的神祇名称（英文，可选，如：Lathander, Torm, Helm等，如果角色不信仰神祇可以为null）","""
                deity_note = " 以及信仰的神祇（可选）"

        prompt = f"""你是D&D 5E角色创建专家。请根据以下信息，创建一个完整的角色描述，包括姓名、年龄、性别、阵营、背景、外貌和个性{deity_note}。

角色信息：
{context}

种族身高体重参考（请在合理范围内随机生成）：
- 人类：身高150-190cm，体重45-90kg
- 矮人：身高120-150cm，体重60-90kg（矮人体格健壮）
- 精灵：身高150-180cm，体重40-70kg（精灵身材纤细）
- 半身人：身高80-120cm，体重15-40kg
- 龙裔：身高180-210cm，体重100-150kg（龙裔体格强壮）
- 侏儒：身高90-120cm，体重18-40kg
- 半精灵：身高150-180cm，体重50-80kg
- 半兽人：身高170-210cm，体重80-130kg（半兽人肌肉发达）
- 提夫林：身高150-180cm，体重50-90kg

请用中文以JSON格式返回，包含以下字段：
{{
  "name": "符合D&D西方奇幻风格的名字的中文音译",
  "age": 合理的年龄数字（必须 >= {age_range[0]}岁且 <= {age_range[1]}岁），
  "gender": "男性或女性",
  "alignment": "九宫格阵营之一（守序善良/中立善良/混乱善良/守序中立/绝对中立/混乱中立/守序邪恶/中立邪恶/混乱邪恶）",{deity_instruction}
  "background": "适合该角色的D&D背景（如：平民、贵族、士兵、学者、罪犯、隐士、艺人、工匠等）",
  "height": 身高数字（厘米，必须符合该种族的身高范围），
  "weight": 体重数字（公斤，必须符合该种族的体重范围和体格特征），
  "eyes": "眼睛颜色（符合种族特征）",
  "skin": "皮肤颜色（符合种族特征）",
  "hair": "头发描述（符合种族特征）",
  "distinguishingMarks": "特殊标记（可选，如疤痕、纹身等）",
  "traits": ["性格特质1", "性格特质2"],
  "ideals": "理想信念（一句话）",
  "bonds": "羁绊（一句话）",
  "flaws": "缺陷（一句话）",
  "otherTraits": "其他值得注意的特性或习惯（可选）",
  "backstory": "角色的详细背景故事，包括出身家庭、童年经历、成长过程中的重要转折点、关键人物、为何踏上冒险之路等（300-500字，要有具体细节和情感）"
}}

要求：
1. 必须返回有效的JSON格式，不要有任何markdown标记
2. 外貌特征必须符合种族、职业和背景的特点
3. 身高和体重必须使用公制单位（厘米和公斤），只返回数字
4. 身高和体重必须在该种族的合理范围内
5. 所有内容必须用中文{f'''
6. deity字段必须是D&D 5E中真实存在的神祇英文名称（如：Lathander, Torm, Helm, Tyr, Bahamut等）
7. 神祇的阵营必须与角色阵营相符或接近
8. 对于牧师和圣武士，deity字段是强烈推荐的；对于其他职业（除术士外），deity字段是可选的，可以为null''' if should_have_deity else ''}"""

        generated_content = await AIService.generate_completion(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )

        # Extract and parse JSON
        parsed_data = await CharacterGenerator._extract_and_parse_json_extended(
            generated_content, api_url, api_key, model
        )

        # Validate and adjust age
        if "age" in parsed_data:
            age = parsed_data["age"]
            mature_age, max_age = age_range
            if age < mature_age:
                parsed_data["age"] = mature_age + int((max_age - mature_age) * 0.1)
            elif age > max_age:
                parsed_data["age"] = int(max_age * 0.8)

        return parsed_data

    @staticmethod
    async def generate_appearance_only(
        api_url: str,
        api_key: str,
        model: str,
        race: str,
        subrace: Optional[str],
        character_class: str,
        background: Optional[str],
        gender: Optional[str],
        age_range: tuple,
        temperature: float = 0.7,
        max_tokens: int = 800
    ) -> Dict[str, Any]:
        """
        Generate only appearance details (age, gender, height, weight, eyes, skin, hair, marks)

        Returns:
            Dict with age, gender, and appearance fields (in Chinese)
        """
        context = f"""种族: {race}"""
        if subrace:
            context += f" ({subrace})"
        context += f"""
职业: {character_class}"""
        if background:
            context += f"""
背景: {background}"""
        if gender:
            context += f"\n性别: {gender}"

        prompt = f"""你是D&D 5E角色创建专家。请根据以下信息，生成符合种族、职业和背景的外貌描述。

角色信息：
{context}

种族身高体重参考（请在合理范围内随机生成）：
- 人类：身高150-190cm，体重45-90kg
- 矮人：身高120-150cm，体重60-90kg（矮人体格健壮）
- 精灵：身高150-180cm，体重40-70kg（精灵身材纤细）
- 半身人：身高80-120cm，体重15-40kg
- 龙裔：身高180-210cm，体重100-150kg（龙裔体格强壮）
- 侏儒：身高90-120cm，体重18-40kg
- 半精灵：身高150-180cm，体重50-80kg
- 半兽人：身高170-210cm，体重80-130kg（半兽人肌肉发达）
- 提夫林：身高150-180cm，体重50-90kg

请用中文以JSON格式返回，包含以下字段：
{{
  "age": 合理的年龄数字（必须 >= {age_range[0]}岁且 <= {age_range[1]}岁），
  "gender": "男性或女性",
  "height": "身高（厘米，必须符合该种族的身高范围）",
  "weight": "体重（公斤，必须符合该种族的体重范围和体格特征）",
  "eyes": "眼睛颜色（符合种族特征）",
  "skin": "皮肤颜色（符合种族特征）",
  "hair": "头发描述（符合种族特征）",
  "distinguishingMarks": "特殊标记（如疤痕、纹身等，可以为空字符串）"
}}

要求：
1. 必须返回有效的JSON格式，不要有任何markdown标记
2. 外貌特征必须符合种族的典型特征
3. 身高和体重必须使用公制单位（厘米和公斤），只返回数字
4. 身高和体重必须在该种族的合理范围内
5. 所有内容必须用中文"""

        generated_content = await AIService.generate_completion(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )

        # Extract and parse JSON
        parsed_data = await CharacterGenerator._extract_and_parse_json_appearance(
            generated_content, api_url, api_key, model
        )

        # Validate and adjust age
        if "age" in parsed_data:
            age = parsed_data["age"]
            mature_age, max_age = age_range
            if age < mature_age:
                parsed_data["age"] = mature_age + int((max_age - mature_age) * 0.1)
            elif age > max_age:
                parsed_data["age"] = int(max_age * 0.8)

        return parsed_data

    @staticmethod
    async def generate_personality_only(
        api_url: str,
        api_key: str,
        model: str,
        race: str,
        subrace: Optional[str],
        character_class: str,
        background: Optional[str],
        alignment: str,
        temperature: float = 0.8,
        max_tokens: int = 2000
    ) -> Dict[str, Any]:
        """
        Generate only personality traits (traits, ideals, bonds, flaws)

        Returns:
            Dict with personality fields (in Chinese)
        """
        context = f"""种族: {race}"""
        if subrace:
            context += f" ({subrace})"
        context += f"""
职业: {character_class}"""
        if background:
            context += f"""
背景: {background}"""
        context += f"""
阵营: {alignment}"""

        prompt = f"""你是D&D 5E角色创建专家。请根据以下信息，生成符合角色特点的个性特征和背景故事。

角色信息：
{context}

请用中文以JSON格式返回，包含以下字段：
{{
  "traits": ["性格特质1", "性格特质2"],
  "ideals": "理想信念（一句话）",
  "bonds": "羁绊（一句话）",
  "flaws": "缺陷（一句话）",
  "otherTraits": "其他值得注意的特性或习惯（可选）",
  "backstory": "角色的详细背景故事，包括出身家庭、童年经历、成长过程中的重要转折点、关键人物、为何踏上冒险之路等（300-500字，要有具体细节和情感）"
}}

要求：
1. 必须返回有效的JSON格式，不要有任何markdown标记
2. 性格特质要符合种族、职业、背景和阵营
3. 理想、羁绊和缺陷要相互关联，形成完整的人物形象
4. 背景故事要详细生动，与角色的性格和经历相符
5. 所有内容必须用中文"""

        generated_content = await AIService.generate_completion(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        )

        # Extract and parse JSON
        parsed_data = await CharacterGenerator._extract_and_parse_json(
            generated_content, api_url, api_key, model
        )

        return parsed_data

    @staticmethod
    async def _extract_and_parse_json(
        content: str,
        api_url: str,
        api_key: str,
        model: str,
        include_basic_info: bool = False
    ) -> Dict[str, Any]:
        """
        Extract JSON from AI response and parse it

        Args:
            content: Raw AI response
            api_url: API URL for validation retry
            api_key: API key
            model: Model name
            include_basic_info: Whether response should include name/age/gender

        Returns:
            Parsed JSON dict
        """
        # Extract JSON from markdown code blocks
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', content) or \
                    re.search(r'```\s*([\s\S]*?)\s*```', content)

        json_content = json_match.group(1) if json_match else content
        json_content = json_content.strip()

        # Try to parse JSON
        try:
            parsed_data = json.loads(json_content)
        except json.JSONDecodeError:
            # If parsing fails, try to fix with AI
            fields = '  "background": "string",\n  "traits": ["string", "string"],\n  "ideals": "string",\n  "bonds": "string",\n  "flaws": "string"'
            if include_basic_info:
                fields = '  "name": "string",\n  "age": number,\n  "gender": "string",\n  ' + fields

            validate_prompt = f"""以下内容应该是JSON格式，但可能格式有误。请提取并修复为有效的JSON格式，只返回JSON，不要有markdown标记或其他文字：

{json_content}

要求的JSON结构：
{{
{fields}
}}"""

            fixed_content = await AIService.generate_completion(
                api_url=api_url,
                api_key=api_key,
                model=model,
                messages=[{"role": "user", "content": validate_prompt}],
                temperature=0.1,
                max_tokens=800
            )

            # Extract JSON again from fixed content
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', fixed_content) or \
                        re.search(r'```\s*([\s\S]*?)\s*```', fixed_content)
            fixed_content = json_match.group(1) if json_match else fixed_content
            fixed_content = fixed_content.strip()

            parsed_data = json.loads(fixed_content)

        # Validate required fields
        required_fields = ["background", "traits", "ideals", "bonds", "flaws"]
        if include_basic_info:
            required_fields = ["name", "age", "gender"] + required_fields

        for field in required_fields:
            if field not in parsed_data:
                raise ValueError(f"Missing required field: {field}")

        # Ensure traits is a list
        if not isinstance(parsed_data["traits"], list):
            parsed_data["traits"] = [parsed_data["traits"]]

        return parsed_data

    @staticmethod
    async def _extract_and_parse_json_extended(
        content: str,
        api_url: str,
        api_key: str,
        model: str
    ) -> Dict[str, Any]:
        """Extract and parse JSON for full description (with appearance fields)"""
        # Extract JSON from markdown code blocks
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', content) or \
                    re.search(r'```\s*([\s\S]*?)\s*```', content)

        json_content = json_match.group(1) if json_match else content
        json_content = json_content.strip()

        # Try to parse JSON
        try:
            parsed_data = json.loads(json_content)
        except json.JSONDecodeError:
            # If parsing fails, try to fix with AI
            validate_prompt = f"""以下内容应该是JSON格式，但可能格式有误。请提取并修复为有效的JSON格式，只返回JSON，不要有markdown标记或其他文字：

{json_content}

要求的JSON结构：
{{
  "name": "string",
  "age": number,
  "gender": "string",
  "alignment": "string",
  "height": "string",
  "weight": "string",
  "eyes": "string",
  "skin": "string",
  "hair": "string",
  "distinguishingMarks": "string",
  "traits": ["string", "string"],
  "ideals": "string",
  "bonds": "string",
  "flaws": "string"
}}"""

            fixed_content = await AIService.generate_completion(
                api_url=api_url,
                api_key=api_key,
                model=model,
                messages=[{"role": "user", "content": validate_prompt}],
                temperature=0.1,
                max_tokens=1000
            )

            # Extract JSON again from fixed content
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', fixed_content) or \
                        re.search(r'```\s*([\s\S]*?)\s*```', fixed_content)
            fixed_content = json_match.group(1) if json_match else fixed_content
            fixed_content = fixed_content.strip()

            parsed_data = json.loads(fixed_content)

        # Validate required fields
        required_fields = ["name", "age", "gender", "alignment", "height", "weight",
                          "eyes", "skin", "hair", "traits", "ideals", "bonds", "flaws"]

        for field in required_fields:
            if field not in parsed_data:
                raise ValueError(f"Missing required field: {field}")

        # Ensure traits is a list
        if not isinstance(parsed_data["traits"], list):
            parsed_data["traits"] = [parsed_data["traits"]]

        return parsed_data

    @staticmethod
    async def _extract_and_parse_json_appearance(
        content: str,
        api_url: str,
        api_key: str,
        model: str
    ) -> Dict[str, Any]:
        """Extract and parse JSON for appearance only"""
        # Extract JSON from markdown code blocks
        json_match = re.search(r'```json\s*([\s\S]*?)\s*```', content) or \
                    re.search(r'```\s*([\s\S]*?)\s*```', content)

        json_content = json_match.group(1) if json_match else content
        json_content = json_content.strip()

        # Try to parse JSON
        try:
            parsed_data = json.loads(json_content)
        except json.JSONDecodeError:
            # If parsing fails, try to fix with AI
            validate_prompt = f"""以下内容应该是JSON格式，但可能格式有误。请提取并修复为有效的JSON格式，只返回JSON，不要有markdown标记或其他文字：

{json_content}

要求的JSON结构：
{{
  "age": number,
  "gender": "string",
  "height": "string",
  "weight": "string",
  "eyes": "string",
  "skin": "string",
  "hair": "string",
  "distinguishingMarks": "string"
}}"""

            fixed_content = await AIService.generate_completion(
                api_url=api_url,
                api_key=api_key,
                model=model,
                messages=[{"role": "user", "content": validate_prompt}],
                temperature=0.1,
                max_tokens=600
            )

            # Extract JSON again from fixed content
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', fixed_content) or \
                        re.search(r'```\s*([\s\S]*?)\s*```', fixed_content)
            fixed_content = json_match.group(1) if json_match else fixed_content
            fixed_content = fixed_content.strip()

            parsed_data = json.loads(fixed_content)

        # Validate required fields
        required_fields = ["age", "gender", "height", "weight", "eyes", "skin", "hair"]

        for field in required_fields:
            if field not in parsed_data:
                raise ValueError(f"Missing required field: {field}")

        return parsed_data

    @staticmethod
    async def generate_backstory_stream(
        api_url: str,
        api_key: str,
        model: str,
        race: str,
        subrace: Optional[str],
        character_class: str,
        background: Optional[str],
        name: Optional[str],
        age: Optional[int],
        gender: Optional[str],
        alignment: Optional[str],
        personality_traits: Optional[List[str]],
        ideals: Optional[str],
        bonds: Optional[str],
        flaws: Optional[str],
        temperature: float = 0.8,
        max_tokens: int = 16384
    ) -> AsyncGenerator[str, None]:
        """
        Generate creative backstory using Advanced Language Model with streaming

        Yields:
            Server-Sent Events (SSE) formatted strings with backstory chunks
        """
        # Build character context
        context_parts = [f"种族: {race}"]
        if subrace:
            context_parts.append(f"亚种: {subrace}")
        context_parts.append(f"职业: {character_class}")
        if background:
            context_parts.append(f"背景: {background}")
        if name:
            context_parts.append(f"姓名: {name}")
        if age:
            context_parts.append(f"年龄: {age}岁")
        if gender:
            context_parts.append(f"性别: {gender}")
        if alignment:
            context_parts.append(f"阵营: {alignment}")

        # Add personality info if available
        personality_info = []
        if personality_traits:
            personality_info.append(f"性格特质: {', '.join(personality_traits)}")
        if ideals:
            personality_info.append(f"理想: {ideals}")
        if bonds:
            personality_info.append(f"羁绊: {bonds}")
        if flaws:
            personality_info.append(f"缺陷: {flaws}")

        character_context = "\n".join(context_parts)
        if personality_info:
            character_context += "\n\n个性特征:\n" + "\n".join(personality_info)

        # Create prompt for backstory
        prompt = f"""你是一位D&D角色背景故事撰写者。请根据以下角色信息，撰写一段简短的背景故事。

【重要】请直接输出故事内容，不要进行任何思考过程的输出，不要有任何前缀、标题或解释。

角色信息：
{character_context}

要求：
1. 使用普通的描述性书面语，避免过于口语化或文艺化的表达
2. 严格控制在150-250字之间（不要超过250字！）
3. 要体现角色的种族、职业和个性特征
4. 可以包含角色的成长经历、重要事件或转折点
5. 用第三人称叙述，语言简洁清晰
6. 用中文输出
7. 直接开始叙述，不要有"这是一个关于..."之类的开头
8. 使用客观、平实的叙事风格

请现在开始撰写："""

        # Stream the response
        async for chunk in AIService.generate_completion_stream(
            api_url=api_url,
            api_key=api_key,
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=max_tokens
        ):
            # Format as Server-Sent Events
            yield f"data: {json.dumps({'content': chunk})}\n\n"

        # Send completion signal
        yield f"data: {json.dumps({'done': True})}\n\n"

    @staticmethod
    async def generate_spells_for_character(
        api_url: str,
        api_key: str,
        model: str,
        class_id: str,
        race: str,
        background: Optional[str],
        personality: Dict[str, Any],
        available_cantrips: List[Dict[str, Any]],
        available_spells: List[Dict[str, Any]],
        num_cantrips: int,
        num_spells: int,
        temperature: float = 0.6,
        max_tokens: int = 500
    ) -> Dict[str, List[str]]:
        """
        Use AI to select spells that fit the character's personality and background.

        Args:
            api_url: AI API URL
            api_key: AI API key
            model: Model name
            class_id: Character's class ID
            race: Character's race name (Chinese)
            background: Character's background name (Chinese)
            personality: Dict with traits, ideals, bonds, flaws, backstory
            available_cantrips: List of cantrip dicts with id, name_cn, school, description_cn
            available_spells: List of spell dicts with id, name_cn, school, description_cn
            num_cantrips: Number of cantrips to select
            num_spells: Number of spells to select

        Returns:
            Dict with "cantrips" and "spells" lists of spell IDs
        """
        if num_cantrips == 0 and num_spells == 0:
            return {"cantrips": [], "spells": []}

        # Build character context
        context_parts = [f"种族: {race}", f"职业: {class_id}"]
        if background:
            context_parts.append(f"背景: {background}")

        # Add personality info
        if personality.get("traits"):
            traits = personality["traits"]
            if isinstance(traits, list):
                context_parts.append(f"性格特质: {', '.join(traits)}")
            else:
                context_parts.append(f"性格特质: {traits}")
        if personality.get("ideals"):
            context_parts.append(f"理想: {personality['ideals']}")
        if personality.get("bonds"):
            context_parts.append(f"羁绊: {personality['bonds']}")
        if personality.get("flaws"):
            context_parts.append(f"缺陷: {personality['flaws']}")
        if personality.get("backstory"):
            context_parts.append(f"背景故事: {personality['backstory'][:200]}...")

        character_context = "\n".join(context_parts)

        # Build spell lists for prompt
        cantrip_list = ""
        if num_cantrips > 0 and available_cantrips:
            cantrip_entries = []
            for c in available_cantrips[:30]:  # Limit to prevent too long prompt
                school_cn = {
                    "abjuration": "防护", "conjuration": "咒法",
                    "divination": "预言", "enchantment": "惑控",
                    "evocation": "塑能", "illusion": "幻术",
                    "necromancy": "死灵", "transmutation": "变化"
                }.get(c.get("school", ""), c.get("school", ""))
                cantrip_entries.append(
                    f"- {c['id']}: {c.get('name_cn', c['id'])} ({school_cn})"
                )
            cantrip_list = "\n".join(cantrip_entries)

        spell_list = ""
        if num_spells > 0 and available_spells:
            spell_entries = []
            for s in available_spells[:40]:  # Limit to prevent too long prompt
                school_cn = {
                    "abjuration": "防护", "conjuration": "咒法",
                    "divination": "预言", "enchantment": "惑控",
                    "evocation": "塑能", "illusion": "幻术",
                    "necromancy": "死灵", "transmutation": "变化"
                }.get(s.get("school", ""), s.get("school", ""))
                spell_entries.append(
                    f"- {s['id']}: {s.get('name_cn', s['id'])} ({school_cn})"
                )
            spell_list = "\n".join(spell_entries)

        # Build prompt
        prompt = f"""你是D&D 5E法术选择专家。请根据角色的性格和背景，从可用法术中选择最符合角色人设的法术。

角色信息：
{character_context}

"""
        if num_cantrips > 0 and cantrip_list:
            prompt += f"""可用戏法列表（需选择{num_cantrips}个）：
{cantrip_list}

"""
        if num_spells > 0 and spell_list:
            prompt += f"""可用1级法术列表（需选择{num_spells}个）：
{spell_list}

"""
        prompt += f"""请根据角色的性格、背景和职业特点，选择最适合这个角色的法术。

选择原则：
1. 法术要与角色的性格和背景故事相符
2. 考虑角色的战斗风格和擅长领域
3. 混合选择攻击、防御、辅助法术以保持实用性
4. 优先选择与角色人设高度契合的法术

请以JSON格式返回，只包含法术的id（不是中文名）：
{{
  "cantrips": ["spell_id_1", "spell_id_2"],
  "spells": ["spell_id_1", "spell_id_2", ...]
}}

注意：
- cantrips数组需要恰好{num_cantrips}个元素
- spells数组需要恰好{num_spells}个元素
- 只返回JSON，不要有任何其他文字"""

        try:
            generated_content = await AIService.generate_completion(
                api_url=api_url,
                api_key=api_key,
                model=model,
                messages=[{"role": "user", "content": prompt}],
                temperature=temperature,
                max_tokens=max_tokens
            )

            # Extract JSON from response
            json_match = re.search(r'```json\s*([\s\S]*?)\s*```', generated_content) or \
                        re.search(r'```\s*([\s\S]*?)\s*```', generated_content)
            json_content = json_match.group(1) if json_match else generated_content
            json_content = json_content.strip()

            # Try to find JSON object
            start = json_content.find("{")
            end = json_content.rfind("}")
            if start != -1 and end != -1:
                json_content = json_content[start:end + 1]

            result = json.loads(json_content)

            # Validate and ensure correct number of spells
            selected_cantrips = result.get("cantrips", [])
            selected_spells = result.get("spells", [])

            # Filter to only valid IDs
            valid_cantrip_ids = {c["id"] for c in available_cantrips}
            valid_spell_ids = {s["id"] for s in available_spells}

            selected_cantrips = [c for c in selected_cantrips if c in valid_cantrip_ids]
            selected_spells = [s for s in selected_spells if s in valid_spell_ids]

            # Fill up if AI didn't select enough
            if len(selected_cantrips) < num_cantrips:
                remaining = [c["id"] for c in available_cantrips if c["id"] not in selected_cantrips]
                selected_cantrips.extend(remaining[:num_cantrips - len(selected_cantrips)])

            if len(selected_spells) < num_spells:
                remaining = [s["id"] for s in available_spells if s["id"] not in selected_spells]
                selected_spells.extend(remaining[:num_spells - len(selected_spells)])

            # Trim if too many
            selected_cantrips = selected_cantrips[:num_cantrips]
            selected_spells = selected_spells[:num_spells]

            return {
                "cantrips": selected_cantrips,
                "spells": selected_spells
            }

        except Exception as e:
            print(f"[CharacterGenerator] AI spell selection failed: {e}, falling back to default")
            # Fallback: select first N spells
            return {
                "cantrips": [c["id"] for c in available_cantrips[:num_cantrips]],
                "spells": [s["id"] for s in available_spells[:num_spells]]
            }
