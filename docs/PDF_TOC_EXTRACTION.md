# PDF TOC Extraction: MinerU bbox + LLM Inference

## Problem

MinerU cloud API parses PDF into markdown, but assigns **all titles as heading level 1** (`#`). The `content_list.json` in the result ZIP contains title blocks with `text_level: 1` for every title — no hierarchy information.

This means a 264-page document with 953 titles all become `# Title`, making TOC and document navigation useless.

## Solution

Use structured metadata from MinerU's `content_list.json` (bbox bounding box height + page position) combined with LLM semantic analysis to infer correct heading levels.

## Pipeline

```
MinerU Cloud API
       │
       ▼
  Result ZIP
  ├── full.md              (all # headings)
  ├── *_content_list.json  (title blocks with bbox)
  ├── content_list_v2.json (v2 format, per-page)
  ├── *_model.json         (layout detection)
  ├── layout.json          (full layout analysis)
  └── images/

       │
       ▼  Extract title blocks
  [{ text, page_idx, bbox_height }, ...]
       │
       ▼  Batch LLM inference (350 per batch)
  [{ i, level (0-4) }, ...]
       │
       ▼  Rewrite markdown
  full.md with ##, ###, #### headings
       │
       ▼  Stage 2 (background)
  Regex TOC extraction (no LLM needed)
```

## Key Signals for LLM

The LLM receives three signals per title and uses them together:

### 1. bbox_height (primary)

Each title block in `content_list.json` has a `bbox` field `[x0, y0, x1, y1]` mapped to 0-1000. The height (`y1 - y0`) correlates with font size.

Example from a real document:
```
h=156  "TRIANGLEAGENCY"         → Level 1 (book title)
h=60   "Anomaly Retrieval"      → Level 1 (chapter)
h=33   "Anomalies in Detail"    → Level 2 (section)
h=22   "The Normal Briefcase"   → Level 3 (subsection)
h=17   "Activities that..."     → Level 4 (minor item)
```

Heights are **relative within each document** — no fixed thresholds. The LLM clusters heights per document.

### 2. Semantic structure

- Series items (A1, A2... B1, B2...) must share the same level
- Numbered siblings (1. xxx, 2. xxx, 3. xxx) must share the same level
- Repeated short labels are likely not headings (see below)

### 3. Repeated title detection

Before sending to LLM, the system counts title occurrences. Titles appearing 3+ times are flagged:

```
Frequently repeated titles (likely NOT real headings → level 0):
"Trigger" (42x), "1 2 3 Next" (18x), "Self-Assessment" (9x), ...
```

These are typically table headers, game mechanic labels, or UI elements that MinerU mistakenly detected as titles.

## Level Assignment

| Level | Meaning | Typical count |
|-------|---------|--------------|
| 1 | Major parts / chapters | 3-10 |
| 2 | Sections | Moderate |
| 3 | Subsections | Many |
| 4 | Minor items | Many |
| 0 | Not a heading (false positive) | Filtered out |

Level 0 titles are converted from `# Title` to `**Title**` (bold paragraph) in the markdown.

## Batch Processing

All titles are processed (no sampling) to ensure consistency. Titles are sent in batches of 350 to stay within LLM context limits. Each batch receives the full document's height distribution for consistent clustering.

Typical cost for a 264-page / 953-title document:
- 3 batches
- ~25K input + ~18K output tokens
- ~1.5 minutes

## Integration with Stage 2

When heading inference succeeds, `headings_inferred: true` is saved to file metadata. Stage 2 (`document_enhance.py`) checks this flag:

- **`headings_inferred = true`**: Uses `extract_toc_simple` (pure regex) — headings are already correct, no LLM needed
- **`headings_inferred = false`**: Falls back to `extract_toc_llm` (regex + LLM refinement) as before

## Files

| File | Role |
|------|------|
| `services/mineru_service.py` | `_extract_title_blocks()` — parse content_list.json from ZIP |
| `services/langextract_service.py` | `infer_heading_levels()` / `_infer_batch()` — LLM inference |
| `routes/files.py` | `_convert_pdf_with_mineru()` — orchestrates inference during upload |
| `tasks/document_enhance.py` | Reads `headings_inferred` flag, skips LLM TOC if true |

## Limitations

- Depends on MinerU returning `content_list.json` in the ZIP (current cloud API does)
- LLM inference is best-effort — some edge cases remain (e.g. decorative large text misclassified as L1)
- If inference fails entirely, falls back to original all-`#` markdown (Stage 2 LLM TOC still works)
- Doc2X parsed documents do not have content_list data — they still use the old `extract_toc_llm` path
