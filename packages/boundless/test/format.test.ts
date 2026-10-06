import { describe, expect, test } from "bun:test"
import { balanceLabel, usd } from "../src/format"

describe("usd", () => {
  test("prints exact amounts, never rounded", () => {
    expect(usd(4.125)).toBe("$4.125")
    expect(usd(0.000001234)).toBe("$0.000001234")
    expect(usd(10)).toBe("$10")
  })
})

describe("balanceLabel", () => {
  test("formats a balance", () => {
    expect(balanceLabel(4.125)).toBe("balance $4.125")
  })

  test("formats null as no limit", () => {
    expect(balanceLabel(null)).toBe("balance: no limit")
  })
})
