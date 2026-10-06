import type { Credentials } from "./credentials"

export class ConsoleError extends Error {
  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message)
  }
}

export function consoleOrigin() {
  return (process.env.BOUNDLESS_CONSOLE ?? "https://inference.boundless.network").replace(/\/+$/, "")
}

const userAgent = "boundless-code"

async function call(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, headers: { "user-agent": userAgent, ...init.headers } })
}

export type Discovery = { codeClientId: string; gatewayUrl: string; issuer: string }

export async function discover(signal?: AbortSignal): Promise<Discovery> {
  const response = await call(`${consoleOrigin()}/api/setup`, { signal })
  if (!response.ok) throw new ConsoleError(`Sign-in is unavailable (HTTP ${response.status}).`, "discovery_failed")
  const body = (await response.json()) as { codeClientId: string | null; gatewayUrl: string; issuer: string }
  if (!body.codeClientId) throw new ConsoleError("Sign-in for Boundless Code is not enabled yet.", "code_signin_unavailable")
  return { codeClientId: body.codeClientId, gatewayUrl: body.gatewayUrl, issuer: body.issuer }
}

export type DeviceGrant = {
  approvalUrl: string
  deviceCode: string
  expiresAt: number
  interval: number
  tokenEndpoint: string
  userCode: string
}

export async function startDeviceGrant(d: Discovery): Promise<DeviceGrant> {
  const metadata = (await (await call(`${d.issuer}/.well-known/oauth-authorization-server`)).json()) as {
    device_authorization_endpoint?: string
    token_endpoint?: string
  }
  if (!metadata.device_authorization_endpoint || !metadata.token_endpoint) {
    throw new ConsoleError("The sign-in server does not support device sign-in.", "no_device_grant")
  }
  const response = await call(metadata.device_authorization_endpoint, {
    body: new URLSearchParams({ client_id: d.codeClientId, scope: "profile" }),
    method: "POST",
  })
  if (!response.ok) throw new ConsoleError(`Starting sign-in failed (HTTP ${response.status}).`, "device_start_failed")
  const grant = (await response.json()) as {
    device_code: string
    expires_in?: number
    interval?: number
    user_code: string
    verification_uri: string
    verification_uri_complete?: string
  }
  const verification = grant.verification_uri_complete ?? grant.verification_uri
  return {
    approvalUrl: `${consoleOrigin()}/authorize?${new URLSearchParams({ redirect_url: verification, user_code: grant.user_code })}`,
    deviceCode: grant.device_code,
    expiresAt: Date.now() + (grant.expires_in ?? 600) * 1000,
    interval: Math.max(grant.interval ?? 5, 0),
    tokenEndpoint: metadata.token_endpoint,
    userCode: grant.user_code,
  }
}

export async function waitForAccessToken(d: Discovery, g: DeviceGrant, signal?: AbortSignal): Promise<string> {
  let interval = g.interval
  while (Date.now() < g.expiresAt) {
    await Bun.sleep(interval * 1000)
    if (signal?.aborted) throw new ConsoleError("Sign-in was cancelled.", "cancelled")
    const response = await call(g.tokenEndpoint, {
      body: new URLSearchParams({
        client_id: d.codeClientId,
        device_code: g.deviceCode,
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
      }),
      method: "POST",
      signal,
    })
    const body = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string }
    if (response.ok && body.access_token) return body.access_token
    if (body.error === "authorization_pending") continue
    if (body.error === "slow_down") {
      interval += 5
      continue
    }
    if (body.error === "access_denied") throw new ConsoleError("You declined the sign-in in the browser.", "access_denied")
    if (body.error === "expired_token") break
    throw new ConsoleError(`Sign-in failed: ${body.error ?? `HTTP ${response.status}`}.`, "oauth_error")
  }
  throw new ConsoleError("The sign-in request expired before it was approved.", "expired")
}

export async function exchangeKey(accessToken: string): Promise<Credentials> {
  const response = await call(`${consoleOrigin()}/api/setup/key`, {
    headers: { authorization: `Bearer ${accessToken}` },
    method: "POST",
  })
  const body = (await response.json().catch(() => ({}))) as { baseUrl?: string; key?: string; name?: string; error?: string }
  if (!response.ok || !body.key || !body.baseUrl || !body.name) {
    throw new ConsoleError(`Could not create a key: ${body.error ?? `HTTP ${response.status}`}.`, body.error ?? "key_failed")
  }
  return { baseUrl: body.baseUrl, key: body.key, name: body.name }
}

export async function readAccount(key: string): Promise<{ balance: number | null } | null> {
  const response = await call(`${consoleOrigin()}/api/me`, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(5000),
  })
  if (response.status === 401) return null
  if (!response.ok) throw new ConsoleError(`Account lookup failed (HTTP ${response.status}).`, "account_failed")
  return (await response.json()) as { balance: number | null }
}

export async function revokeOwnKey(key: string) {
  await call(`${consoleOrigin()}/api/me/key`, { headers: { authorization: `Bearer ${key}` }, method: "DELETE" })
}
