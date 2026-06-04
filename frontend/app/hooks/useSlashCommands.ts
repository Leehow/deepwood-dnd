import { useState, useCallback, useMemo } from "react";
import type { SlashCommand, SlashCommandContext, CharacterStats } from "~/types/slashCommand.types";
import { ABILITIES, SKILLS_BY_ABILITY } from "~/components/ui/CheckTypeSelectModal";

// --- 骰子解析 ---

interface DiceTerm {
  count: number;
  sides: number;
}

interface ParsedDice {
  terms: DiceTerm[];
  modifier: number;
  raw: string;
}

/** 解析骰子表达式，如 "2d6+1d4+3" 或 "1d20-2" */
export function parseDiceExpr(expr: string): ParsedDice | null {
  const raw = expr.replace(/\s/g, "");
  // 拆分为 +/- 分隔的 token
  const tokens = raw.match(/[+-]?[^+-]+/g);
  if (!tokens) return null;

  const terms: DiceTerm[] = [];
  let modifier = 0;

  for (const tok of tokens) {
    const diceMatch = tok.match(/^([+-]?\d*)[dD](\d+)$/);
    if (diceMatch) {
      const count = diceMatch[1] && diceMatch[1] !== '+' && diceMatch[1] !== '-'
        ? parseInt(diceMatch[1], 10)
        : (diceMatch[1] === '-' ? -1 : 1);
      const sides = parseInt(diceMatch[2], 10);
      if (sides < 1 || count === 0) return null;
      terms.push({ count, sides });
    } else if (/^[+-]?\d+$/.test(tok)) {
      modifier += parseInt(tok, 10);
    } else {
      return null; // 无法解析
    }
  }

  if (terms.length === 0) return null;
  return { terms, modifier, raw };
}

/**
 * Convert ParsedDice to @3d-dice/dice-box notation string.
 * E.g. "2d6+1d4+3" → "2d6+1d4" (modifier handled separately)
 */
export function toBoxNotation(parsed: ParsedDice): string {
  return parsed.terms
    .map(t => `${Math.abs(t.count)}d${t.sides}`)
    .join('+');
}

/** Format dice result text from physical rolls */
function formatPhysicalResult(parsed: ParsedDice, rolls: number[]): { text: string; total: number } {
  let rollIdx = 0;
  let total = 0;
  const parts: string[] = [];

  for (const term of parsed.terms) {
    const abs = Math.abs(term.count);
    const sign = term.count < 0 ? -1 : 1;
    const termRolls = rolls.slice(rollIdx, rollIdx + abs);
    rollIdx += abs;

    const termSum = termRolls.reduce((a, b) => a + b, 0);
    total += sign * termSum;

    const prefix = sign < 0 ? "-" : parts.length > 0 ? "+" : "";
    parts.push(`${prefix}[${termRolls.join(",")}]`);
  }

  total += parsed.modifier;
  if (parsed.modifier !== 0) {
    parts.push(parsed.modifier > 0 ? `+${parsed.modifier}` : `${parsed.modifier}`);
  }

  return { text: `${parsed.raw} → ${parts.join("")} = ${total}`, total };
}

function rollDiceFallback(count: number, sides: number): number[] {
  const abs = Math.abs(count);
  const results: number[] = [];
  for (let i = 0; i < abs; i++) {
    results.push(Math.floor(Math.random() * sides) + 1);
  }
  return results;
}

function formatDiceResultFallback(parsed: ParsedDice): { text: string; total: number } {
  const allRolls: { results: number[]; sign: number }[] = [];
  let total = 0;

  for (const term of parsed.terms) {
    const sign = term.count < 0 ? -1 : 1;
    const results = rollDiceFallback(term.count, term.sides);
    allRolls.push({ results, sign });
    total += sign * results.reduce((a, b) => a + b, 0);
  }
  total += parsed.modifier;

  const parts: string[] = [];
  for (const r of allRolls) {
    const prefix = r.sign < 0 ? "-" : parts.length > 0 ? "+" : "";
    parts.push(`${prefix}[${r.results.join(",")}]`);
  }
  if (parsed.modifier !== 0) {
    parts.push(parsed.modifier > 0 ? `+${parsed.modifier}` : `${parsed.modifier}`);
  }

  return { text: `${parsed.raw} → ${parts.join("")} = ${total}`, total };
}

// --- 属性/技能名映射 ---

type NameMapping = { id: string; type: "ability" | "skill"; abilityId: string };

