/**
 * Session key suffix for EAD project-scoped chat history (control UI).
 * Appended to the user's base session key (e.g. agent:main:main).
 */
export const EAD_PROJECT_MARKER = ":eadproj:";

export type EadProjectContext =
  | { mode: "none" }
  | { mode: "template"; id: string }
  | { mode: "run"; id: string };

export type EadProjectStateSlice = {
  chatShowNoneProjectChat: boolean;
  chatActiveTemplateId: string | null;
  templatesList: Array<{ id: string }>;
  globalExecutionsList: Array<{ id: string }> | null | undefined;
  /**
   * When the Project Run chat tab is open, this is the execution id from the URL.
   * It must not depend on `globalExecutionsList` (list can be empty or stale while loading).
   */
  chatProjectRunExecutionId?: string | null;
  /** Use with `chatProjectRunExecutionId` so a stale run id does not apply on other tabs. */
  tab?: string;
};

export function stripEadProjectSuffix(sessionKey: string): string {
  const raw = sessionKey.trim();
  const idx = raw.indexOf(EAD_PROJECT_MARKER);
  if (idx === -1) {
    return raw;
  }
  return raw.slice(0, idx);
}

function safeSegmentId(id: string): string {
  return id.replace(/:/g, "_");
}

export function buildEadProjectChatSessionKey(
  baseSessionKey: string,
  ctx: EadProjectContext,
): string {
  const base = stripEadProjectSuffix(baseSessionKey.trim());
  if (ctx.mode === "none") {
    return `${base}${EAD_PROJECT_MARKER}none`;
  }
  if (ctx.mode === "template") {
    return `${base}${EAD_PROJECT_MARKER}tpl:${safeSegmentId(ctx.id)}`;
  }
  return `${base}${EAD_PROJECT_MARKER}run:${safeSegmentId(ctx.id)}`;
}

export function resolveEadProjectContextFromState(state: EadProjectStateSlice): EadProjectContext {
  if (state.chatShowNoneProjectChat) {
    return { mode: "none" };
  }
  const runId = state.chatProjectRunExecutionId?.trim();
  if (runId && state.tab === "chatProjectRun") {
    return { mode: "run", id: runId };
  }
  const tid = state.chatActiveTemplateId?.trim();
  if (!tid) {
    return { mode: "none" };
  }
  const isTemplate = state.templatesList.some((t) => t.id === tid);
  if (isTemplate) {
    return { mode: "template", id: tid };
  }
  const isRun = (state.globalExecutionsList ?? []).some((e) => e.id === tid);
  if (isRun) {
    return { mode: "run", id: tid };
  }
  return { mode: "none" };
}
