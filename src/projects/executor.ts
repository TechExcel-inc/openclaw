import {
  loadGatewaySessionRow,
  loadSessionEntry,
  readSessionMessages,
} from "../gateway/session-utils.js";
import { loadProjectsStore, resolveProjectsStorePath, saveProjectsStore } from "./store.js";
import type { EadFmNodeRun, ProgressLogEntry, TestCaseRun, TestCaseStepRun } from "./types.js";

const executionControllers = new Map<string, AbortController>();

type ExploreCandidateKind = "button" | "link" | "menuitem" | "tab";
type ExploreCandidatePurpose = "detail" | "section";
type RawExploreCandidate = {
  exploreId: string;
  href: string | null;
  inNavigation: boolean;
  kind: ExploreCandidateKind;
  label: string;
  sameOrigin: boolean;
};
type ExploreCandidate = RawExploreCandidate & {
  key: string;
  score: number;
};

function normalizeExploreLabel(
  value: string | null | undefined,
  fallback = "Untitled view",
): string {
  const normalized = (value ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return fallback;
  }
  return normalized.length > 70 ? `${normalized.slice(0, 67).trimEnd()}...` : normalized;
}

function describePage(url: string, title: string): string {
  const safeTitle = normalizeExploreLabel(title, "");
  if (safeTitle) {
    return `${safeTitle} (${url})`;
  }
  return url;
}

function buildExploreCandidateKey(raw: RawExploreCandidate): string {
  return `${raw.kind}|${(raw.href ?? "").toLowerCase()}|${normalizeExploreLabel(raw.label).toLowerCase()}`;
}

function isDangerousExploreLabel(label: string): boolean {
  return /\b(add|approve|archive|book|buy|cancel subscription|checkout|confirm|create|deactivate|delete|destroy|disable|disconnect|drop|end call|erase|invite|logout|log out|new\b|pay|purchase|remove|reset|revoke|save|send|sign out|submit|transfer|unlink|update)\b/i.test(
    label,
  );
}

function scoreExploreCandidate(raw: RawExploreCandidate, purpose: ExploreCandidatePurpose): number {
  let score = 0;
  if (raw.inNavigation) {
    score += purpose === "section" ? 60 : 15;
  }
  if (raw.kind === "tab") {
    score += purpose === "detail" ? 35 : 20;
  } else if (raw.kind === "link") {
    score += raw.href ? 30 : 12;
  } else if (raw.kind === "menuitem") {
    score += 22;
  } else {
    score += 16;
  }
  if (raw.sameOrigin) {
    score += 12;
  }
  const label = raw.label.toLowerCase();
  if (
    /\b(dashboard|home|overview|project|workspace|team|user|member|settings|report|analytics|calendar|meeting|room|chat|call|admin)\b/i.test(
      label,
    )
  ) {
    score += purpose === "section" ? 20 : 8;
  }
  if (label.length >= 3 && label.length <= 40) {
    score += 8;
  }
  if (isDangerousExploreLabel(raw.label)) {
    score -= 1000;
  }
  return score;
}

