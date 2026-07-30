const ORIGINAL_SET_VIEW_STATE = Symbol.for("arbor.original-set-view-state");

type SetViewStateFunction = (...args: never[]) => unknown;

export function captureOriginalSetViewState<T extends SetViewStateFunction>(prototype: { setViewState: T }): T {
  const storage = prototype as { [ORIGINAL_SET_VIEW_STATE]?: unknown };
  const stored = storage[ORIGINAL_SET_VIEW_STATE];
  if (typeof stored === "function") {
    return stored as T;
  }

  const original = prototype.setViewState;
  Object.defineProperty(prototype, ORIGINAL_SET_VIEW_STATE, {
    value: original,
    configurable: false
  });
  return original;
}

export async function invokeOriginalSetViewState<TLeaf extends object, TState>(
  setter: (this: TLeaf, state: TState, ...args: never[]) => unknown,
  leaf: TLeaf,
  state: TState
): Promise<void> {
  await Reflect.apply(setter, leaf, [state]);
}
