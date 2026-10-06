import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import { createSignal, onCleanup } from "solid-js"
import { readAccount, revokeOwnKey } from "../console"
import { openInBrowser, signIn } from "./account"
import { deleteCredentials, readCredentials } from "../credentials"
import { balanceLabel } from "../format"

const [label, setLabel] = createSignal<string | undefined>()

async function refresh(): Promise<void> {
  const saved = await readCredentials()
  if (!saved) {
    setLabel("Signed out · /signin")
    return
  }
  try {
    const account = await readAccount(saved.key)
    setLabel(account ? balanceLabel(account.balance) : "Signed out · /signin")
  } catch {
    setLabel(undefined)
  }
}

function Balance(props: { api: TuiPluginApi }) {
  const timer = setInterval(refresh, 30_000)
  onCleanup(() => clearInterval(timer))
  return <text fg={props.api.theme.current.textMuted}>{label() ?? ""}</text>
}

async function signOut(api: TuiPluginApi) {
  const saved = await readCredentials()
  if (saved) await revokeOwnKey(saved.key).catch(() => {})
  await deleteCredentials()
  await api.client.auth.remove({ providerID: "boundless" })
  await refresh()
  api.ui.toast({ message: "Signed out of Boundless.", variant: "info" })
}

const tui: TuiPlugin = async (api) => {
  await refresh()
  api.slots.register({
    order: 50,
    slots: {
      home_prompt_right: () => <Balance api={api} />,
      session_prompt_right: () => <Balance api={api} />,
    },
  })
  api.keymap.registerLayer({
    commands: [
      { name: "boundless.signin", title: "Sign in to Boundless", category: "Boundless", namespace: "palette", slashName: "signin", run: () => void signIn(api, { open: openInBrowser, refresh }) },
      { name: "boundless.signout", title: "Sign out of Boundless", category: "Boundless", namespace: "palette", slashName: "signout", run: () => void signOut(api) },
    ],
    bindings: [],
  })
  if (!(await readCredentials())) void signIn(api, { open: openInBrowser, refresh })
}

export default { id: "internal:boundless", tui }
