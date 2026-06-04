export interface RitualCastingInfoState {
  tokenName: string;
  spellName: string;
}

export interface StatusEffectDetailState {
  id: string;
  name: string;
  icon: string;
  color: string;
  duration?: number;
  duration_unit?: string;
  from_caster?: string;
  description?: string;
  [key: string]: any;
}

export interface StatusEffectRemoveConfirmState {
  tokenId: number;
  effectId: string;
  tokenName: string;
  effectName: string;
  runtimeInstanceId?: number | null;
  runtimeSourceTokenId?: number | null;
  runtimeSpellId?: string | null;
  runtimeEndsConcentration?: boolean;
}

export interface CastingCancelConfirmState {
  tokenId: number;
  tokenName: string;
  spellName: string;
}

export interface CastingCompleteConfirmState {
  tokenId: number;
  tokenName: string;
  spellName: string;
  isReadyToRelease: boolean;
}

export interface ConcentrationBreakConfirmState {
  tokenId: number;
  name: string;
  spellName: string;
}

export interface ConcentrationDurationEditState {
  tokenId: number;
  currentRemaining: number;
}

interface MapStatusDialogsProps {
  showConcentrationRulesInfo: boolean;
  ritualCastingInfo: RitualCastingInfoState | null;
  statusEffectDetail: StatusEffectDetailState | null;
  statusEffectRemoveConfirm: StatusEffectRemoveConfirmState | null;
  castingCancelConfirm: CastingCancelConfirmState | null;
  castingCompleteConfirm: CastingCompleteConfirmState | null;
  concBreakConfirm: ConcentrationBreakConfirmState | null;
  concDurationEdit: ConcentrationDurationEditState | null;
  concDurationInput: string;
  setShowConcentrationRulesInfo: (value: boolean) => void;
  setRitualCastingInfo: (value: RitualCastingInfoState | null) => void;
  setStatusEffectDetail: (value: StatusEffectDetailState | null) => void;
  setStatusEffectRemoveConfirm: (value: StatusEffectRemoveConfirmState | null) => void;
  setCastingCancelConfirm: (value: CastingCancelConfirmState | null) => void;
  setCastingCompleteConfirm: (value: CastingCompleteConfirmState | null) => void;
  setConcBreakConfirm: (value: ConcentrationBreakConfirmState | null) => void;
  setConcDurationEdit: (value: ConcentrationDurationEditState | null) => void;
  setConcDurationInput: (value: string) => void;
  onConfirmStatusEffectRemove: () => void | Promise<void>;
  onConfirmCastingCancel: () => void | Promise<void>;
  onConfirmCastingComplete: () => void | Promise<void>;
  onConfirmConcentrationBreak: () => void | Promise<void>;
  onConfirmConcentrationDurationEdit: () => void | Promise<void>;
}

