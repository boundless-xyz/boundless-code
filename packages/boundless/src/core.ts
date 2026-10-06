import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { ModelsDev } from "@opencode/core/models-dev"
import { define } from "@opencode/plugin/effect/plugin"
import { Effect, Stream } from "effect"
import { consoleOrigin, discover, exchangeKey, startDeviceGrant, waitForAccessToken } from "./console"
import { writeCredentials } from "./credentials"

export type CatalogModel = {
  cachedInputPerMillionTokens: number | null
  contextTokens: number
  id: string
  inputPerMillionTokens: number | null
  name: string
  outputPerMillionTokens: number | null
  serving: boolean
  supports: string[]
}

const integrationID = Integration.ID.make("boundless")
const methodID = Integration.MethodID.make("browser")

function sourceModel(model: CatalogModel): ModelsDev.SourceModel {
  const inputs = ["text" as const, ...(["image", "audio", "video"] as const).filter((kind) => model.supports.includes(`${kind} input`))]
  return {
    id: model.id,
    name: model.name,
    release_date: "2026-01-01",
    attachment: inputs.length > 1,
    reasoning: model.supports.includes("reasoning"),
    tool_call: model.supports.includes("tool-use"),
    temperature: true,
    limit: { context: model.contextTokens, output: 32_000 },
    modalities: { input: inputs, output: ["text"] },
    cost: {
      input: model.inputPerMillionTokens ?? 0,
      output: model.outputPerMillionTokens ?? 0,
      cache_read: model.cachedInputPerMillionTokens ?? model.inputPerMillionTokens ?? 0,
    } as ModelsDev.SourceModel["cost"],
  }
}

export function catalogSnapshot(catalog: readonly CatalogModel[], gatewayUrl: string) {
  const [snapshot] = ModelsDev.normalize({
    boundless: {
      id: "boundless",
      name: "Boundless",
      npm: "@ai-sdk/openai-compatible",
      api: `${gatewayUrl}/v1`,
      env: [],
      models: Object.fromEntries(catalog.filter((model) => model.serving).map((model) => [model.id, sourceModel(model)])),
    },
  })
  return snapshot!
}

const signIn = {
  integrationID,
  method: { id: methodID, type: "oauth" as const, label: "Sign in with Boundless" },
  authorize: () =>
    Effect.tryPromise(async () => {
      const discovery = await discover()
      const grant = await startDeviceGrant(discovery)
      return { discovery, grant }
    }).pipe(
      Effect.map(({ discovery, grant }) => ({
        mode: "auto" as const,
        url: grant.approvalUrl,
        instructions: `Confirm the code ${grant.userCode} in your browser.`,
        expiresAt: grant.expiresAt,
        callback: Effect.tryPromise(async () => {
          const credentials = await exchangeKey(await waitForAccessToken(discovery, grant))
          await writeCredentials(credentials)
          return credentials
        }).pipe(
          Effect.map((credentials) =>
            Credential.OAuth.make({
              type: "oauth",
              methodID,
              access: credentials.key,
              refresh: "",
              expires: 8_640_000_000_000_000,
              metadata: { baseUrl: credentials.baseUrl, name: credentials.name },
            }),
          ),
        ),
      })),
    ),
  refresh: (value: Credential.OAuth) => Effect.succeed(value),
}

export const BoundlessPlugin = define({
  id: "boundless.provider",
  effect: Effect.fn(function* (ctx) {
    const loaded = { snapshot: undefined as ModelsDev.Snapshot | undefined, key: "" }

    yield* ctx.integration.transform((editor) => {
      editor.update(integrationID, (integration) => {
        integration.name = "Boundless"
      })
      editor.method.update(signIn)
    })

    yield* ctx.provider.transform((providers) => {
      if (!loaded.snapshot) return
      providers.add({ info: { ...loaded.snapshot.info, integrationID }, models: loaded.snapshot.models })
    })

    const refresh = Effect.fn("BoundlessPlugin.refresh")(function* () {
      const connection = yield* ctx.integration.connection.active(integrationID)
      const value = connection ? yield* ctx.integration.connection.resolve(connection) : undefined
      const baseUrl = value?.metadata?.baseUrl
      const next =
        typeof baseUrl === "string"
          ? catalogSnapshot(
              yield* Effect.tryPromise(async () => {
                const response = await fetch(`${consoleOrigin()}/api/catalog`, { signal: AbortSignal.timeout(5000) })
                return ((await response.json()) as { data: CatalogModel[] }).data
              }),
              baseUrl,
            )
          : undefined
      const key = next ? JSON.stringify(next) : ""
      if (key === loaded.key) return
      loaded.snapshot = next
      loaded.key = key
      yield* ctx.provider.reload()
    })

    yield* refresh().pipe(Effect.ignore)
    yield* ctx.event.subscribe().pipe(
      Stream.filter((event) => event.type === "credential.updated" || event.type === "credential.switched"),
      Stream.runForEach(() => refresh().pipe(Effect.ignore)),
      Effect.forkScoped({ startImmediately: true }),
    )
  }),
})
