"""Validate that every fixture key is a real spell id in spells.json."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
spells_path = ROOT / "frontend/app/data/rules/spells.json"
fixtures_path = Path(__file__).with_name("fixtures.json")

data = json.loads(spells_path.read_text(encoding="utf-8"))
spells = data["spells"] if isinstance(data, dict) and "spells" in data else data
ids = {s["id"] for s in spells if "id" in s}
fixtures = json.loads(fixtures_path.read_text(encoding="utf-8"))

unknown = [k for k in fixtures if k not in ids]
if unknown:
    print(f"UNKNOWN spell ids in fixtures.json: {unknown}", file=sys.stderr)
    sys.exit(1)
print(f"OK: {len(fixtures)} fixtures, all ids valid. Catalog has {len(ids)} spells.")
