# Active Plans Ledger

This directory holds durable Markdown ledgers for multi-turn initiatives that
need on-disk Done / Not Done memory. Each plan lives in
`docs/active-plans/<work_id>.md`.

The ledger is memory and accountability only. It does not authorize direct code
edits, does not replace worker handoffs, and does not weaken validation. The
Codex lead owns updates by default.

## Status Terms

- `Done` - implemented or decided, backed by evidence.
- `In Progress` - currently owned by the lead or a named worker.
- `Not Done` - agreed work, not yet started.
- `Partial` - some evidence exists, intended behavior incomplete.
- `Blocked` - cannot proceed without a dependency or user decision.
- `Deferred` - intentionally postponed, with a stated reason.

## Active Plans

| Work ID | Plan | Status | Last Updated | Next Action |
|---|---|---|---:|---|
| `i18n-english-canonical` | [English-Canonical i18n Migration](i18n-english-canonical.md) | `In Progress` | `2026-05-27` | Dispatch first `AppError` producer / frontend error-code rendering pilot. |
| `spell-runtime-engine` | [Spell Runtime Engine Phase Executor](spell-runtime-engine.md) | `In Progress` | `2026-05-26` | Dispatch Stage 1 worker for engine skeleton and unit tests. |

## Archived

| Work ID | Plan | Closed | Outcome |
|---|---|---:|---|
