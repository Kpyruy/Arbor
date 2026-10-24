import { describe, expect, it } from "vitest";
import { TouchColumnViewport } from "../src/view/branch/TouchColumnViewport";

function column(count = 3) {
  let height = 500;
  let topPadding = 0;
  let bottomPadding = 0;
  const writes: ScrollToOptions[] = [];
  const events = new EventTarget();
  const children = Array.from({ length: count }, (_, index) => ({
    offsetHeight: 100, isConnected: true,
    getBoundingClientRect: (): { top: number } => ({ top: 100 + topPadding + children.slice(0, index).reduce((sum, card) => sum + card.offsetHeight + 20, 0) - list.scrollTop })
  }));
  const list = {
    isConnected: true, scrollTop: 0,
    get clientHeight() { return height; },
    get scrollHeight() { return topPadding + children.reduce((sum, card) => sum + card.offsetHeight, 0) + (count - 1) * 20 + bottomPadding; },
    firstElementChild: children[0], lastElementChild: children[count - 1],
    contains: (child: unknown) => children.includes(child as typeof children[number]),
    getBoundingClientRect: () => ({ top: 100 }),
    win: { matchMedia: () => ({ matches: false }) },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
    dispatchEvent: events.dispatchEvent.bind(events),
    setCssProps(values: Record<string, string>) {
      topPadding = parseFloat(values["--arbor-touch-list-top"]);
      bottomPadding = parseFloat(values["--arbor-touch-list-bottom"]);
    },
    scrollTo(options: ScrollToOptions) { this.scrollTop = options.top ?? this.scrollTop; writes.push(options); }
  };
  const controller = new TouchColumnViewport();
  const align = (index: number, instant = false, force = false) => controller.align(list as unknown as HTMLElement, children[index] as unknown as HTMLElement, instant, force);
  return { list, children, writes, controller, align, resize: (value: number) => { height = value; } };
}

describe("native tablet column alignment", () => {
  it("centers a middle sibling through native scroll with reachable first and last edges", () => {
    const f = column();
    f.align(1);
    expect(f.list.scrollTop).toBe(120);
    expect(f.list.scrollHeight - f.list.clientHeight).toBe(240);
    expect(f.children[1].getBoundingClientRect().top).toBe(270);
    f.list.scrollTop = 0;
    expect(f.children[0].getBoundingClientRect().top).toBe(270);
    f.list.scrollTop = 240;
    expect(f.children[2].getBoundingClientRect().top).toBe(270);
  });
  it("animates explicit selection but does not undo manual scrolling during a same-selection render", () => {
    const f = column();
    f.align(0); f.align(2);
    expect(f.writes.at(-1)?.behavior).toBe("smooth");
    f.list.scrollTop = 60;
    const writes = f.writes.length;
    f.align(2);
    expect(f.list.scrollTop).toBe(60);
    expect(f.writes).toHaveLength(writes);
  });
  it("preserves the visible anchor when keyboard geometry changes", () => {
    const f = column(); f.align(1); f.list.scrollTop = 60;
    expect(f.children[1].getBoundingClientRect().top).toBe(330);
    f.resize(400); f.controller.refresh();
    expect(f.list.scrollTop).toBe(16);
    expect(f.children[1].getBoundingClientRect().top).toBe(330);
  });
  it("does not invent a blank scrolling range for a single short parent", () => {
    const f = column(1); f.align(0);
    expect(f.list.scrollHeight).toBe(500);
    expect(f.list.scrollTop).toBe(0);
    f.controller.pause(true); f.resize(400); f.controller.refresh();
    expect(f.list.scrollHeight).toBe(500);
    f.controller.pause(false);
    expect(f.list.scrollHeight).toBe(400);
  });
  it("retains manual pan when content before the selection changes size", () => {
    const f = column(); f.align(2);
    const touch = new Event("touchstart"); Object.defineProperty(touch, "touches", { value: [{}] });
    f.list.dispatchEvent(touch); f.list.scrollTop = 60;
    expect(f.children[2].getBoundingClientRect().top).toBe(450);
    f.children[0].offsetHeight = 200;
    f.list.scrollTop = 160; // Native scroll anchoring follows the preceding image growth.
    f.align(2);
    expect(f.list.scrollTop).toBe(110);
    expect(f.children[2].getBoundingClientRect().top).toBe(450);
  });
  it("lets an explicit same-block reveal regain the column camera after manual pan", () => {
    const f = column(); f.align(2);
    const touch = new Event("touchstart"); Object.defineProperty(touch, "touches", { value: [{}] });
    f.list.dispatchEvent(touch); f.list.scrollTop = 60;
    f.align(2, false, true);
    expect(f.list.scrollTop).toBe(240);
    expect(f.writes.at(-1)?.behavior).toBe("smooth");
  });
});
