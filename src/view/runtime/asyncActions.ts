export function runAsyncAction(
  action: Promise<unknown> | void,
  reportError: (error: unknown) => void = error => console.error("[Arbor] Action failed", error)
): void {
  void Promise.resolve(action).catch(reportError);
}
