/**
 * The tick nearest a pointer `offset` px down a rail of `count` evenly spaced ticks `height` px tall, and the pointer's
 * position in tick units (0 is the first tick's centre). Offsets beyond either end clamp to that end's tick.
 */
export function railHit(offset: number, height: number, count: number) {
  const position = Math.min(count - 1, Math.max(0, (offset / height) * count - 0.5))

  return { index: Math.round(position), position }
}