function buildNameToIdMap(): Map<string, NameMapping> {
  const map = new Map<string, NameMapping>();
  for (const ab of ABILITIES) {
    map.set(ab.name, { id: ab.id, type: "ability", abilityId: ab.id });
  }
  for (const [abilityId, skills] of Object.entries(SKILLS_BY_ABILITY)) {
    for (const sk of skills) {
      map.set(sk.name, { id: sk.id, type: "skill", abilityId });
    }
  }
  return map;
}

const NAME_MAP = buildNameToIdMap();

// --- D&D 5E 计算 ---

function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2);
}

function proficiencyBonus(level: number): number {
  return Math.ceil(level / 4) + 1;
}

function resolveCheck(
  input: string,
  stats: CharacterStats,
): { label: string; modifier: number } | null {
  const mapping = NAME_MAP.get(input);
  if (!mapping) return null;

  const score = stats.abilityScores[mapping.abilityId];
  if (score === undefined) return null;

  const abMod = abilityModifier(score);

  if (mapping.type === "ability") {
    return { label: `${input}检定`, modifier: abMod };
  }

  // 技能检定：加熟练/专精
  const profBonus = proficiencyBonus(stats.level);
  const isExpert = stats.expertiseSkills.includes(mapping.id);
  const isProf = stats.selectedSkills.includes(mapping.id);
  const mod = abMod + (isExpert ? profBonus * 2 : isProf ? profBonus : 0);
  return { label: `${input}检定`, modifier: mod };
}

// --- 命令注册表 ---
const COMMANDS: SlashCommand[] = [
  {
    name: "ai",
    label: "AI 助手",
    description: "向 AI 提问",
    icon: "🤖",
    argPlaceholder: "输入你的问题...",
    execute(args, ctx) {
      if (!args.trim()) {
        ctx.showToast("请输入问题内容");
        return false;
      }
      ctx.sendMessage({
        type: "chat",
        data: {
          message: args.trim(),
          recipients: ["ai"],
          timestamp: Date.now(),
        },
      });
      return true;
    },
  },
  {
    name: "roll",
    label: "掷骰子",
    description: "掷骰 /roll 2d6+3 | 属性检定 /roll 力量 | DC检定 /roll 察觉dc12",
    icon: "🎲",
    argPlaceholder: "2d6+3 / 力量 / 隐匿dc12",
    execute(args, ctx) {
      const raw = args.trim();
      if (!raw) {
        ctx.showToast("用法: /roll 2d6+3 或 /roll 力量 或 /roll 隐匿dc12");
        return false;
      }

      // 解析 DC 后缀: "力量dc15" or "力量 dc 15"
      const dcMatch = raw.match(/^(.+?)(?:\s*dc\s*(\d+))?\s*$/i);
      const mainPart = dcMatch?.[1]?.trim() || raw;
      const dc = dcMatch?.[2] ? parseInt(dcMatch[2], 10) : null;

      // 尝试 1: 纯骰子表达式
      const parsed = parseDiceExpr(mainPart);
      if (parsed) {
        // 有 3D 骰子时，请求 3D 投掷
        if (ctx.requestDiceRoll) {
          ctx.requestDiceRoll({
            notation: toBoxNotation(parsed),
            checkInfo: parsed.modifier !== 0
              ? { modifier: parsed.modifier, dc: dc ?? undefined, label: parsed.raw }
              : (dc !== null ? { dc, label: parsed.raw } : { label: parsed.raw }),
            buildMessage: (rolls, total) => {
              const finalTotal = total + parsed.modifier;
              const { text } = formatPhysicalResult(parsed, rolls);
              let msg = `🎲 ${text}`;
              if (dc !== null) {
                msg += finalTotal >= dc ? ` ✅ 成功(DC${dc})` : ` ❌ 失败(DC${dc})`;
              }
              return msg;
            },
          });
          return true;
        }
        // 无 3D 骰子时，用 JS 随机
        const { text, total } = formatDiceResultFallback(parsed);
        let msg = `🎲 ${text}`;
        if (dc !== null) {
          msg += total >= dc ? ` ✅ 成功(DC${dc})` : ` ❌ 失败(DC${dc})`;
        }
        ctx.sendMessage({
          type: "chat",
          data: { message: msg, timestamp: Date.now(), meta: { inline_roll: true } },
        });
        return true;
      }

      // 尝试 2: 属性/技能名
      if (!ctx.characterStats) {
        ctx.showToast("请先选择角色后再使用属性/技能检定");
        return false;
      }
      const check = resolveCheck(mainPart, ctx.characterStats);
      if (!check) {
        ctx.showToast(`无法识别: ${mainPart}。支持骰子表达式(2d6+3)或属性/技能名(力量/隐匿)`);
        return false;
      }

      // 属性/技能检定：投 d20 + modifier
      if (ctx.requestDiceRoll) {
        ctx.requestDiceRoll({
          notation: '1d20',
          checkInfo: { modifier: check.modifier, dc: dc ?? undefined, label: check.label },
          buildMessage: (rolls, total) => {
            const d20 = rolls[0] ?? total;
            const finalTotal = d20 + check.modifier;
            const modStr = check.modifier >= 0 ? `+${check.modifier}` : `${check.modifier}`;
            let msg = `🎲 ${check.label} → d20${modStr} → [${d20}]${modStr} = ${finalTotal}`;
            if (dc !== null) {
              msg += finalTotal >= dc ? ` ✅ 成功(DC${dc})` : ` ❌ 失败(DC${dc})`;
            }
            return msg;
          },
        });
        return true;
      }

      // 无 3D 骰子时，用 JS 随机
      const d20 = Math.floor(Math.random() * 20) + 1;
      const total = d20 + check.modifier;
      const modStr = check.modifier >= 0 ? `+${check.modifier}` : `${check.modifier}`;
      let msg = `🎲 ${check.label} → d20${modStr} → [${d20}]${modStr} = ${total}`;
      if (dc !== null) {
        msg += total >= dc ? ` ✅ 成功(DC${dc})` : ` ❌ 失败(DC${dc})`;
      }
      ctx.sendMessage({
        type: "chat",
        data: { message: msg, timestamp: Date.now(), meta: { inline_roll: true } },
      });
      return true;
    },
  },
];

