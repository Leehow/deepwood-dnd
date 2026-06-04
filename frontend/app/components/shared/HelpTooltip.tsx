import * as Dialog from "@radix-ui/react-dialog";
import { QuestionMarkCircledIcon } from "@radix-ui/react-icons";

interface HelpTooltipProps {
  title: string;
  content: string | React.ReactNode;
  size?: "1" | "2" | "3";
}

/**
 * 帮助提示组件 - 显示一个问号图标，点击后弹出模态框显示详细说明
 */
export function HelpTooltip({ title, content, size = "1" }: HelpTooltipProps) {
  return (
    <Dialog.Root>
      <Dialog.Trigger asChild>
        <span
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); (e.currentTarget as HTMLElement).click(); } e.stopPropagation(); }}
          role="button"
          tabIndex={0}
          className="inline-flex items-center justify-center rounded p-[2px] text-gray-400 hover:text-amber-400 focus:outline-none focus:ring-1 focus:ring-amber-400"
          aria-label={`查看${title}的说明`}
        >
          <QuestionMarkCircledIcon />
        </span>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 z-[99998]" />
        <Dialog.Content
          className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[90vw] max-w-[500px] max-h-[85dvh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-lg p-6 z-[99999] shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <Dialog.Title className="text-lg font-bold text-amber-400">{title}</Dialog.Title>
          <div className="mt-4 text-sm text-gray-300">
            {typeof content === "string" ? (
              <div className="whitespace-pre-line">{content}</div>
            ) : (
              content
            )}
          </div>

          <div className="mt-6 flex justify-end">
            <Dialog.Close asChild>
              <button
                onClick={(e) => e.stopPropagation()}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded transition-colors"
              >
                知道了
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
