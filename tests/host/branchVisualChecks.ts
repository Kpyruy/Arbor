interface BranchTransitionFixture {
  root: HTMLElement;
  rootIds: readonly [string, string];
  select(id: string): void;
  settle(): Promise<void>;
}

/** Run against a real Branch Editor forest with uneven descendant columns. */
export async function checkBranchParentTransitionHost(input: BranchTransitionFixture): Promise<number> {
  let checks = 0;
  const check = (condition: unknown, message: string) => {
    if (!condition) throw Error(message);
    checks += 1;
  };
  const column = () => input.root.querySelector<HTMLElement>('.arbor-column[data-column-depth="0"]')!;
  const scene = () => input.root.querySelector<HTMLElement>(".arbor-columns")!;
  input.select(input.rootIds[0]);
  await input.settle();
  const baseline = column().offsetTop;
  const initialHeight = scene().offsetHeight;
  for (const id of [input.rootIds[1], input.rootIds[0]]) {
    input.select(id);
    await input.settle();
    check(input.root.querySelector<HTMLElement>(".arbor-card.is-active")?.dataset.blockId === id, "Selection must actually publish before checking motion");
    if (id === input.rootIds[1]) check(Math.abs(scene().offsetHeight - initialHeight) > 100, "Fixture must exercise a real change in descendant scene height");
    check(Math.abs(column().offsetTop - baseline) < 2, "Root column must not jump when a differently sized descendant branch appears or disappears");
    const card = input.root.querySelector<HTMLElement>(".arbor-card.is-active")!;
    const bounds = card.getBoundingClientRect();
    const viewport = input.root.querySelector<HTMLElement>(".arbor-columns-viewport")!.getBoundingClientRect();
    check(bounds.top >= viewport.top && bounds.bottom <= viewport.bottom, "Selected root must remain inside the viewport after its smooth transition");
  }
  return checks;
}

/** Screen-space geometry, not CSS source text: the scroller should hug the edge. */
export function checkBranchScrollbarHost(card: HTMLElement): number {
  const content = card.querySelector<HTMLElement>(".arbor-card-content")!;
  if (content.scrollHeight <= content.clientHeight) throw Error("Fixture must have actual vertical overflow");
  const style = getComputedStyle(card);
  const rtl = getComputedStyle(content).direction === "rtl";
  const gap = rtl
    ? content.getBoundingClientRect().left - card.getBoundingClientRect().left
    : card.getBoundingClientRect().right - content.getBoundingClientRect().right;
  const padding = parseFloat(rtl ? style.paddingLeft : style.paddingRight);
  if (gap > padding * 0.65) throw Error("Active content scrollbar must sit nearer the card edge than its text inset");
  if (gap < 2) throw Error("Scrollbar must retain a small gap from the card border");
  return 3;
}
