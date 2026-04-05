import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  abortChatRunsForSessionKey,
  createChatAbortOpsFromGatewayContext,
  type ChatAbortOps,
} from "./chat-abort.js";
import { getGatewayRequestContextFromFallback } from "./server-plugins.js";

const log = createSubsystemLogger("project-run-chat-abort");

let resolveChatAbortOps: (() => ChatAbortOps | undefined) | undefined;

/**
 * Called from gateway startup with the live gateway context so Project Run completion can always
 * abort in-flight agent work (including project-run-pace sleeps) without relying on fallback
 * context resolution alone.
 */
export function setProjectRunChatAbortOpsResolver(resolver: () => ChatAbortOps | undefined): void {
  resolveChatAbortOps = resolver;
}

function resolveOps(): ChatAbortOps | undefined {
  const direct = resolveChatAbortOps?.();
  if (direct) {
    return direct;
  }
  const context = getGatewayRequestContextFromFallback();
  return context ? createChatAbortOpsFromGatewayContext(context) : undefined;
}

/**
 * Abort any in-flight chat runs for a Project Run session when the execution row becomes terminal.
 * Stops embedded agent work (tool loops, project-run-pace delays) as soon as the orchestrator marks
 * the run finished.
 */
export function abortProjectRunTerminalChatRuns(sessionKey: string): void {
  const trimmed = sessionKey.trim();
  if (!trimmed) {
    return;
  }
  const ops = resolveOps();
  if (!ops) {
    log.warn("skipped abort: no gateway chat abort context (gateway not ready?)");
    return;
  }
  const res = abortChatRunsForSessionKey(ops, {
    sessionKey: trimmed,
    stopReason: "project_run_terminal",
  });
  if (!res.aborted) {
    log.debug(`no in-flight chat runs to abort for session ${trimmed.slice(0, 48)}…`);
  }
}
