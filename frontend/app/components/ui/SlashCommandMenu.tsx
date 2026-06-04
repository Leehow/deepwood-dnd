import type { SlashCommand } from "~/types/slashCommand.types";

interface SlashCommandMenuProps {
  commands: SlashCommand[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}

export function SlashCommandMenu({ commands, selectedIndex, onSelect }: SlashCommandMenuProps) {
  if (commands.length === 0) return null;

  return (
    <div className="absolute bottom-full left-0 right-0 mb-1 z-50">
      <div className="bg-gray-800 border border-amber-500/20 rounded-lg shadow-xl overflow-hidden">
        <div className="px-3 py-1.5 text-[10px] text-gray-500 uppercase tracking-wider border-b border-gray-700/50">
          斜杠命令
        </div>
        <div className="py-1 max-h-48 overflow-y-auto">
          {commands.map((cmd, i) => (
            <button
              key={cmd.name}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                i === selectedIndex
                  ? "bg-amber-500/15 text-amber-200"
                  : "text-gray-300 hover:bg-gray-700/50"
              }`}
              onMouseDown={(e) => {
                e.preventDefault(); // 阻止 blur 导致菜单关闭
                onSelect(i);
              }}
            >
              <span className="text-base flex-shrink-0 w-6 text-center">{cmd.icon}</span>
              <div className="min-w-0">
                <div className="text-sm font-medium">
                  /{cmd.name}
                  <span className="ml-2 text-xs text-gray-500">{cmd.label}</span>
                </div>
                <div className="text-xs text-gray-500 truncate">{cmd.description}</div>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
