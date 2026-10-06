# Patches to upstream files

Our code lives in `packages/boundless`. Every edit outside it is listed here so upstream merges stay predictable.
Upstream: anomalyco/opencode. Base tag: v1.18.34.

| File | Change | Why |
|---|---|---|
| packages/opencode/src/plugin/index.ts | import + register `BoundlessPlugin` first in `internalPlugins` | Boundless sign-in and provider ship built in |
| packages/opencode/package.json | `@boundless/code` workspace dependency | resolve the plugin |
