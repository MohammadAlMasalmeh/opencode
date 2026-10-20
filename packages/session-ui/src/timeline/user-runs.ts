import { Predicate } from "effect"
import type { TimelineRow } from "./timeline-row"

/** A user message's place in a run of consecutive user messages: joined to the one above, below, or both. */
export type UserRun = { above: boolean; below: boolean }

/** Layout moves in a run settle on Kit's calm spring: .4 s, bounce 0. */
export const userRunSpring = { omega: (2 * Math.PI) / 0.4, zeta: 1 }

/**
 * Like the iOS app's grouped corners, consecutive user messages with nothing but turn gaps between them read as
 * one block under a single meta line. Only sent messages join; input still waiting for delivery stands alone.
 */
export function userMessageRuns(
  rows: readonly TimelineRow.TimelineRow[],
  kind: (messageID: string) => "sent" | "pending",
) {
  const members = rows.filter((row) => !Predicate.isTagged(row, "TurnGap"))

  const joins = (above: TimelineRow.TimelineRow | undefined, below: TimelineRow.TimelineRow | undefined) =>
    Predicate.isTagged(above, "UserMessage") &&
    Predicate.isTagged(below, "UserMessage") &&
    kind(above.userMessageID) === "sent" &&
    kind(below.userMessageID) === "sent"

  return new Map(
    members.flatMap((row, index) =>
      Predicate.isTagged(row, "UserMessage")
        ? [
            [
              row.userMessageID,
              { above: joins(members[index - 1], row), below: joins(row, members[index + 1]) } satisfies UserRun,
            ] as const,
          ]
        : [],
    ),
  )
}
