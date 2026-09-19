import type { ArborOutputState, BranchTreeMetadata } from "../../src/types";

export function fixtureTree(): BranchTreeMetadata {
  return {
    version: 1,
    prefix: "",
    blocks: [
      { id: "root", parentId: null, order: 0, content: "Root", after: "\n\n" },
      { id: "first", parentId: "root", order: 0, content: "First", after: "\n\n" },
      { id: "second", parentId: "root", order: 1, content: "Second", after: "\n\n" },
      { id: "leaf", parentId: "first", order: 0, content: "Leaf", after: "" }
    ]
  };
}

export function fixtureOutput(active = "draft"): ArborOutputState {
  return {
    version: 1,
    activeProfileId: active,
    profiles: [{
      id: "draft",
      name: "Draft",
      rules: [{ blockId: "root", state: "exclude" }]
    }]
  };
}

export function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