function prepareExploreCandidates(
  rawCandidates: RawExploreCandidate[],
  purpose: ExploreCandidatePurpose,
  limit: number,
): ExploreCandidate[] {
  const deduped = new Map<string, ExploreCandidate>();
  for (const raw of rawCandidates) {
    const label = normalizeExploreLabel(raw.label, "");
    if (!label) {
      continue;
    }
    const normalized = { ...raw, label };
    const candidate: ExploreCandidate = {
      ...normalized,
      key: buildExploreCandidateKey(normalized),
      score: scoreExploreCandidate(normalized, purpose),
    };
    if (candidate.score < 0) {
      continue;
    }
    const existing = deduped.get(candidate.key);
    if (!existing || candidate.score > existing.score) {
      deduped.set(candidate.key, candidate);
    }
  }
  return [...deduped.values()]
    .toSorted((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, limit);
}

export const __internal = {
  describePage,
  isDangerousExploreLabel,
  normalizeExploreLabel,
  prepareExploreCandidates,
};

async function loadExecution(
  storePath: string,
  executionId: string,
): Promise<{
  store: Awaited<ReturnType<typeof loadProjectsStore>>;
  execution: NonNullable<Awaited<ReturnType<typeof loadProjectsStore>>["executions"][number]>;
} | null> {
  const store = await loadProjectsStore(storePath);
  const execution = store.executions.find((entry) => entry.id === executionId);
  if (!execution) {
    return null;
  }
  return { store, execution };
}

async function persistExecution(
  storePath: string,
  store: Awaited<ReturnType<typeof loadProjectsStore>>,
): Promise<void> {
  await saveProjectsStore(storePath, store);
}

async function updateExecutionSnapshot(
  storePath: string,
  executionId: string,
  update: (
    execution: NonNullable<Awaited<ReturnType<typeof loadProjectsStore>>["executions"][number]>,
  ) => void,
): Promise<void> {
  const snap = await loadExecution(storePath, executionId);
  if (!snap) {
    return;
  }
  update(snap.execution);
  await persistExecution(storePath, snap.store);
}

async function sleepWithAbort(signal: AbortSignal, timeoutMs: number): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function truncateExecutionText(value: string | undefined, maxChars = 2_000): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars - 3).trimEnd()}...` : trimmed;
}

function extractTranscriptText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (!part || typeof part !== "object") {
          return "";
        }
        const typedPart = part as { type?: unknown; text?: unknown; content?: unknown };
        if (typedPart.type === "text" && typeof typedPart.text === "string") {
          return typedPart.text;
        }
        return extractTranscriptText(typedPart.content);
      })
      .filter(Boolean)
      .join("\n")
      .trim();
  }
  if (content && typeof content === "object") {
    const nested = content as { text?: unknown; content?: unknown };
    if (typeof nested.text === "string") {
      return nested.text.trim();
    }
    return extractTranscriptText(nested.content);
  }
  return "";
}

const PROGRESS_LOG_MAX = 300;
const PROGRESS_TEXT_MAX = 200;

/** Truncate string for display. */
function truncateForLog(value: string | undefined, max: number): string {
  if (!value) {
    return "";
  }
  const t = value.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}...` : t;
}

/**
 * Build a natural-language description for a tool_use block.
 * Never returns undefined — always produces a description.
 */
