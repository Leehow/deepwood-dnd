#!/usr/bin/env node
/**
 * Analyze React/TypeScript components for line count violations.
 * Part of the project optimization initiative.
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_LINES = 400;
const EXCLUDED_DIRS = new Set([
  'node_modules', '.next', 'dist', 'build', '.git',
  'coverage', 'public', '.cache', '.turbo'
]);
const EXCLUDED_FILES = new Set([
  'index.ts', 'index.tsx', 'index.js', 'index.jsx'
]);
const EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

class ComponentAnalyzer {
  constructor(maxLines = DEFAULT_MAX_LINES) {
    this.maxLines = maxLines;
    this.violations = [];
    this.compliant = [];
    this.stats = {
      '.tsx': 0,
      '.ts': 0,
      '.jsx': 0,
      '.js': 0
    };
  }

  /**
   * Count non-blank lines in a file
   */
  countLines(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n');
      return lines.filter(line => line.trim()).length;
    } catch (err) {
      console.error(`Error reading ${filePath}:`, err.message);
      return 0;
    }
  }

  /**
   * Check if file should be analyzed
   */
  shouldAnalyze(filePath) {
    const basename = path.basename(filePath);
    const ext = path.extname(filePath);

    // Check extension
    if (!EXTENSIONS.has(ext)) {
      return false;
    }

    // Skip excluded files
    if (EXCLUDED_FILES.has(basename)) {
      return false;
    }

    // Skip test files
    if (basename.includes('.test.') || basename.includes('.spec.')) {
      return false;
    }

    // Skip story files (Storybook)
    if (basename.includes('.stories.')) {
      return false;
    }

    return true;
  }

  /**
   * Recursively analyze directory
   */
  analyzeDirectory(dir, baseDir = dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) {
          this.analyzeDirectory(fullPath, baseDir);
        }
      } else if (entry.isFile()) {
        if (this.shouldAnalyze(fullPath)) {
          const lineCount = this.countLines(fullPath);
          const relativePath = path.relative(baseDir, fullPath);
          const ext = path.extname(fullPath);

          this.stats[ext] = (this.stats[ext] || 0) + 1;

          if (lineCount > this.maxLines) {
            this.violations.push({ path: relativePath, lines: lineCount });
          } else {
            this.compliant.push({ path: relativePath, lines: lineCount });
          }
        }
      }
    }
  }

  /**
   * Analyze component complexity
   */
  analyzeComplexity(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');

      // Count various metrics
      const metrics = {
        hooks: (content.match(/use[A-Z]\w*\(/g) || []).length,
        useState: (content.match(/useState\(/g) || []).length,
        useEffect: (content.match(/useEffect\(/g) || []).length,
        functions: (content.match(/const\s+\w+\s*=\s*(?:\([^)]*\)|async)/g) || []).length,
        components: (content.match(/(?:function|const)\s+[A-Z]\w*\s*[:=]/g) || []).length,
        imports: (content.match(/^import\s/gm) || []).length
      };

      return metrics;
    } catch (err) {
      return null;
    }
  }

  /**
   * Print analysis results
   */
  printResults() {
    console.log('\n' + '='.repeat(70));
    console.log(`Component Analysis Report - Max Lines: ${this.maxLines}`);
    console.log('='.repeat(70) + '\n');

    // Statistics
    const total = this.violations.length + this.compliant.length;
    console.log('📊 Statistics:');
    console.log(`  Total components analyzed: ${total}`);
    console.log(`  Components exceeding limit: ${this.violations.length}`);
    console.log(`  Compliant components: ${this.compliant.length}`);
    console.log(`  Compliance rate: ${(this.compliant.length / total * 100).toFixed(1)}%\n`);

    // By file type
    console.log('📈 By file type:');
    Object.entries(this.stats).forEach(([ext, count]) => {
      if (count > 0) {
        console.log(`  ${ext}: ${count} files`);
      }
    });
    console.log();

    // Violations
    if (this.violations.length > 0) {
      // Sort by line count
      this.violations.sort((a, b) => b.lines - a.lines);

      console.log(`❌ Components exceeding ${this.maxLines} lines:`);
      console.log('-'.repeat(70));
      console.log(`${'File'.padEnd(50)} ${'Lines'.padStart(10)} ${'Excess'.padStart(10)}`);
      console.log('-'.repeat(70));

      this.violations.forEach(({ path: filePath, lines }) => {
        const excess = lines - this.maxLines;
        console.log(`${filePath.padEnd(50)} ${lines.toString().padStart(10)} ${excess.toString().padStart(10)}`);
      });
      console.log();

      // Top offenders with complexity analysis
      console.log('🎯 Refactoring priorities (with complexity analysis):');
      const topViolations = this.violations.slice(0, 5);
      topViolations.forEach(({ path: filePath, lines }, index) => {
        console.log(`\n  ${index + 1}. ${filePath}: ${lines} lines`);

        const fullPath = path.join(process.cwd(), filePath);
        const complexity = this.analyzeComplexity(fullPath);

        if (complexity) {
          console.log('     Complexity metrics:');
          console.log(`       - React hooks: ${complexity.hooks}`);
          console.log(`       - State hooks: ${complexity.useState}`);
          console.log(`       - Effect hooks: ${complexity.useEffect}`);
          console.log(`       - Functions: ${complexity.functions}`);
          console.log(`       - Sub-components: ${complexity.components}`);
          console.log(`       - Imports: ${complexity.imports}`);

          // Suggest refactoring strategy
          console.log('     Suggested refactoring:');
          if (complexity.components > 1) {
            console.log('       → Extract sub-components to separate files');
          }
          if (complexity.hooks > 5) {
            console.log('       → Extract custom hooks');
          }
          if (complexity.functions > 10) {
            console.log('       → Extract utility functions');
          }
          if (lines > 800) {
            console.log('       → Consider splitting into multiple components');
          }
        }
      });
    } else {
      console.log('✅ All components are within the line limit!');
    }

    // Summary
    if (this.violations.length > 0) {
      const totalExcess = this.violations.reduce((sum, v) => sum + (v.lines - this.maxLines), 0);
      console.log('\n📋 Refactoring Summary:');
      console.log(`  Total lines to refactor: ${totalExcess}`);
      console.log(`  Estimated new files needed: ~${Math.ceil(totalExcess / 300)}`);
      console.log('  Approach: Extract hooks, utilities, and sub-components');
    }
  }

  /**
   * Generate refactoring script for a component
   */
  generateRefactorScript(componentPath) {
    const suggestions = [];
    const fullPath = path.join(process.cwd(), componentPath);
    const complexity = this.analyzeComplexity(fullPath);

    if (!complexity) {
      return null;
    }

    // Suggest file structure
    const baseName = path.basename(componentPath, path.extname(componentPath));
    const dirName = path.dirname(componentPath);

    suggestions.push(`# Refactoring script for ${componentPath}`);
    suggestions.push(`\n# Create component directory`);
    suggestions.push(`mkdir -p ${path.join(dirName, baseName)}`);

    if (complexity.hooks > 3) {
      suggestions.push(`\n# Extract custom hooks`);
      suggestions.push(`touch ${path.join(dirName, baseName, 'hooks.ts')}`);
    }

    if (complexity.functions > 5) {
      suggestions.push(`\n# Extract utilities`);
      suggestions.push(`touch ${path.join(dirName, baseName, 'utils.ts')}`);
    }

    if (complexity.components > 1) {
      suggestions.push(`\n# Extract sub-components`);
      suggestions.push(`touch ${path.join(dirName, baseName, 'components.tsx')}`);
    }

    suggestions.push(`\n# Move main component`);
    suggestions.push(`mv ${componentPath} ${path.join(dirName, baseName, 'index.tsx')}`);

    return suggestions.join('\n');
  }
}

