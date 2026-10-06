import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

export type Credentials = { baseUrl: string; key: string; name: string }

export function credentialsPath() {
  return join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "boundless", "credentials.json")
}

export async function readCredentials(): Promise<Credentials | null> {
  try {
    const value = JSON.parse(await readFile(credentialsPath(), "utf8")) as Partial<Credentials>
    return typeof value.key === "string" && typeof value.baseUrl === "string" && typeof value.name === "string"
      ? { baseUrl: value.baseUrl, key: value.key, name: value.name }
      : null
  } catch {
    return null
  }
}

export async function writeCredentials(value: Credentials) {
  const path = credentialsPath()
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  await writeFile(path, JSON.stringify(value, null, 2), { mode: 0o600 })
  await chmod(path, 0o600)
}

export async function deleteCredentials() {
  await rm(credentialsPath(), { force: true })
}
