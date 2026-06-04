import { useRef, useCallback, useState, useEffect } from "react";
import { apiFetch } from "~/utils/api-client";
import type { CharacterState } from "~/components/character/types";

export interface CharacterDraftData {
  current_step: number;
  wizard_state: CharacterState;
}

export function useCharacterDraft() {
  const [loading, setLoading] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasSavedRef = useRef(false);
  const pendingRef = useRef<{ step: number; state: CharacterState } | null>(null);

  const loadDraft = useCallback(async (): Promise<CharacterDraftData | null> => {
    try {
      setLoading(true);
      const res = await apiFetch("/api/character-drafts");
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const saveDraftNow = useCallback(async (step: number, state: CharacterState) => {
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    try {
      await apiFetch("/api/character-drafts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_step: step, wizard_state: state }),
      });
      hasSavedRef.current = true;
    } catch {
      // Silent fail
    }
  }, []);

  const saveDraft = useCallback((step: number, state: CharacterState) => {
    pendingRef.current = { step, state };
    if (timerRef.current) clearTimeout(timerRef.current);
    // First save fires immediately; subsequent saves debounce
    if (!hasSavedRef.current) {
      saveDraftNow(step, state);
      return;
    }
    timerRef.current = setTimeout(() => {
      saveDraftNow(step, state);
    }, 1500);
  }, [saveDraftNow]);

  // Flush pending draft when page becomes hidden (tab switch, close, refresh)
  useEffect(() => {
    const flush = () => {
      if (document.visibilityState !== "hidden") return;
      const p = pendingRef.current;
      if (!p) return;
      pendingRef.current = null;
      if (timerRef.current) clearTimeout(timerRef.current);
      // keepalive: true lets fetch survive page unload
      apiFetch("/api/character-drafts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current_step: p.step, wizard_state: p.state }),
        keepalive: true,
      }).catch(() => {});
    };
    document.addEventListener("visibilitychange", flush);
    return () => document.removeEventListener("visibilitychange", flush);
  }, []);

  const deleteDraft = useCallback(async () => {
    pendingRef.current = null;
    hasSavedRef.current = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    try {
      await apiFetch("/api/character-drafts", { method: "DELETE" });
    } catch {
      // Silent fail
    }
  }, []);

  return { loadDraft, saveDraft, saveDraftNow, deleteDraft, loading };
}
