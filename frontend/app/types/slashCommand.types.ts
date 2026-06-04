import type { WebSocketMessage } from "~/hooks/useWebSocket";

export interface CharacterStats {
  name: string;
  level: number;
  abilityScores: Record<string, number>;
  selectedSkills: string[];
  expertiseSkills: string[];
}

/** Request to trigger 3D dice roll from a slash command */
export interface DiceRollRequest {
  /** Dice notation, e.g. "2d6", "1d20" */
  notation: string;
  /** Optional check info for display */
  checkInfo?: { modifier?: number; dc?: number; label?: string } | null;
  /** Called with physical dice results to build the final chat message */
  buildMessage: (rolls: number[], total: number) => string;
}

export interface SlashCommandContext {
  sendMessage: (msg: WebSocketMessage) => void;
  showToast: (msg: string) => void;
  characterStats?: CharacterStats;
  /** Request a 3D dice roll instead of sending message directly */
  requestDiceRoll?: (req: DiceRollRequest) => void;
}

export interface SlashCommand {
  /** 命令名（不含 /） */
  name: string;
  /** 菜单显示名 */
  label: string;
  /** 描述文字 */
  description: string;
  /** 菜单图标 emoji */
  icon: string;
  /** 参数占位提示 */
  argPlaceholder: string;
  /** 执行命令，返回 true 表示成功 */
  execute: (args: string, ctx: SlashCommandContext) => boolean;
}
