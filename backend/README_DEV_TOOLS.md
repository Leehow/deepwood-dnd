# Development Tools Guide

This document explains how to use the code quality and testing tools configured for this project.

## Setup

Install all development dependencies:

```bash
cd backend
source venv/bin/activate
pip install -r requirements-dev.txt
```

## Testing with pytest

### Running Tests

```bash
# Run all tests
pytest

# Run specific test file
pytest tests/test_parsers.py

# Run with verbose output
pytest -v

# Run with coverage report
pytest --cov=app --cov-report=html

# Run only unit tests
pytest -m unit

# Run only integration tests
pytest -m integration

# Run by test name pattern
pytest -k "test_websocket"
```

### Test Coverage

View coverage report:
```bash
# Generate HTML coverage report
pytest --cov=app --cov-report=html

# Open in browser
open htmlcov/index.html  # macOS
xdg-open htmlcov/index.html  # Linux
```

## Code Formatting with Black

Black formats Python code automatically.

```bash
# Format all Python files
black app/

# Check what would be formatted (dry-run)
black --check app/

# Format specific file
black app/main.py
```

**Configuration:** See `pyproject.toml` - Black is configured for 100 character line length.

## Linting with Ruff

Ruff is an extremely fast Python linter.

```bash
# Lint all files
ruff check app/

# Lint with auto-fix
ruff check --fix app/

# Lint specific file
ruff check app/main.py

# Show all violations (including fixed ones)
ruff check --statistics app/
```

**Configuration:** See `pyproject.toml` for enabled rules and exclusions.

## Type Checking with mypy

Check type hints and catch type errors:

```bash
# Type check all files
mypy app/

# Type check specific file
mypy app/main.py

# Show error codes
mypy --show-error-codes app/
```

**Configuration:** See `pyproject.toml`. Type checking is configured to be lenient with some missing imports.

## Pre-commit Workflow

### Recommended workflow before committing:

```bash
# 1. Format code
black app/

# 2. Fix linting issues
ruff check --fix app/

# 3. Type check
mypy app/

# 4. Run tests
pytest

# 5. Check coverage
pytest --cov=app --cov-report=term-missing
```

### Quick Check Script

Create a script `scripts/check.sh`:

```bash
#!/bin/bash
set -e

echo "🔍 Running code quality checks..."

echo "\n📝 Formatting with Black..."
black app/

echo "\n🔧 Linting with Ruff..."
ruff check --fix app/

echo "\n✨ Type checking with mypy..."
mypy app/

echo "\n🧪 Running tests..."
pytest --cov=app --cov-report=term-missing

echo "\n✅ All checks passed!"
```

Then run:
```bash
chmod +x scripts/check.sh
./scripts/check.sh
```

## IDE Integration

### VS Code

Install extensions:
- Python (Microsoft)
- Black Formatter
- Ruff
- Pylance (for mypy)

Add to `.vscode/settings.json`:
```json
{
  "[python]": {
    "editor.formatOnSave": true,
    "editor.defaultFormatter": "ms-python.black-formatter",
    "editor.codeActionsOnSave": {
      "source.organizeImports": true,
      "source.fixAll": true
    }
  },
  "python.linting.enabled": true,
  "python.linting.ruffEnabled": true,
  "python.testing.pytestEnabled": true,
  "python.testing.unittestEnabled": false
}
```

### PyCharm

1. **Black**: Settings → Tools → Black → Enable "On code reformat"
2. **Ruff**: Install Ruff plugin from marketplace
3. **pytest**: Automatically detected
4. **mypy**: Settings → Tools → Python Integrated Tools → Type checker: mypy

## CI/CD Integration

Example GitHub Actions workflow (`.github/workflows/ci.yml`):

```yaml
name: CI

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-python@v4
        with:
          python-version: '3.11'

      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install -r requirements-dev.txt

      - name: Run Black
        run: black --check app/

      - name: Run Ruff
        run: ruff check app/

      - name: Run mypy
        run: mypy app/

      - name: Run tests with coverage
        run: pytest --cov=app --cov-report=xml

      - name: Upload coverage
        uses: codecov/codecov-action@v3
```

## Troubleshooting

### Black and Ruff conflict

If Black and Ruff disagree on formatting, Black takes precedence. Ruff is configured to ignore `E501` (line too long) since Black handles this.

### mypy import errors

Add type stubs for packages:
```bash
pip install types-redis types-...
```

Or ignore in `pyproject.toml`:
```toml
[[tool.mypy.overrides]]
module = "problematic_module.*"
ignore_missing_imports = true
```

### pytest can't find modules

Ensure you're in the virtual environment and the package is installed in development mode:
```bash
source venv/bin/activate
pip install -e .
```

## References

- [Black Documentation](https://black.readthedocs.io/)
- [Ruff Documentation](https://docs.astral.sh/ruff/)
- [mypy Documentation](https://mypy.readthedocs.io/)
- [pytest Documentation](https://docs.pytest.org/)
