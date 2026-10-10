import { describe, expect, it } from "vitest"
import { recentNotifications } from "./notification-bell-model"

const ME = "ab12"
const note = (id: number, date: number, over: Record<string, unknown> = {}) => ({
  id,
  messageType: { tag: "Notification" },
  metadata: JSON.stringify({ recipient: ME }),
  body: `New comment ${id}`,
  date,
  model: "lead",
  resId: 3,
  ...over,
})

describe("recentNotifications", () => {
  it("keeps only my notifications, newest first", () => {
    const rows = [
      note(1, 1000),
      note(2, 3000),
      note(3, 2000, { metadata: JSON.stringify({ recipient: "ffff" }) }),
      note(4, 4000, { messageType: { tag: "Comment" } }),
      note(5, 2000, { metadata: null }),
      note(6, 5000, { metadata: JSON.stringify({ recipient: ME, read_at: 1234 }) }),
    ]
    expect(recentNotifications(rows, ME).map((n) => n.id)).toEqual(["2", "1"])
    expect(recentNotifications(rows, "0xAB12").length).toBe(2)
    expect(recentNotifications(rows, null)).toEqual([])
  })

  it("keeps a notification unread when read_at is absent or null", () => {
    const rows = [
      note(1, 1000, { metadata: JSON.stringify({ recipient: ME, read_at: null }) }),
      note(2, 2000, { metadata: JSON.stringify({ recipient: ME, read_at: 0 }) }),
    ]
    expect(recentNotifications(rows, ME).map((n) => n.id)).toEqual(["1"])
  })

  it("caps at ten and strips markup", () => {
    const rows = Array.from({ length: 14 }, (_, i) => note(i + 1, (i + 1) * 1000, { body: "<b>Hi</b>  there" }))
    const out = recentNotifications(rows, ME)
    expect(out).toHaveLength(10)
    expect(out[0].id).toBe("14")
    expect(out[0].title).toBe("Hi there")
  })

  it("accepts string tags and timestamp objects", () => {
    const rows = [note(1, 0, { messageType: "notification", date: { microsSinceUnixEpoch: 5000n } })]
    expect(recentNotifications(rows, ME)[0].dateMs).toBe(5)
  })
})