export function MapStatusDialogs({
  showConcentrationRulesInfo,
  ritualCastingInfo,
  statusEffectDetail,
  statusEffectRemoveConfirm,
  castingCancelConfirm,
  castingCompleteConfirm,
  concBreakConfirm,
  concDurationEdit,
  concDurationInput,
  setShowConcentrationRulesInfo,
  setRitualCastingInfo,
  setStatusEffectDetail,
  setStatusEffectRemoveConfirm,
  setCastingCancelConfirm,
  setCastingCompleteConfirm,
  setConcBreakConfirm,
  setConcDurationEdit,
  setConcDurationInput,
  onConfirmStatusEffectRemove,
  onConfirmCastingCancel,
  onConfirmCastingComplete,
  onConfirmConcentrationBreak,
  onConfirmConcentrationDurationEdit,
}: MapStatusDialogsProps) {
  return (
    <>
      {showConcentrationRulesInfo && (
        <div
          className="fixed inset-0 bg-black/50 z-[210] flex items-center justify-center"
          onClick={() => setShowConcentrationRulesInfo(false)}
        >
          <div
            className="bg-gray-800 border border-purple-500 rounded-lg p-5 max-w-xs mx-4 shadow-xl shadow-purple-500/20"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-purple-400 font-bold text-base mb-3">专注 (Concentration)</h3>
            <ul className="text-gray-300 text-sm space-y-2">
              <li>• 同一时间只能维持<span className="text-purple-300 font-medium">一个</span>专注法术</li>
              <li>
                • 受到伤害需进行<span className="text-amber-400 font-medium">体质豁免</span>保持专注
                <br />
                <span className="text-gray-400 text-xs ml-3">DC = max(10, 伤害值÷2)</span>
              </li>
              <li>• 豁免失败则法术<span className="text-red-400 font-medium">立即结束</span></li>
              <li>• 施放新的专注法术会终止当前专注</li>
              <li>• 失去意识或死亡会终止专注</li>
            </ul>
            <button
              className="mt-4 w-full py-1.5 bg-purple-600 hover:bg-purple-500 text-white text-sm rounded transition-colors"
              onClick={() => setShowConcentrationRulesInfo(false)}
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {ritualCastingInfo && (
        <div
          className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center"
          onClick={() => setRitualCastingInfo(null)}
        >
          <div
            className="bg-gray-800 border border-amber-500 rounded-lg p-5 max-w-sm mx-4 shadow-xl shadow-amber-500/20"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-amber-400 font-bold text-base mb-3">仪式施法</h3>
            <p className="text-gray-300 text-sm mb-3">
              <span className="text-amber-300 font-medium">{ritualCastingInfo.tokenName}</span>{" "}
              正在以仪式方式施放
              <span className="text-yellow-300 font-medium">「{ritualCastingInfo.spellName}」</span>。
            </p>
            <ul className="text-gray-300 text-sm space-y-2">
              <li>• 仪式施法会额外增加施法时间，不能在战斗里当普通动作快速打出。</li>
              <li>• 仪式施法通常不消耗法术位，但前提是该法术本身带有“仪式”标签。</li>
              <li>• 完成前可以中止；完成后如果法术还需要选目标或区域，仍要继续选择。</li>
            </ul>
            <button
              className="mt-4 w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-white text-sm rounded transition-colors"
              onClick={() => setRitualCastingInfo(null)}
            >
              知道了
            </button>
          </div>
        </div>
      )}

      {statusEffectDetail && (
        <div
          className="fixed inset-0 bg-black/50 z-[210] flex items-center justify-center"
          onClick={() => setStatusEffectDetail(null)}
        >
          <div
            className="bg-gray-800 border border-gray-600 rounded-lg p-5 max-w-xs mx-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 mb-3">
              <span className="text-3xl">{statusEffectDetail.icon}</span>
              <div>
                <h3
                  className="text-white font-bold text-lg"
                  style={{ color: statusEffectDetail.color }}
                >
                  {statusEffectDetail.name}
                </h3>
                {statusEffectDetail.from_caster && (
                  <p className="text-gray-400 text-xs">来源: {statusEffectDetail.from_caster}</p>
                )}
              </div>
            </div>
            {statusEffectDetail.duration != null && (
              <p className="text-gray-300 text-sm mb-2">
                剩余:{" "}
                <span className="text-amber-400 font-medium">
                  {statusEffectDetail.duration}
                  {statusEffectDetail.duration_unit === "day" ? "日" : "轮"}
                </span>
              </p>
            )}
            {statusEffectDetail.description && (
              <p className="text-gray-400 text-sm">{statusEffectDetail.description}</p>
            )}
            <div className="flex justify-end mt-4">
              <button
                className="px-3 py-1.5 text-sm text-gray-300 bg-gray-700 hover:bg-gray-600 rounded"
                onClick={() => setStatusEffectDetail(null)}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}

      {statusEffectRemoveConfirm && (
        <div
          className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center"
          onClick={() => setStatusEffectRemoveConfirm(null)}
        >
          <div
            className="bg-gray-800 border border-red-500 rounded-lg p-5 max-w-sm mx-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-white font-bold mb-3">移除效果</h3>
            <p className="text-gray-300 text-sm mb-4">
              确定要从{" "}
              <span className="text-amber-400 font-medium">
                {statusEffectRemoveConfirm.tokenName}
              </span>{" "}
              身上移除
              <span className="text-red-400 font-medium">
                「{statusEffectRemoveConfirm.effectName}」
              </span>{" "}
              吗？
            </p>
            {statusEffectRemoveConfirm.runtimeEndsConcentration && (
              <p className="text-amber-300 text-xs mb-4">
                这是一个专注法术。确认后会一并解除施法者的专注。
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-200 rounded text-sm"
                onClick={() => setStatusEffectRemoveConfirm(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                onClick={() => void onConfirmStatusEffectRemove()}
              >
                确认移除
              </button>
            </div>
          </div>
        </div>
      )}

      {castingCancelConfirm && (
        <div
          className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center"
          onClick={() => setCastingCancelConfirm(null)}
        >
          <div
            className="bg-gray-800 border border-red-500 rounded-lg p-5 max-w-sm mx-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-white font-bold mb-3">停止施法</h3>
            <p className="text-gray-300 text-sm mb-4">
              确定要停止{" "}
              <span className="text-amber-400 font-medium">
                {castingCancelConfirm.tokenName}
              </span>{" "}
              的
              <span className="text-red-400 font-medium">
                「{castingCancelConfirm.spellName}」
              </span>{" "}
              吗？
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-200 rounded text-sm"
                onClick={() => setCastingCancelConfirm(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                onClick={() => void onConfirmCastingCancel()}
              >
                确认停止
              </button>
            </div>
          </div>
        </div>
      )}

      {castingCompleteConfirm && (
        <div
          className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center"
          onClick={() => setCastingCompleteConfirm(null)}
        >
          <div
            className="bg-gray-800 border border-amber-500 rounded-lg p-5 max-w-sm mx-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-white font-bold mb-3">
              {castingCompleteConfirm.isReadyToRelease ? "释放法术" : "立即完成施法"}
            </h3>
            <p className="text-gray-300 text-sm mb-4">
              确定要对{" "}
              <span className="text-amber-400 font-medium">
                {castingCompleteConfirm.tokenName}
              </span>{" "}
              的
              <span className="text-yellow-300 font-medium">
                「{castingCompleteConfirm.spellName}」
              </span>
              {castingCompleteConfirm.isReadyToRelease ? "进入释放流程吗？" : "直接完成吗？"}
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-200 rounded text-sm"
                onClick={() => setCastingCompleteConfirm(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded text-sm font-medium"
                onClick={() => void onConfirmCastingComplete()}
              >
                {castingCompleteConfirm.isReadyToRelease ? "确认释放" : "确认完成"}
              </button>
            </div>
          </div>
        </div>
      )}

      {concBreakConfirm && (
        <div
          className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center"
          onClick={() => setConcBreakConfirm(null)}
        >
          <div
            className="bg-gray-800 border border-gray-600 rounded-lg p-5 max-w-sm mx-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-white font-bold mb-3">解除专注</h3>
            <p className="text-gray-300 text-sm mb-4">
              确定要解除 <span className="text-amber-400 font-medium">{concBreakConfirm.name}</span>{" "}
              对 <span className="text-purple-400 font-medium">{concBreakConfirm.spellName}</span>{" "}
              的专注吗？
            </p>
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-200 rounded text-sm"
                onClick={() => setConcBreakConfirm(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-1.5 bg-red-600 hover:bg-red-700 text-white rounded text-sm font-medium"
                onClick={() => void onConfirmConcentrationBreak()}
              >
                确认解除
              </button>
            </div>
          </div>
        </div>
      )}

      {concDurationEdit && (
        <div
          className="fixed inset-0 bg-black/50 z-[9999] flex items-center justify-center"
          onClick={() => setConcDurationEdit(null)}
        >
          <div
            className="bg-gray-800 border border-gray-600 rounded-lg p-5 max-w-xs mx-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 className="text-white font-bold mb-3">修改剩余轮数</h3>
            <input
              type="number"
              min={0}
              autoFocus
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white text-center text-lg mb-3 focus:outline-none focus:border-purple-500"
              value={concDurationInput}
              onChange={(event) => setConcDurationInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void onConfirmConcentrationDurationEdit();
                }
              }}
            />
            <div className="flex gap-3 justify-end">
              <button
                className="px-4 py-1.5 bg-gray-600 hover:bg-gray-500 text-gray-200 rounded text-sm"
                onClick={() => setConcDurationEdit(null)}
              >
                取消
              </button>
              <button
                className="px-4 py-1.5 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm font-medium"
                onClick={() => void onConfirmConcentrationDurationEdit()}
              >
                确认
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
