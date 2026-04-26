import type { Part } from "@opencode-ai/sdk"
import type { ModelRef } from "./types.js"
import { isResetKey, type RouterConfig } from "./config.js"

const sessionStore = new Map<string, ModelRef>()

export function clearSession(sessionID: string): void {
  sessionStore.delete(sessionID)
}

/** Test helper — clears in-memory store between tests */
export function __resetStoreForTests(): void {
  sessionStore.clear()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function parseModelRef(model: string): ModelRef | undefined {
  const slash = model.indexOf("/")
  if (slash <= 0 || slash === model.length - 1) {
    return undefined
  }
  return {
    providerID: model.slice(0, slash),
    modelID: model.slice(slash + 1),
  }
}

function lookupKey(keys: Record<string, string>, raw: string): ModelRef | "reset" | "invalid" | undefined {
  const lower = raw.toLowerCase()
  if (isResetKey(lower)) {
    // Allow reset without adding to `keys` — always recognized after sigil
    return "reset"
  }
  for (const [name, model] of Object.entries(keys)) {
    if (name.toLowerCase() === lower) {
      return parseModelRef(model) ?? "invalid"
    }
  }
  return undefined
}

function stripFromText(text: string, start: number, end: number): string {
  const before = text.slice(0, start)
  const after = text.slice(end)
  const beforeHasSpace = /\s$/.test(before)
  const afterHasSpace = /^\s/.test(after)

  if (beforeHasSpace && afterHasSpace) {
    return before.replace(/\s+$/, " ") + after.replace(/^\s+/, "")
  }
  if (beforeHasSpace && /^[.,!?;:]/.test(after)) {
    return before.replace(/\s+$/, "") + after
  }
  if (!before) {
    return after.replace(/^\s+/, "")
  }
  if (!after) {
    return before.replace(/\s+$/, "")
  }
  return before + after
}

function stripFromTextPart(parts: Part[], partID: string, start: number, end: number): Part[] {
  if (start === end) {
    return parts
  }
  return parts.map((p) => (p.type === "text" && p.id === partID ? { ...p, text: stripFromText(p.text, start, end) } : p))
}

export type ResolveOutcome =
  | { kind: "none"; detail: string } // Do not modify hook output
  | {
      kind: "apply"
      model: ModelRef
      parts: Part[]
      detail: string
    }
  | {
      kind: "revert"
      parts: Part[]
      detail: string
    }

/**
 * - On `@key` anywhere in a text part with a configured mapping: store model, strip the token, return model to set.
 * - On `@reset` anywhere in a text part: clear stored model, strip the token, caller should set message.model to input.model.
 * - On `@unknown`: leave message unchanged (no strip).
 * - On message without a key: re-apply stored model if any; parts unchanged.
 */
export function resolve(
  sessionID: string,
  parts: Part[],
  cfg: RouterConfig,
): ResolveOutcome {
  const sigil = cfg.sigil
  const re = new RegExp(`(^|\\s)${escapeRe(sigil)}([a-zA-Z0-9_]{2,32})(?=\\s|$|[.,!?;:])`)

  for (const part of parts) {
    if (part.type !== "text") {
      continue
    }
    const m = part.text.match(re)
    if (!m || m.index === undefined) {
      continue
    }

    const rawKey = m[2]
    const found = lookupKey(cfg.keys, rawKey)
    if (found === undefined) {
      return { kind: "none", detail: `unknown key ${rawKey.toLowerCase()}` }
    }
    if (found === "invalid") {
      return { kind: "none", detail: `invalid model for key ${rawKey.toLowerCase()}` }
    }

    const leading = m[1] ?? ""
    const tokenStart = m.index + leading.length
    const tokenEnd = tokenStart + sigil.length + rawKey.length

    if (found === "reset") {
      clearSession(sessionID)
      return {
        kind: "revert",
        parts: stripFromTextPart(parts, part.id, tokenStart, tokenEnd),
        detail: "reset",
      }
    }

    sessionStore.set(sessionID, found)
    return {
      kind: "apply",
      model: found,
      parts: stripFromTextPart(parts, part.id, tokenStart, tokenEnd),
      detail: `key ${rawKey.toLowerCase()}`,
    }
  }

  return applyOrPassthroughFromStore(sessionID, undefined, parts, cfg, "no configured key found")
}

function applyOrPassthroughFromStore(
  sessionID: string,
  _defaultModel: { providerID: string; modelID: string } | undefined,
  parts: Part[],
  _cfg: RouterConfig,
  reason: string,
): ResolveOutcome {
  const stored = sessionStore.get(sessionID)
  if (!stored) {
    return { kind: "none", detail: reason }
  }
  // Always re-apply the stored model on every subsequent turn.
  // OpenCode's chat.message hook only affects the current turn's model;
  // the TUI may send a different model in its PromptInput on turn 2+,
  // so we must explicitly override on every turn to keep the choice sticky.
  return {
    kind: "apply",
    model: stored,
    parts,
    detail: "sticky reapply",
  }
}