function describeToolAction(name: string, block: Record<string, unknown>): string {
  const input = block.input as Record<string, unknown> | undefined;
  const inp = input && typeof input === "object" ? input : {};
  // Also check top-level fields as fallback
  const src = { ...inp, ...block };

  // ── Browser / computer-use tools ──
  if (name === "browser" || name === "computer") {
    const action = truncateForLog(typeof src.action === "string" ? src.action : undefined, 40);
    const url = truncateForLog(typeof src.url === "string" ? src.url : undefined, 120);
    const desc = truncateForLog(
      typeof src.description === "string" ? src.description : undefined,
      60,
    );
    const elem = truncateForLog(typeof src.element === "string" ? src.element : undefined, 60);
    const sel = truncateForLog(typeof src.selector === "string" ? src.selector : undefined, 60);
    const text = truncateForLog(typeof src.text === "string" ? src.text : undefined, 50);
    const key = truncateForLog(typeof src.key === "string" ? src.key : undefined, 30);
    const coord =
      typeof src.coordinate === "object" && src.coordinate ? JSON.stringify(src.coordinate) : "";
    const label = desc || elem || sel;

    if (url && (action === "goto_url" || action === "navigate" || !action)) {
      return `Navigating to ${url}`;
    }
    if (action === "screenshot" || action === "screenshot_element") {
      return label ? `Taking screenshot of "${label}"` : "Taking a screenshot...";
    }
    if (action === "click") {
      return label ? `Clicking "${label}"` : coord ? `Clicking at ${coord}` : "Clicking...";
    }
    if (action === "type") {
      return text ? `Typing "${text}"` : "Typing...";
    }
    if (action === "key") {
      return key ? `Pressing ${key}` : "Pressing a key...";
    }
    if (action === "hover") {
      return label ? `Hovering over "${label}"` : "Hovering...";
    }
    if (action === "scroll") {
      return "Scrolling the page...";
    }
    if (action === "wait" || action === "wait_for") {
      return "Waiting...";
    }
    if (action === "new_tab") {
      return "Opening a new tab...";
    }
    if (action === "close_tab" || action === "close") {
      return "Closing tab...";
    }
    if (action === "go_back") {
      return "Going back...";
    }
    if (action === "select_option") {
      return label ? `Selecting "${label}"` : "Selecting an option...";
    }
    // Fallback: show whatever we know
    if (action && url) {
      return `Browser: ${action} ${url}`;
    }
    if (action && label) {
      return `Browser: ${action} "${label}"`;
    }
    if (action && text) {
      return `Browser: ${action}`;
    }
    if (action) {
      return `Performing ${action}...`;
    }
    if (url) {
      return `Opening ${url}`;
    }
    return `Using ${name}...`;
  }

  // ── Shell / exec ──
  if (name === "exec" || name === "shell") {
    const cmd = truncateForLog(typeof src.command === "string" ? src.command : undefined, 80);
    return cmd ? `Running: ${cmd}` : "Running command...";
  }

  // ── File read ──
  if (name === "read" || name === "read_file") {
    const path = truncateForLog(typeof src.file_path === "string" ? src.file_path : undefined, 100);
    if (!path) {
      return `Reading file...`;
    }
    const base = path.split("/").pop() ?? path;
    return `Reading ${base}`;
  }

  // ── File write / edit ──
  if (name === "write" || name === "write_file" || name === "edit") {
    const path = truncateForLog(typeof src.file_path === "string" ? src.file_path : undefined, 100);
    if (!path) {
      return "Editing file...";
    }
    const base = path.split("/").pop() ?? path;
    return `Editing ${base}`;
  }

  // ── Image / vision ──
  if (name === "image" || name === "analyze_image") {
    const prompt = truncateForLog(typeof src.prompt === "string" ? src.prompt : undefined, 60);
    return prompt ? `Analyzing image: "${prompt}"` : "Analyzing image...";
  }

  // ── Search ──
  if (name === "search" || name === "glob" || name === "grep" || name === "find") {
    const pattern = truncateForLog(typeof src.pattern === "string" ? src.pattern : undefined, 60);
    const query = truncateForLog(typeof src.query === "string" ? src.query : undefined, 60);
    const term = pattern || query;
    return term ? `Searching for "${term}"` : "Searching...";
  }

  // ── Generic fallback: extract useful fields from input ──
  const url = truncateForLog(typeof src.url === "string" ? src.url : undefined, 120);
  const query = truncateForLog(typeof src.query === "string" ? src.query : undefined, 60);
  const desc = truncateForLog(
    typeof src.description === "string" ? src.description : undefined,
    80,
  );
  const path = truncateForLog(typeof src.file_path === "string" ? src.file_path : undefined, 80);
  if (url) {
    return `Opening ${url}`;
  }
  if (path) {
    return `Working with ${path.split("/").pop() ?? path}`;
  }
  if (query) {
    return `Query: "${query}"`;
  }
  if (desc) {
    return desc;
  }
  // Last resort: just show the tool name
  return `Using ${name}...`;
}

/**
 * Extracts progress log entries from new transcript messages (index >= alreadyProcessed).
 * No deduplication — every action gets logged. Capped at PROGRESS_LOG_MAX total entries.
 */
