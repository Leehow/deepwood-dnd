import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";

export type VisionsOfThePastMode = "object" | "area";

export interface VisionsOfThePastSubmitPayload {
  mode: VisionsOfThePastMode;
  focus: string;
  details: string;
  question: string;
}

interface VisionsOfThePastModalProps {
  open: boolean;
  sourceName?: string;
  suggestedMode?: VisionsOfThePastMode;
  suggestedFocus?: string;
  onCancel: () => void;
  onConfirm: (payload: VisionsOfThePastSubmitPayload) => void;
}

export function VisionsOfThePastModal({
  open,
  sourceName,
  suggestedMode = "area",
  suggestedFocus = "",
  onCancel,
  onConfirm,
}: VisionsOfThePastModalProps) {
  const [mode, setMode] = useState<VisionsOfThePastMode>(suggestedMode);
  const [focus, setFocus] = useState(suggestedFocus);
  const [details, setDetails] = useState("");
  const [question, setQuestion] = useState("");

  useEffect(() => {
    if (!open) return;
    setMode(suggestedMode);
    setFocus(suggestedFocus);
    setDetails("");
    setQuestion("");
  }, [open, suggestedMode, suggestedFocus]);

  const canConfirm = focus.trim().length > 0;
  const focusLabel = mode === "object" ? "观察物品" : "观察地点";
  const detailsPlaceholder = mode === "object"
    ? "例如：我正握着这把古老匕首，想追溯它最近的重要持有者和发生过的血案。"
    : "例如：我站在这间祭坛大厅中央，想追溯最近 7 天在这里进行过的关键仪式。";
  const questionPlaceholder = mode === "object"
    ? "例如：它最近一次被用于什么事件？"
    : "例如：这里最近发生过什么最重要的事？";

  return (
    <Dialog.Root open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 z-[1200]" />
        <Dialog.Content className="fixed left-1/2 top-1/2 w-[min(92vw,36rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-violet-700/40 bg-gray-900 shadow-2xl z-[1201] p-4 text-gray-100">
          <Dialog.Title className="text-lg font-semibold text-violet-300">
            异象
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-gray-400">
            {sourceName || "该角色"} 凝神追溯过去。填写聚焦对象后，系统会生成明确的 DM 提示，等待 DM 叙述异象内容。
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setMode("area")}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  mode === "area"
                    ? "border-violet-500 bg-violet-500/20 text-violet-200"
                    : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                地点回溯
              </button>
              <button
                type="button"
                onClick={() => setMode("object")}
                className={`rounded-lg border px-3 py-2 text-sm transition-colors ${
                  mode === "object"
                    ? "border-violet-500 bg-violet-500/20 text-violet-200"
                    : "border-gray-700 bg-gray-800 text-gray-300 hover:bg-gray-700"
                }`}
              >
                物品回溯
              </button>
            </div>

            <label className="block">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">{focusLabel}</div>
              <input
                value={focus}
                onChange={(event) => setFocus(event.target.value)}
                placeholder={mode === "object" ? "例如：染血的银匕首" : "例如：北塔顶层的观星室"}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">补充描述</div>
              <textarea
                value={details}
                onChange={(event) => setDetails(event.target.value)}
                rows={4}
                placeholder={detailsPlaceholder}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
              />
            </label>

            <label className="block">
              <div className="mb-1 text-xs uppercase tracking-wide text-gray-500">最想知道的问题</div>
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                placeholder={questionPlaceholder}
                className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100"
              />
            </label>

            <div className="rounded-lg border border-violet-700/30 bg-violet-950/30 px-3 py-2 text-sm text-gray-300">
              <div className="text-violet-200">
                {mode === "object" ? "将追溯物品相关的过往片段" : "将追溯此地最近 7 天内的重要事件"}
              </div>
              <div className="mt-1 text-xs text-gray-400">
                点击确认后，会在聊天中生成清晰的 DM 提示，便于 DM 立即叙述或稍后补充。
              </div>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-gray-700 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800"
            >
              取消
            </button>
            <button
              type="button"
              disabled={!canConfirm}
              onClick={() => onConfirm({
                mode,
                focus: focus.trim(),
                details: details.trim(),
                question: question.trim(),
              })}
              className="rounded-lg bg-violet-600 px-3 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:cursor-not-allowed disabled:bg-violet-900/60 disabled:text-violet-200/60"
            >
              触发异象
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
