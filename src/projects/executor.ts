import {
  loadGatewaySessionRow,
  loadSessionEntry,
  readSessionMessages,
} from "../gateway/session-utils.js";
import { isTerminalProjectExecutionStatus } from "./project-run-session-guard.js";
import { loadProjectsStore, resolveProjectsStorePath, saveProjectsStore } from "./store.js";
import type {
  EadFmNodeRun,
  ProgressLogEntry,
  StepArtifact,
  StepResult,
  TestCaseRun,
  TestCaseStepRun,
} from "./types.js";

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
  extractRunningSteps,
  looksLikeProviderRateLimit,
  looksLikeBrowserNetworkBlocker,
  extractLatestBlockerHintFromProgressLog,
  computeHostStallAdvisory,
  resolveFailedRunHints,
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
  const beforeStatus = snap.execution.status;
  update(snap.execution);
  const afterStatus = snap.execution.status;
  await persistExecution(storePath, snap.store);
  if (
    isTerminalProjectExecutionStatus(afterStatus) &&
    !isTerminalProjectExecutionStatus(beforeStatus) &&
    snap.execution.runSessionKey?.trim()
  ) {
    const runKey = snap.execution.runSessionKey.trim();
    try {
      const { abortProjectRunTerminalChatRuns } =
        await import("../gateway/project-run-chat-abort.js");
      abortProjectRunTerminalChatRuns(runKey);
    } catch {
      // Gateway may not be initialized (tests, CLI-only paths).
    }
    try {
      const { injectProjectRunTerminalStatusFromExecutor } =
        await import("../gateway/project-run-status-inject.js");
      const { buildProjectRunTerminalStatusInjectMessage } =
        await import("./project-run-messages.js");
      await injectProjectRunTerminalStatusFromExecutor({
        sessionKey: runKey,
        message: buildProjectRunTerminalStatusInjectMessage(snap.execution),
      });
    } catch {
      // Gateway may not be initialized (tests, CLI-only paths).
    }
  }
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
const PROGRESS_TEXT_MAX = 2000;

/** Truncate string for display. */
function truncateForLog(value: string | undefined, max: number): string {
  if (!value) {
    return "";
  }
  const t = value.trim();
  return t.length > max ? `${t.slice(0, max).trimEnd()}...` : t;
}

/**
 * Pi transcripts use `type: "toolCall"` with `arguments` (string or object).
 * OpenClaw tool schemas use `input`. Normalize so executor + dashboard see the same fields.
 */
function normalizeToolCallBlock(block: Record<string, unknown>): Record<string, unknown> {
  const rawInput = block.input;
  if (rawInput && typeof rawInput === "object" && !Array.isArray(rawInput)) {
    return { ...(rawInput as Record<string, unknown>) };
  }
  const rawArgs = block.arguments;
  if (typeof rawArgs === "string" && rawArgs.trim()) {
    try {
      const parsed = JSON.parse(rawArgs) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return { ...(parsed as Record<string, unknown>) };
      }
    } catch {
      return {};
    }
  }
  if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
    return { ...(rawArgs as Record<string, unknown>) };
  }
  return {};
}

/**
 * Build a natural-language description for a tool_use block.
 * Never returns undefined — always produces a description.
 */
