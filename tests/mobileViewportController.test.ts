import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { ingestionHarness, loadIngestionView } from "./helpers/ingestionHarness";
import type { ViewShell } from "../src/view/chrome/ViewShell";
import { MobileViewportController } from "../src/view/chrome/MobileViewportController";

beforeAll(loadIngestionView);
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("mobile pane geometry", () => {
  it("never forces a 120px frame into a keyboard-compressed 20px pane", async () => {
    const f = await ingestionHarness();
    Object.defineProperty(f.root, "clientWidth", { value: 375 });
    vi.spyOn(f.root, "getBoundingClientRect").mockReturnValue(new f.win.DOMRect(0, 80, 375, 820));
    Object.defineProperty(f.win, "visualViewport", { configurable: true, value: { height: 100, offsetTop: 0 } });
    const shell = (f.view as unknown as { shell: ViewShell }).shell;
    shell.handleMobileResize();
    await new Promise(resolve => f.win.requestAnimationFrame(resolve));
    const height = Number.parseFloat(f.root.style.getPropertyValue("--arbor-mobile-height"));
    expect(height).toBeLessThanOrEqual(20);
    f.view.teardownShell();
  });

  it("restores height on viewport scroll and ignores hidden or other-pane toolbar bounds", async () => {
    const f = await ingestionHarness();
    Object.defineProperty(f.root, "clientWidth", { value: 375 });
    vi.spyOn(f.root, "getBoundingClientRect").mockReturnValue(new f.win.DOMRect(500, 80, 375, 820));
    const viewport = Object.assign(new f.win.EventTarget(), { height: 500, width: 1000, offsetTop: 0, offsetLeft: 0 });
    Object.defineProperty(f.win, "visualViewport", { configurable: true, value: viewport });
    const bar = f.win.document.body.createDiv({ cls: "mobile-toolbar" });
    bar.setCssStyles({ opacity: "0" });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(new f.win.DOMRect(0, 400, 1000, 50));
    const shell = (f.view as unknown as { shell: ViewShell }).shell;
    const resize = new MobileViewportController(f.root, () => shell.handleMobileResize());
    const frame = () => new Promise(resolve => f.win.requestAnimationFrame(resolve));
    await frame();
    expect(f.root.style.getPropertyValue("--arbor-mobile-height")).toBe("420px");
    viewport.height = 900;
    viewport.dispatchEvent(new f.win.Event("scroll"));
    await frame();
    expect(f.root.style.getPropertyValue("--arbor-mobile-height")).toBe("820px");
    bar.setCssStyles({ opacity: "1" });
    vi.spyOn(bar, "getBoundingClientRect").mockReturnValue(new f.win.DOMRect(0, 400, 400, 50));
    viewport.dispatchEvent(new f.win.Event("resize"));
    await frame();
    expect(f.root.style.getPropertyValue("--arbor-mobile-height")).toBe("820px");
    resize.dispose();
    viewport.height = 300;
    viewport.dispatchEvent(new f.win.Event("scroll"));
    await frame();
    expect(f.root.style.getPropertyValue("--arbor-mobile-height")).toBe("820px");
    f.view.teardownShell();
  });
});
