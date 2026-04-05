import { loadProjectsStore, resolveProjectsStorePath } from "./store.js";
import type { ProjectExecute } from "./types.js";

const EAD_PROJECT_MARKER = ":eadproj:";
const RUN_PREFIX = `${EAD_PROJECT_MARKER}run:`;

/**
 * Returns the execution id embedded in a Project Run session key (`…:eadproj:run:<id>`), or null.
 */
export function isProjectRunSessionKey(sessionKey: string | undefined): boolean {
  return Boolean(sessionKey?.trim() && parseProjectRunExecutionIdFromSessionKey(sessionKey));
}

export function parseProjectRunExecutionIdFromSessionKey(sessionKey: string): string | null {
  const raw = sessionKey.trim();
  const idx = raw.indexOf(RUN_PREFIX);
  if (idx === -1) {
    return null;
  }
  const suffix = raw.slice(idx + RUN_PREFIX.length);
  if (!suffix) {
    return null;
  }
  // buildProjectRunSessionKey uses safeProjectSessionSegment: id.replace(/:/g, "_")
  return suffix.replace(/_/g, ":");
}

export function isTerminalProjectExecutionStatus(
  status: ProjectExecute["status"] | undefined,
): boolean {
  if (!status) {
    return false;
  }
  return (
    status === "completed" || status === "failed" || status === "cancelled" || status === "error"
  );
}

export type ProjectRunChatGateResult = { ok: true } | { ok: false; message: string };

/**
 * Gate chat.send for Project Run sessions: block only while the run is **paused** (operator must
 * resume). **Terminal** runs (completed / failed / cancelled / error) stay chat-enabled so the
 * operator can ask follow-up questions in the same thread; that does not restart the Project Run
 * executor loop (the execution row stays terminal).
 */
export async function evaluateProjectRunChatGate(
  sessionKey: string,
): Promise<ProjectRunChatGateResult> {
  const executionId = parseProjectRunExecutionIdFromSessionKey(sessionKey);
  if (!executionId) {
    return { ok: true };
  }
  const storePath = resolveProjectsStorePath();
  const store = await loadProjectsStore(storePath).catch(() => null);
  if (!store) {
    return { ok: true };
  }
  const execution = store.executions.find((e) => e.id === executionId);
  // If the row is missing (tests, race, or store not written yet), do not block chat.send.
  if (!execution) {
    return { ok: true };
  }
  if (isTerminalProjectExecutionStatus(execution.status)) {
    return { ok: true };
  }
  if (execution.paused) {
    return {
      ok: false,
      message: "Project Run is paused. Resume the run before sending chat messages.",
    };
  }
  return { ok: true };
}
