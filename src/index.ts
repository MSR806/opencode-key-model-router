import type { Plugin } from "@opencode-ai/plugin"
import { mergeConfig } from "./config.js"
import { clearSession, resolve } from "./resolver.js"

const plugin: Plugin = async (ctx, options) => {
  const cfg = mergeConfig(options)
  return {
    event: async ({ event }) => {
      if (event.type === "session.deleted") {
        clearSession(event.properties.info.id)
      }
    },
    "chat.message": async (input, output) => {
      const out = resolve(input.sessionID, output.parts, cfg)
      if (out.kind === "none") {
        if (cfg.debug) {
          await ctx.client.app.log({
            body: {
              service: "opencode-model-router",
              level: "info",
              message: `opencode-model-router: no routing change (${out.detail})`,
              extra: {
                sessionID: input.sessionID,
                inputModel: input.model ? `${input.model.providerID}/${input.model.modelID}` : undefined,
              },
            },
          })
        }
        return
      }
      if (out.kind === "revert") {
        output.parts.splice(0, output.parts.length, ...out.parts)
        // For @reset we leave output.message.model as-is — OpenCode will use
        // whatever its normal resolution picked (TUI selection or lastModel).
        // We just clear our in-memory sticky state.
        if (cfg.debug) {
          await ctx.client.app.log({
            body: {
              service: "opencode-model-router",
              level: "info",
              message: "opencode-model-router: @reset — sticky routing cleared; using default model for this call",
              extra: { sessionID: input.sessionID },
            },
          })
        }
        return
      }
      output.parts.splice(0, output.parts.length, ...out.parts)
      // Mutate in-place so any internal reference OpenCode holds to the model
      // object also sees the update, rather than replacing the whole object.
      output.message.model.providerID = out.model.providerID
      output.message.model.modelID = out.model.modelID
      if (cfg.debug) {
        await ctx.client.app.log({
          body: {
            service: "opencode-model-router",
            level: "info",
            message: `opencode-model-router: using ${out.model.providerID}/${out.model.modelID} (${out.detail})`,
            extra: { sessionID: input.sessionID },
          },
        })
      }
    },
  }
}

export default plugin
export { plugin as opencodeModelRouter }
