import { afterEach, expect, it, vi } from "vitest";
import { ViewWorkScope } from "../src/view/runtime/ViewWorkScope";

type ControlledFrameScheduler = {
  window: Window;
  requestCount(): number;
  cancelledIds(): number[];
  run(id: number, time?: number): void;
};

function createControlledFrameScheduler(): ControlledFrameScheduler {
  let nextId = 1;
  const frames = new Map<number, FrameRequestCallback>();
  const cancelled: number[] = [];
  const scheduler = {
    requestAnimationFrame(callback: FrameRequestCallback): number {
      const id = nextId++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame(id: number): void {
      cancelled.push(id);
      frames.delete(id);
    }
  };

  return {
    window: scheduler as Window,
    requestCount: () => nextId - 1,
    cancelledIds: () => cancelled,
    run(id, time = 0) {
      const callback = frames.get(id);
      frames.delete(id);
      callback?.(time);
    }
  };
}

afterEach(() => vi.useRealTimers());

it("invalidates old work while allowing a new document generation", async () => {
  vi.useFakeTimers();
  const scope = new ViewWorkScope();
  const first = scope.token();
  const called = vi.fn();

  scope.timeout(called, 80);
  scope.reset();

  expect(scope.isCurrent(first)).toBe(false);
  await vi.advanceTimersByTimeAsync(80);
  expect(called).not.toHaveBeenCalled();

  const next = scope.token();
  expect(scope.isCurrent(next)).toBe(true);
  scope.dispose();
  expect(scope.isCurrent(next)).toBe(false);
});

it("cancels a scheduled animation frame through its supplied Window scheduler", () => {
  const scheduler = createControlledFrameScheduler();
  const scope = new ViewWorkScope();
  const callback = vi.fn();

  scope.frame(scheduler.window, callback);
  scope.reset();

  expect(scheduler.cancelledIds()).toEqual([1]);
  scheduler.run(1, 42);
  expect(callback).not.toHaveBeenCalled();
});

it("runs each registered cleanup at most once when cancelled repeatedly", () => {
  const scope = new ViewWorkScope();
  const cleanup = vi.fn();
  const cancel = scope.register(cleanup);

  cancel();
  cancel();
  scope.reset();

  expect(cleanup).toHaveBeenCalledTimes(1);
});

it("can be reset and reused for a new timeout generation", async () => {
  vi.useFakeTimers();
  const scope = new ViewWorkScope();
  const first = vi.fn();
  const second = vi.fn();

  scope.timeout(first, 20);
  scope.reset();
  scope.timeout(second, 20);
  await vi.advanceTimersByTimeAsync(20);

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledTimes(1);
});

it("is terminal after dispose and does not schedule further work", async () => {
  vi.useFakeTimers();
  const scheduler = createControlledFrameScheduler();
  const scope = new ViewWorkScope();
  const callback = vi.fn();

  scope.dispose();
  scope.timeout(callback, 20);
  scope.frame(scheduler.window, callback);
  scope.reset();
  await vi.advanceTimersByTimeAsync(20);

  expect(scheduler.requestCount()).toBe(0);
  expect(callback).not.toHaveBeenCalled();
  expect(scope.isCurrent(scope.token())).toBe(false);
});

it("keeps independent scopes from cancelling each other's work", () => {
  const scheduler = createControlledFrameScheduler();
  const firstScope = new ViewWorkScope();
  const secondScope = new ViewWorkScope();
  const first = vi.fn();
  const second = vi.fn();

  firstScope.frame(scheduler.window, first);
  secondScope.frame(scheduler.window, second);
  firstScope.reset();
  scheduler.run(2, 99);

  expect(first).not.toHaveBeenCalled();
  expect(second).toHaveBeenCalledWith(99);
  expect(secondScope.isCurrent(secondScope.token())).toBe(true);
});
