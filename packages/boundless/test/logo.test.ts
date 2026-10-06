import { expect, test } from "bun:test"
import { logo } from "../../tui/src/logo"

test("the wordmark is Boundless and each half is rectangular", () => {
  for (const half of [logo.left, logo.right]) {
    expect(new Set(half.map((row) => row.length)).size).toBe(1)
  }
  expect(logo.left[1]).toBe("█▀▀█ █▀▀█ █  █ █▀▀▄ █▀▀█")
})
