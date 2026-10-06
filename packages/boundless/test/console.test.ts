import { afterEach, describe, expect, test } from "bun:test"
import {
  ConsoleError,
  discover,
  exchangeKey,
  readAccount,
  revokeOwnKey,
  startDeviceGrant,
  waitForAccessToken,
} from "../src/console"

let server: ReturnType<typeof Bun.serve> | undefined
afterEach(() => {
  server?.stop(true)
  delete process.env.BOUNDLESS_CONSOLE
})

function fake(handler: (request: Request, url: URL) => Response | Promise<Response>) {
  server = Bun.serve({ port: 0, fetch: (request) => handler(request, new URL(request.url)) })
  process.env.BOUNDLESS_CONSOLE = server.url.origin
  return server.url.origin
}

const json = (body: unknown, status = 200) => Response.json(body, { status })

describe("discover", () => {
  test("reads the code client, issuer and gateway", async () => {
    fake(() => json({ clientId: "wizard", codeClientId: "code", gatewayUrl: "https://gw", issuer: "https://issuer" }))
    expect(await discover()).toEqual({ codeClientId: "code", gatewayUrl: "https://gw", issuer: "https://issuer" })
  })

  test("refuses when the console has no code client", async () => {
    fake(() => json({ clientId: "wizard", codeClientId: null, gatewayUrl: "https://gw", issuer: "https://issuer" }))
    await expect(discover()).rejects.toMatchObject({ code: "code_signin_unavailable" })
  })
})

describe("device grant", () => {
  test("starts, polls through pending and slow_down, and returns the token", async () => {
    let polls = 0
    const origin = fake(async (request, url) => {
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        return json({ device_authorization_endpoint: `${url.origin}/device`, token_endpoint: `${url.origin}/token` })
      }
      if (url.pathname === "/device") {
        expect((await request.formData()).get("client_id")).toBe("code")
        return json({ device_code: "dc", user_code: "ABCD-EFGH", verification_uri: `${url.origin}/verify`, interval: 0 })
      }
      polls++
      if (polls === 1) return json({ error: "authorization_pending" }, 400)
      return json({ access_token: "at" })
    })
    const d = { codeClientId: "code", gatewayUrl: "https://gw", issuer: origin }
    const grant = await startDeviceGrant(d)
    expect(grant.userCode).toBe("ABCD-EFGH")
    expect(grant.approvalUrl).toStartWith(`${origin}/authorize?`)
    expect(await waitForAccessToken(d, { ...grant, interval: 0 })).toBe("at")
  })

  test("a declined sign-in is access_denied", async () => {
    const origin = fake(() => json({ error: "access_denied" }, 400))
    const d = { codeClientId: "code", gatewayUrl: "https://gw", issuer: origin }
    const grant = { approvalUrl: "", deviceCode: "dc", expiresAt: Date.now() + 10_000, interval: 0, tokenEndpoint: `${origin}/token`, userCode: "X" }
    await expect(waitForAccessToken(d, grant)).rejects.toMatchObject({ code: "access_denied" })
  })

  test("an expired grant is expired", async () => {
    const origin = fake(() => json({ error: "authorization_pending" }, 400))
    const d = { codeClientId: "code", gatewayUrl: "https://gw", issuer: origin }
    const grant = { approvalUrl: "", deviceCode: "dc", expiresAt: Date.now() - 1, interval: 0, tokenEndpoint: `${origin}/token`, userCode: "X" }
    await expect(waitForAccessToken(d, grant)).rejects.toBeInstanceOf(ConsoleError)
  })
})

describe("key and account", () => {
  test("exchanges the access token for a key", async () => {
    fake((request) => {
      expect(request.headers.get("authorization")).toBe("Bearer at")
      return json({ baseUrl: "https://gw", id: "id", key: "sk-1", name: "code-abc" })
    })
    expect(await exchangeKey("at")).toEqual({ baseUrl: "https://gw", key: "sk-1", name: "code-abc" })
  })

  test("me() returns the balance, and null on 401", async () => {
    fake((request) =>
      request.headers.get("authorization") === "Bearer sk-1" ? json({ balance: 4.125 }) : json({ error: "unauthorized" }, 401),
    )
    expect(await readAccount("sk-1")).toEqual({ balance: 4.125 })
    expect(await readAccount("sk-revoked")).toBeNull()
  })

  test("revokeOwnKey sends DELETE /api/me/key", async () => {
    let seen = ""
    fake((request, url) => {
      seen = `${request.method} ${url.pathname}`
      return new Response(null, { status: 204 })
    })
    await revokeOwnKey("sk-1")
    expect(seen).toBe("DELETE /api/me/key")
  })
})