function extractProgressLogFromTranscript(
  sessionKey: string,
  existingLog: ProgressLogEntry[],
  alreadyProcessed: number,
): ProgressLogEntry[] {
  const loaded = loadSessionEntry(sessionKey);
  if (!loaded.entry?.sessionId) {
    return [];
  }
  const transcript = readSessionMessages(
    loaded.entry.sessionId,
    loaded.storePath,
    loaded.entry.sessionFile,
  );
  if (transcript.length <= alreadyProcessed) {
    return [];
  }

  const entries: ProgressLogEntry[] = [];

  for (let i = alreadyProcessed; i < transcript.length; i++) {
    const row = transcript[i];
    if (!row || typeof row !== "object") {
      continue;
    }
    const msg = row as Record<string, unknown>;
    const role = typeof msg.role === "string" ? msg.role : "";
    const ts =
      typeof msg.timestamp === "number"
        ? msg.timestamp
        : typeof msg.__openclaw === "object"
          ? (((msg.__openclaw as Record<string, unknown>)?.ts as number) ?? Date.now())
          : Date.now();

    if (role === "assistant") {
      const content = Array.isArray(msg.content) ? msg.content : null;
      let hasToolUse = false;

      if (content) {
        // Extract text blocks — natural language narration
        for (const block of content) {
          if (!block || typeof block !== "object") {
            continue;
          }
          const b = block as Record<string, unknown>;
          const btype = typeof b.type === "string" ? b.type.trim().toLowerCase() : "";
          if (btype === "tool_use" || btype === "toolcall" || btype === "tool_call") {
            hasToolUse = true;
            const toolName = typeof b.name === "string" ? b.name.trim() : "";
            if (!toolName) {
              continue;
            }
            entries.push({ ts, kind: "tool_use", text: describeToolAction(toolName, b) });
          } else if (btype === "text" && typeof b.text === "string" && b.text.trim()) {
            const raw = b.text.trim();
            // Skip pure system/context boilerplate
            if (raw.startsWith("[") && (raw.includes("System]") || raw.includes("Context]"))) {
              continue;
            }
            entries.push({
              ts,
              kind: "assistant",
              text: truncateForLog(raw, PROGRESS_TEXT_MAX),
            });
          }
        }
      }

      // Fallback: toolName field without content array
      if (!hasToolUse && !content) {
        const rawName = msg.toolName ?? msg.tool_name;
        if (typeof rawName === "string" && rawName.trim()) {
          entries.push({
            ts,
            kind: "tool_use",
            text: describeToolAction(rawName.trim(), msg),
          });
        } else {
          // Pure text assistant message without content array
          const textContent = extractTranscriptText(msg.content);
          if (textContent) {
            const raw = textContent.trim();
            if (!(raw.startsWith("[") && (raw.includes("System]") || raw.includes("Context]")))) {
              entries.push({
                ts,
                kind: "assistant",
                text: truncateForLog(raw, PROGRESS_TEXT_MAX),
              });
            }
          }
        }
      }
    } else if (role === "tool") {
      // Show tool result errors
      const isError = msg.is_error === true || msg.isError === true;
      const toolName =
        typeof msg.toolName === "string"
          ? msg.toolName.trim()
          : typeof msg.tool_name === "string"
            ? msg.tool_name.trim()
            : "";
      if (isError && toolName) {
        const errorText = extractTranscriptText(msg.content);
        entries.push({
          ts,
          kind: "system",
          text: errorText ? truncateForLog(errorText, 120) : `Error in ${toolName}`,
        });
      }
    }
  }

  return entries;
}

/** Append new progress log entries to the execution entry inside an updateExecutionSnapshot callback. */
function appendProgressLog(
  entry: { progressLog?: ProgressLogEntry[]; progressLogSeq?: number },
  newEntries: ProgressLogEntry[],
  newSeq: number,
) {
  if (newEntries.length === 0) {
    // Still update seq even if no new entries, so we don't re-scan
    if (newSeq > (entry.progressLogSeq ?? 0)) {
      entry.progressLogSeq = newSeq;
    }
    return;
  }
  const existing = entry.progressLog ?? [];
  entry.progressLog = [...existing, ...newEntries];
  if (entry.progressLog.length > PROGRESS_LOG_MAX) {
    entry.progressLog = entry.progressLog.slice(entry.progressLog.length - PROGRESS_LOG_MAX);
  }
  entry.progressLogSeq = newSeq;
}

