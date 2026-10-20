import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client/promise"
import { Timeline } from "./projection"
import { userMessageRuns } from "./user-runs"

const user = (id: string, created: number) =>
  ({ id, type: "user", text: id, time: { created } }) satisfies SessionMessageInfo

const assistant = (id: string, parentID: string, created: number) =>
  ({
    id,
    type: "assistant",
    agent: "build",
    model: { id: "model", providerID: "provider" },
    metadata: { parentID },
    content: [{ type: "text", text: "answer" }],
    time: { created, completed: created + 1 },
  }) satisfies SessionMessageInfo

function runs(messages: SessionMessageInfo[], pending: string[] = []) {
  const waiting = new Set(pending)
  const rows = Timeline.constructSessionMessageRows(messages, true, { type: "busy" }, waiting).rows

  return Object.fromEntries(userMessageRuns(rows, (id) => (waiting.has(id) ? "pending" : "sent")))
}

describe("userMessageRuns", () => {
  test("joins consecutive sent messages into one run", () => {
    expect(runs([user("msg_1", 1), user("msg_2", 2), user("msg_3", 3)])).toEqual({
      msg_1: { above: false, below: true },
      msg_2: { above: true, below: true },
      msg_3: { above: true, below: false },
    })
  })

  test("assistant output between two messages ends the run", () => {
    expect(runs([user("msg_1", 1), assistant("msg_2", "msg_1", 2), user("msg_3", 3), user("msg_4", 4)])).toEqual({
      msg_1: { above: false, below: false },
      msg_3: { above: false, below: true },
      msg_4: { above: true, below: false },
    })
  })

  test("pending input never joins a sent message or another pending one", () => {
    expect(runs([user("msg_1", 1), user("msg_2", 2), user("msg_3", 3), user("msg_4", 4)], ["msg_3", "msg_4"])).toEqual({
      msg_1: { above: false, below: true },
      msg_2: { above: true, below: false },
      msg_3: { above: false, below: false },
      msg_4: { above: false, below: false },
    })
  })

  test("a lone message stands alone", () => {
    expect(runs([user("msg_1", 1), assistant("msg_2", "msg_1", 2)])).toEqual({
      msg_1: { above: false, below: false },
    })
  })
})
