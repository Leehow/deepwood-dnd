import * as Collapsible from "@radix-ui/react-collapsible";

interface BackstorySectionProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  backstory?: string;
}

export function BackstorySection({ open, onOpenChange, backstory }: BackstorySectionProps) {
  if (!backstory) return null;
  return (
    <Collapsible.Root open={open} onOpenChange={onOpenChange}>
      <Collapsible.Trigger className="w-full flex items-center justify-between p-2 bg-gray-800/30 rounded hover:bg-gray-800/50 transition-colors">
        <span className="text-sm font-semibold text-gray-300">背景故事</span>
        <span className="text-gray-400">{open ? "▼" : "▶"}</span>
      </Collapsible.Trigger>
      <Collapsible.Content className="mt-2 p-3 bg-gray-800/20 rounded text-sm text-gray-400">
        <p className="whitespace-pre-wrap">{backstory}</p>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}

