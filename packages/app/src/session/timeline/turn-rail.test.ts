import { describe, expect, test } from "bun:test"
import { railHit } from "./turn-rail"

describe("railHit", () => {
  // Four 10px ticks: centres at 5, 15, 25 and 35.
  test.each([
    [-40, 0, 0],
    [0, 0, 0],
    [5, 0, 0],
    [9, 0, 0.4],
    [11, 1, 0.6],
    [25, 2, 2],
    [34, 3, 2.9],
    [40, 3, 3],
    [400, 3, 3],
  ])("offset %p hits tick %p at position %p", (offset, index, position) => {
    const hit = railHit(offset, 40, 4)

    expect(hit.index).toBe(index)
    expect(hit.position).toBeCloseTo(position)
  })
})
