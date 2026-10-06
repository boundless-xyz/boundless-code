import type { Config, Plugin } from "@opencode-ai/plugin"
import { consoleOrigin, discover, exchangeKey, startDeviceGrant, waitForAccessToken } from "./console"
import { readCredentials, writeCredentials } from "./credentials"

type CatalogModel = {
  cachedInputPerMillionTokens: number | null
  contextTokens: number
  id: string
  inputPerMillionTokens: number | null
  name: string
  outputPerMillionTokens: number | null
  serving: boolean
  supports: string[]
}

function modelEntry(model: CatalogModel) {
  return {
    name: model.name,
    limit: { context: model.contextTokens, output: 32_000 },
    reasoning: model.supports.includes("reasoning"),
    tool_call: model.supports.includes("tool-use"),
    cost: {
      input: model.inputPerMillionTokens ?? 0,
      output: model.outputPerMillionTokens ?? 0,
      cache_read: model.cachedInputPerMillionTokens ?? model.inputPerMillionTokens ?? 0,
    },
  }
}

async function provider(signal: AbortSignal) {
  const saved = await readCredentials()
  const gatewayUrl = saved?.baseUrl ?? (await discover(signal)).gatewayUrl
  const { data } = (await (await fetch(`${consoleOrigin()}/api/catalog`, { signal })).json()) as { data: CatalogModel[] }
  return {
    name: "Boundless",
    npm: "@ai-sdk/openai-compatible",
    options: { baseURL: `${gatewayUrl}/v1` },
    models: Object.fromEntries(data.filter((model) => model.serving).map((model) => [model.id, modelEntry(model)])),
  }
}

export const BoundlessPlugin: Plugin = async () => ({
  auth: {
    provider: "boundless",
    methods: [
      {
        type: "oauth",
        label: "Sign in with Boundless",
        async authorize() {
          const discovery = await discover()
          const grant = await startDeviceGrant(discovery)
          return {
            url: grant.approvalUrl,
            instructions: `Confirm the code ${grant.userCode} in your browser.`,
            method: "auto" as const,
            async callback() {
              try {
                const credentials = await exchangeKey(await waitForAccessToken(discovery, grant))
                await writeCredentials(credentials)
                return { type: "success" as const, provider: "boundless", key: credentials.key }
              } catch {
                return { type: "failed" as const }
              }
            },
          }
        },
      },
    ],
  },
  async config(config: Config) {
    try {
      const entry = await provider(AbortSignal.timeout(2000))
      config.provider = { ...config.provider, boundless: entry }
      config.model ??= "boundless/glm-5.3-flash"
    } catch {}
  },
})
