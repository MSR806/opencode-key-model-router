export type RouterConfig = {
  /**
   * Prefix before the key, e.g. "@" for `@fast`.
   * Must be a non-alphanumeric start so keys stay unambiguous.
   */
  sigil: string
  /** If true, log routing decisions via OpenCode's structured logger */
  debug: boolean
  /**
   * Map of key name (lowercase) -> OpenCode model string (`provider/model`).
   * Keys are matched case-insensitively after the sigil.
   * Optional built-in: `reset` — clears sticky session model and reverts to OpenCode's default for this call.
   */
  keys: Record<string, string>
}

export const defaultConfig: RouterConfig = {
  sigil: "@",
  debug: false,
  keys: {},
}

const RESET = "reset"

export function isResetKey(key: string): boolean {
  return key.toLowerCase() === RESET
}

export function mergeConfig(raw: unknown): RouterConfig {
  if (!raw || typeof raw !== "object") {
    return { ...defaultConfig, keys: { ...defaultConfig.keys } }
  }
  const o = raw as Record<string, unknown>
  return {
    sigil: typeof o.sigil === "string" && o.sigil.length > 0 ? o.sigil : defaultConfig.sigil,
    debug: o.debug === true,
    keys: isRecord(o.keys) ? readKeys(o.keys) : {},
  }
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return x !== null && typeof x === "object" && !Array.isArray(x)
}

function readKeys(input: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string" && value.includes("/")) {
      out[key] = value
    }
  }
  return out
}
