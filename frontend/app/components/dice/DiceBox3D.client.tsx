/**
 * DiceBox3D - 3D 骰子投掷动画
 *
 * 容器通过命令式 DOM 操作创建（避免 Remix 双挂载产生两个容器），
 * 并用内联 style 保证 BabylonJS 能正确读取尺寸。
 *
 * 3D 动画的物理结果即为最终结果，通过 onRollComplete 回调传出。
 */
import { useEffect, useRef, useCallback, useState } from 'react';

interface DiceBox3DProps {
  visible: boolean;
  notation?: string;
  /** 检定附加信息：modifier、dc，用于在3D骰子结果上显示完整信息 */
  checkInfo?: {
    modifier?: number;
    dc?: number;
    label?: string;
    rollMode?: 'advantage' | 'disadvantage' | null;
  } | null;
  onRollComplete?: (result: { total: number; rolls: number[] }) => void;
  onClose?: () => void;
  autoCloseDelay?: number;
}

const CONTAINER_ID = 'dice-box-3d';
const BASE_URL = typeof import.meta.env?.BASE_URL === 'string'
  ? import.meta.env.BASE_URL.replace(/\/$/, '')
  : '';
const DICE_BOX_ASSET_PATH = `${BASE_URL}/assets/dice-box/`;

let diceBoxInstance: any = null;
let diceBoxInitPromise: Promise<any> | null = null;
let styleInjected = false;

function injectCanvasStyle() {
  if (styleInjected) return;
  styleInjected = true;
  const style = document.createElement('style');
  style.textContent = `#${CONTAINER_ID} canvas.dice-box-canvas { width: 100% !important; height: 100% !important; display: block !important; }`;
  document.head.appendChild(style);
}

function ensureContainer(): HTMLDivElement {
  let el = document.getElementById(CONTAINER_ID) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = CONTAINER_ID;
  el.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:-1;opacity:0;pointer-events:none;';
  document.body.appendChild(el);
  return el;
}

function showContainer() {
  const el = ensureContainer();
  el.style.zIndex = '10300';
  el.style.opacity = '1';
}

function hideContainer() {
  const el = document.getElementById(CONTAINER_ID);
  if (el) {
    el.style.zIndex = '-1';
    el.style.opacity = '0';
  }
}

async function initDiceBox(): Promise<any> {
  if (diceBoxInstance) return diceBoxInstance;
  if (diceBoxInitPromise) return diceBoxInitPromise;

  injectCanvasStyle();
  ensureContainer();

  diceBoxInitPromise = (async () => {
    const { default: DiceBox } = await import('@3d-dice/dice-box');
    const box = new DiceBox(`#${CONTAINER_ID}`, {
      assetPath: DICE_BOX_ASSET_PATH,
      theme: 'default',
      scale: 6,
      gravity: 2,
      throwForce: 5,
      spinForce: 3,
      startingHeight: 6,
      settleTimeout: 5000,
      offscreen: false,
      delay: 10,
      lightIntensity: 1,
    });
    await box.init();
    diceBoxInstance = box;
    return box;
  })();

  return diceBoxInitPromise;
}

