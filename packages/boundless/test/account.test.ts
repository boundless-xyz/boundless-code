import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readCredentials, writeCredentials } from "../src/credentials"
import { needsSignIn, signIn, signOut } from "../src/tui/account"

type Toast = { message: string; variant?: string }

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "boundless-"))
  process.env.XDG_CONFIG_HOME = dir
  process.env.BOUNDLESS_CONSOLE = "http://127.0.0.1:9"
})
afterEach(async () => {
  delete process.env.BOUNDLESS_CONSOLE
  await rm(dir, { recursive: true, force: true })
})

function harness(options: { connect?: () => Promise<unknown>; statuses?: string[]; open?: () => Promise<void> } = {}) {
  const toasts: Toast[] = []
  const opened: string[] = []
  const removed: string[] = []
  let refreshed = 0
  const statuses = [...(options.statuses ?? ["pending", "complete"])]
  const client = {
    integration: {
      oauth: {
        connect: () =>
          options.connect?.() ??
          Promise.resolve({ data: { attemptID: "a1", url: "https://console/authorize?x", mode: "auto", instructions: "" } }),
        status: () => {
          const status = statuses.shift() ?? "pending"
          return Promise.resolve({ data: status === "failed" ? { status, message: "denied" } : { status } })
        },
      },
    },
    credential: {
      list: () =>
        Promise.resolve([
          { id: "cred_1", integrationID: "boundless" },
          { id: "cred_2", integrationID: "anthropic" },
        ]),
      remove: ({ credentialID }: { credentialID: string }) => {
        removed.push(credentialID)
        return Promise.resolve()
      },
    },
  }
  const deps = {
    client: client as any,
    location: { directory: "/work" },
    toast: (toast: Toast) => toasts.push(toast),
    open: (url: string) => {
      opened.push(url)
      return options.open?.() ?? Promise.resolve()
    },
    refresh: async () => void refreshed++,
    wait: () => Promise.resolve(),
  }
  return { deps, toasts, opened, removed, refreshed: () => refreshed }
}

describe("signIn", () => {
  test("opens the approval URL, waits for completion and refreshes", async () => {
    const h = harness()
    await signIn(h.deps)
    expect(h.opened).toEqual(["https://console/authorize?x"])
    expect(h.refreshed()).toBe(1)
    expect(h.toasts.at(-1)?.variant).toBe("success")
  })

  test("a machine with no browser still shows the URL and completes", async () => {
    const h = harness({ open: () => Promise.reject(new Error("no browser")) })
    await signIn(h.deps)
    expect(h.toasts.some((toast) => toast.message.includes("https://console/authorize?x"))).toBe(true)
    expect(h.refreshed()).toBe(1)
  })

  test("a declined sign-in is reported", async () => {
    const h = harness({ statuses: ["pending", "failed"] })
    await signIn(h.deps)
    expect(h.refreshed()).toBe(0)
    expect(h.toasts.at(-1)?.variant).toBe("error")
  })

  test("an unavailable sign-in is reported, not raised", async () => {
    const h = harness({ connect: () => Promise.reject(new Error("Sign-in for Boundless Code is not enabled yet.")) })
    await signIn(h.deps)
    expect(h.toasts.at(-1)).toEqual({ message: "Boundless sign-in is unavailable right now. Try /signin later.", variant: "error" })
  })
})

describe("signOut", () => {
  test("forgets the key locally and removes only Boundless credentials", async () => {
    await writeCredentials({ baseUrl: "https://gw", key: "sk-1", name: "code-abc" })
    const h = harness()
    await signOut(h.deps)
    expect(await readCredentials()).toBeNull()
    expect(h.removed).toEqual(["cred_1"])
    expect(h.refreshed()).toBe(1)
  })
})

describe("needsSignIn", () => {
  test("only when the server offers Boundless and it has no connection", () => {
    expect(needsSignIn(undefined)).toBe(false)
    expect(needsSignIn([{ id: "anthropic", connections: [] }])).toBe(false)
    expect(needsSignIn([{ id: "boundless", connections: [{}] }])).toBe(false)
    expect(needsSignIn([{ id: "boundless", connections: [] }])).toBe(true)
  })
})