// CLI
function main() {
  const args = process.argv.slice(2);
  let maxLines = DEFAULT_MAX_LINES;
  let directory = process.cwd();
  let generateScripts = false;

  // Parse arguments
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--max-lines' && args[i + 1]) {
      maxLines = parseInt(args[i + 1]);
      i++;
    } else if (args[i] === '--directory' && args[i + 1]) {
      directory = path.resolve(args[i + 1]);
      i++;
    } else if (args[i] === '--generate-scripts') {
      generateScripts = true;
    } else if (args[i] === '--help') {
      console.log('Usage: node analyze_components.js [options]');
      console.log('Options:');
      console.log('  --max-lines <number>   Maximum lines per component (default: 400)');
      console.log('  --directory <path>     Directory to analyze (default: current)');
      console.log('  --generate-scripts     Generate refactoring scripts');
      console.log('  --help                 Show this help');
      process.exit(0);
    }
  }

  const analyzer = new ComponentAnalyzer(maxLines);

  console.log(`Analyzing components in: ${directory}`);
  console.log(`Max lines threshold: ${maxLines}\n`);

  try {
    analyzer.analyzeDirectory(directory);
    analyzer.printResults();

    // Generate refactoring scripts if requested
    if (generateScripts && analyzer.violations.length > 0) {
      console.log('\n📝 Generating refactoring scripts...\n');

      const scriptsDir = path.join(directory, 'scripts', 'refactor');
      if (!fs.existsSync(scriptsDir)) {
        fs.mkdirSync(scriptsDir, { recursive: true });
      }

      analyzer.violations.slice(0, 5).forEach(({ path: filePath }) => {
        const script = analyzer.generateRefactorScript(filePath);
        if (script) {
          const scriptName = path.basename(filePath, path.extname(filePath)) + '_refactor.sh';
          const scriptPath = path.join(scriptsDir, scriptName);
          fs.writeFileSync(scriptPath, script);
          console.log(`  Created: ${scriptPath}`);
        }
      });
    }

    // Exit with error if violations found
    process.exit(analyzer.violations.length > 0 ? 1 : 0);
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = ComponentAnalyzer;