export function DiceBox3D({
  visible,
  notation = '1d20',
  checkInfo,
  onRollComplete,
  onClose,
  autoCloseDelay = 2500,
}: DiceBox3DProps) {
  const [rolling, setRolling] = useState(false);
  const [physicalResult, setPhysicalResult] = useState<number | null>(null);
  const [physicalRolls, setPhysicalRolls] = useState<number[]>([]);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const failsafeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const rollIdRef = useRef(0);

  useEffect(() => { ensureContainer(); }, []);

  useEffect(() => {
    if (!visible) {
      setRolling(false);
      setPhysicalResult(null);
      setPhysicalRolls([]);
      hideContainer();
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
      if (diceBoxInstance) {
        try { diceBoxInstance.clear(); } catch {}
      }
      return;
    }

    const currentRollId = ++rollIdRef.current;
    setRolling(true);
    setPhysicalResult(null);
    setPhysicalRolls([]);
    showContainer();

    failsafeTimerRef.current = setTimeout(() => {
      if (rollIdRef.current === currentRollId) {
        setRolling(false);
        onClose?.();
      }
    }, 8000);

    initDiceBox().then(box => {
      if (rollIdRef.current !== currentRollId) return;
      return box.roll(notation);
    }).then((results: any) => {
      if (rollIdRef.current !== currentRollId) return;
      if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
      setRolling(false);

      // 从 DiceBox 结果中提取物理值
      // 返回格式: DieResult[] — 每个骰子一个 { value, sides, groupId, ... }
      if (results && results.length > 0) {
        const rolls = results.map((r: any) => r.value ?? 0);
        const total = checkInfo?.rollMode && rolls.length >= 2
          ? (checkInfo.rollMode === 'advantage' ? Math.max(...rolls) : Math.min(...rolls))
          : rolls.reduce((a: number, b: number) => a + b, 0);
        setPhysicalRolls(rolls);
        setPhysicalResult(total);
        onRollComplete?.({ total, rolls });
      }

      // 物理结果出来后启动自动关闭
      if (autoCloseDelay > 0) {
        closeTimerRef.current = setTimeout(() => {
          if (rollIdRef.current === currentRollId) onClose?.();
        }, autoCloseDelay);
      }
    }).catch((err: any) => {
      console.error('[DiceBox3D] Roll failed:', err);
      if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
      if (rollIdRef.current === currentRollId) {
        setRolling(false);
        closeTimerRef.current = setTimeout(() => onClose?.(), 2000);
      }
    });

    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
    };
  }, [visible]);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    if (failsafeTimerRef.current) clearTimeout(failsafeTimerRef.current);
    onClose?.();
  }, [onClose]);

  if (!visible) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        zIndex: 10301,
      }}
      onClick={handleClose}
    >
      {/* 显示物理骰子结果 */}
      {physicalResult != null && (
        <div className="absolute bottom-[12vh] left-1/2 -translate-x-1/2 pointer-events-none">
          <div className="bg-black/70 backdrop-blur-md border border-amber-500/50 rounded-xl px-8 py-4 text-center min-w-[160px]">
            {checkInfo?.label && (
              <div className="text-gray-300 text-xs mb-2">{checkInfo.label}</div>
            )}
            {checkInfo?.modifier != null ? (() => {
              const finalTotal = physicalResult + checkInfo.modifier!;
              const passed = checkInfo.dc != null ? finalTotal >= checkInfo.dc : null;
              const hasRollMode = Boolean(checkInfo.rollMode && physicalRolls.length >= 2);
              const rollModeLabel = checkInfo.rollMode === 'advantage' ? '取高' : '取低';
              return (
                <>
                  {hasRollMode ? (
                    <>
                      <div className="text-white/70 text-sm tabular-nums leading-tight">
                        [{physicalRolls.join(', ')}] {rollModeLabel}
                      </div>
                      <div className="text-white/80 text-lg tabular-nums leading-tight mt-1">
                        <span className="text-white text-2xl font-bold">{physicalResult}</span>
                        {' '}
                        <span className={checkInfo.modifier! >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {checkInfo.modifier! >= 0 ? '+' : ''}{checkInfo.modifier}
                        </span>
                        {' = '}
                        <span className="text-amber-300 text-3xl font-bold">{finalTotal}</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-white/80 text-lg tabular-nums leading-tight">
                      <span className="text-white text-2xl font-bold">{physicalResult}</span>
                      {' '}
                      <span className={checkInfo.modifier! >= 0 ? 'text-green-400' : 'text-red-400'}>
                        {checkInfo.modifier! >= 0 ? '+' : ''}{checkInfo.modifier}
                      </span>
                      {' = '}
                      <span className="text-amber-300 text-3xl font-bold">{finalTotal}</span>
                    </div>
                  )}
                  {checkInfo.dc != null && (
                    <div className={`text-sm font-semibold mt-2 ${passed ? 'text-green-400' : 'text-red-400'}`}>
                      vs DC {checkInfo.dc} — {passed ? '成功' : '失败'}
                    </div>
                  )}
                </>
              );
            })() : (
              <>
                <div className="text-amber-400 text-sm font-medium mb-1">{notation}</div>
                <div className="text-white text-4xl font-bold tabular-nums">{physicalResult}</div>
                {checkInfo?.dc != null && (
                  <div className="text-gray-400 text-sm mt-1">vs DC {checkInfo.dc}</div>
                )}
              </>
            )}
          </div>
        </div>
      )}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-gray-400 text-xs pointer-events-none">
        {rolling ? '骰子滚动中...' : '点击任意处关闭'}
      </div>
    </div>
  );
}

export default DiceBox3D;
