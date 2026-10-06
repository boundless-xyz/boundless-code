import type { TuiPluginApi } from "@opencode-ai/plugin/tui"

type SignInApi = { client: Pick<TuiPluginApi["client"], "provider">; ui: Pick<TuiPluginApi["ui"], "toast"> }

export function openInBrowser(url: string) {
  const command = process.platform === "darwin" ? ["open", url] : process.platform === "win32" ? ["cmd", "/c", "start", "", url] : ["xdg-open", url]
  Bun.spawn(command, { stdout: "ignore", stderr: "ignore" })
}

export async function signIn(api: SignInApi, deps: { open: (url: string) => void; refresh: () => Promise<void> }) {
  const failed = (message: string) => api.ui.toast({ message, variant: "error" })
  try {
    const started = await api.client.provider.oauth.authorize({ providerID: "boundless", method: 0 })
    const url = started.data?.url
    if (started.error || !url) return failed("Boundless sign-in is unavailable right now. Try /signin later.")
    api.ui.toast({ message: `Approve the sign-in in your browser: ${url}`, variant: "info" })
    try {
      deps.open(url)
    } catch {}
    const finished = await api.client.provider.oauth.callback({ providerID: "boundless", method: 0 })
    if (finished.error) return failed("Sign-in did not complete. Run /signin to try again.")
    await deps.refresh()
  } catch {
    failed("Could not reach Boundless. Check your connection and run /signin.")
  }
}
