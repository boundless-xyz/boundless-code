import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { Provider } from "@opencode/core/provider"
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Effect, Schedule } from "effect"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { BoundlessPlugin, catalogSnapshot, type CatalogModel } from "../src/core"
import { readCredentials } from "../src/credentials"

const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("boundless")
const methodID = Integration.MethodID.make("browser")
const providerID = Provider.ID.make("boundless")

const catalog: CatalogModel[] = [
  { id: "glm-5.3-flash", name: "GLM 5.3 Flash", contextTokens: 200000, serving: true, supports: ["tool-use", "reasoning"], inputPerMillionTokens: 0.12, outputPerMillionTokens: 0.4, cachedInputPerMillionTokens: 0.03 },
  { id: "retired", name: "Retired", contextTokens: 1000, serving: false, supports: [], inputPerMillionTokens: 1, outputPerMillionTokens: 1, cachedInputPerMillionTokens: null },
]

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

function fakeConsole(token: () => Response) {
  server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      const origin = url.origin
      if (url.pathname === "/api/setup") return Response.json({ clientId: "wizard", codeClientId: "code", gatewayUrl: "https://gw.example.com", issuer: origin })
      if (url.pathname === "/api/catalog") return Response.json({ data: catalog })
      if (url.pathname === "/.well-known/oauth-authorization-server") return Response.json({ device_authorization_endpoint: `${origin}/device`, token_endpoint: `${origin}/token` })
      if (url.pathname === "/device") return Response.json({ device_code: "dc", user_code: "ABCD-EFGH", verification_uri: `${origin}/v`, interval: 0, expires_in: 30 })
      if (url.pathname === "/token") return token()
      if (url.pathname === "/api/setup/key") return Response.json({ baseUrl: "https://gw.example.com", id: "i", key: "sk-1", name: "code-abc" })
      return new Response("not found", { status: 404 })
    },
  })
  process.env.BOUNDLESS_CONSOLE = server.url.origin
}

const boot = Effect.gen(function* () {
  const plugin = yield* Plugin.Service
  const host = yield* PluginHost.make(plugin)
  yield* BoundlessPlugin.effect(host)
  const integrations = yield* Integration.Service
  const status = (attemptID: Integration.AttemptID) =>
    integrations.oauth.status({ integrationID, attemptID }).pipe(
      Effect.repeat({ until: (value) => value.status !== "pending", schedule: Schedule.spaced("20 millis"), times: 250 }),
    )
  return { integrations, providers: yield* Provider.Service, credentials: yield* Credential.Service, status }
})

describe("catalogSnapshot", () => {
  test("turns the serving catalog into a Boundless provider on the gateway", () => {
    const snapshot = catalogSnapshot(catalog, "https://gw.example.com")
    expect(snapshot.info.id).toBe(providerID)
    expect(snapshot.info.settings?.baseURL).toBe("https://gw.example.com/v1")
    expect(snapshot.models.map((model) => String(model.id))).toEqual(["glm-5.3-flash"])
    expect(snapshot.models[0]?.capabilities.tools).toBe(true)
  })
})

it.live("registers Boundless sign-in without touching the network", () =>
  Effect.gen(function* () {
    process.env.BOUNDLESS_CONSOLE = "http://127.0.0.1:9"
    const test = yield* boot
    expect((yield* test.integrations.get(integrationID))?.methods).toEqual([
      { id: methodID, type: "oauth", label: "Sign in with Boundless" },
    ])
    expect(yield* test.providers.get(providerID)).toBeUndefined()
  }),
)

it.live("an approved sign-in stores the gateway key and loads the catalog", () =>
  Effect.gen(function* () {
    fakeConsole(() => Response.json({ access_token: "at" }))
    const test = yield* boot
    const attempt = yield* test.integrations.oauth.connect({ integrationID, methodID, label: "Boundless" })
    expect(attempt.url).toContain("/authorize?")
    expect((yield* test.status(attempt.attemptID)).status).toBe("complete")
    const saved = (yield* test.credentials.list(integrationID))[0]?.value
    if (saved?.type !== "oauth") throw new Error("expected an OAuth credential")
    expect(saved.access).toBe("sk-1")
    expect(saved.metadata?.baseUrl).toBe("https://gw.example.com")
    expect(yield* Effect.promise(readCredentials)).toEqual({ baseUrl: "https://gw.example.com", key: "sk-1", name: "code-abc" })
    const provider = yield* Effect.gen(function* () {
      return yield* test.providers.get(providerID)
    }).pipe(Effect.repeat({ until: (value) => value !== undefined, schedule: Schedule.spaced("20 millis"), times: 100 }))
    expect(provider?.settings?.baseURL).toBe("https://gw.example.com/v1")
  }),
)

it.live("a declined sign-in fails and writes nothing", () =>
  Effect.gen(function* () {
    fakeConsole(() => Response.json({ error: "access_denied" }, { status: 400 }))
    const test = yield* boot
    const attempt = yield* test.integrations.oauth.connect({ integrationID, methodID, label: "Boundless" })
    expect((yield* test.status(attempt.attemptID)).status).toBe("failed")
    expect(yield* test.credentials.list(integrationID)).toEqual([])
    expect(yield* Effect.promise(readCredentials)).toBeNull()
  }),
)