function describeToolAction(name: string, block: Record<string, unknown>): string {
  const inp = normalizeToolCallBlock(block);
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
async function extractProgressLogFromTranscript(
  sessionKey: string,
  existingLog: ProgressLogEntry[],
  alreadyProcessed: number,
  executionId: string,
): Promise<ProgressLogEntry[]> {
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
            entries.push({
              ts,
              kind: "tool_use",
              text: describeToolAction(toolName, b),
              toolName,
              toolInput: normalizeToolCallBlock(b),
            });
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
          const toolName = rawName.trim();
          const merged = { ...msg, input: msg.toolInput ?? msg.input };
          entries.push({
            ts,
            kind: "tool_use",
            text: describeToolAction(toolName, merged as Record<string, unknown>),
            toolName,
            toolInput: normalizeToolCallBlock(merged as Record<string, unknown>),
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
          text: errorText ? truncateForLog(errorText, 400) : `Error in ${toolName}`,
        });
      }

      // Check for raw image artifacts in the tool response
      const content = Array.isArray(msg.content) ? msg.content : [msg.content];
      for (const block of content) {
        if (!block || typeof block !== "object") {
          continue;
        }
        const b = block as Record<string, unknown>;
        let base64Data: string | undefined;

        if (b.type === "image") {
          if (typeof b.data === "string") {
            base64Data = b.data;
          } else if (
            b.source &&
            typeof b.source === "object" &&
            typeof (b.source as Record<string, unknown>).data === "string"
          ) {
            base64Data = (b.source as Record<string, unknown>).data as string;
          }
        } else if (
          typeof b.image_url === "object" &&
          b.image_url &&
          typeof (b.image_url as Record<string, unknown>).url === "string" &&
          ((b.image_url as Record<string, unknown>).url as string).startsWith("data:image/")
        ) {
          // OpenAI style
          base64Data = ((b.image_url as Record<string, unknown>).url as string).split(",")[1];
        }

        if (base64Data) {
          const { uploadBrowserScreenshot } = await import("./s3-storage.js");
          let url = await uploadBrowserScreenshot(base64Data, executionId);
          if (!url) {
            // Fallback to storing the image directly as a localized Data URL
            url = `data:image/png;base64,${base64Data}`;
          }
          if (url) {
            entries.push({
              ts,
              kind: "tool_result",
              text: "Captured browser screenshot.",
              imageUrl: url,
              thumbnailUrl: url,
            });
          }
        }
      }
    }
  }

  return entries;
}

/** Append new progress log entries to the execution entry inside an updateExecutionSnapshot callback. */
function appendProgressLog(
  entry: { progressLog?: ProgressLogEntry[]; progressLogSeq?: number; steps?: StepResult[] },
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

  entry.steps = extractRunningSteps(entry.progressLog);
}

/** Matches report_running_step schema: agent picks the most relevant shots per milestone. */
const MAX_THUMBNAIL_URLS_PER_STEP = 3;
const MAX_THUMBNAIL_URL_LEN = 4096;

function buildArtifactsForReportStep(
  toolInput: Record<string, unknown>,
  recentImage: ProgressLogEntry | undefined,
): StepArtifact[] {
  const urls: string[] = [];
  const rawUrls = toolInput.thumbnailUrls;
  if (Array.isArray(rawUrls)) {
    for (const u of rawUrls) {
      if (typeof u !== "string") {
        continue;
      }
      const t = u.trim();
      if (t.length > 0 && t.length <= MAX_THUMBNAIL_URL_LEN) {
        urls.push(t);
      }
    }
  }
  if (urls.length === 0 && typeof toolInput.thumbnailUrl === "string") {
    const t = toolInput.thumbnailUrl.trim();
    if (t.length > 0 && t.length <= MAX_THUMBNAIL_URL_LEN) {
      urls.push(t);
    }
  }
  const capped = urls.slice(0, MAX_THUMBNAIL_URLS_PER_STEP);
  const now = new Date().toISOString();
  if (capped.length > 0) {
    return capped.map((path) => ({
      type: "screenshot" as const,
      path,
      thumbnailPath: path,
      capturedAt: now,
    }));
  }
  if (recentImage?.imageUrl) {
    return [
      {
        type: "screenshot",
        path: recentImage.imageUrl,
        thumbnailPath: recentImage.thumbnailUrl ?? recentImage.imageUrl,
        capturedAt: new Date(recentImage.ts).toISOString(),
      },
    ];
  }
  return [];
}

