import { publishAppEvent, type AppEventName } from "~/events/appEventBus";

const typedOpenEvents = new Set<AppEventName>([
  "wildShapeTarget",
  "arcaneRecoveryTarget",
  "flexibleCastingTarget",
  "naturalRecoveryTarget",
]);

type TypedOpenEventName = "wildShapeTarget" | "arcaneRecoveryTarget" | "flexibleCastingTarget" | "naturalRecoveryTarget";

export function isTypedOpenEvent(eventName: string): eventName is TypedOpenEventName {
  return typedOpenEvents.has(eventName as AppEventName);
}

export function dispatchOpenEvent(eventName: string, detail: Record<string, unknown>) {
  if (isTypedOpenEvent(eventName)) {
    publishAppEvent(eventName, detail as never);
    return;
  }

  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(eventName, { detail }));
}
