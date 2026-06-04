#!/usr/bin/env python3
"""
Analyze code files to identify those exceeding the line limit.
Part of the project optimization initiative.
"""

import os
import sys
import argparse
from pathlib import Path
from typing import List, Tuple, Dict
from collections import defaultdict

DEFAULT_MAX_LINES = 400
EXCLUDED_DIRS = {
    "__pycache__", "node_modules", ".git", "venv", "env",
    ".pytest_cache", "htmlcov", "dist", "build", ".next"
}
EXCLUDED_FILES = {
    "__init__.py", "setup.py"
}

def count_lines(file_path: Path) -> int:
    """Count non-blank lines in a file."""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return sum(1 for line in f if line.strip())
    except (UnicodeDecodeError, PermissionError):
        return 0

def should_analyze_file(file_path: Path) -> bool:
    """Determine if a file should be analyzed."""
    # Check if it's a Python or TypeScript/JavaScript file
    extensions = {'.py', '.ts', '.tsx', '.js', '.jsx'}
    if file_path.suffix not in extensions:
        return False

    # Skip excluded files
    if file_path.name in EXCLUDED_FILES:
        return False

    # Skip test files if requested
    if 'test' in file_path.name.lower():
        return False

    return True

def analyze_directory(
    directory: Path,
    max_lines: int = DEFAULT_MAX_LINES
) -> Dict[str, List[Tuple[Path, int]]]:
    """
    Analyze all code files in a directory.
    Returns dict with 'violations' and 'compliant' lists.
    """
    results = {
        'violations': [],
        'compliant': [],
        'stats': defaultdict(int)
    }

    for root, dirs, files in os.walk(directory):
        # Remove excluded directories from traversal
        dirs[:] = [d for d in dirs if d not in EXCLUDED_DIRS]

        root_path = Path(root)
        for file_name in files:
            file_path = root_path / file_name

            if not should_analyze_file(file_path):
                continue

            line_count = count_lines(file_path)
            relative_path = file_path.relative_to(directory)

            # Track statistics by file type
            results['stats'][file_path.suffix] += 1

            if line_count > max_lines:
                results['violations'].append((relative_path, line_count))
            else:
                results['compliant'].append((relative_path, line_count))

    # Sort violations by line count (worst first)
    results['violations'].sort(key=lambda x: x[1], reverse=True)

    return results

def print_results(results: Dict, max_lines: int, directory: Path):
    """Print analysis results in a readable format."""
    violations = results['violations']
    compliant = results['compliant']
    stats = results['stats']

    print(f"\n{'='*60}")
    print(f"Code Analysis Report - Max Lines: {max_lines}")
    print(f"Directory: {directory}")
    print(f"{'='*60}\n")

    # Statistics
    total_files = len(violations) + len(compliant)
    print(f"📊 Statistics:")
    print(f"  Total files analyzed: {total_files}")
    print(f"  Files exceeding limit: {len(violations)}")
    print(f"  Compliant files: {len(compliant)}")
    print(f"  Compliance rate: {len(compliant)/total_files*100:.1f}%\n")

    print(f"📈 By file type:")
    for ext, count in sorted(stats.items()):
        print(f"  {ext}: {count} files")
    print()

    # Violations
    if violations:
        print(f"❌ Files exceeding {max_lines} lines ({len(violations)} files):")
        print(f"{'File':<50} {'Lines':>10} {'Excess':>10}")
        print("-" * 70)
        for file_path, line_count in violations:
            excess = line_count - max_lines
            print(f"{str(file_path):<50} {line_count:>10} {excess:>10}")
        print()

        # Refactoring priorities
        print("🎯 Refactoring priorities (worst offenders):")
        for i, (file_path, line_count) in enumerate(violations[:5], 1):
            print(f"  {i}. {file_path}: {line_count} lines (split into ~{line_count//350} files)")
    else:
        print("✅ All files are within the line limit!")

    # Summary recommendations
    if violations:
        total_excess = sum(count - max_lines for _, count in violations)
        print(f"\n📋 Refactoring Summary:")
        print(f"  Total lines to refactor: {total_excess}")
        print(f"  Estimated new files needed: ~{sum((c-1)//350 + 1 for _, c in violations)}")
        print(f"  Suggested approach: Start with largest files first")

def main():
    parser = argparse.ArgumentParser(
        description="Analyze code files for line count violations"
    )
    parser.add_argument(
        "--max-lines",
        type=int,
        default=DEFAULT_MAX_LINES,
        help=f"Maximum allowed lines per file (default: {DEFAULT_MAX_LINES})"
    )
    parser.add_argument(
        "--directory",
        type=str,
        default=".",
        help="Directory to analyze (default: current directory)"
    )
    parser.add_argument(
        "--output",
        type=str,
        help="Output file for results (optional)"
    )

    args = parser.parse_args()

    directory = Path(args.directory).resolve()
    if not directory.exists():
        print(f"Error: Directory {directory} does not exist")
        sys.exit(1)

    # Run analysis
    results = analyze_directory(directory, args.max_lines)

    # Print results
    print_results(results, args.max_lines, directory)

    # Save to file if requested
    if args.output:
        with open(args.output, 'w') as f:
            f.write(f"Code Analysis Report\n")
            f.write(f"Max Lines: {args.max_lines}\n")
            f.write(f"Directory: {directory}\n\n")
            f.write("Violations:\n")
            for file_path, line_count in results['violations']:
                f.write(f"  {file_path}: {line_count} lines\n")

    # Exit with error code if violations found
    sys.exit(1 if results['violations'] else 0)

if __name__ == "__main__":
    main()