// --- 状态阶段 ---
type Phase = "idle" | "selecting" | "args";

interface UseSlashCommandsOptions {
  input: string;
}

export function useSlashCommands({ input }: UseSlashCommandsOptions) {
  const [selectedIndex, setSelectedIndex] = useState(0);

  // 解析当前阶段
  const { phase, commandPrefix, matchedCommand, argsText } = useMemo(() => {
    if (!input.startsWith("/")) {
      return { phase: "idle" as Phase, commandPrefix: "", matchedCommand: null, argsText: "" };
    }

    const spaceIdx = input.indexOf(" ");
    if (spaceIdx === -1) {
      const prefix = input.slice(1).toLowerCase();
      return { phase: "selecting" as Phase, commandPrefix: prefix, matchedCommand: null, argsText: "" };
    }

    const cmdName = input.slice(1, spaceIdx).toLowerCase();
    const cmd = COMMANDS.find((c) => c.name === cmdName) || null;
    const args = input.slice(spaceIdx + 1);
    return {
      phase: cmd ? ("args" as Phase) : ("idle" as Phase),
      commandPrefix: cmdName,
      matchedCommand: cmd,
      argsText: args,
    };
  }, [input]);

  // 过滤命令列表
  const filteredCommands = useMemo(() => {
    if (phase !== "selecting") return [];
    if (commandPrefix === "") return COMMANDS;
    return COMMANDS.filter((c) => c.name.startsWith(commandPrefix));
  }, [phase, commandPrefix]);

  const isMenuOpen = phase === "selecting" && filteredCommands.length > 0;
  const isSlashInput = phase === "selecting" || phase === "args";

  const safeIndex = isMenuOpen ? Math.min(selectedIndex, filteredCommands.length - 1) : 0;

  const moveUp = useCallback(() => {
    setSelectedIndex((i) => (i > 0 ? i - 1 : filteredCommands.length - 1));
  }, [filteredCommands.length]);

  const moveDown = useCallback(() => {
    setSelectedIndex((i) => (i < filteredCommands.length - 1 ? i + 1 : 0));
  }, [filteredCommands.length]);

  const selectCommand = useCallback(
    (index?: number): string => {
      const idx = index ?? safeIndex;
      const cmd = filteredCommands[idx];
      if (!cmd) return input;
      return `/${cmd.name} `;
    },
    [filteredCommands, safeIndex, input],
  );

  const tryExecute = useCallback(
    (ctx: SlashCommandContext): boolean => {
      if (phase === "selecting") {
        return false;
      }
      if (phase === "args" && matchedCommand) {
        return matchedCommand.execute(argsText, ctx);
      }
      return false;
    },
    [phase, matchedCommand, argsText],
  );

  return {
    isMenuOpen,
    isSlashInput,
    filteredCommands,
    selectedIndex: safeIndex,
    phase,
    matchedCommand,
    moveUp,
    moveDown,
    selectCommand,
    tryExecute,
  };
}
