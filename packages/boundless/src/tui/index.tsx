import { Plugin } from "@opencode/plugin/tui"
import { openUrl } from "@opencode/util/open"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { readAccount } from "../console"
import { readCredentials } from "../credentials"
import { balanceLabel } from "../format"
import { type AccountDeps, needsSignIn, signIn, signOut } from "./account"

const [label, setLabel] = createSignal<string>()

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

export default Plugin.define({
  id: "boundless.account",
  setup(context) {
    const deps = (): AccountDeps => ({
      client: context.client as unknown as AccountDeps["client"],
      location: { directory: context.location?.directory },
      toast: (toast) => context.ui.toast.show(toast),
      open: (url) => openUrl(url).then(() => {}),
      refresh,
      wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    })
    const Balance = () => {
      const timer = setInterval(refresh, 30_000)
      onCleanup(() => clearInterval(timer))
      return <text fg={context.theme.text.muted}>{label() ?? ""}</text>
    }
    context.ui.slot({ append: "home.footer.status", render: () => <Balance /> })
    context.ui.slot({ append: "prompt.footer.status", render: () => <Balance /> })
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            { id: "boundless.signin", title: "Sign in to Boundless", group: "Boundless", slash: { name: "signin" }, palette: true, run: () => void signIn(deps()) },
            { id: "boundless.signout", title: "Sign out of Boundless", group: "Boundless", slash: { name: "signout" }, palette: true, run: () => void signOut(deps()) },
          ],
        }))
        let prompted = false
        createEffect(() => {
          if (prompted || !needsSignIn(context.data.location.integration.list())) return
          prompted = true
          void signIn(deps())
        })
        return null
      },
    })
    void refresh()
  },
})
