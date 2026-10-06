import { describe, expect, test } from "bun:test"
import { signIn } from "../src/tui/account"

type Toast = { message: string; variant?: string }

function fakeApi(options: { authorize?: () => Promise<unknown>; callback?: () => Promise<unknown> }) {
  const toasts: Toast[] = []
  const calls: string[] = []
  return {
    toasts,
    calls,
    api: {
      client: {
        provider: {
          oauth: {
            authorize: () => {
              calls.push("authorize")
              return options.authorize?.() ?? Promise.resolve({ data: { url: "https://console/authorize?x" } })
            },
            callback: () => {
              calls.push("callback")
              return options.callback?.() ?? Promise.resolve({ data: true })
            },
          },
        },
      },
      ui: { toast: (toast: Toast) => toasts.push(toast) },
    },
  }
}

describe("signIn", () => {
  test("opens the approval URL, waits for the callback and refreshes", async () => {
    const opened: string[] = []
    let refreshed = 0
    const { api, calls } = fakeApi({})
    await signIn(api as any, { open: (url) => opened.push(url), refresh: async () => void refreshed++ })
    expect(opened).toEqual(["https://console/authorize?x"])
    expect(calls).toEqual(["authorize", "callback"])
    expect(refreshed).toBe(1)
  })

  test("an unavailable sign-in shows an error and never polls", async () => {
    const { api, calls, toasts } = fakeApi({ authorize: () => Promise.resolve({ error: { message: "nope" } }) })
    await signIn(api as any, { open: () => {}, refresh: async () => {} })
    expect(calls).toEqual(["authorize"])
    expect(toasts.at(-1)?.variant).toBe("error")
  })

  test("a thrown network error is reported, not raised", async () => {
    const { api, toasts } = fakeApi({ authorize: () => Promise.reject(new Error("offline")) })
    await signIn(api as any, { open: () => {}, refresh: async () => {} })
    expect(toasts.at(-1)?.variant).toBe("error")
  })

  test("a declined sign-in in the browser is reported", async () => {
    const { api, toasts } = fakeApi({ callback: () => Promise.resolve({ error: { message: "failed" } }) })
    await signIn(api as any, { open: () => {}, refresh: async () => {} })
    expect(toasts.at(-1)?.variant).toBe("error")
  })

  test("a machine with no browser still shows the URL and completes sign-in", async () => {
    let refreshed = 0
    const { api, calls, toasts } = fakeApi({})
    await signIn(api as any, {
      open: () => {
        throw new Error("spawn xdg-open ENOENT")
      },
      refresh: async () => void refreshed++,
    })
    expect(toasts.some((toast) => toast.message.includes("https://console/authorize?x"))).toBe(true)
    expect(calls).toEqual(["authorize", "callback"])
    expect(refreshed).toBe(1)
  })
})
