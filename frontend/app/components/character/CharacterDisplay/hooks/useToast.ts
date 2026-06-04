import { useCallback } from "react";
import { showGlobalToast, type ToastType } from "~/components/ui/Toast";

export function useToast() {
  const showToast = useCallback((message: string, type: ToastType = 'success') => {
    showGlobalToast({ message, type });
  }, []);

  return { showToast } as const;
}

