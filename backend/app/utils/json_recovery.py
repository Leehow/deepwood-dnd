"""
JSON recovery utilities for handling malformed AI responses.
Consolidates JSON extraction and repair logic used across multiple parsers.
"""

import json
import re
from typing import Any, Dict, List, Optional, Union
import logging

logger = logging.getLogger(__name__)


def extract_json_from_text(
    text: str,
    fallback_to_repair: bool = True
) -> Optional[Union[Dict[str, Any], List[Any]]]:
    """
    Extract and parse JSON from text that may contain markdown or other formatting.

    Attempts multiple strategies:
    1. Direct JSON parsing
    2. Extract from markdown code blocks
    3. Find JSON-like structure with balanced brackets
    4. Repair common issues if fallback enabled

    Args:
        text: Input text potentially containing JSON
        fallback_to_repair: Whether to attempt repair on failure

    Returns:
        Parsed JSON object/array or None if extraction fails
    """
    if not text or not text.strip():
        return None

    # Strategy 1: Try direct parsing
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Strategy 2: Extract from markdown code blocks
    json_block = extract_from_code_block(text)
    if json_block:
        try:
            return json.loads(json_block)
        except json.JSONDecodeError:
            if fallback_to_repair:
                repaired = repair_json(json_block)
                if repaired:
                    return repaired

    # Strategy 3: Find JSON structure with balanced brackets
    json_structure = extract_balanced_json(text)
    if json_structure:
        try:
            return json.loads(json_structure)
        except json.JSONDecodeError:
            if fallback_to_repair:
                repaired = repair_json(json_structure)
                if repaired:
                    return repaired

    # Strategy 4: Last resort - attempt repair on full text
    if fallback_to_repair:
        return repair_json(text)

    return None


def extract_from_code_block(text: str) -> Optional[str]:
    """
    Extract JSON from markdown code blocks.

    Looks for:
    - ```json ... ```
    - ```JSON ... ```
    - ``` ... ``` (generic code block)

    Args:
        text: Text containing potential code blocks

    Returns:
        Extracted JSON string or None
    """
    # Try JSON-specific code blocks first
    patterns = [
        r'```json\s*(.*?)\s*```',
        r'```JSON\s*(.*?)\s*```',
        r'```\s*(.*?)\s*```'
    ]

    for pattern in patterns:
        match = re.search(pattern, text, re.DOTALL | re.IGNORECASE)
        if match:
            content = match.group(1).strip()
            if content.startswith('{') or content.startswith('['):
                return content

    return None


def extract_balanced_json(text: str) -> Optional[str]:
    """
    Extract JSON by finding balanced brackets.

    Scans for opening { or [ and finds the matching closing bracket,
    accounting for nested structures.

    Args:
        text: Text to scan

    Returns:
        Extracted JSON string with balanced brackets or None
    """
    # Find first opening bracket
    start_idx = -1
    start_char = None

    for i, char in enumerate(text):
        if char in '{[':
            start_idx = i
            start_char = char
            break

    if start_idx == -1:
        return None

    # Find matching closing bracket
    bracket_map = {'{': '}', '[': ']'}
    closing_char = bracket_map[start_char]

    depth = 0
    in_string = False
    escape_next = False

    for i in range(start_idx, len(text)):
        char = text[i]

        if escape_next:
            escape_next = False
            continue

        if char == '\\':
            escape_next = True
            continue

        if char == '"' and not escape_next:
            in_string = not in_string
            continue

        if not in_string:
            if char == start_char:
                depth += 1
            elif char == closing_char:
                depth -= 1
                if depth == 0:
                    return text[start_idx:i + 1]

    return None


