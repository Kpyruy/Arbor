/** Independent numeric timer namespaces, as in separate browser windows. */
export function timerWindow() {
  let nextId = 1;
  const pending = new Map<number, () => void>();
  const win = {
    setTimeout(callback: () => void): number {
      const id = nextId++;
      pending.set(id, callback);
      return id;
    },
    clearTimeout(id: number): void { pending.delete(id); }
  } as unknown as Window;
  return {
    win,
    flush() { const jobs = [...pending.values()]; pending.clear(); jobs.forEach(job => job()); },
    pendingCount: () => pending.size
  };
}
