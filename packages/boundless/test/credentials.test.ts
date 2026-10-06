import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, stat, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { credentialsPath, deleteCredentials, readCredentials, writeCredentials } from "../src/credentials"

let dir: string
const saved = process.env.XDG_CONFIG_HOME

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "boundless-"))
  process.env.XDG_CONFIG_HOME = dir
})

afterEach(async () => {
  process.env.XDG_CONFIG_HOME = saved
  await rm(dir, { recursive: true, force: true })
})

describe("credentials", () => {
  test("lives under XDG_CONFIG_HOME/boundless", () => {
    expect(credentialsPath()).toBe(join(dir, "boundless", "credentials.json"))
  })

  test("round-trips and is private to the user", async () => {
    const value = { baseUrl: "https://gw.example.com", key: "sk-1", name: "code-abc" }
    await writeCredentials(value)
    expect(await readCredentials()).toEqual(value)
    expect((await stat(credentialsPath())).mode & 0o777).toBe(0o600)
  })

  test("reads null when absent or corrupt", async () => {
    expect(await readCredentials()).toBeNull()
    await mkdir(join(dir, "boundless"), { recursive: true })
    await writeFile(credentialsPath(), "{not json")
    expect(await readCredentials()).toBeNull()
  })

  test("delete is idempotent", async () => {
    await writeCredentials({ baseUrl: "https://gw.example.com", key: "sk-1", name: "code-abc" })
    await deleteCredentials()
    await deleteCredentials()
    expect(await readCredentials()).toBeNull()
  })
})