def repair_json(text: str) -> Optional[Union[Dict[str, Any], List[Any]]]:
    """
    Attempt to repair common JSON formatting issues.

    Fixes:
    - Missing quotes around keys
    - Single quotes instead of double quotes
    - Trailing commas
    - Unescaped characters
    - Missing closing brackets

    Args:
        text: Malformed JSON text

    Returns:
        Parsed JSON or None if repair fails
    """
    if not text:
        return None

    # Remove comments
    text = re.sub(r'//.*?$', '', text, flags=re.MULTILINE)
    text = re.sub(r'/\*.*?\*/', '', text, flags=re.DOTALL)

    # Fix common issues
    repairs = [
        # Convert single quotes to double quotes (careful with apostrophes)
        (r"(?<=[{\[,:\s])'([^']*)'(?=[:,\]\}\s])", r'"\1"'),

        # Add quotes to unquoted keys
        (r'(?<=[{\[,\s])([a-zA-Z_][a-zA-Z0-9_]*)\s*:', r'"\1":'),

        # Remove trailing commas
        (r',\s*([}\]])', r'\1'),

        # Fix escaped characters
        (r'\\([^"\\bfnrtu/])', r'\\\\\1'),

        # Remove control characters
        (r'[\x00-\x1f\x7f]', ' ')
    ]

    for pattern, replacement in repairs:
        text = re.sub(pattern, replacement, text)

    # Try to parse repaired JSON
    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        # Attempt to fix unclosed brackets
        if "Expecting" in str(e):
            fixed = attempt_bracket_completion(text)
            if fixed:
                try:
                    return json.loads(fixed)
                except json.JSONDecodeError:
                    pass

    return None


def attempt_bracket_completion(text: str) -> Optional[str]:
    """
    Attempt to close unclosed brackets in JSON.

    Args:
        text: JSON text with potentially unclosed brackets

    Returns:
        Text with brackets closed or None
    """
    open_brackets = []
    in_string = False
    escape_next = False

    for char in text:
        if escape_next:
            escape_next = False
            continue

        if char == '\\':
            escape_next = True
            continue

        if char == '"' and not escape_next:
            in_string = not in_string
            continue

        if not in_string:
            if char == '{':
                open_brackets.append('}')
            elif char == '[':
                open_brackets.append(']')
            elif char == '}':
                if open_brackets and open_brackets[-1] == '}':
                    open_brackets.pop()
                else:
                    return None  # Mismatched brackets
            elif char == ']':
                if open_brackets and open_brackets[-1] == ']':
                    open_brackets.pop()
                else:
                    return None  # Mismatched brackets

    # Add missing closing brackets
    if open_brackets:
        text = text.rstrip()
        # Remove trailing comma if present
        if text.endswith(','):
            text = text[:-1]
        # Add closing brackets in reverse order
        text += ''.join(reversed(open_brackets))

    return text


def validate_json_structure(
    data: Union[Dict, List],
    required_fields: Optional[List[str]] = None,
    required_type: Optional[type] = None
) -> bool:
    """
    Validate that extracted JSON has expected structure.

    Args:
        data: Parsed JSON data
        required_fields: List of required field names (for dicts)
        required_type: Expected type (dict or list)

    Returns:
        True if structure is valid
    """
    if required_type and not isinstance(data, required_type):
        return False

    if required_fields and isinstance(data, dict):
        return all(field in data for field in required_fields)

    return True


def safe_json_loads(
    text: str,
    default: Optional[Union[Dict, List]] = None,
    required_fields: Optional[List[str]] = None
) -> Union[Dict[str, Any], List[Any]]:
    """
    Safely load JSON with fallback and validation.

    Args:
        text: JSON text to parse
        default: Default value if parsing fails
        required_fields: Required fields for validation

    Returns:
        Parsed JSON or default value
    """
    result = extract_json_from_text(text)

    if result and (not required_fields or validate_json_structure(result, required_fields)):
        return result

    if default is not None:
        logger.warning(f"JSON parsing failed, using default: {default}")
        return default

    logger.error(f"JSON parsing failed with no default: {text[:200]}...")
    return {} if required_fields else []