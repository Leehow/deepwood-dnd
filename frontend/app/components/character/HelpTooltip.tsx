import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

interface HelpTooltipProps {
  title: string;
  content: string | React.ReactNode;
  calculation?: string;
  usage?: string;
  examples?: string[];
}

export function HelpTooltip({ title, content, calculation, usage, examples }: HelpTooltipProps) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <Dialog.Root open={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger asChild>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); e.preventDefault(); setIsOpen(true); }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); e.preventDefault(); setIsOpen(true); } }}
          className="inline-flex items-center justify-center w-5 h-5 ml-1 text-xs text-gray-400 hover:text-amber-400 transition-colors rounded-full border border-gray-600 hover:border-amber-400 cursor-pointer select-none"
          title="查看详细说明"
        >
          ?
        </span>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-[10198]" />
        <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gray-800 border border-gray-700 rounded-lg shadow-xl max-w-md w-full max-h-[80dvh] overflow-y-auto z-[10200]">
          <div className="p-6">
            {/* Header */}
            <div className="flex items-start justify-between mb-4">
              <Dialog.Title className="text-xl font-bold text-amber-400">
                {title}
              </Dialog.Title>
              <Dialog.Close asChild>
                <button className="text-gray-400 hover:text-gray-300 transition-colors">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </Dialog.Close>
            </div>

            {/* Content */}
            <div className="space-y-4 text-sm text-gray-300">
              {/* Description */}
              <div>
                <h3 className="font-semibold text-gray-200 mb-2">📖 说明</h3>
                <div className="text-gray-300 leading-relaxed">
                  {typeof content === 'string' ? <p>{content}</p> : content}
                </div>
              </div>

              {/* Calculation */}
              {calculation && (
                <div>
                  <h3 className="font-semibold text-gray-200 mb-2">🧮 计算方法</h3>
                  <div className="bg-gray-900/50 rounded p-3 font-mono text-xs text-amber-300">
                    {calculation}
                  </div>
                </div>
              )}

              {/* Usage */}
              {usage && (
                <div>
                  <h3 className="font-semibold text-gray-200 mb-2">⚔️ 战斗中的使用</h3>
                  <p className="text-gray-300 leading-relaxed">{usage}</p>
                </div>
              )}

              {/* Examples */}
              {examples && examples.length > 0 && (
                <div>
                  <h3 className="font-semibold text-gray-200 mb-2">💡 示例</h3>
                  <ul className="space-y-2">
                    {examples.map((example, idx) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="text-amber-400 mt-0.5">•</span>
                        <span className="text-gray-300 flex-1">{example}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="mt-6 pt-4 border-t border-gray-700">
              <Dialog.Close asChild>
                <button className="w-full px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors">
                  关闭
                </button>
              </Dialog.Close>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

