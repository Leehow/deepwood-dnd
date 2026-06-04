<!--
Sync Impact Report:
Version change: 0.0.0 → 1.0.0 (initial ratification)
Modified principles: None (initial creation)
Added sections: All sections (initial creation)
Removed sections: None
Templates requiring updates: ✅ plan-template.md (constitution check aligned), ✅ spec-template.md (scope aligned), ✅ tasks-template.md (task organization aligned)
Follow-up TODOs: None
-->

# D&D Platform Constitution

## Core Principles

### I. Modular Architecture
Every component must be self-contained and independently testable. Code files SHALL NOT exceed 400 lines - split by functional modules when needed. Components MUST have clear, single responsibilities and well-defined interfaces. This ensures maintainability and supports the complex domain of D&D gaming features.

### II. Real-Time First
All features MUST support real-time synchronization between DM and players. State changes SHALL propagate immediately through WebSocket connections. The tactical map system REQUIRES sub-100ms update latency for token movements and interactions. This principle enables the live, collaborative nature of tabletop gaming.

### III. Data-Driven Rules
D&D 5E rules MUST be implemented as structured data, not hardcoded logic. All game mechanics SHALL reference the comprehensive JSON rule system. Changes to rules, spells, monsters, or equipment MUST only require data updates, not code changes. This ensures the system remains current with official D&D content.

### IV. Bilingual Accessibility
The platform MUST support both English and Chinese interfaces. All user-visible text SHALL be externalized to i18n files. Technical documentation, code comments, and variable names MUST be English only. This serves the international D&D community while maintaining code maintainability.

### V. Test-Driven Development
TDD is MANDATORY for all features. Tests MUST be written before implementation and MUST fail initially. Browser devtools SHALL be used for primary testing, with Playwright for automated regression tests. All test files MUST be organized in the `debug/` folder to maintain project structure clarity.

## Development Standards

### Code Quality Requirements

Maximum 400 lines per file - files exceeding this limit MUST be split along functional boundaries. English variable names ONLY - Chinese characters are forbidden in identifiers. All API keys and sensitive configuration MUST remain in `.env` files only - never copied or hardcoded elsewhere.

### Technology Stack Constraints

Frontend MUST use React 18.3.1 + Remix 2.12.0 + TypeScript. UI components MUST use Radix UI + Radix Themes + Tailwind CSS. Map rendering MUST use Konva.js with react-konva. State management MUST use TanStack Query for server state, Zustand for client state. AI integration MUST use Qwen API with credentials from environment variables.

### Performance Standards

Tactical map grid scale MUST be 40px = 5 feet (D&D 5E standard). Map rendering MUST maintain 60fps during token movements. React Query cache SHALL use 60s stale time for optimal balance between freshness and performance. WebSocket connections MUST support real-time updates for all game state changes.

## Security & Privacy

API keys and AI credentials MUST remain in `.env` files only. The fetch MCP MUST be used instead of native fetch for all API calls. Virtual environments MUST be used for all Python development and data processing scripts.

## Governance

This constitution SUPREME to all other project practices. Amendments MUST follow semantic versioning: MAJOR for backward-incompatible changes, MINOR for new principles or sections, PATCH for clarifications and wording. All pull requests MUST verify compliance with these principles. The CLAUDE.md file provides runtime development guidance and MUST align with constitutional requirements.

**Version**: 1.0.0 | **Ratified**: 2025-10-28 | **Last Amended**: 2025-10-28