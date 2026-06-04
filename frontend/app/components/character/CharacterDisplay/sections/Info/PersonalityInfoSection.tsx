import * as Collapsible from "@radix-ui/react-collapsible";
import type { Character } from "../../types/Character";

interface PersonalityInfoSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  personality: Character["personality"]; // Record<string, any> | undefined
}

export function PersonalityInfoSection({ open, onOpenChange, personality }: PersonalityInfoSectionProps) {
  if (!personality) return null;
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <Collapsible.Trigger className="w-full flex items-center justify-between p-2 bg-gray-800/30 rounded hover:bg-gray-800/50 transition-colors">
        <span className="text-sm font-semibold text-gray-300">性格特质</span>
        <span className="text-gray-400">{open ? "▼" : "▶"}</span>
      </Collapsible.Trigger>

      <Collapsible.Content className="mt-2 p-3 bg-gray-800/20 rounded text-sm text-gray-400 space-y-2">
        {personality.traits && personality.traits.length > 0 && (
          <div>
            <span className="text-gray-300 font-medium">性格：</span>
            <ul className="list-disc list-inside mt-1">
              {personality.traits.map((trait: string, i: number) => (
                <li key={i}>{trait}</li>
              ))}
            </ul>
          </div>
        )}
        {personality.ideals && (
          <p><span className="text-gray-300 font-medium">理想：</span> {personality.ideals}</p>
        )}
        {personality.bonds && (
          <p><span className="text-gray-300 font-medium">羁绊：</span> {personality.bonds}</p>
        )}
        {personality.flaws && (
          <p><span className="text-gray-300 font-medium">缺陷：</span> {personality.flaws}</p>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