function extractRunningSteps(log: ProgressLogEntry[]): StepResult[] {
  const steps: StepResult[] = [];
  let stepIndex = 1;

  for (let i = 0; i < log.length; i++) {
    const entry = log[i];

    // Fallback legacy support for existing runs that formatted XML
    if (entry.kind === "assistant") {
      const runningStepRegex =
        /<RUNNING_STEP>[\s\S]*?<TITLE>(.*?)<\/TITLE>[\s\S]*?<DESCRIPTION>(.*?)<\/DESCRIPTION>[\s\S]*?<\/RUNNING_STEP>/gi;
      let match;
      while ((match = runningStepRegex.exec(entry.text)) !== null) {
        const title = match[1].trim();
        const description = match[2].trim();

        let recentImage: ProgressLogEntry | undefined;
        for (let j = i; j >= 0; j--) {
          if (log[j].kind === "tool_result" && log[j].imageUrl) {
            recentImage = log[j];
            break;
          }
        }

        steps.push({
          stepId: `finding-${stepIndex++}`,
          title,
          status: "completed",
          summary: description,
          artifacts: recentImage
            ? [
                {
                  type: "screenshot",
                  path: recentImage.imageUrl!,
                  thumbnailPath: recentImage.thumbnailUrl || recentImage.imageUrl!,
                  capturedAt: new Date(recentImage.ts).toISOString(),
                },
              ]
            : [],
        });
      }
      continue;
    }

    // Tool-based milestones (parameters live on tool call; see normalizeToolCallBlock)
    if (entry.kind === "tool_use" && entry.toolName === "report_running_step") {
      const ti = entry.toolInput;
      if (ti && typeof ti === "object") {
        const raw = ti;
        const title = typeof raw.title === "string" ? raw.title || "Milestone" : "Milestone";
        const description = typeof raw.description === "string" ? raw.description : "";

        let recentImage: ProgressLogEntry | undefined;
        for (let j = i; j >= 0; j--) {
          if (log[j].kind === "tool_result" && log[j].imageUrl) {
            recentImage = log[j];
            break;
          }
        }

        steps.push({
          stepId: `finding-${stepIndex++}`,
          title,
          status: "completed",
          summary: description,
          artifacts: buildArtifactsForReportStep(raw, recentImage),
        });
      }
    }
  }

  // If the model never called report_running_step, show at least one browser milestone so the UI is not empty.
  if (steps.length === 0) {
    for (const entry of log) {
      if (entry.kind !== "tool_use" || entry.toolName !== "browser") {
        continue;
      }
      const inp = entry.toolInput;
      if (!inp || typeof inp !== "object") {
        continue;
      }
      const action =
        typeof (inp as { action?: unknown }).action === "string"
          ? String((inp as { action: string }).action).trim()
          : "";
      const url =
        typeof (inp as { url?: unknown }).url === "string"
          ? String((inp as { url: string }).url).trim()
          : typeof (inp as { targetUrl?: unknown }).targetUrl === "string"
            ? String((inp as { targetUrl: string }).targetUrl).trim()
            : "";
      if (action === "open" || action === "navigate") {
        steps.push({
          stepId: "auto-browser-1",
          title: url
            ? `Loaded ${url.length > 72 ? `${url.slice(0, 69)}...` : url}`
            : "Browser navigation",
          status: "completed",
          summary:
            "Automatic milestone from the browser tool. Call report_running_step after important findings for richer step notes.",
          artifacts: [],
        });
        break;
      }
    }
  }

  return steps;
}

function readProjectRunTranscriptSnapshot(sessionKey: string): {
  messageCount: number;
  latestAssistantText?: string;
  /** Recent transcript text (any roles) for classifying provider failures (e.g. rate limits). */
  tailTextForFailureHints?: string;
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

  const tailParts: string[] = [];
  const maxTailParts = 15;
  for (let i = transcript.length - 1; i >= 0 && tailParts.length < maxTailParts; i -= 1) {
    const row = transcript[i] as { message?: unknown } | undefined;
    const maybeMessage = row?.message && typeof row.message === "object" ? row.message : row;
    if (!maybeMessage || typeof maybeMessage !== "object") {
      continue;
    }
    const message = maybeMessage as { content?: unknown };
    const text = truncateExecutionText(extractTranscriptText(message.content), 2_000);
    if (text) {
      tailParts.push(text);
    }
  }
  const tailTextForFailureHints = tailParts.length > 0 ? tailParts.join("\n") : undefined;

  return {
    messageCount: transcript.length,
    latestAssistantText,
    tailTextForFailureHints,
  };
}

