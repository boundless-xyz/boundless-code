import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readCredentials, writeCredentials } from "../src/credentials"
import { BoundlessPlugin } from "../src/server"

let dir: string
let server: ReturnType<typeof Bun.serve> | undefined

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "boundless-"))
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(async () => {
  server?.stop(true)
  server = undefined
  delete process.env.BOUNDLESS_CONSOLE
  await rm(dir, { recursive: true, force: true })
})

const input = {} as Parameters<typeof BoundlessPlugin>[0]
const catalog = {
  data: [
    { id: "glm-5.3-flash", name: "GLM 5.3 Flash", contextTokens: 200000, serving: true, supports: ["tool-use", "reasoning"], inputPerMillionTokens: 0.12, outputPerMillionTokens: 0.4, cachedInputPerMillionTokens: 0.03 },
    { id: "retired", name: "Retired", contextTokens: 1000, serving: false, supports: [], inputPerMillionTokens: 1, outputPerMillionTokens: 1, cachedInputPerMillionTokens: null },
  ],
}

function fakeConsole(tokenReply: () => Response) {
  server = Bun.serve({
    port: 0,
    fetch(_request, s) {
      const url = new URL(_request.url)
      const origin = url.origin
      if (url.pathname === "/api/setup") return Response.json({ codeClientId: "code", gatewayUrl: "https://gw.example.com", issuer: origin })
      if (url.pathname === "/api/catalog") return Response.json(catalog)
      if (url.pathname === "/.well-known/oauth-authorization-server") return Response.json({ device_authorization_endpoint: `${origin}/device`, token_endpoint: `${origin}/token` })
      if (url.pathname === "/device") return Response.json({ device_code: "dc", user_code: "ABCD", verification_uri: `${origin}/v`, interval: 0, expires_in: 5 })
      if (url.pathname === "/token") return tokenReply()
      if (url.pathname === "/api/setup/key") return Response.json({ baseUrl: "https://gw.example.com", id: "i", key: "sk-1", name: "code-abc" })
      return new Response("not found", { status: 404 })
    },
  })
  process.env.BOUNDLESS_CONSOLE = server.url.origin
}

describe("auth hook", () => {
  test("approved sign-in stores the key and hands it to the provider", async () => {
    fakeConsole(() => Response.json({ access_token: "at" }))
    const hooks = await BoundlessPlugin(input)
    const method = hooks.auth!.methods[0]!
    if (method.type !== "oauth") throw new Error("expected oauth")
    const started = await method.authorize()
    expect(started.url).toContain("/authorize?")
    if (started.method !== "auto") throw new Error("expected auto")
    expect(await started.callback()).toEqual({ type: "success", provider: "boundless", key: "sk-1" })
    expect(await readCredentials()).toEqual({ baseUrl: "https://gw.example.com", key: "sk-1", name: "code-abc" })
  })

  test("declined sign-in writes nothing", async () => {
    fakeConsole(() => Response.json({ error: "access_denied" }, { status: 400 }))
    const hooks = await BoundlessPlugin(input)
    const method = hooks.auth!.methods[0]!
    if (method.type !== "oauth") throw new Error("expected oauth")
    const started = await method.authorize()
    if (started.method !== "auto") throw new Error("expected auto")
    expect(await started.callback()).toEqual({ type: "failed" })
    expect(await readCredentials()).toBeNull()
  })
})

describe("config hook", () => {
  test("adds the provider from the live catalog and sets the default model", async () => {
    fakeConsole(() => Response.json({}))
    await writeCredentials({ baseUrl: "https://gw.example.com", key: "sk-1", name: "code-abc" })
    const config: Record<string, any> = {}
    await (await BoundlessPlugin(input)).config!(config as any)
    expect(config.model).toBe("boundless/glm-5.3-flash")
    expect(config.provider.boundless.options.baseURL).toBe("https://gw.example.com/v1")
    expect(Object.keys(config.provider.boundless.models)).toEqual(["glm-5.3-flash"])
    expect(config.provider.boundless.models["glm-5.3-flash"].cost).toEqual({ input: 0.12, output: 0.4, cache_read: 0.03 })
  })

  test("keeps a user's model", async () => {
    fakeConsole(() => Response.json({}))
    const config: Record<string, any> = { model: "anthropic/claude-x" }
    await (await BoundlessPlugin(input)).config!(config as any)
    expect(config.model).toBe("anthropic/claude-x")
  })

  test("config hook survives an unreachable console", async () => {
    process.env.BOUNDLESS_CONSOLE = "http://127.0.0.1:9"
    const config: Record<string, any> = {}
    const started = Date.now()
    await (await BoundlessPlugin(input)).config!(config as any)
    expect(Date.now() - started).toBeLessThan(2500)
    expect(config.provider?.boundless).toBeUndefined()
  })
})
