import { render } from "../test-utils";
import { describe, expect, it, vi } from "vitest";

import { LevelUpNotification } from "~/components/ui/LevelUpNotification";
import { publishAppEvent } from "~/events/appEventBus";

const showGlobalToastMock = vi.fn();

vi.mock("~/components/ui/Toast", () => ({
  showGlobalToast: (...args: any[]) => showGlobalToastMock(...args),
}));

describe("LevelUpNotification", () => {
  it("shows a success toast when character level-up is published through the typed bus", () => {
    render(<LevelUpNotification />);

    publishAppEvent("characterLevelUp", {
      character_id: 12,
      character_name: "米拉",
      level: 4,
      class_id: "cleric",
      max_hp: 29,
    });

    expect(showGlobalToastMock).toHaveBeenCalledWith({
      message: "🎉 米拉 升到 4 级（Cleric，最大生命值 29）",
      type: "success",
      duration: 8000,
    });
  });
});