function readProjectRunTranscriptSnapshot(sessionKey: string): {
  messageCount: number;
  latestAssistantText?: string;
} {
  const loaded = loadSessionEntry(sessionKey);
  if (!loaded.entry?.sessionId) {
    return { messageCount: 0 };
  }
  const transcript = readSessionMessages(
    loaded.entry.sessionId,
    loaded.storePath,
    loaded.entry.sessionFile,
  );
  let latestAssistantText: string | undefined;
  for (let i = transcript.length - 1; i >= 0; i -= 1) {
    const row = transcript[i] as { message?: unknown } | undefined;
    const maybeMessage = row?.message && typeof row.message === "object" ? row.message : row;
    if (!maybeMessage || typeof maybeMessage !== "object") {
      continue;
    }
    const message = maybeMessage as { role?: unknown; content?: unknown };
    if (message.role !== "assistant") {
      continue;
    }
    const text = truncateExecutionText(extractTranscriptText(message.content), 4_000);
    if (text) {
      latestAssistantText = text;
      break;
    }
  }
  return {
    messageCount: transcript.length,
    latestAssistantText,
  };
}

function buildTranscriptEvidenceRun(params: {
  executionId: string;
  latestAssistantText?: string;
  status: "Success" | "Failed";
}): EadFmNodeRun {
  const actualResult =
    truncateExecutionText(params.latestAssistantText, 4_000) ??
    "OpenClaw completed the run, but no assistant summary was captured in the transcript yet.";
  const stepRun: TestCaseStepRun = {
    stepId: `step-summary-${params.executionId}`,
    sortOrder: 1,
    procedureText: "Review the OpenClaw Project Run transcript",
    expectedResult: "A run summary, findings, or blocker explanation is captured in chat.",
    actualResult,
    mustPass: true,
    status: params.status,
    executionTimeMs: 1,
  };
  const testCaseRun: TestCaseRun = {
    caseId: `tc-summary-${params.executionId}`,
    title: "OpenClaw transcript summary",
    status: params.status,
    testCaseStepRuns: [stepRun],
  };
  return {
    nodeId: "openclaw-run-transcript",
    nodeKey: "openclaw-run-transcript",
    type: "chat",
    title: "OpenClaw Project Run transcript",
    status: params.status,
    testCaseRuns: [testCaseRun],
  };
}

function resolveActiveRunProgress(messageCount: number): number {
  return Math.min(15 + Math.max(0, messageCount) * 3, 92);
}

function resolveRunningHint(targetUrl?: string, paused = false, authMode?: string): string {
  if (paused) {
    if (authMode === "manual-bootstrap") {
      return "Waiting for the operator to finish login or bootstrap steps. Resume the run after authentication is complete.";
    }
    return targetUrl?.trim()
      ? `Project Run is paused for ${targetUrl.trim()}. Resume when you want OpenClaw to continue.`
      : "Project Run is paused. Resume when you want OpenClaw to continue.";
  }
  const prefix = targetUrl?.trim()
    ? `OpenClaw is exploring ${targetUrl.trim()}.`
    : "OpenClaw is exploring the target app.";
  return `${prefix} Follow the run chat for live reasoning, browser actions, and blockers.`;
}

function resolveTerminalHint(status: "completed" | "cancelled" | "error"): string {
  if (status === "completed") {
    return "OpenClaw finished this Project Run. Review the run chat for the full transcript and ask for a report or summary if needed.";
  }
  if (status === "cancelled") {
    return "The Project Run stopped before completion. Review the run chat for the last partial output and blocker details.";
  }
  return "The OpenClaw run ended with an error. Review the run chat for the failing step or blocker explanation.";
}

