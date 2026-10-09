import { describe, expect, it } from "vitest";
import { runAsyncAction } from "../src/view/runtime/asyncActions";
import { deferred } from "./helpers/arborFixtures";

describe("fire-and-forget action boundary", () => {
  it("reports the genuine rejection once without changing an awaited caller's error", async () => {
    const operation = deferred<void>();
    const reported: unknown[] = [];
    const failure = Error("disk full");
    runAsyncAction(operation.promise, error => reported.push(error));
    const rejection = expect(operation.promise).rejects.toBe(failure);
    operation.reject(failure);
    await rejection;
    expect(reported).toEqual([failure]);
  });
  it("does not report an error for successful or synchronous void actions", async () => {
    const reported: unknown[] = [];
    runAsyncAction(Promise.resolve(), error => reported.push(error));
    runAsyncAction(undefined, error => reported.push(error));
    await Promise.resolve();
    expect(reported).toEqual([]);
  });
});
