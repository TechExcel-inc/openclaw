import type { ExtensionFactory } from "@mariozechner/pi-coding-agent";
import { sleepWithAbort } from "../../infra/backoff.js";
import { createSubsystemLogger } from "../../logging/subsystem.js";

const log = createSubsystemLogger("project-run-pace");

/**
 * Default minimum time between successive LLM turns inside a Project Run (multi-tool loops).
 * Spreads provider RPM/TPM; too low increases rate-limit risk on screenshot-heavy runs.
 */
export const PROJECT_RUN_MIN_LLM_INTERVAL_MS = 40_000;

/**
 * Embeddable extension: enforces a minimum delay before each LLM turn after the first
 * (`turnIndex > 0`) within one agent invocation. Project Run only — registered from
 * `buildEmbeddedExtensionFactories` when `projectRunPace` is set.
 *
 * A new user message starts a new agent loop at `turnIndex === 0`, which is never delayed here.
 * The interval applies between successive model calls inside the same multi-tool run (after tools).
 */
export function createProjectRunPaceExtension(params: {
  minIntervalMs: number;
  abortSignal?: AbortSignal;
}): ExtensionFactory {
  return (api) => {
    let lastTurnEndedAt = 0;

    api.on("turn_end", () => {
      lastTurnEndedAt = Date.now();
    });

    api.on("turn_start", async (event) => {
      if (event.turnIndex === 0) {
        return;
      }
      const elapsed = Date.now() - lastTurnEndedAt;
      const waitMs = Math.max(0, params.minIntervalMs - elapsed);
      if (waitMs <= 0) {
        return;
      }
      log.info(
        `waiting ${waitMs}ms before LLM turn ${event.turnIndex} (project run min interval ${params.minIntervalMs}ms)`,
      );
      await sleepWithAbort(waitMs, params.abortSignal);
    });
  };
}
