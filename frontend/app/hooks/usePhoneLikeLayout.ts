import { useEffect, useState } from "react";

const PHONE_MAX_SHORTEST_SIDE = 500;
const PHONE_MIN_ASPECT_RATIO = 1.6;

function hasCoarsePointer(win: Window): boolean {
  return typeof win.matchMedia === "function" && win.matchMedia("(pointer: coarse)").matches;
}

export function isPhoneLikeViewport(win: Window): boolean {
  const width = win.innerWidth;
  const height = win.innerHeight;

  if (width <= 0 || height <= 0) {
    return false;
  }

  const shortestSide = Math.min(width, height);
  const longestSide = Math.max(width, height);
  const aspectRatio = longestSide / Math.max(shortestSide, 1);

  return hasCoarsePointer(win)
    && shortestSide <= PHONE_MAX_SHORTEST_SIDE
    && aspectRatio >= PHONE_MIN_ASPECT_RATIO;
}

export function usePhoneLikeLayout(): boolean {
  const [isPhoneLike, setIsPhoneLike] = useState<boolean>(() => {
    if (typeof window === "undefined") {
      return false;
    }
    return isPhoneLikeViewport(window);
  });

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const update = () => {
      setIsPhoneLike(isPhoneLikeViewport(window));
    };

    update();
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);

    const coarseQuery = window.matchMedia("(pointer: coarse)");
    if (typeof coarseQuery.addEventListener === "function") {
      coarseQuery.addEventListener("change", update);
    } else {
      coarseQuery.addListener(update);
    }

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);

      if (typeof coarseQuery.removeEventListener === "function") {
        coarseQuery.removeEventListener("change", update);
      } else {
        coarseQuery.removeListener(update);
      }
    };
  }, []);

  return isPhoneLike;
}
