import { useCallback, useEffect, useRef, type MutableRefObject, type RefObject } from "react";
import type Konva from "konva";

import { getCenter, getDistance } from "../utils/mapCalculations";

type Point = { x: number; y: number };

interface UseMapTouchGestureControllerArgs {
  containerRef: RefObject<HTMLDivElement | null>;
  stageRef: MutableRefObject<Konva.Stage | null>;
  handleNativeTouchMove: (event: TouchEvent) => void;
  handleNativeTouchEnd: () => void;
  lastDist: MutableRefObject<number>;
  lastCenter: MutableRefObject<Point>;
  setStageScale: (scale: number) => void;
  setStagePos: (position: Point) => void;
}

export function useMapTouchGestureController({
  containerRef,
  stageRef,
  handleNativeTouchMove,
  handleNativeTouchEnd,
  lastDist,
  lastCenter,
  setStageScale,
  setStagePos,
}: UseMapTouchGestureControllerArgs) {
  const nativeTouchMoveRef = useRef<typeof handleNativeTouchMove>(() => {});
  const nativeTouchEndRef = useRef<typeof handleNativeTouchEnd>(() => {});
  const gestureBaseScaleRef = useRef(1);
  const gestureBasePosRef = useRef({ x: 0, y: 0 });
  const gestureStartCenterRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    nativeTouchMoveRef.current = handleNativeTouchMove;
  }, [handleNativeTouchMove]);

  useEffect(() => {
    nativeTouchEndRef.current = handleNativeTouchEnd;
  }, [handleNativeTouchEnd]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const applyTouchActionToCanvases = () => {
      container.querySelectorAll("canvas").forEach((canvas) => {
        (canvas as HTMLElement).style.touchAction = "none";
      });
    };

    applyTouchActionToCanvases();

    const observer = new MutationObserver(applyTouchActionToCanvases);
    observer.observe(container, { childList: true, subtree: true });

    const onTouchMove = (event: TouchEvent) => {
      if (event.touches.length >= 2) {
        event.preventDefault();
        if (typeof nativeTouchMoveRef.current === "function") {
          nativeTouchMoveRef.current(event);
        }
      }
    };

    const onTouchEnd = (event: TouchEvent) => {
      if (event.touches.length < 2) {
        if (typeof nativeTouchEndRef.current === "function") {
          nativeTouchEndRef.current();
        }
      }
    };

    const onGestureStart = (event: any) => {
      event.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      if (stage.isDragging()) stage.stopDrag();

      const containerRect = container.getBoundingClientRect();
      gestureBaseScaleRef.current = stage.scaleX();
      gestureBasePosRef.current = { x: stage.x(), y: stage.y() };
      gestureStartCenterRef.current = {
        x: (event.clientX ?? containerRect.width / 2) - containerRect.left,
        y: (event.clientY ?? containerRect.height / 2) - containerRect.top,
      };
    };

    const onGestureChange = (event: any) => {
      event.preventDefault();
      const stage = stageRef.current;
      if (!stage) return;
      if (stage.isDragging()) stage.stopDrag();

      const gestureScale = event.scale || 1;
      const newScale = Math.max(0.1, Math.min(5, gestureBaseScaleRef.current * gestureScale));
      const baseScale = gestureBaseScaleRef.current;
      const basePos = gestureBasePosRef.current;
      const startCenter = gestureStartCenterRef.current;
      const containerRect = container.getBoundingClientRect();
      const curCenter = {
        x: (event.clientX ?? containerRect.width / 2) - containerRect.left,
        y: (event.clientY ?? containerRect.height / 2) - containerRect.top,
      };
      const anchorMap = {
        x: (startCenter.x - basePos.x) / baseScale,
        y: (startCenter.y - basePos.y) / baseScale,
      };
      const newPos = {
        x: curCenter.x - anchorMap.x * newScale,
        y: curCenter.y - anchorMap.y * newScale,
      };

      stage.scaleX(newScale);
      stage.scaleY(newScale);
      stage.x(newPos.x);
      stage.y(newPos.y);
      stage.batchDraw();

      setStageScale(newScale);
      setStagePos(newPos);
    };

    const onGestureEnd = (event: any) => {
      event.preventDefault();
    };

    const onDocTouchMove = (event: TouchEvent) => {
      if (event.touches.length > 1) {
        const target = event.touches[0]?.target as Node | null;
        if (target && container.contains(target)) {
          event.preventDefault();
        }
      }
    };

    container.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    container.addEventListener("touchend", onTouchEnd, { capture: true });
    document.addEventListener("gesturestart", onGestureStart, { passive: false } as any);
    document.addEventListener("gesturechange", onGestureChange, { passive: false } as any);
    document.addEventListener("gestureend", onGestureEnd, { passive: false } as any);
    document.addEventListener("touchmove", onDocTouchMove, { passive: false });

    return () => {
      observer.disconnect();
      container.removeEventListener("touchmove", onTouchMove, { capture: true });
      container.removeEventListener("touchend", onTouchEnd, { capture: true });
      document.removeEventListener("gesturestart", onGestureStart);
      document.removeEventListener("gesturechange", onGestureChange);
      document.removeEventListener("gestureend", onGestureEnd);
      document.removeEventListener("touchmove", onDocTouchMove);
    };
  }, [containerRef, stageRef, setStagePos, setStageScale]);

  const handleRulerMultiTouchMove = useCallback(
    (touches: Point[]) => {
      if (touches.length < 2) return;
      const stage = stageRef.current;
      if (!stage) return;

      if (stage.isDragging()) {
        stage.stopDrag();
      }

      const p1 = touches[0];
      const p2 = touches[1];
      const newDist = getDistance(p1, p2);
      const newCenter = getCenter(p1, p2);

      if (lastDist.current === 0) {
        lastDist.current = newDist;
        lastCenter.current = newCenter;
        return;
      }

      const dx = newCenter.x - lastCenter.current.x;
      const dy = newCenter.y - lastCenter.current.y;
      const distRatio = newDist / lastDist.current;
      const oldScale = stage.scaleX();
      const curPos = { x: stage.x(), y: stage.y() };
      const pinchThreshold = 0.03;
      const isPinching = Math.abs(distRatio - 1) > pinchThreshold;

      if (isPinching) {
        const newScale = Math.max(0.1, Math.min(5, distRatio * oldScale));
        const containerRect = stage.container().getBoundingClientRect();
        const stagePointer = {
          x: newCenter.x - containerRect.left,
          y: newCenter.y - containerRect.top,
        };
        const mousePointTo = {
          x: (stagePointer.x - curPos.x) / oldScale,
          y: (stagePointer.y - curPos.y) / oldScale,
        };
        const newPos = {
          x: stagePointer.x - mousePointTo.x * newScale + dx,
          y: stagePointer.y - mousePointTo.y * newScale + dy,
        };

        setStageScale(newScale);
        setStagePos(newPos);
        lastDist.current = newDist;
      } else {
        setStagePos({
          x: curPos.x + dx,
          y: curPos.y + dy,
        });
      }

      lastCenter.current = newCenter;
    },
    [lastCenter, lastDist, setStagePos, setStageScale, stageRef],
  );

  const handleRulerMultiTouchEnd = useCallback(() => {
    lastDist.current = 0;
    lastCenter.current = { x: 0, y: 0 };
  }, [lastCenter, lastDist]);

  return {
    handleRulerMultiTouchEnd,
    handleRulerMultiTouchMove,
  };
}
