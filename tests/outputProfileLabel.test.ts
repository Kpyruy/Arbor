import { afterEach, describe, expect, it, vi } from "vitest";
import { OutputProfileLabel } from "../src/view/chrome/OutputProfileLabel";

afterEach(() => vi.unstubAllGlobals());

function labelHost(direction = "ltr", width = 260) {
  const handlers = new Map<string, () => void>();
  const classes = new Set<string>();
  const cancel = vi.fn();
  const animate = vi.fn(() => ({ cancel }));
  const disconnect = vi.fn();
  let refresh: () => void = () => undefined;
  const motion = { matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
  const text = {
    textContent: "Acceptance — a long profile name",
    setText(value: string) { this.textContent = value; },
    getBoundingClientRect: () => ({ width }), animate
  };
  const label = {
    clientWidth: 80,
    createSpan: () => text,
    addClass: (name: string) => classes.add(name),
    removeClass: (name: string) => classes.delete(name)
  };
  const button = {
    textContent: text.textContent, isConnected: true, empty: () => undefined, createSpan: () => label,
    ownerDocument: { defaultView: { matchMedia: () => motion, getComputedStyle: () => ({ direction }) } },
    addEventListener: (name: string, callback: () => void) => handlers.set(name, callback),
    removeEventListener: (name: string) => handlers.delete(name)
  };
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: () => void) { refresh = callback; }
    observe() {}
    disconnect = disconnect;
  });
  const controller = new OutputProfileLabel(button as unknown as HTMLButtonElement);
  return { controller, button, text, label, motion, animate, cancel, disconnect, classes, handlers, refresh: () => refresh() };
}

describe("bounded output profile label", () => {
  it.each(["ltr", "rtl"])("moves forward and back in %s, then resets on leave", direction => {
    const host = labelHost(direction);
    expect(host.animate).not.toHaveBeenCalled();
    host.handlers.get("mouseenter")!();
    expect(host.classes.has("is-marquee")).toBe(true);
    const [frames, timing] = host.animate.mock.calls[0] as unknown as [Keyframe[], KeyframeAnimationOptions];
    expect(frames[2].transform).toBe(direction === "rtl" ? "translateX(180px)" : "translateX(-180px)");
    expect(frames[4].transform).toBe("translateX(0)");
    expect(timing.duration).toBeGreaterThanOrEqual(6000);
    host.handlers.get("mouseleave")!();
    expect(host.cancel).toHaveBeenCalledOnce();
    expect(host.classes.has("is-marquee")).toBe(false);
    host.controller.dispose();
  });

  it("does not animate a fitting label or reduced-motion label", () => {
    const short = labelHost("ltr", 50);
    short.handlers.get("mouseenter")!();
    expect(short.animate).not.toHaveBeenCalled();
    short.controller.dispose();
    const reduced = labelHost();
    reduced.motion.matches = true;
    reduced.handlers.get("mouseenter")!();
    expect(reduced.animate).not.toHaveBeenCalled();
    reduced.controller.dispose();
  });

  it("cancels stale animation on rename, resize, motion preference change and shell close", () => {
    const host = labelHost();
    host.handlers.get("mouseenter")!();
    host.controller.setText("A different long name");
    expect(host.text.textContent).toBe("A different long name");
    expect(host.cancel).toHaveBeenCalledOnce();
    host.refresh();
    expect(host.cancel).toHaveBeenCalledTimes(2);
    host.motion.matches = true;
    host.refresh();
    expect(host.cancel).toHaveBeenCalledTimes(3);
    host.controller.dispose();
    expect(host.disconnect).toHaveBeenCalledOnce();
    expect(host.handlers.size).toBe(0);
    expect(host.motion.removeEventListener).toHaveBeenCalledOnce();
    host.refresh();
    expect(host.animate).toHaveBeenCalledTimes(3);
  });
});