function looksLikeProviderRateLimit(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) {
    return false;
  }
  return (
    (t.includes("rate") && (t.includes("limit") || t.includes("limited"))) ||
    t.includes("429") ||
    t.includes("too many requests") ||
    t.includes("resource exhausted") ||
    t.includes("requests per minute") ||
    t.includes("tokens per min") ||
    t.includes("quota") ||
    t.includes("rate_limit")
  );
}

function resolveFailedRunHints(params: {
  latestAssistantText?: string;
  tailTextForFailureHints?: string;
}): { executorHint: string; lastErrorMessage: string } {
  const combined = [params.latestAssistantText ?? "", params.tailTextForFailureHints ?? ""].join(
    "\n",
  );
  if (looksLikeProviderRateLimit(combined)) {
    return {
      executorHint:
        "The model provider rate limit was reached before this run could finish. Wait and retry, or slow down browser screenshots (see run guidance).",
      lastErrorMessage:
        truncateExecutionText(params.latestAssistantText, 500) ??
        "The provider rate limit was reached. The run stopped early.",
    };
  }
  if (looksLikeBrowserNetworkBlocker(combined)) {
    return {
      executorHint:
        "The browser could not load the site (network error, SSL, or certificate problem). See the run chat for the exact error and how to fix it.",
      lastErrorMessage:
        truncateExecutionText(params.latestAssistantText, 500) ??
        truncateExecutionText(params.tailTextForFailureHints, 500) ??
        "Navigation or TLS failed. Check the run chat for details.",
    };
  }
  return {
    executorHint:
      "The OpenClaw run ended before completion. Review the run chat for the last messages or errors.",
    lastErrorMessage:
      truncateExecutionText(params.latestAssistantText, 500) ??
      "The run stopped before OpenClaw could finish successfully.",
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

const LIVE_BLOCKER_HINT_MAX = 220;

/** After this, suggest host/browser readiness if the run still looks stuck (see HOST_STALL_MAX_TRANSCRIPT_MESSAGES). */
const HOST_STALL_AFTER_MS = 5 * 60 * 1000;
/** Above this transcript size, assume real progress and do not show the long-stall nudge. */
const HOST_STALL_MAX_TRANSCRIPT_MESSAGES = 14;

/** Transcript progress entries for failed browser tools use kind "system" (see extractProgressLogFromTranscript). */
function looksLikeBrowserNetworkBlocker(text: string): boolean {
  const t = text.toLowerCase();
  if (!t.trim()) {
    return false;
  }
  if (t.includes("net::err") || t.includes("net:: err")) {
    return true;
  }
  if (
    t.includes("err_cert") ||
    t.includes("cert_common_name") ||
    (t.includes("certificate") &&
      (t.includes("invalid") || t.includes("ssl") || t.includes("error")))
  ) {
    return true;
  }
  if (
    t.includes("your connection is not private") ||
    t.includes("connection is not private") ||
    t.includes("ssl_error") ||
    t.includes("tls ")
  ) {
    return true;
  }
  if (
    t.includes("connection refused") ||
    t.includes("econnrefused") ||
    t.includes("enotfound") ||
    t.includes("name not resolved") ||
    (t.includes("dns") && (t.includes("failed") || t.includes("error")))
  ) {
    return true;
  }
  if (t.includes("navigation") && (t.includes("timeout") || t.includes("timed out"))) {
    return true;
  }
  if (t.includes("page failed to load") || t.includes("browser: page failed")) {
    return true;
  }
  if (t.includes("navigation failed")) {
    return true;
  }
  return false;
}

/**
 * Surfaces the latest browser/network failure in the dashboard hint while the run is still active,
 * so operators do not need to leave and re-enter the run to see that the site is unreachable.
 */
function extractLatestBlockerHintFromProgressLog(
  log: ProgressLogEntry[] | undefined,
): string | undefined {
  if (!log?.length) {
    return undefined;
  }
  const tail = log.length > 40 ? log.slice(log.length - 40) : log;
  for (let i = tail.length - 1; i >= 0; i -= 1) {
    const e = tail[i];
    if (!e || e.kind !== "system") {
      continue;
    }
    const text = typeof e.text === "string" ? e.text : "";
    if (looksLikeBrowserNetworkBlocker(text)) {
      const oneLine = text.replace(/\s+/g, " ").trim();
      return oneLine.length > LIVE_BLOCKER_HINT_MAX
        ? `${oneLine.slice(0, LIVE_BLOCKER_HINT_MAX - 1)}…`
        : oneLine;
    }
  }
  return undefined;
}

/**
 * If the run has been up for several minutes with little transcript activity and no clear tool error,
 * tell the operator what usually blocks host/browser startup (complements liveBlockerHint).
 */
function computeHostStallAdvisory(params: {
  startTime: number | null;
  paused: boolean;
  hasBlockerHint: boolean;
  messageCount: number;
}): string | undefined {
  if (params.paused || params.hasBlockerHint) {
    return undefined;
  }
  if (params.startTime == null || !Number.isFinite(params.startTime)) {
    return undefined;
  }
  if (params.messageCount > HOST_STALL_MAX_TRANSCRIPT_MESSAGES) {
    return undefined;
  }
  const elapsed = Date.now() - params.startTime;
  if (elapsed < HOST_STALL_AFTER_MS) {
    return undefined;
  }
  return (
    "This run has been active for 5+ minutes with little chat activity. " +
    "If the browser or host app never finished starting, check: gateway and browser service are running, " +
    "Chrome can start and attach, the target URL is reachable, HTTPS or certificate prompts, " +
    "and firewall or VPN rules. Open the run chat for tool output and check gateway logs."
  );
}

function resolveRunningHintWithOptionalBlocker(
  targetUrl: string | undefined,
  paused: boolean,
  authMode: string | undefined,
  blockerHint: string | undefined,
  stallAdvisory?: string,
): string {
  const trimmed = blockerHint?.trim();
  if (trimmed) {
    return `Browser or network issue: ${trimmed} Open the run chat for the full error and suggested next steps.`;
  }
  const stall = stallAdvisory?.trim();
  if (stall) {
    return stall;
  }
  return resolveRunningHint(targetUrl, paused, authMode);
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
        current.status === "failed" ||
        current.status === "cancelled" ||
        current.status === "error"
      ) {
        return;
      }
      if (current.paused) {
        const blockerHintPaused = extractLatestBlockerHintFromProgressLog(current.progressLog);
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "running";
          entry.paused = true;
          entry.progressPercentage = Math.max(entry.progressPercentage, 8);
          entry.executorHint = resolveRunningHintWithOptionalBlocker(
            entry.targetUrl,
            true,
            entry.authMode,
            blockerHintPaused,
          );
        });
        await sleepWithAbort(abortController.signal, 1_200);
        continue;
      }

      const row = loadGatewaySessionRow(activeSessionKey);
      const transcript = readProjectRunTranscriptSnapshot(activeSessionKey);
      const newProgressEntries = await extractProgressLogFromTranscript(
        activeSessionKey,
        current.progressLog ?? [],
        current.progressLogSeq ?? 0,
        executionId,
      );
      const candidateLogForHint = [...(current.progressLog ?? []), ...newProgressEntries];
      const liveBlockerHint = extractLatestBlockerHintFromProgressLog(candidateLogForHint);
      const stallAdvisory = computeHostStallAdvisory({
        startTime: current.startTime,
        paused: Boolean(current.paused),
        hasBlockerHint: Boolean(liveBlockerHint),
        messageCount: transcript.messageCount,
      });
      const currentTokens =
        typeof row?.totalTokensFresh === "number"
          ? row.totalTokensFresh
          : typeof row?.totalTokens === "number"
            ? row.totalTokens
            : undefined;

      const elapsedTimeMs = current.startTime ? Date.now() - current.startTime : 0;
      if (current.timeBudgetMinutes && elapsedTimeMs > current.timeBudgetMinutes * 60 * 1000) {
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "error";
          entry.lastErrorMessage = `Project Run forcibly stopped: Exceeded time budget of ${current.timeBudgetMinutes} minutes.`;
          entry.executorHint = resolveTerminalHint("error");
          entry.durationMs = elapsedTimeMs;
        });
        // Important: Stop the OpenClaw session properly? We don't have the context here, but setting status to error stops the loop.
        // The background session might continue until the next turn, but this halts the project execution orchestrator.
        return;
      }

      // Rough cost approximation: assume combined input/output cost averages around $3.00 per 1M tokens.
      const calculatedCostDollars = (currentTokens || 0) * (3.0 / 1000000);
      if (current.costBudgetDollars && calculatedCostDollars >= current.costBudgetDollars) {
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = "error";
          entry.lastErrorMessage = `Project Run forcibly stopped: Exceeded cost budget of $${current.costBudgetDollars}.`;
          entry.executorHint = resolveTerminalHint("error");
          entry.durationMs = elapsedTimeMs;
        });
        return;
      }

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
          entry.executorHint = resolveRunningHintWithOptionalBlocker(
            entry.targetUrl,
            entry.paused,
            entry.authMode,
            liveBlockerHint,
            stallAdvisory,
          );
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
          entry.executorHint = resolveRunningHintWithOptionalBlocker(
            entry.targetUrl,
            entry.paused,
            entry.authMode,
            liveBlockerHint,
            stallAdvisory,
          );
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

      if (rowStatus === "done" || rowStatus === "failed") {
        const terminalStatus = rowStatus === "failed" ? "failed" : "completed";
        await updateExecutionSnapshot(storePath, executionId, (entry) => {
          entry.status = terminalStatus;
          entry.paused = false;
          entry.progressPercentage = rowStatus === "done" ? 100 : entry.progressPercentage;
          if (rowStatus === "failed") {
            const hints = resolveFailedRunHints({
              latestAssistantText: transcript.latestAssistantText,
              tailTextForFailureHints: transcript.tailTextForFailureHints,
            });
            entry.executorHint = hints.executorHint;
            entry.lastErrorMessage = hints.lastErrorMessage;
          } else {
            entry.executorHint = resolveTerminalHint("completed");
          }
          appendProgressLog(entry, newProgressEntries, transcript.messageCount);
          if (typeof currentTokens === "number") {
            entry.logTokens = currentTokens;
          }
          if (transcript.latestAssistantText) {
            entry.results = [
              buildTranscriptEvidenceRun({
                executionId,
                latestAssistantText: transcript.latestAssistantText,
                status: rowStatus === "failed" ? "Failed" : "Success",
              }),
            ];
          }
        });
        // We will break out of the loop on the next iteration because current.status becomes completed/error.
        await sleepWithAbort(abortController.signal, 1_200);
        continue;
      }

      const terminalStatus = rowStatus === "killed" ? "cancelled" : "cancelled";
      await updateExecutionSnapshot(storePath, executionId, (entry) => {
        entry.status = terminalStatus;
        entry.paused = false;
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
        if (!entry.lastErrorMessage) {
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
            status: "Failed",
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

/**
 * Resumes monitoring for executions that were running or paused when the gateway was shut down.
 * Does not restart the backend agent run if it was killed entirely, but will resume listening to its session
 * and updating the execution UI state.
 */
export async function resumeActiveProjects(): Promise<void> {
  const storePath = resolveProjectsStorePath();
  const store = await loadProjectsStore(storePath).catch(() => null);
  if (!store) {
    return;
  }

  for (const execution of store.executions) {
    if (execution.status === "running" || execution.status === "pending") {
      // Background and don't block
      Promise.resolve()
        .then(() => runProjectExecution(execution.id))
        .catch((err) => console.error(`resumeActiveProjects panic for ${execution.id}:`, err));
    }
  }
}
