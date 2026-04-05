import type { ProjectExecute } from "./types.js";

type ProjectRunBootstrapFields = Pick<
  ProjectExecute,
  | "id"
  | "name"
  | "description"
  | "targetUrl"
  | "aiPrompt"
  | "authMode"
  | "authLoginUrl"
  | "authSessionProfile"
  | "authInstructions"
>;

type ProjectAuthFields = Pick<
  ProjectExecute,
  "authMode" | "authLoginUrl" | "authSessionProfile" | "authInstructions"
>;

function describeProjectRunAuth(
  execution: ProjectAuthFields,
  options?: { operatorConfirmed?: boolean },
): string[] {
  const lines: string[] = [];
  const authMode = execution.authMode ?? "none";
  lines.push(`Authentication strategy: ${authMode}.`);
  if (execution.authLoginUrl?.trim()) {
    lines.push(`Authentication URL: ${execution.authLoginUrl.trim()}.`);
  }
  if (execution.authSessionProfile?.trim()) {
    lines.push(`Session reuse hint: ${execution.authSessionProfile.trim()}.`);
  }
  if (execution.authInstructions?.trim()) {
    lines.push(`Authentication notes: ${execution.authInstructions.trim()}.`);
  }
  if (authMode === "reuse-session") {
    lines.push(
      "Prefer reusing existing authenticated browser/session state before asking for manual login.",
    );
  } else if (authMode === "manual-bootstrap" && !options?.operatorConfirmed) {
    lines.push(
      "Ask the operator to complete login/bootstrap steps first, then continue the run after confirmation.",
    );
  }
  return lines;
}

/**
 * Injected before the bootstrap user message. Keep short to save context budget.
 * Include **status** so the model matches the dashboard for this execution id.
 */
export function buildProjectRunContextMessage(
  execution: Pick<ProjectExecute, "id" | "status" | "paused" | "executorHint">,
): string {
  const statusLine = `Dashboard execution status: ${execution.status}${
    execution.paused ? " (paused — automation waits until the operator resumes)." : ""
  }.`;
  const hint = execution.executorHint?.trim();
  return [
    "[System] Project Run session ready.",
    statusLine,
    `Execution id: ${execution.id}.`,
    hint ? `Latest dashboard hint: ${hint}` : "",
    "OpenClaw owns this run: conversation, browser navigation, and the final answer. The executor mirrors status into the dashboard; treat dashboard status and [System] lines here as authoritative for whether this run is pending, running, paused, or finished.",
    "When the operator asks for run status, use this message, read_ead_execution if needed, and the dashboard — do not invent a different state.",
    "After browser or screenshot tool use, every visible debrief to the operator must include one explicit line with the current count of screenshots recorded in this run (call read_ead_execution for screenshotsRecorded if you do not already have it). Include this line even when the operator did not ask.",
    "Interactive mode: this chat is the operator's main window. Stay conversational—do not go silent across long tool chains. Before a batch of tools, state a short plan (intent and why). After important tools (browser, web_fetch, exec, etc.), say what you did, cite the page or outcome when relevant, and interpret what it means for the Instructions. If something fails, say what failed and how you will adjust. Answer operator messages here before resuming heavy automation.",
  ]
    .filter(Boolean)
    .join(" ");
}

function truncateForInject(text: string, max = 1_500): string {
  const t = text.trim();
  if (t.length <= max) {
    return t;
  }
  return `${t.slice(0, max - 3)}...`;
}

/**
 * Injected when the execution row becomes terminal (cancelled, completed, failed, error).
 * Written into the run chat transcript so follow-up questions see the same truth as the UI.
 */
