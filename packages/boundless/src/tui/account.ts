import { revokeOwnKey } from "../console"
import { deleteCredentials, readCredentials } from "../credentials"

type Toast = { message: string; variant: "info" | "success" | "error" }

type AccountClient = {
  integration: {
    oauth: {
      connect(input: { integrationID: string; methodID: string; location: { directory?: string } }): Promise<{
        data: { attemptID: string; url: string; mode: "auto" | "code" }
      }>
      status(input: { integrationID: string; attemptID: string; location: { directory?: string } }): Promise<{
        data: { status: string; message?: string }
      }>
    }
  }
  credential: {
    list(): Promise<ReadonlyArray<{ id: string; integrationID: string }>>
    remove(input: { credentialID: string }): Promise<void>
  }
}

export type AccountDeps = {
  client: AccountClient
  location: { directory?: string }
  toast: (toast: Toast) => void
  open: (url: string) => Promise<void>
  refresh: () => Promise<void>
  wait: (ms: number) => Promise<void>
}

export async function signIn(deps: AccountDeps) {
  const ids = { integrationID: "boundless", location: deps.location }
  try {
    const attempt = (await deps.client.integration.oauth.connect({ ...ids, methodID: "browser" })).data
    deps.toast({ message: `Approve the sign-in in your browser: ${attempt.url}`, variant: "info" })
    await deps.open(attempt.url).catch(() => {})
    for (;;) {
      const { status, message } = (await deps.client.integration.oauth.status({ ...ids, attemptID: attempt.attemptID })).data
      if (status === "pending") {
        await deps.wait(1000)
        continue
      }
      if (status !== "complete") return deps.toast({ message: message ?? "Sign-in did not complete. Run /signin to try again.", variant: "error" })
      await deps.refresh()
      return deps.toast({ message: "Signed in to Boundless.", variant: "success" })
    }
  } catch {
    deps.toast({ message: "Boundless sign-in is unavailable right now. Try /signin later.", variant: "error" })
  }
}

export async function signOut(deps: AccountDeps) {
  const saved = await readCredentials()
  if (saved) await revokeOwnKey(saved.key).catch(() => {})
  await deleteCredentials()
  for (const credential of await deps.client.credential.list()) {
    if (credential.integrationID === "boundless") await deps.client.credential.remove({ credentialID: credential.id })
  }
  await deps.refresh()
  deps.toast({ message: "Signed out of Boundless.", variant: "info" })
}

export function needsSignIn(integrations: ReadonlyArray<{ id: string; connections: ReadonlyArray<unknown> }> | undefined) {
  const boundless = integrations?.find((integration) => integration.id === "boundless")
  return boundless !== undefined && boundless.connections.length === 0
}
