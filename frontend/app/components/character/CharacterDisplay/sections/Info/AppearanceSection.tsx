import * as Collapsible from "@radix-ui/react-collapsible";
import type { Character } from "../../types/Character";

interface AppearanceSectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  appearance: Character["appearance"]; // Record<string, any> | undefined
}

export function AppearanceSection({ open, onOpenChange, appearance }: AppearanceSectionProps) {
  if (!appearance) return null;
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <Collapsible.Trigger className="w-full flex items-center justify-between p-2 bg-gray-800/30 rounded hover:bg-gray-800/50 transition-colors">
        <span className="text-sm font-semibold text-gray-300">外貌特征</span>
        <span className="text-gray-400">{open ? "▼" : "▶"}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="mt-2 p-3 bg-gray-800/20 rounded text-sm text-gray-400 space-y-1">
        {appearance.height && <p>身高：{appearance.height}</p>}
        {appearance.weight && <p>体重：{appearance.weight}</p>}
        {appearance.eyes && <p>眼睛：{appearance.eyes}</p>}
        {appearance.skin && <p>皮肤：{appearance.skin}</p>}
        {appearance.hair && <p>头发：{appearance.hair}</p>}
        {appearance.distinguishingMarks && (
          <p>特殊标记：{appearance.distinguishingMarks}</p>
        )}
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

