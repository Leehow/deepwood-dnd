# Quickstart Guide: Project Optimization

## Overview

This guide helps you implement the project optimization features incrementally, starting with the highest priority items.

## Prerequisites

- Python 3.11+ with virtual environment activated
- Node.js 20+ and npm
- PostgreSQL 15+ running
- Development environment set up per CLAUDE.md

## Phase 1: Code Refactoring (Week 1-2)

### Step 1: Analyze Current Codebase

```bash
# Run code analysis to identify files needing refactoring
python scripts/analyze_code.py --max-lines 400

# Expected output: List of files exceeding line limit
# backend/app/api/routes/modules.py: ... lines
# backend/app/api/routes/characters.py: ... lines
# ...
```

### Step 2: Refactor WebSocket Handlers

```bash
# WebSocket has been migrated to the registry-based handler system:
# - Endpoint: backend/app/api/routes/websocket_simplified.py
# - Handlers: backend/app/services/websocket_handlers/

# Verify tests still pass
pytest backend/tests/test_websocket.py
```

### Step 3: Split Large Components

```bash
# Analyze frontend components
npm run analyze:components

# Refactor large components
npm run refactor:component -- ChatPanel.tsx

# Run component tests
npm test
```

## Phase 2: Performance Optimization (Week 2-3)

### Step 1: Implement Viewport Culling

```typescript
// frontend/app/components/map/TacticalMap.client.tsx
import { ViewportCuller } from './ViewportCuller';

// Add culling to render loop
const visibleTokens = ViewportCuller.cull(allTokens, viewport);
```

### Step 2: Enable WebSocket Batching

```python
# backend/app/services/websocket_manager.py
MESSAGE_BATCH_WINDOW_MS = 50

async def batch_messages(messages: List[dict]):
    """Batch messages within time window"""
    # Implementation provided in refactored code
```

### Step 3: Optimize Database Queries

```python
# backend/app/api/routes/characters.py
from sqlalchemy.orm import selectinload

# Before (N+1 problem):
character = await db.get(Character, character_id)
for item in character.equipment:  # Each item is a query
    ...

# After (eager loading):
character = await db.get(
    Character,
    character_id,
    options=[selectinload(Character.equipment)]
)
```

## Phase 3: Test Coverage (Week 3-4)

### Step 1: Set Up Test Infrastructure

```bash
# Install test dependencies
pip install pytest-cov pytest-asyncio pytest-mock

# Configure coverage targets
echo "min_coverage = 80" >> pytest.ini
```

### Step 2: Write Unit Tests

```python
# backend/tests/unit/test_token_handler.py
async def test_token_move_handler():
    handler = TokenMoveHandler()
    result = await handler.handle(mock_ws, token_data)
    assert result.success
```

### Step 3: Add Integration Tests

```bash
# Run test coverage report
pytest --cov=backend/app --cov-report=html

# View coverage report
open htmlcov/index.html
```

## Phase 4: Error Handling (Week 4)

### Step 1: Implement Structured Errors

```typescript
// frontend/app/utils/errors.ts
export class GameError extends Error {
  constructor(
    message: string,
    public recoveryAction: 'retry' | 'refresh' | 'contact-support',
    public userMessage: string
  ) {
    super(message);
  }
}
```

### Step 2: Add Retry Logic

```python
# backend/app/utils/retry.py
async def with_exponential_backoff(
    func: Callable,
    max_retries: int = 3,
    base_delay_ms: int = 100
):
    # Implementation in refactored code
```

## Monitoring Progress

### Performance Metrics

```bash
# Check current performance
curl http://localhost:8174/api/optimization/metrics?component=map

# Expected targets:
# - FPS: >= 60
# - WebSocket latency: < 50ms
# - Database queries: -60% from baseline
```

### Code Quality Metrics

```bash
# Verify file sizes
find backend frontend -name "*.py" -o -name "*.ts" -o -name "*.tsx" | \
  xargs wc -l | awk '$1 > 400'

# Should return empty (no files over 400 lines)
```

### Test Coverage

```bash
# Backend coverage
pytest --cov=backend/app --cov-report=term-missing

# Frontend coverage
npm run test:coverage

# Targets:
# - Backend: 80%
# - Frontend: 70%
```

## Rollback Procedures

If any optimization causes issues:

```bash
# Feature flags in .env
ENABLE_WEBSOCKET_BATCHING=false
ENABLE_VIEWPORT_CULLING=false
ENABLE_QUERY_OPTIMIZATION=false

# Git rollback
git checkout HEAD~1 -- path/to/file

# Database rollback (if schema changed)
alembic downgrade -1
```

## Common Issues

### Issue: Tests fail after refactoring

**Solution**: Run tests incrementally during refactoring, not after

```bash
# Use watch mode
pytest-watch backend/tests
```

### Issue: Performance degradation

**Solution**: Profile before and after

```bash
python -m cProfile -o profile.stats app/main.py
# Analyze with snakeviz
snakeviz profile.stats
```

### Issue: Circular dependencies after splitting

**Solution**: Use dependency injection pattern

```python
# Avoid circular imports
from __future__ import annotations
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .other_module import OtherClass
```

## Next Steps

After completing the optimization:

1. Run full regression test suite
2. Deploy to staging for performance testing
3. Monitor metrics for 24-48 hours
4. Gradually enable optimizations in production
5. Document lessons learned

## Support

For issues or questions:

- Check existing tests in `backend/tests/` and `frontend/tests/`
- Review architecture decisions in `specs/003-project-optimization/research.md`
- Consult CLAUDE.md for project standards