export function buildProjectRunTerminalStatusInjectMessage(execution: ProjectExecute): string {
  const lines: string[] = [
    `[System] Project Run execution ${execution.id} ended with status: ${execution.status}.`,
  ];
  if (typeof execution.durationMs === "number" && Number.isFinite(execution.durationMs)) {
    lines.push(`Approximate duration: ${Math.round(execution.durationMs / 1000)}s.`);
  }
  if (execution.cancelReason?.trim()) {
    lines.push(
      execution.status === "completed"
        ? `Operator note: ${truncateForInject(execution.cancelReason, 800)}`
        : `Stop reason: ${truncateForInject(execution.cancelReason, 800)}`,
    );
  }
  if (execution.lastErrorMessage?.trim() && execution.status !== "cancelled") {
    lines.push(`Last error: ${truncateForInject(execution.lastErrorMessage, 800)}`);
  }
  lines.push(
    "This run is no longer active automation. Answer operator questions about outcome using this status and the transcript; do not claim the run is still in progress.",
  );
  if (execution.operatorStopKind === "finish") {
    lines.push(
      "Stop immediately: do not call any tools (browser, web_fetch, exec, read_ead_execution, report_running_step, etc.). Reply with a short summary (2–5 sentences) of what you accomplished for this run.",
    );
  } else if (execution.operatorStopKind === "cancel") {
    lines.push(
      "Stop immediately: do not call any tools. Reply with one brief sentence acknowledging cancellation unless the operator asks for more detail.",
    );
  }
  return lines.join("\n");
}

/** Injected when the operator pauses a running execution. */
export function buildProjectRunPausedInjectMessage(execution: ProjectExecute): string {
  return [
    `[System] Project Run ${execution.id} is paused by the operator.`,
    "Do not continue browsing or heavy automation until the run is resumed. Reply to the operator when they write here.",
  ].join(" ");
}

/** Injected when the operator resumes after pause (or after bootstrap confirmation). */
export function buildProjectRunResumedInjectMessage(execution: ProjectExecute): string {
  return [
    `[System] Project Run ${execution.id} is active again (status: ${execution.status}).`,
    "Continue per Instructions and prior context.",
  ].join(" ");
}

/**
 * User message that kicks off (or resumes) the run-scoped agent.
 * Intentionally concise: long prompts + large browser snapshots quickly exceed 128k context on small models.
 * The operator's Instructions must stay primary; avoid injecting a parallel "how to browse" script that competes with that prompt.
 */
export function buildProjectRunBootstrapMessage(
  execution: ProjectRunBootstrapFields,
  options?: { operatorConfirmed?: boolean },
): string {
  const operatorConfirmed = Boolean(options?.operatorConfirmed);
  return [
    "OpenClaw Project Run — you alone decide how to browse, tool-use, and structure the final reply to satisfy Instructions below.",
    execution.aiPrompt?.trim() ? `Instructions: ${execution.aiPrompt.trim()}` : "",
    `Execution id: ${execution.id}.`,
    execution.name?.trim() ? `Name: ${execution.name.trim()}.` : "",
    execution.targetUrl?.trim() ? `Target URL: ${execution.targetUrl.trim()}.` : "",
    ...describeProjectRunAuth(execution, { operatorConfirmed }),
    execution.authMode === "manual-bootstrap" && !operatorConfirmed
      ? "Paused until the operator finishes login/bootstrap; ask if needed."
      : "",
    execution.authMode === "manual-bootstrap" && operatorConfirmed
      ? "Operator confirmed bootstrap done; continue per Instructions."
      : "",
    "After major milestones, call report_running_step with a short title and description; include thumbnailUrl or up to three thumbnailUrls (the most relevant screenshot URLs from browser tool results for that step). In that description (and in any assistant debrief), include screenshots recorded so far: call read_ead_execution with the execution id and state screenshotsRecorded plainly (for example: Screenshots recorded in this run so far: N).",
    "Each browser screenshot waits a random 5–10 seconds before capture to let pages settle and reduce rate limits. If limits persist, add more time between screenshot-heavy actions.",
    "Sequence navigations: wait for a page load to finish before starting another open/navigate to a different URL, or Playwright may report a navigation interrupted by another navigation.",
    "Operator messages in this chat must get a direct assistant reply (acknowledge and act) before you continue silent tool loops.",
    "Advanced interactive style: treat each cycle as plan → tools → plain-language debrief. Before tools, one tight paragraph on goals and next moves. After tools, summarize success/failure, extract facts the operator cares about, and state the next step—like a senior agent pairing with a human, not a batch job.",
    "When the model exposes reasoning or thinking, still add a short user-visible recap in the assistant message so the panel always reads clearly even without expanded reasoning UI.",
  ]
    .filter(Boolean)
    .join(" ");
}
