# Patches to upstream files

Our code lives in `packages/boundless`. Every edit outside it is listed here so upstream merges stay predictable.
Upstream: anomalyco/opencode. Base tag: v2.0.24.

| File | Change | Why |
|---|---|---|
| packages/core/src/models-dev.ts | export `SourceModel`, `SourceProvider` and `normalize` | build the Boundless provider from our catalog exactly as models.dev entries are built |
| packages/core/src/plugin/provider.ts | import + register `BoundlessPlugin` first in `ProviderPlugins` | Boundless sign-in and provider ship built in |
| packages/core/package.json | `@boundless/code` workspace dependency | resolve the plugin |
| packages/tui/src/plugin/builtins.ts | import + register `BoundlessAccount` first | balance, first-run sign-in, /signin and /signout ship built in |
| packages/tui/package.json | `@boundless/code` workspace dependency | resolve the TUI plugin |
| packages/tui/src/logo.ts | `logo` wordmark reads "boundless" | branding |
