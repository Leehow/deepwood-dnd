import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MapMarkerAndConfirmDialogs } from "~/components/map/MapMarkerAndConfirmDialogs";

describe("MapMarkerAndConfirmDialogs", () => {
  it("renders the marker dialog and handles cancel", () => {
    const setShowMarkerDialog = vi.fn();
    const setPendingMarkerPos = vi.fn();
    const setMarkerLabelInput = vi.fn();

    render(
      <MapMarkerAndConfirmDialogs
        isDM={true}
        showMarkerDialog={true}
        pendingMarkerPos={{ x: 5, y: 7 }}
        markerIcon="📍"
        markerColor="#f59e0b"
        markerLabelInput="Secret Door"
        selectedMarkerId={null}
        rangeConfirmModal={null}
        moveConfirmModal={null}
        setShowMarkerDialog={setShowMarkerDialog}
        setPendingMarkerPos={setPendingMarkerPos}
        setMarkerLabelInput={setMarkerLabelInput}
        setSelectedMarkerId={vi.fn()}
        handleCreateMarker={vi.fn()}
        handleDeleteMarker={vi.fn()}
        handleRangeCancel={vi.fn()}
        handleRangeConfirm={vi.fn()}
        handleMoveCancel={vi.fn()}
        handleMoveConfirm={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(setShowMarkerDialog).toHaveBeenCalledWith(false);
    expect(setPendingMarkerPos).toHaveBeenCalledWith(null);
    expect(setMarkerLabelInput).toHaveBeenCalledWith("");
  });

  it("confirms range and movement overrides", () => {
    const handleRangeConfirm = vi.fn();
    const handleMoveConfirm = vi.fn();

    render(
      <MapMarkerAndConfirmDialogs
        isDM={false}
        showMarkerDialog={false}
        pendingMarkerPos={null}
        markerIcon="📍"
        markerColor="#f59e0b"
        markerLabelInput=""
        selectedMarkerId={null}
        rangeConfirmModal={{
          show: true,
          distanceFeet: 60,
          maxRange: 30,
          attackData: {},
          sourceName: "Archer",
          targetName: "Goblin",
        }}
        moveConfirmModal={{
          show: true,
          distanceFeet: 50,
          movementSpeed: 30,
          sourceName: "Rogue",
          moveData: { gridX: 4, gridY: 5, sourceTokenId: 1, token: {} },
        }}
        setShowMarkerDialog={vi.fn()}
        setPendingMarkerPos={vi.fn()}
        setMarkerLabelInput={vi.fn()}
        setSelectedMarkerId={vi.fn()}
        handleCreateMarker={vi.fn()}
        handleDeleteMarker={vi.fn()}
        handleRangeCancel={vi.fn()}
        handleRangeConfirm={handleRangeConfirm}
        handleMoveCancel={vi.fn()}
        handleMoveConfirm={handleMoveConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "强行攻击" }));
    fireEvent.click(screen.getByRole("button", { name: "强行移动" }));

    expect(handleRangeConfirm).toHaveBeenCalledTimes(1);
    expect(handleMoveConfirm).toHaveBeenCalledTimes(1);
  });
});