/**
 * Project Run is now primarily an orchestrator around a run-scoped OpenClaw chat session.
 * The gateway starts the real agent turn, and this executor keeps the project execution row
 * synced with that session's lifecycle and transcript.
 */
export async function runProjectExecution(executionId: string): Promise<void> {
  const storePath = resolveProjectsStorePath();
  const initial = await loadExecution(storePath, executionId);
  if (!initial) {
    throw new Error(`Execution ${executionId} not found`);
  }

  const { store, execution } = initial;
  const runSessionKey = execution.runSessionKey?.trim();
  if (!runSessionKey) {
    execution.status = "error";
    execution.lastErrorMessage = "Project Run session was not initialized.";
    execution.durationMs = execution.startTime
      ? Math.max(0, Date.now() - execution.startTime)
      : null;
    await persistExecution(storePath, store);
    throw new Error(`Execution ${executionId} missing run session key`);
  }

  const abortController = new AbortController();
  executionControllers.set(executionId, abortController);

  try {
    execution.status = "running";
    execution.paused = Boolean(execution.paused);
    execution.progressPercentage = Math.max(
      execution.progressPercentage,
      execution.paused ? 8 : 15,
    );
    execution.executorHint =
      execution.executorHint ||
      resolveRunningHint(execution.targetUrl, execution.paused, execution.authMode);
    await persistExecution(storePath, store);

    let missingSessionRowCount = 0;
    for (;;) {
      if (abortController.signal.aborted) {
        return;
      }

      const snap = await loadExecution(storePath, executionId);
      if (!snap) {
        return;
      }
      const current = snap.execution;
      const activeSessionKey = current.runSessionKey?.trim();
      if (!activeSessionKey) {
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "error";
          entry.lastErrorMessage = "Project Run session key disappeared while monitoring the run.";
          entry.durationMs = entry.startTime ? Math.max(0, Date.now() - entry.startTime) : null;
          entry.executorHint = resolveTerminalHint("error");
        });
        return;
      }
      if (
        current.status === "completed" ||
        current.status === "cancelled" ||
        current.status === "error"
      ) {
        return;
      }
      if (current.paused) {
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "running";
          entry.paused = true;
          entry.progressPercentage = Math.max(entry.progressPercentage, 8);
          entry.executorHint = resolveRunningHint(entry.targetUrl, true, entry.authMode);
        });
        await sleepWithAbort(abortController.signal, 1_200);
        continue;
      }

      const row = loadGatewaySessionRow(activeSessionKey);
      const transcript = readProjectRunTranscriptSnapshot(activeSessionKey);
      const newProgressEntries = extractProgressLogFromTranscript(
        activeSessionKey,
        current.progressLog ?? [],
        current.progressLogSeq ?? 0,
      );
      const currentTokens =
        typeof row?.totalTokensFresh === "number"
          ? row.totalTokensFresh
          : typeof row?.totalTokens === "number"
            ? row.totalTokens
            : undefined;

      if (!row) {
        missingSessionRowCount += 1;
        if (missingSessionRowCount >= 25) {
          await updateExecutionSnapshot(storePath, executionId, (entry) => {
            entry.status = "error";
            entry.progressPercentage = 0;
            entry.durationMs = entry.startTime ? Math.max(0, Date.now() - entry.startTime) : null;
            entry.lastErrorMessage =
              transcript.latestAssistantText ??
              "OpenClaw never reported a live session state for this Project Run.";
            entry.executorHint = resolveTerminalHint("error");
            appendProgressLog(entry, newProgressEntries, transcript.messageCount);
            entry.results = [
              buildTranscriptEvidenceRun({
                executionId,
                latestAssistantText: transcript.latestAssistantText,
                status: "Failed",
              }),
            ];
          });
          return;
        }
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "running";
          entry.paused = Boolean(entry.paused);
          entry.progressPercentage = Math.max(entry.progressPercentage, entry.paused ? 8 : 15);
          entry.executorHint = resolveRunningHint(entry.targetUrl, entry.paused, entry.authMode);
          appendProgressLog(entry, newProgressEntries, transcript.messageCount);
          if (typeof currentTokens === "number") {
            entry.logTokens = currentTokens;
          }
          if (transcript.latestAssistantText) {
            entry.results = [
              buildTranscriptEvidenceRun({
                executionId,
                latestAssistantText: transcript.latestAssistantText,
                status: "Success",
              }),
            ];
          }
        });
        await sleepWithAbort(abortController.signal, 1_200);
        continue;
      }

      missingSessionRowCount = 0;
      const rowStatus = typeof row.status === "string" ? row.status : "";
      if (rowStatus === "running" || !rowStatus) {
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "running";
          entry.paused = Boolean(entry.paused);
          entry.progressPercentage = Math.max(
            entry.progressPercentage,
            entry.paused ? 8 : resolveActiveRunProgress(transcript.messageCount),
          );
          entry.executorHint = resolveRunningHint(entry.targetUrl, entry.paused, entry.authMode);
          appendProgressLog(entry, newProgressEntries, transcript.messageCount);
          if (typeof currentTokens === "number") {
            entry.logTokens = currentTokens;
          }
          if (transcript.latestAssistantText) {
            entry.results = [
              buildTranscriptEvidenceRun({
                executionId,
                latestAssistantText: transcript.latestAssistantText,
                status: "Success",
              }),
            ];
          }
        });
        await sleepWithAbort(abortController.signal, 1_200);
        continue;
      }

      const terminalStatus =
        rowStatus === "done" ? "completed" : rowStatus === "killed" ? "cancelled" : "error";
      await updateExecutionSnapshot(storePath, executionId, (entry) => {
        entry.status = terminalStatus;
        entry.paused = false;
        entry.progressPercentage = terminalStatus === "completed" ? 100 : entry.progressPercentage;
        entry.durationMs =
          typeof row.runtimeMs === "number"
            ? row.runtimeMs
            : entry.startTime
              ? Math.max(0, Date.now() - entry.startTime)
              : null;
        entry.executorHint = resolveTerminalHint(terminalStatus);
        appendProgressLog(entry, newProgressEntries, transcript.messageCount);
        if (typeof currentTokens === "number") {
          entry.logTokens = currentTokens;
        }
        if (terminalStatus !== "completed" && !entry.lastErrorMessage) {
          entry.lastErrorMessage =
            transcript.latestAssistantText ??
            (rowStatus === "killed"
              ? "The Project Run was stopped before OpenClaw finished."
              : "OpenClaw ended the Project Run without a successful completion.");
        }
        entry.results = [
          buildTranscriptEvidenceRun({
            executionId,
            latestAssistantText: transcript.latestAssistantText,
            status: terminalStatus === "completed" ? "Success" : "Failed",
          }),
        ];
      });
      return;
    }
  } catch (err) {
    const errText = truncateExecutionText(String(err)) ?? "Unknown Project Run executor failure";
    await updateExecutionSnapshot(storePath, executionId, (entry) => {
      if (entry.status !== "cancelled") {
        entry.status = "error";
        entry.progressPercentage = 0;
        entry.durationMs = entry.startTime ? Math.max(0, Date.now() - entry.startTime) : null;
        entry.lastErrorMessage = entry.lastErrorMessage || errText;
        entry.executorHint = resolveTerminalHint("error");
      }
    });
  } finally {
    executionControllers.delete(executionId);
  }
}

/**
 * Cancels the local monitoring loop for a Project Run.
 * The gateway request handler is responsible for aborting the backing OpenClaw chat run.
 */
export async function cancelProjectExecution(executionId: string): Promise<void> {
  const controller = executionControllers.get(executionId);
  if (controller) {
    controller.abort();
    executionControllers.delete(executionId);
  }
}
