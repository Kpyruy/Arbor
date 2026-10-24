interface AnchorRect { left: number; top: number; width: number; height: number }
export function anchorCompensation(before: AnchorRect, after: AnchorRect, fraction: { x: number; y: number }, midpointDelta: { x: number; y: number }): { left: number; top: number } {
  return {
    left: after.left + fraction.x * after.width - before.left - fraction.x * before.width - midpointDelta.x,
    top: after.top + fraction.y * after.height - before.top - fraction.y * before.height - midpointDelta.y
  };
}
