import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/svelte";
import Caption from "../src/components/Caption.svelte";

const frame = (el) => { el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 600, right: 300, bottom: 600 }); };

describe("Caption", () => {
  it("renders the text with the style's custom properties; nothing without text", () => {
    const { container, unmount } = render(Caption, { text: "Kaya toast", style: { x: 0.2, y: 0.5, font: "script", bg: "dark" } });
    const cap = container.querySelector(".cap");
    expect(cap).toHaveTextContent("Kaya toast");
    const style = cap.getAttribute("style").replace(/\s/g, "");
    expect(style).toContain("--cap-x:20.00%"); expect(style).toContain("Caveat"); expect(style).toContain("--cap-bg:rgba(8,9,12,0.66)");
    expect(cap.getAttribute("role")).toBeNull();
    unmount();
    const { container: c2 } = render(Caption, { text: "" });
    expect(c2.querySelector(".cap")).toBeNull();
  });
  it("editable: dragging moves the caption in fractions of the frame, clamped, and commits on release", async () => {
    const onMove = vi.fn(), onCommit = vi.fn();
    const { container } = render(Caption, { text: "Hi", style: { x: 0.5, y: 0.5 }, editable: true, onMove, onCommit });
    frame(container.querySelector(".cap-layer"));
    const cap = container.querySelector(".cap");
    expect(cap.getAttribute("role")).toBe("button");
    await fireEvent.pointerDown(cap, { clientX: 150, clientY: 300, pointerId: 1 });
    await fireEvent.pointerMove(cap, { clientX: 210, clientY: 360, pointerId: 1 });   // +60px of 300 -> +0.2; +60px of 600 -> +0.1
    expect(onMove).toHaveBeenLastCalledWith(0.7, 0.6);
    await fireEvent.pointerMove(cap, { clientX: 2000, clientY: -500, pointerId: 1 });
    expect(onMove).toHaveBeenLastCalledWith(0.94, 0.12);   // clamped to the frame's safe area
    expect(onCommit).not.toHaveBeenCalled();
    await fireEvent.pointerUp(cap, { clientX: 2000, clientY: -500, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
  it("editable: arrow keys nudge by 1% (5% with shift) and commit", async () => {
    const onMove = vi.fn(), onCommit = vi.fn();
    const { container } = render(Caption, { text: "Hi", style: { x: 0.5, y: 0.5 }, editable: true, onMove, onCommit });
    const cap = container.querySelector(".cap");
    await fireEvent.keyDown(cap, { key: "ArrowRight" });
    expect(onMove).toHaveBeenLastCalledWith(0.51, 0.5);
    await fireEvent.keyDown(cap, { key: "ArrowUp", shiftKey: true });
    expect(onMove).toHaveBeenLastCalledWith(0.5, 0.45);
    expect(onCommit).toHaveBeenCalledTimes(2);
  });
  it("not editable: no drag handling, no button role", async () => {
    const onMove = vi.fn();
    const { container } = render(Caption, { text: "Hi", onMove });
    const cap = container.querySelector(".cap");
    await fireEvent.pointerDown(cap, { clientX: 10, clientY: 10, pointerId: 1 }); await fireEvent.pointerMove(cap, { clientX: 50, clientY: 50, pointerId: 1 });
    expect(onMove).not.toHaveBeenCalled(); expect(cap.getAttribute("tabindex")).toBeNull();
  });
});
