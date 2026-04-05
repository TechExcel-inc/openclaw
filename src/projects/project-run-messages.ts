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
    "Keep the operator oriented: briefly state what you plan to do next before a batch of tools, and briefly recap what you did plus what you will do next after tools return.",
    "Task checkpoints: after finishing a major step or tool batch, pause automation to check chat. First answer any operator questions or feedback, then summarize your progress, and only then start the next task. Do not ignore the operator to rush through consecutive tasks.",
    "Visibility is part of job quality, not optional: if you would otherwise stay silent through a long stretch of tools or navigation, break it up—prefer a short user-visible message first, then continue. Do not optimize only for uninterrupted automation.",
    "Cadence: about every ~1 minute of continuous browser or tool work without a user-visible assistant message, pause automation momentum—send one short engaging message (plain-language status, takeaway, or question; budget ~10 seconds of operator attention) before starting the next tool batch.",
    "If work continues without a new user-visible assistant message for about one minute (e.g. long login, slow pages, many tools), send a short pulse update: current sub-goal, what you are trying or waiting on, and what comes next.",
    "The operator may not see expanded reasoning UI—put essential plans and conclusions in the normal assistant message text, not only in hidden thinking.",
    "When the operator asks for run status, use this message, read_ead_execution if needed, and the dashboard — do not invent a different state.",
    "When the operator sends a new question or direction in chat, address it first in your reply before continuing unrelated browsing or long tool chains. Treat new operator messages as urgent: your next assistant reply should answer or acknowledge them before more browser tools—not after another long silent stretch.",
    "During login or authentication trouble, send user-visible status much sooner than the usual ~1 minute cadence—after each attempt or failed tool round, not minutes later.",
    "When sign-in or account access is required, that is top priority: pause unrelated exploration until login succeeds or is clearly impossible. Do not open the target or login URL and do not attempt login (typing credentials, submitting forms) until you have sent a user-visible assistant message that explains what you will do next and what you need from the operator, and allow time for them to reply if input is needed. After that, proceed. If visiting the site fails, times out, or is unreachable, stop and engage the operator with what happened—do not retry in silence. If login is not successful (rejected credentials, MFA failure, captcha, lockout, or unknown error), explain in chat what failed and what you observed on the page or in the error text so the operator can help—do not move on without stating why. Until login succeeds, do not treat the rest of Instructions as started—no exploration or documentation work past the auth wall. After a failed login, do not chain another login attempt without at least ~20 seconds of pause and a user-visible message in between so the operator can read updates and send messages; answer their questions before the next attempt.",
    "Credential fields: you may only type username or password into a login form when those exact values are already stated in Instructions, Authentication notes, or this chat by the operator. If you only see the form but credentials are not clearly established for this run, ask the operator in chat to provide or confirm username and password and wait for their reply before any browser action that fills or submits login—do not go straight from snapshot to typing credentials in the same burst.",
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
    "If the operator asks a new question or gives new direction in chat, answer or acknowledge it immediately in your next assistant message before more automation—conversation interrupts browsing; do not make them wait for the next tool batch.",
    "Task checkpoints: after finishing a major step or tool batch, pause automation to check chat. First answer any operator questions or feedback, then summarize your progress, and only then start the next task.",
    "Balance throughput with communication: brief updates to the operator are part of a successful run. Prefer interleaving short explanations with work over chaining many tools with no user-visible text in between.",
    "Cadence: about every minute of sustained browsing or tooling, take a deliberate engagement turn—one short assistant message to the operator (~10 seconds of reading time) before more tools. Browsing is not the only product; the operator should never feel left behind for long stretches.",
    "Proactively inform the operator in chat: before meaningful tool batches, say in one or two sentences what you will try next and why; after tools complete, say what you learned or achieved and what the next action will be. Avoid long silence across tool chains.",
    "During login, navigation, or other stretches longer than ~1 minute without a new assistant reply, add a brief pulse message so the operator sees progress (what you are doing, any blocker, next step). Repeat important reasoning in visible assistant text, not only in hidden thinking.",
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
    "Sign-in and authentication: when required, stop other jobs first—successful login comes before the rest of Instructions; if login is not successful, the main job has not really started yet—prioritize chat with the operator over pushing more automation. Sequence: (1) Message the operator first with your plan and what you need (passwords, MFA, account). Do not visit the target or login page and do not enter credentials until that message is sent and any needed operator reply is considered. (2) Then use the browser. (3) If the visit fails, loads time out, or the site is unreachable, explain the failure in chat and engage—do not spin silently. (4) If login still fails after an attempt, state clearly why (observed error message, page state, or best inference) so the operator can fix credentials or next steps. (5) Before any retry login attempt, wait at least ~20 seconds from the previous attempt and send a short assistant message so the operator can respond—do not rapid-fire login retries. (6) When you discover a login form, do not fill username/password unless those values are already in Instructions, Authentication notes, or this chat—otherwise ask the operator to input or confirm them in chat first and wait; never skip from form discovery to typing credentials without that step. Use credentials or hints in Instructions and Authentication notes; otherwise ask here—do not invent passwords.",
    "After major milestones, call report_running_step with a short title and description; optional thumbnailUrl or thumbnailUrls from recent browser screenshots for the dashboard step log.",
    "Each browser screenshot waits a random 8–16 seconds before capture to let pages settle and reduce rate limits. If limits persist, add more time between screenshot-heavy actions.",
    "Sequence navigations: wait for a page load to finish before starting another open/navigate to a different URL, or Playwright may report a navigation interrupted by another navigation.",
  ]
    .filter(Boolean)
    .join(" ");
}
