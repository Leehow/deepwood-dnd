export interface MarkerDialogPosition {
  x: number;
  y: number;
}

export interface RangeConfirmModalState {
  show: boolean;
  distanceFeet: number;
  maxRange: number;
  attackData: any;
  sourceName: string;
  targetName: string;
}

export interface MoveConfirmModalState {
  show: boolean;
  distanceFeet: number;
  movementSpeed: number;
  sourceName: string;
  moveData: { gridX: number; gridY: number; sourceTokenId: number; token: any };
}

interface MapMarkerAndConfirmDialogsProps {
  isDM: boolean;
  showMarkerDialog: boolean;
  pendingMarkerPos: MarkerDialogPosition | null;
  markerIcon: string;
  markerColor: string;
  markerLabelInput: string;
  selectedMarkerId: number | null;
  rangeConfirmModal: RangeConfirmModalState | null;
  moveConfirmModal: MoveConfirmModalState | null;
  setShowMarkerDialog: (value: boolean) => void;
  setPendingMarkerPos: (value: MarkerDialogPosition | null) => void;
  setMarkerLabelInput: (value: string) => void;
  setSelectedMarkerId: (value: number | null) => void;
  handleCreateMarker: () => void;
  handleDeleteMarker: () => void;
  handleRangeCancel: () => void;
  handleRangeConfirm: () => void;
  handleMoveCancel: () => void;
  handleMoveConfirm: () => void;
}

export function MapMarkerAndConfirmDialogs({
  isDM,
  showMarkerDialog,
  pendingMarkerPos,
  markerIcon,
  markerColor,
  markerLabelInput,
  selectedMarkerId,
  rangeConfirmModal,
  moveConfirmModal,
  setShowMarkerDialog,
  setPendingMarkerPos,
  setMarkerLabelInput,
  setSelectedMarkerId,
  handleCreateMarker,
  handleDeleteMarker,
  handleRangeCancel,
  handleRangeConfirm,
  handleMoveCancel,
  handleMoveConfirm,
}: MapMarkerAndConfirmDialogsProps) {
  const handleCancelMarker = () => {
    setShowMarkerDialog(false);
    setPendingMarkerPos(null);
    setMarkerLabelInput("");
  };

  return (
    <>
      {showMarkerDialog && pendingMarkerPos && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-gray-800 rounded-lg p-4 w-80 space-y-4">
            <h3 className="text-lg font-semibold text-amber-400 flex items-center gap-2">
              <span>{markerIcon}</span>
              添加地图标记
            </h3>
            <div>
              <label className="block text-sm text-gray-300 mb-1">标记名称</label>
              <input
                type="text"
                value={markerLabelInput}
                onChange={(event) => setMarkerLabelInput(event.target.value)}
                placeholder="输入标记名称..."
                className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white placeholder-gray-400 focus:outline-none focus:border-amber-500"
                autoFocus
                onKeyDown={(event) => {
                  if (event.key === "Enter" && markerLabelInput.trim()) {
                    handleCreateMarker();
                  } else if (event.key === "Escape") {
                    handleCancelMarker();
                  }
                }}
              />
            </div>
            <div className="text-xs text-gray-400">
              位置: ({pendingMarkerPos.x}, {pendingMarkerPos.y}) · 颜色:{" "}
              <span style={{ color: markerColor }}>{markerColor}</span>
            </div>
            <div className="flex justify-end gap-2">
              <button
                onClick={handleCancelMarker}
                className="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 rounded"
              >
                取消
              </button>
              <button
                onClick={handleCreateMarker}
                disabled={!markerLabelInput.trim()}
                className="px-3 py-1.5 text-sm bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed rounded"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}

      {isDM && selectedMarkerId && (
        <div className="fixed bottom-4 right-4 z-40 bg-gray-800 rounded-lg p-2 shadow-lg flex items-center gap-2">
          <span className="text-sm text-gray-300">已选中标记 #{selectedMarkerId}</span>
          <button
            onClick={handleDeleteMarker}
            className="px-3 py-1.5 text-sm bg-red-600 hover:bg-red-500 rounded flex items-center gap-1"
          >
            <span>🗑️</span>
            删除
          </button>
          <button
            onClick={() => setSelectedMarkerId(null)}
            className="px-3 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 rounded"
          >
            取消选择
          </button>
        </div>
      )}

      {rangeConfirmModal?.show && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-amber-400 mb-3 flex items-center gap-2">
              ⚠️ 超出攻击距离
            </h3>
            <p className="text-gray-300 mb-4">
              <span className="text-white font-medium">{rangeConfirmModal.sourceName}</span>{" "}
              距离 <span className="text-white font-medium">{rangeConfirmModal.targetName}</span>{" "}
              <span className="text-red-400 font-bold">{rangeConfirmModal.distanceFeet}尺</span>，
              超出最大攻击距离{" "}
              <span className="text-green-400 font-bold">{rangeConfirmModal.maxRange}尺</span>。
            </p>
            <p className="text-gray-400 text-sm mb-4">
              是否强行进行远距离攻击？（DM判定可能带劣势或其他惩罚）
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleRangeCancel}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-gray-200 rounded transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleRangeConfirm}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors"
              >
                强行攻击
              </button>
            </div>
          </div>
        </div>
      )}

      {moveConfirmModal?.show && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-6 max-w-md mx-4 shadow-xl">
            <h3 className="text-lg font-semibold text-amber-400 mb-3 flex items-center gap-2">
              🏃 超出移动距离
            </h3>
            <p className="text-gray-300 mb-4">
              <span className="text-white font-medium">{moveConfirmModal.sourceName}</span>{" "}
              移动距离 <span className="text-red-400 font-bold">{moveConfirmModal.distanceFeet}尺</span>
              ，超出移动速度{" "}
              <span className="text-green-400 font-bold">{moveConfirmModal.movementSpeed}尺</span>。
            </p>
            <p className="text-gray-400 text-sm mb-4">
              是否强行移动？（可能需要使用疾走动作或多回合移动）
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={handleMoveCancel}
                className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-gray-200 rounded transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleMoveConfirm}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded transition-colors"
              >
                强行移动
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
