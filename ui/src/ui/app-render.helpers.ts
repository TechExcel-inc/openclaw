import { html, nothing, type TemplateResult } from "lit";
import { repeat } from "lit/directives/repeat.js";
import type {
  ExecutionStatus,
  ProjectExecute,
  ProjectTemplate,
} from "../../../src/projects/types.js";
import { parseAgentSessionKey } from "../../../src/sessions/session-key-utils.js";
import { applyEadChatSessionToState, switchChatSession } from "./chat/ead-chat-sync.ts";
import { writePersistedProjectChatId } from "./chat/ead-project-chat-persist.ts";
import { stripEadProjectSuffix } from "./chat/ead-project-session-key.ts";

export { applyEadChatSessionToState, switchChatSession };
import { t } from "../i18n/index.ts";
import { refreshChat } from "./app-chat.ts";
import type { AppViewState } from "./app-view-state.ts";
import { OpenClawApp } from "./app.ts";
import { createChatModelOverride } from "./chat-model-ref.ts";
import {
  resolveChatModelOverrideValue,
  resolveChatModelSelectState,
} from "./chat-model-select-state.ts";
import { refreshVisibleToolsEffectiveForCurrentSession } from "./controllers/agents.ts";
import { loadSessions } from "./controllers/sessions.ts";
import { icons } from "./icons.ts";
import {
  iconForTab,
  isChatTab,
  pathForProjectRunTab,
  pathForTab,
  titleForTab,
  type Tab,
} from "./navigation.ts";
import type { ThemeTransitionContext } from "./theme-transition.ts";
import type { ThemeMode, ThemeName } from "./theme.ts";
import type { SessionsListResult } from "./types.ts";

type SessionDefaultsSnapshot = {
  mainSessionKey?: string;
  mainKey?: string;
};

function resolveSidebarChatSessionKey(state: AppViewState): string {
  const snapshot = state.hello?.snapshot as
    | { sessionDefaults?: SessionDefaultsSnapshot }
    | undefined;
  const mainSessionKey = snapshot?.sessionDefaults?.mainSessionKey?.trim();
  if (mainSessionKey) {
    return mainSessionKey;
  }
  const mainKey = snapshot?.sessionDefaults?.mainKey?.trim();
  if (mainKey) {
    return mainKey;
  }
  return "main";
}

/**
 * Template id used to list "Project Run 1…N" under Chat.
 * Prefer Project Chat selection; fall back to Test Plan page (active / detail) so runs show
 * without opening Project Chat first.
 */
export function resolveActiveTemplateIdForProjectNav(state: AppViewState): string | null {
  const isKnownTemplate = (id: string) => state.templatesList.some((t) => t.id === id);

  const tid = state.chatActiveTemplateId;
  if (tid) {
    if (isKnownTemplate(tid)) {
      return tid;
    }
    // Execution id (run-scoped chat): resolve template from execution payload. Do not require
    // linkedTemplateId to appear in templatesList yet — list can lag behind connect/loadTemplates.
    const exFromList = state.globalExecutionsList?.find((e) => e.id === tid);
    const exFromDetail = state.executionDetail?.id === tid ? state.executionDetail : undefined;
    const ex = exFromList ?? exFromDetail;
    if (ex?.linkedTemplateId) {
      return ex.linkedTemplateId;
    }
  }

  const active = state.activeTemplateId?.trim();
  if (active && isKnownTemplate(active)) {
    return active;
  }

  const detailId = state.templateDetail?.id?.trim();
  if (detailId && isKnownTemplate(detailId)) {
    return detailId;
  }

  return null;
}

export function templateExecutionsOrdered(
  state: AppViewState,
  templateId: string,
): ProjectExecute[] {
  return (state.globalExecutionsList ?? [])
    .filter((e) => e.linkedTemplateId === templateId)
    .toSorted((a, b) => (a.startTime ?? 0) - (b.startTime ?? 0));
}

/** Runs for this template excluding those the user removed from the sidebar. */
export function visibleTemplateExecutionsForNav(
  state: AppViewState,
  templateId: string,
): ProjectExecute[] {
  const hidden = new Set(state.hiddenProjectRunNavIds ?? []);
  return templateExecutionsOrdered(state, templateId).filter((e) => !hidden.has(e.id));
}

/**
 * Before hiding a run from the sidebar, pick another visible run for the same template:
 * prefer the next run below in start-time order, else the run above. Returns null if there
 * is no sibling (caller should fall back to Project Chat).
 */
export function pickAdjacentProjectRunIdForNav(
  state: AppViewState,
  removedExecutionId: string,
): string | null {
  const templateId = resolveActiveTemplateIdForProjectNav(state);
  if (!templateId) {
    return null;
  }
  const visible = visibleTemplateExecutionsForNav(state, templateId);
  const idx = visible.findIndex((e) => e.id === removedExecutionId);
  if (idx === -1) {
    return null;
  }
  if (idx + 1 < visible.length) {
    return visible[idx + 1].id;
  }
  if (idx - 1 >= 0) {
    return visible[idx - 1].id;
  }
  return null;
}

export function projectRunOrdinalLabel(state: AppViewState, executionId: string): string {
  const templateId = resolveActiveTemplateIdForProjectNav(state);
  if (!templateId) {
    return "Running Project";
  }
  const list = visibleTemplateExecutionsForNav(state, templateId);
  const idx = list.findIndex((e) => e.id === executionId);
  const n = idx === -1 ? list.length + 1 : idx + 1;
  return `Running Project ${n}`;
}

/** User-facing run status for toolbar and summary (maps `completed` → Finished, etc.). */
export function formatExecutionStatusForUi(
  status: ExecutionStatus | undefined,
  paused: boolean | undefined,
): string {
  if (!status) {
    return t("chat.projectRunStatusLoading");
  }
  if (status === "running" && paused) {
    return t("chat.projectRunStatusPaused");
  }
  switch (status) {
    case "pending":
      return t("chat.projectRunStatusPending");
    case "running":
      return t("chat.projectRunStatusRunning");
    case "completed":
      return t("chat.projectRunStatusFinished");
    case "cancelled":
      return t("chat.projectRunStatusCancelled");
    case "error":
      return t("chat.projectRunStatusError");
    default:
      return String(status);
  }
}

function projectRunToolbarStatusDataState(
  status: ExecutionStatus | undefined,
  paused: boolean,
): string {
  if (!status) {
    return "loading";
  }
  if (status === "running" && paused) {
    return "paused";
  }
  if (status === "completed") {
    return "finished";
  }
  return status;
}

export function formatProjectRunSimpleMarkdown(state: AppViewState): string {
  const id = state.chatProjectRunExecutionId;
  if (!id) {
    return "## Project Run\n\nNo execution selected.";
  }
  const ex =
    state.executionDetail?.id === id
      ? state.executionDetail
      : state.globalExecutionsList?.find((e) => e.id === id);
  if (!ex) {
    return ["## Project Run & Chat", "", "Loading execution…", "", `\`id\`: \`${id}\``].join("\n");
  }
  const statusLabel = formatExecutionStatusForUi(ex.status, ex.paused);
  const prog = ex.progressPercentage ?? 0;
  const started = new Date(ex.startTime ?? Date.now()).toLocaleString();
  const duration =
    ex.durationMs != null
      ? `${Math.round(ex.durationMs / 1000)}s`
      : ex.status === "running" || ex.status === "pending"
        ? "…"
        : "—";
  const title = projectRunOrdinalLabel(state, id);
  const hint = ex.executorHint?.trim();
  const err = ex.lastErrorMessage?.trim();
  const cancelR = ex.cancelReason?.trim();
  const lines = [
    `## ${title}`,
    "",
    `**Status:** ${statusLabel}`,
    `**Progress:** ${prog}%`,
    `**Started:** ${started}`,
    `**Duration:** ${duration}`,
    "",
  ];
  if (hint) {
    lines.push(`**Note:** ${hint}`, "");
  }
  if (err) {
    lines.push(`**Last error:** \`${err.replace(/`/g, "'")}\``, "");
  }
  if (cancelR) {
    lines.push(`**Stop reason:** ${cancelR.replace(/`/g, "'")}`, "");
  }
  lines.push(`**Execution id:** \`${ex.id}\``, "");
  if (ex.progressLog && ex.progressLog.length > 0) {
    lines.push("---");
    lines.push("### Progress Log");
    lines.push("");
    for (const entry of ex.progressLog) {
      const time = new Date(entry.ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      if (entry.kind === "tool_use") {
        lines.push(`- **${time}** ${entry.text}`);
      } else if (entry.kind === "system") {
        lines.push(`- **${time}** ⚠️ ${entry.text}`);
      } else {
        lines.push(`- *${time}* ${entry.text}`);
      }
    }
    lines.push("");
  } else {
    lines.push("_Step captures render in the gallery below when the gateway returns them._");
  }
  return lines.join("\n");
}

/** Flatten screenshot steps from execution results (same shape as Test Run Project). */
export function projectRunScreenshotSteps(
  ex: ProjectExecute,
): Array<{ label: string; url: string }> {
  const out: Array<{ label: string; url: string }> = [];
  for (const node of ex.results ?? []) {
    for (const tc of node.testCaseRuns ?? []) {
      for (const step of tc.testCaseStepRuns ?? []) {
        const url = step.screenshotUrl?.trim();
        if (url) {
          out.push({
            label: (step.procedureText ?? "Capture").trim() || "Capture",
            url,
          });
        }
      }
    }
  }
  return out;
}

export function hasProjectRunCaptures(state: AppViewState): boolean {
  const id = state.chatProjectRunExecutionId?.trim();
  if (!id) {
    return false;
  }
  const ex =
    state.executionDetail?.id === id
      ? state.executionDetail
      : state.globalExecutionsList?.find((e) => e.id === id);
  return Boolean(ex && projectRunScreenshotSteps(ex).length > 0);
}

/**
 * Renders capture thumbnails beside the Project Run markdown summary. Base64 screenshots are
 * not embedded in markdown (size limit breaks the markdown pipeline).
 */
export function renderProjectRunCaptureGallery(state: AppViewState): TemplateResult | undefined {
  const id = state.chatProjectRunExecutionId?.trim();
  if (!id) {
    return undefined;
  }
  const ex =
    state.executionDetail?.id === id
      ? state.executionDetail
      : state.globalExecutionsList?.find((e) => e.id === id);
  if (!ex) {
    return undefined;
  }
  const steps = projectRunScreenshotSteps(ex);
  if (steps.length === 0) {
    return undefined;
  }
  return html`
    <div
      class="project-run-capture-gallery"
      style="margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--border); max-height: min(70vh, 720px); overflow-y: auto;"
    >
      <div
        style="font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: var(--muted); margin-bottom: 10px;"
      >
        ${t("chat.projectRunCaptureGalleryTitle")}
      </div>
      ${repeat(
        steps,
        (s) => s.url,
        (s, i) => html`
          <div style="margin-bottom: 14px;">
            <div style="font-size: 12px; color: var(--muted); margin-bottom: 6px;">${i + 1}. ${s.label}</div>
            <img
              src=${s.url}
              alt=""
              style="max-width: 100%; max-height: 220px; object-fit: contain; display: block; border: 1px solid var(--border-color); border-radius: 6px; background: var(--surface);"
            />
          </div>
        `,
      )}
    </div>
  `;
}

export function renderProjectRunNavItems(state: AppViewState, opts?: { collapsed?: boolean }) {
  const templateId = resolveActiveTemplateIdForProjectNav(state);
  if (!templateId) {
    return nothing;
  }
  const runs = visibleTemplateExecutionsForNav(state, templateId);
  if (runs.length === 0) {
    return nothing;
  }
  const collapsed = opts?.collapsed ?? state.settings.navCollapsed;
  const reversedRuns = runs.toReversed();

  return html`
    ${repeat(
      reversedRuns,
      (e) => e.id,
      (e) => {
        // Find original chronological index from the start
        const chronIdx = runs.findIndex((r) => r.id === e.id);
        const href = pathForProjectRunTab(e.id, state.basePath ?? "");
        const label = `Running Project ${chronIdx + 1}`;
        const isActive = state.tab === "chatProjectRun" && state.chatProjectRunExecutionId === e.id;
        return html`
          <a
            href=${href}
            class="nav-item ${isActive ? "nav-item--active" : ""}"
            @click=${(event: MouseEvent) => {
              if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              ) {
                return;
              }
              event.preventDefault();
              state.setProjectRunTab(e.id);
            }}
            title=${label}
          >
            <span class="nav-item__icon" aria-hidden="true">${icons.messageSquare}</span>
            ${!collapsed ? html`<span class="nav-item__text">${label}</span>` : nothing}
          </a>
        `;
      },
    )}
  `;
}

export function renderTab(state: AppViewState, tab: Tab, opts?: { collapsed?: boolean }) {
  const href = pathForTab(tab, state.basePath);
  const isActive = state.tab === tab;
  const collapsed = opts?.collapsed ?? state.settings.navCollapsed;
  return html`
    <a
      href=${href}
      class="nav-item ${isActive ? "nav-item--active" : ""}"
      @click=${(event: MouseEvent) => {
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        ) {
          return;
        }
        event.preventDefault();
        if (isChatTab(tab)) {
          const mainSessionKey = resolveSidebarChatSessionKey(state);
          const base = stripEadProjectSuffix(state.sessionKey);
          if (base !== mainSessionKey) {
            switchChatSession(state, mainSessionKey);
            void state.loadAssistantIdentity();
          }
        }
        state.setTab(tab);
      }}
      title=${titleForTab(tab)}
    >
      <span class="nav-item__icon" aria-hidden="true">${icons[iconForTab(tab)]}</span>
      ${!collapsed ? html`<span class="nav-item__text">${titleForTab(tab)}</span>` : nothing}
    </a>
  `;
}

function renderCronFilterIcon(hiddenCount: number) {
  return html`
    <span style="position: relative; display: inline-flex; align-items: center;">
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
        aria-hidden="true"
      >
        <circle cx="12" cy="12" r="10"></circle>
        <polyline points="12 6 12 12 16 14"></polyline>
      </svg>
      ${
        hiddenCount > 0
          ? html`<span
            style="
              position: absolute;
              top: -5px;
              right: -6px;
              background: var(--color-accent, #6366f1);
              color: #fff;
              border-radius: var(--radius-full);
              font-size: 9px;
              line-height: 1;
              padding: 1px 3px;
              pointer-events: none;
            "
          >${hiddenCount}</span
          >`
          : ""
      }
    </span>
  `;
}

/** Test Plan id for Project Chat (template only; execution ids resolve to linked template). */
function resolveTemplateIdForProjectChatPicker(state: AppViewState): string | null {
  return resolveActiveTemplateIdForProjectNav(state);
}

export function renderChatSessionSelect(state: AppViewState) {
  let projectKindLabel = "";
  let projectDisplayName = t("chat.selectProjectContinue");
  const templateId = resolveTemplateIdForProjectChatPicker(state);
  if (templateId) {
    const activeTemplate = state.templatesList.find((t) => t.id === templateId);
    if (activeTemplate) {
      projectKindLabel = "Test Plan";
      projectDisplayName = activeTemplate.name;
    }
  }
  const hasProjectContext = Boolean(projectKindLabel);
  const projectTitle = hasProjectContext
    ? `${projectKindLabel}: ${projectDisplayName}`
    : t("chat.selectProjectContinue");

  return html`
    <div class="chat-project-toolbar chat-project-toolbar--stacked">
      <div class="chat-project-toolbar__label-row">
        <span class="chat-project-toolbar__label">Select a project</span>
      </div>
      <div class="chat-project-toolbar__row2">
        <div class="chat-project-toolbar__left">
          <div
            class="chat-project-toolbar__project ${hasProjectContext ? "is-active" : ""}"
            title=${projectTitle}
            role="status"
            aria-live="polite"
          >
            ${
              projectKindLabel
                ? html`<span class="chat-project-toolbar__kind">${projectKindLabel}</span>`
                : nothing
            }
            <span class="chat-project-toolbar__name">${projectDisplayName}</span>
          </div>
          <button
            type="button"
            class="btn btn--sm btn--icon chat-project-toolbar__picker"
            @click=${() => {
              state.chatSelectedTemplateId = resolveTemplateIdForProjectChatPicker(state);
              state.showChatProjectModal = true;
            }}
            title="Select project"
            aria-label="Open project picker"
          >
            ${icons.moreHorizontal}
          </button>
        </div>
        <div class="chat-project-toolbar__controls">${renderChatControls(state)}</div>
      </div>
    </div>
  `;
}

export function renderProjectChatGate(state: AppViewState) {
  return html`
    <section class="project-chat-gate">
      <div class="project-chat-gate__card">
        <h2 class="project-chat-gate__title">${t("chat.projectGateTitle")}</h2>
        <p class="project-chat-gate__body">${t("chat.projectGateBody")}</p>
        <button
          type="button"
          class="btn btn--primary"
          @click=${() => {
            state.chatSelectedTemplateId = resolveTemplateIdForProjectChatPicker(state);
            state.showChatProjectModal = true;
          }}
        >
          ${t("chat.projectGateButton")}
        </button>
      </div>
    </section>
  `;
}

export function renderProjectRunGate(state: AppViewState) {
  return html`
    <section class="project-chat-gate">
      <div class="project-chat-gate__card">
        <h2 class="project-chat-gate__title">${t("chat.projectRunGateTitle")}</h2>
        <p class="project-chat-gate__body">${t("chat.projectRunGateBody")}</p>
        <button
          type="button"
          class="btn btn--primary"
          @click=${() => {
            state.setTab("chatProject");
          }}
        >
          ${t("chat.projectRunGateButton")}
        </button>
      </div>
    </section>
  `;
}

function formatChatModalDateTime(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) {
    return "—";
  }
  return new Date(ts).toLocaleString();
}

/** Placeholder until the gateway exposes Test Plan lifecycle. */
function templatePlanStatusLabel(
  _template: ProjectTemplate,
): "Active" | "Inactive" | "In Progress" {
  return "Active";
}

function templatePlanStatusPillClass(label: "Active" | "Inactive" | "In Progress"): string {
  if (label === "Active") {
    return "chat-project-modal__pill chat-project-modal__pill--active";
  }
  if (label === "Inactive") {
    return "chat-project-modal__pill chat-project-modal__pill--inactive";
  }
  return "chat-project-modal__pill chat-project-modal__pill--inprogress";
}

export function renderChatProjectModal(state: AppViewState) {
  if (!state.showChatProjectModal) {
    return nothing;
  }

  const modalOkDisabled =
    state.chatSelectedTemplateId == null ||
    !state.templatesList.some((t) => t.id === state.chatSelectedTemplateId);

  return html`
    <div
      class="chat-project-modal"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          state.showChatProjectModal = false;
        }
      }}
    >
      <div class="chat-project-modal__dialog">
        <header class="chat-project-modal__toolbar">
          <div class="chat-project-modal__toolbar-left">
            <h2 class="chat-project-modal__title">${t("chat.projectModalTitle")}</h2>
            <p class="chat-project-modal__subtitle" style="margin: 6px 0 0; font-size: 13px; color: var(--muted); max-width: 42rem;">
              ${t("chat.projectModalSubtitle")}
            </p>
          </div>
          <div class="chat-project-modal__toolbar-actions">
            <button
              type="button"
              class="chat-project-modal__btn chat-project-modal__btn--primary"
              ?disabled=${modalOkDisabled}
              @click=${() => {
                if (modalOkDisabled) {
                  return;
                }
                const id = state.chatSelectedTemplateId?.trim();
                if (!id || !state.templatesList.some((t) => t.id === id)) {
                  return;
                }
                state.chatActiveTemplateId = id;
                writePersistedProjectChatId(id);
                state.showChatProjectModal = false;
                state.projectLeftPanelDismissed = false;
                switchChatSession(state, state.sessionKey);
              }}
            >
              OK
            </button>
            <button
              type="button"
              class="chat-project-modal__btn"
              @click=${() => {
                state.showChatProjectModal = false;
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              class="chat-project-modal__help"
              title="Help (coming soon)"
              aria-label="Help"
              @click=${(e: Event) => {
                e.preventDefault();
              }}
            >
              ${icons.helpCircle}
            </button>
          </div>
        </header>

        <div class="chat-project-modal__body">
          <div class="chat-project-modal__panel">
            <div class="chat-project-modal__tablewrap">
              <table class="chat-project-modal__table">
                <thead>
                  <tr>
                    <th>Project name</th>
                    <th>Time created</th>
                    <th>Created by</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${state.templatesList.map((template) => {
                    const planStatus = templatePlanStatusLabel(template);
                    return html`
                      <tr
                        class=${
                          state.chatSelectedTemplateId === template.id
                            ? "chat-project-modal__row--selected"
                            : ""
                        }
                        @click=${() => {
                          state.chatSelectedTemplateId = template.id;
                        }}
                      >
                        <td>
                          <div class="chat-project-modal__name">${template.name}</div>
                          <div class="chat-project-modal__muted">
                            ${template.description || "—"}
                          </div>
                        </td>
                        <td>${formatChatModalDateTime(template.createdAt)}</td>
                        <td>${template.createdBy?.trim() || "—"}</td>
                        <td>
                          <span
                            class=${templatePlanStatusPillClass(planStatus)}
                            title="Full lifecycle rules coming soon"
                            >${planStatus}</span
                          >
                        </td>
                      </tr>
                    `;
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function renderChatControls(state: AppViewState) {
  const hideCron = state.sessionsHideCron ?? true;
  const hiddenCronCount = hideCron
    ? countHiddenCronSessions(state.sessionKey, state.sessionsResult)
    : 0;
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const showToolCalls = state.onboarding ? true : state.settings.chatShowToolCalls;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  const toolCallsIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
      ></path>
    </svg>
  `;
  const refreshIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8"></path>
      <path d="M21 3v5h-5"></path>
    </svg>
  `;
  const focusIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
  const sessionsIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
      <line x1="8" y1="21" x2="16" y2="21"></line>
      <line x1="12" y1="17" x2="12" y2="21"></line>
    </svg>
  `;
  const llmIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M12 2v20"></path>
      <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
    </svg>
  `;

  const sessionGroups = resolveSessionOptionGroups(state, state.sessionKey, state.sessionsResult);
  const modelSelect = renderChatModelSelect(state);

  return html`
    <div class="chat-controls">
      <!-- Run Instances (Sessions) Icon Menu -->
      <label class="btn btn--sm btn--icon" style="position: relative; display: inline-flex; overflow: hidden; margin-right: 4px;" title="Run Instances (Session)">
        ${sessionsIcon}
        <select
          style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer;"
          .value=${state.sessionKey}
          ?disabled=${!state.connected || sessionGroups.length === 0}
          @change=${(e: Event) => {
            const next = (e.target as HTMLSelectElement).value;
            if (state.sessionKey === next) {
              return;
            }
            switchChatSession(state, next);
          }}
        >
          ${repeat(
            sessionGroups,
            (group) => group.id,
            (group) =>
              html`<optgroup label=${group.label}>
                ${repeat(
                  group.options,
                  (entry) => entry.key,
                  (entry) =>
                    html`<option value=${entry.key} title=${entry.title}>
                      ${entry.label}
                    </option>`,
                )}
              </optgroup>`,
          )}
        </select>
      </label>

      <!-- LLM (Model) Icon Menu -->
      <div style="position: relative; display: inline-flex; align-items: center; margin-right: 4px;" title="LLM (Model)">
        <span class="btn btn--sm btn--icon" style="pointer-events: none;">${llmIcon}</span>
        <div style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; opacity: 0; cursor: pointer; overflow: hidden;">
          ${modelSelect}
        </div>
      </div>

      <button
        class="btn btn--sm btn--icon"
        ?disabled=${state.chatLoading || !state.connected}
        @click=${async () => {
          const app = state as unknown as OpenClawApp;
          app.chatManualRefreshInFlight = true;
          app.chatNewMessagesBelow = false;
          await app.updateComplete;
          app.resetToolStream();
          try {
            await refreshChat(state as unknown as Parameters<typeof refreshChat>[0], {
              scheduleScroll: false,
            });
            app.scrollToBottom({ smooth: true });
          } finally {
            requestAnimationFrame(() => {
              app.chatManualRefreshInFlight = false;
              app.chatNewMessagesBelow = false;
            });
          }
        }}
        title=${t("chat.refreshTitle")}
      >
        ${refreshIcon}
      </button>
      <span class="chat-controls__separator">|</span>
      <button
        class="btn btn--sm btn--icon ${showThinking ? "active" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatShowThinking: !state.settings.chatShowThinking,
          });
        }}
        aria-pressed=${showThinking}
        title=${disableThinkingToggle ? t("chat.onboardingDisabled") : t("chat.thinkingToggle")}
      >
        ${icons.brain}
      </button>
      <button
        class="btn btn--sm btn--icon ${showToolCalls ? "active" : ""}"
        ?disabled=${disableThinkingToggle}
        @click=${() => {
          if (disableThinkingToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatShowToolCalls: !state.settings.chatShowToolCalls,
          });
        }}
        aria-pressed=${showToolCalls}
        title=${disableThinkingToggle ? t("chat.onboardingDisabled") : t("chat.toolCallsToggle")}
      >
        ${toolCallsIcon}
      </button>
      <button
        class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
        ?disabled=${disableFocusToggle}
        @click=${() => {
          if (disableFocusToggle) {
            return;
          }
          state.applySettings({
            ...state.settings,
            chatFocusMode: !state.settings.chatFocusMode,
          });
        }}
        aria-pressed=${focusActive}
        title=${disableFocusToggle ? t("chat.onboardingDisabled") : t("chat.focusToggle")}
      >
        ${focusIcon}
      </button>
      <button
        class="btn btn--sm btn--icon ${hideCron ? "active" : ""}"
        @click=${() => {
          state.sessionsHideCron = !hideCron;
        }}
        aria-pressed=${hideCron}
        title=${
          hideCron
            ? hiddenCronCount > 0
              ? t("chat.showCronSessionsHidden", { count: String(hiddenCronCount) })
              : t("chat.showCronSessions")
            : t("chat.hideCronSessions")
        }
      >
        ${renderCronFilterIcon(hiddenCronCount)}
      </button>
    </div>
  `;
}

/** Toolbar for Project Run chat only (not General Chat or Project Chat). */
export function renderProjectRunToolbar(state: AppViewState) {
  const runId = state.chatProjectRunExecutionId?.trim();
  const runExec = runId
    ? state.executionDetail?.id === runId
      ? state.executionDetail
      : state.globalExecutionsList?.find((e) => e.id === runId)
    : undefined;
  const status = runExec?.status;
  const paused = Boolean(runExec?.paused);
  const canStop = Boolean(runId && (status === "pending" || status === "running"));
  const canPauseResume = Boolean(runId && status === "running");
  const statusText = runId
    ? formatExecutionStatusForUi(status, runExec?.paused)
    : t("chat.projectRunStatusLoading");
  const statusDataState = projectRunToolbarStatusDataState(status, Boolean(runExec?.paused));
  return html`
    <div class="chat-controls chat-controls--project-run">
      <span
        class="chat-controls__project-run-status"
        data-status=${statusDataState}
        aria-live="polite"
        >${statusText}</span
      >
      ${
        canStop
          ? html`
              <button
                type="button"
                class="btn btn--sm"
                @click=${() => state.openProjectRunConfirm("stop")}
              >
                ${t("chat.projectRunStop")}
              </button>
            `
          : nothing
      }
      ${
        canPauseResume
          ? paused
            ? html`
                <button
                  type="button"
                  class="btn btn--sm btn--primary"
                  @click=${() => {
                    if (runId) {
                      void state.handleExecutionResume(runId);
                    }
                  }}
                >
                  ${t("chat.projectRunResume")}
                </button>
              `
            : html`
                <button
                  type="button"
                  class="btn btn--sm"
                  @click=${() => {
                    if (runId) {
                      void state.handleExecutionPause(runId);
                    }
                  }}
                >
                  ${t("chat.projectRunPause")}
                </button>
              `
          : nothing
      }
      ${
        runId
          ? html`
              <button
                type="button"
                class="btn btn--sm btn--ghost"
                @click=${() => state.openProjectRunConfirm("remove")}
              >
                ${t("chat.projectRunRemove")}
              </button>
            `
          : nothing
      }
    </div>
  `;
}

export function renderProjectRunConfirmDialog(state: AppViewState) {
  const kind = state.projectRunConfirmKind;
  if (!kind) {
    return nothing;
  }
  const body =
    kind === "stop" ? t("chat.projectRunConfirmStop") : t("chat.projectRunConfirmRemove");
  return html`
    <div
      class="project-create-modal"
      style="z-index: 2000;"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget) {
          state.dismissProjectRunConfirm();
        }
      }}
    >
      <div
        class="project-create-modal__dialog"
        style="max-width: 420px;"
        @click=${(e: Event) => e.stopPropagation()}
      >
        <p style="margin: 0 0 16px; line-height: 1.5;">${body}</p>
        ${
          kind === "stop"
            ? html`
                <label class="project-create-modal__label" style="display: block; margin-bottom: 8px; font-size: 13px; color: var(--muted);"
                  >${t("chat.projectRunStopReasonOptional")}</label
                >
                <textarea
                  class="project-create-modal__textarea"
                  style="width: 100%; min-height: 72px; margin-bottom: 16px; box-sizing: border-box; padding: 8px; border-radius: var(--radius-md); border: 1px solid var(--border); background: var(--surface); color: var(--text); font: inherit;"
                  .value=${state.projectRunStopReasonDraft}
                  placeholder=${t("chat.projectRunStopReasonPlaceholder")}
                  @input=${(e: Event) => {
                    const el = e.target as HTMLTextAreaElement;
                    state.projectRunStopReasonDraft = el.value;
                  }}
                ></textarea>
              `
            : nothing
        }
        <div class="project-create-modal__actions" style="margin-top: 0;">
          <button type="button" class="project-create-modal__btn" @click=${() => state.dismissProjectRunConfirm()}>
            ${t("common.cancel")}
          </button>
          <button
            type="button"
            class="project-create-modal__btn ${kind === "stop" ? "project-create-modal__btn--danger" : "project-create-modal__btn--primary"}"
            @click=${() => state.confirmProjectRunConfirm()}
          >
            ${t("chat.projectRunConfirm")}
          </button>
        </div>
      </div>
    </div>
  `;
}

/**
 * Mobile-only gear toggle + dropdown for chat controls.
 * Rendered in the topbar so it doesn't consume content-header space.
 * Hidden on desktop via CSS.
 */
export function renderChatMobileToggle(state: AppViewState) {
  const sessionGroups = resolveSessionOptionGroups(state, state.sessionKey, state.sessionsResult);
  const disableThinkingToggle = state.onboarding;
  const disableFocusToggle = state.onboarding;
  const showThinking = state.onboarding ? false : state.settings.chatShowThinking;
  const showToolCalls = state.onboarding ? true : state.settings.chatShowToolCalls;
  const focusActive = state.onboarding ? true : state.settings.chatFocusMode;
  const toolCallsIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path
        d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
      ></path>
    </svg>
  `;
  const focusIcon = html`
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M4 7V4h3"></path>
      <path d="M20 7V4h-3"></path>
      <path d="M4 17v3h3"></path>
      <path d="M20 17v3h-3"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;

  return html`
    <div class="chat-mobile-controls-wrapper">
      <button
        class="btn btn--sm btn--icon chat-controls-mobile-toggle"
        @click=${(e: Event) => {
          e.stopPropagation();
          const btn = e.currentTarget as HTMLElement;
          const dropdown = btn.nextElementSibling as HTMLElement;
          if (dropdown) {
            const isOpen = dropdown.classList.toggle("open");
            if (isOpen) {
              const close = () => {
                dropdown.classList.remove("open");
                document.removeEventListener("click", close);
              };
              setTimeout(() => document.addEventListener("click", close, { once: true }), 0);
            }
          }
        }}
        title="Chat settings"
        aria-label="Chat settings"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>
      <div class="chat-controls-dropdown" @click=${(e: Event) => {
        e.stopPropagation();
      }}>
        <div class="chat-controls">
          <label class="field chat-controls__session">
            <select
              .value=${state.sessionKey}
              @change=${(e: Event) => {
                const next = (e.target as HTMLSelectElement).value;
                switchChatSession(state, next);
              }}
            >
              ${sessionGroups.map(
                (group) => html`
                  <optgroup label=${group.label}>
                    ${group.options.map(
                      (opt) => html`
                        <option value=${opt.key} title=${opt.title}>
                          ${opt.label}
                        </option>
                      `,
                    )}
                  </optgroup>
                `,
              )}
            </select>
          </label>
          <div class="chat-controls__thinking">
            <button
              class="btn btn--sm btn--icon ${showThinking ? "active" : ""}"
              ?disabled=${disableThinkingToggle}
              @click=${() => {
                if (!disableThinkingToggle) {
                  state.applySettings({
                    ...state.settings,
                    chatShowThinking: !state.settings.chatShowThinking,
                  });
                }
              }}
              aria-pressed=${showThinking}
              title=${t("chat.thinkingToggle")}
            >
              ${icons.brain}
            </button>
            <button
              class="btn btn--sm btn--icon ${showToolCalls ? "active" : ""}"
              ?disabled=${disableThinkingToggle}
              @click=${() => {
                if (!disableThinkingToggle) {
                  state.applySettings({
                    ...state.settings,
                    chatShowToolCalls: !state.settings.chatShowToolCalls,
                  });
                }
              }}
              aria-pressed=${showToolCalls}
              title=${t("chat.toolCallsToggle")}
            >
              ${toolCallsIcon}
            </button>
            <button
              class="btn btn--sm btn--icon ${focusActive ? "active" : ""}"
              ?disabled=${disableFocusToggle}
              @click=${() => {
                if (!disableFocusToggle) {
                  state.applySettings({
                    ...state.settings,
                    chatFocusMode: !state.settings.chatFocusMode,
                  });
                }
              }}
              aria-pressed=${focusActive}
              title=${t("chat.focusToggle")}
            >
              ${focusIcon}
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderChatModelSelect(state: AppViewState) {
  const { currentOverride, defaultLabel, options } = resolveChatModelSelectState(state);
  const busy =
    state.chatLoading || state.chatSending || Boolean(state.chatRunId) || state.chatStream !== null;
  const disabled =
    !state.connected || busy || (state.chatModelsLoading && options.length === 0) || !state.client;
  return html`
    <label class="field chat-controls__session chat-controls__model">
      <select
        data-chat-model-select="true"
        aria-label="Chat model"
        ?disabled=${disabled}
        @change=${async (e: Event) => {
          const next = (e.target as HTMLSelectElement).value.trim();
          await switchChatModel(state, next);
        }}
      >
        <option value="" ?selected=${currentOverride === ""}>${defaultLabel}</option>
        ${repeat(
          options,
          (entry) => entry.value,
          (entry) =>
            html`<option value=${entry.value} ?selected=${entry.value === currentOverride}>
              ${entry.label}
            </option>`,
        )}
      </select>
    </label>
  `;
}

async function refreshSessionOptions(state: AppViewState) {
  await loadSessions(state as unknown as Parameters<typeof loadSessions>[0], {
    activeMinutes: 0,
    limit: 0,
    includeGlobal: true,
    includeUnknown: true,
  });
}

async function switchChatModel(state: AppViewState, nextModel: string) {
  if (!state.client || !state.connected) {
    return;
  }
  const currentOverride = resolveChatModelOverrideValue(state);
  if (currentOverride === nextModel) {
    return;
  }
  const targetSessionKey = state.sessionKey;
  const prevOverride = state.chatModelOverrides[targetSessionKey];
  state.lastError = null;
  // Write the override cache immediately so the picker stays in sync during the RPC round-trip.
  state.chatModelOverrides = {
    ...state.chatModelOverrides,
    [targetSessionKey]: createChatModelOverride(nextModel),
  };
  try {
    await state.client.request("sessions.patch", {
      key: targetSessionKey,
      model: nextModel || null,
    });
    void refreshVisibleToolsEffectiveForCurrentSession(state);
    await refreshSessionOptions(state);
  } catch (err) {
    // Roll back so the picker reflects the actual server model.
    state.chatModelOverrides = { ...state.chatModelOverrides, [targetSessionKey]: prevOverride };
    state.lastError = `Failed to set model: ${String(err)}`;
  }
}

/* ── Channel display labels ────────────────────────────── */
const CHANNEL_LABELS: Record<string, string> = {
  bluebubbles: "iMessage",
  telegram: "Telegram",
  discord: "Discord",
  signal: "Signal",
  slack: "Slack",
  whatsapp: "WhatsApp",
  matrix: "Matrix",
  email: "Email",
  sms: "SMS",
};

const KNOWN_CHANNEL_KEYS = Object.keys(CHANNEL_LABELS);

/** Parsed type / context extracted from a session key. */
export type SessionKeyInfo = {
  /** Prefix for typed sessions (Subagent:/Cron:). Empty for others. */
  prefix: string;
  /** Human-readable fallback when no label / displayName is available. */
  fallbackName: string;
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Parse a session key to extract type information and a human-readable
 * fallback display name.  Exported for testing.
 */
export function parseSessionKey(key: string): SessionKeyInfo {
  const normalized = key.toLowerCase();

  // ── Main session ─────────────────────────────────
  if (key === "main" || key === "agent:main:main") {
    return { prefix: "", fallbackName: "Main Session" };
  }

  // ── Subagent ─────────────────────────────────────
  if (key.includes(":subagent:")) {
    return { prefix: "Subagent:", fallbackName: "Subagent:" };
  }

  // ── Cron job ─────────────────────────────────────
  if (normalized.startsWith("cron:") || key.includes(":cron:")) {
    return { prefix: "Cron:", fallbackName: "Cron Job:" };
  }

  // ── Direct chat  (agent:<x>:<channel>:direct:<id>) ──
  const directMatch = key.match(/^agent:[^:]+:([^:]+):direct:(.+)$/);
  if (directMatch) {
    const channel = directMatch[1];
    const identifier = directMatch[2];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} · ${identifier}` };
  }

  // ── Group chat  (agent:<x>:<channel>:group:<id>) ────
  const groupMatch = key.match(/^agent:[^:]+:([^:]+):group:(.+)$/);
  if (groupMatch) {
    const channel = groupMatch[1];
    const channelLabel = CHANNEL_LABELS[channel] ?? capitalize(channel);
    return { prefix: "", fallbackName: `${channelLabel} Group` };
  }

  // ── Channel-prefixed legacy keys (e.g. "bluebubbles:g-…") ──
  for (const ch of KNOWN_CHANNEL_KEYS) {
    if (key === ch || key.startsWith(`${ch}:`)) {
      return { prefix: "", fallbackName: `${CHANNEL_LABELS[ch]} Session` };
    }
  }

  // ── Unknown — return key as-is ───────────────────
  return { prefix: "", fallbackName: key };
}

export function resolveSessionDisplayName(
  key: string,
  row?: SessionsListResult["sessions"][number],
): string {
  const label = row?.label?.trim() || "";
  const displayName = row?.displayName?.trim() || "";
  const { prefix, fallbackName } = parseSessionKey(key);

  const applyTypedPrefix = (name: string): string => {
    if (!prefix) {
      return name;
    }
    const prefixPattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*`, "i");
    return prefixPattern.test(name) ? name : `${prefix} ${name}`;
  };

  if (label && label !== key) {
    return applyTypedPrefix(label);
  }
  if (displayName && displayName !== key) {
    return applyTypedPrefix(displayName);
  }
  return fallbackName;
}

export function isCronSessionKey(key: string): boolean {
  const normalized = key.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (normalized.startsWith("cron:")) {
    return true;
  }
  if (!normalized.startsWith("agent:")) {
    return false;
  }
  const parts = normalized.split(":").filter(Boolean);
  if (parts.length < 3) {
    return false;
  }
  const rest = parts.slice(2).join(":");
  return rest.startsWith("cron:");
}

type SessionOptionEntry = {
  key: string;
  label: string;
  scopeLabel: string;
  title: string;
};

type SessionOptionGroup = {
  id: string;
  label: string;
  options: SessionOptionEntry[];
};

export function resolveSessionOptionGroups(
  state: AppViewState,
  sessionKey: string,
  sessions: SessionsListResult | null,
): SessionOptionGroup[] {
  const rows = sessions?.sessions ?? [];
  const hideCron = state.sessionsHideCron ?? true;
  const byKey = new Map<string, SessionsListResult["sessions"][number]>();
  for (const row of rows) {
    byKey.set(row.key, row);
  }

  const seenKeys = new Set<string>();
  const groups = new Map<string, SessionOptionGroup>();
  const ensureGroup = (groupId: string, label: string): SessionOptionGroup => {
    const existing = groups.get(groupId);
    if (existing) {
      return existing;
    }
    const created: SessionOptionGroup = {
      id: groupId,
      label,
      options: [],
    };
    groups.set(groupId, created);
    return created;
  };

  const addOption = (key: string) => {
    if (!key || seenKeys.has(key)) {
      return;
    }
    seenKeys.add(key);
    const row = byKey.get(key);
    const parsed = parseAgentSessionKey(key);
    const group = parsed
      ? ensureGroup(
          `agent:${parsed.agentId.toLowerCase()}`,
          resolveAgentGroupLabel(state, parsed.agentId),
        )
      : ensureGroup("other", "Other Sessions");
    const scopeLabel = parsed?.rest?.trim() || key;
    const label = resolveSessionScopedOptionLabel(key, row, parsed?.rest);
    group.options.push({
      key,
      label,
      scopeLabel,
      title: key,
    });
  };

  for (const row of rows) {
    if (row.key !== sessionKey && (row.kind === "global" || row.kind === "unknown")) {
      continue;
    }
    if (hideCron && row.key !== sessionKey && isCronSessionKey(row.key)) {
      continue;
    }
    addOption(row.key);
  }
  addOption(sessionKey);

  for (const group of groups.values()) {
    const counts = new Map<string, number>();
    for (const option of group.options) {
      counts.set(option.label, (counts.get(option.label) ?? 0) + 1);
    }
    for (const option of group.options) {
      if ((counts.get(option.label) ?? 0) > 1 && option.scopeLabel !== option.label) {
        option.label = `${option.label} · ${option.scopeLabel}`;
      }
    }
  }

  const allOptions = Array.from(groups.values()).flatMap((group) =>
    group.options.map((option) => ({ groupLabel: group.label, option })),
  );
  const labels = new Map(allOptions.map(({ option }) => [option, option.label]));
  const countAssignedLabels = () => {
    const counts = new Map<string, number>();
    for (const { option } of allOptions) {
      const label = labels.get(option) ?? option.label;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return counts;
  };
  const labelIncludesScopeLabel = (label: string, scopeLabel: string) => {
    const trimmedScope = scopeLabel.trim();
    if (!trimmedScope) {
      return false;
    }
    return (
      label === trimmedScope ||
      label.endsWith(` · ${trimmedScope}`) ||
      label.endsWith(` / ${trimmedScope}`)
    );
  };

  const globalCounts = countAssignedLabels();
  for (const { groupLabel, option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((globalCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    const scopedPrefix = `${groupLabel} / `;
    if (currentLabel.startsWith(scopedPrefix)) {
      continue;
    }
    // Keep the agent visible once the native select collapses to a single chosen label.
    labels.set(option, `${groupLabel} / ${currentLabel}`);
  }

  const scopedCounts = countAssignedLabels();
  for (const { option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((scopedCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    if (labelIncludesScopeLabel(currentLabel, option.scopeLabel)) {
      continue;
    }
    labels.set(option, `${currentLabel} · ${option.scopeLabel}`);
  }

  const finalCounts = countAssignedLabels();
  for (const { option } of allOptions) {
    const currentLabel = labels.get(option) ?? option.label;
    if ((finalCounts.get(currentLabel) ?? 0) <= 1) {
      continue;
    }
    // Fall back to the full key only when every friendlier disambiguator still collides.
    labels.set(option, `${currentLabel} · ${option.key}`);
  }

  for (const { option } of allOptions) {
    option.label = labels.get(option) ?? option.label;
  }

  return Array.from(groups.values());
}

/** Count sessions with a cron: key that would be hidden when hideCron=true. */
function countHiddenCronSessions(sessionKey: string, sessions: SessionsListResult | null): number {
  if (!sessions?.sessions) {
    return 0;
  }
  // Don't count the currently active session even if it's a cron.
  return sessions.sessions.filter((s) => isCronSessionKey(s.key) && s.key !== sessionKey).length;
}

function resolveAgentGroupLabel(state: AppViewState, agentIdRaw: string): string {
  const normalized = agentIdRaw.trim().toLowerCase();
  const agent = (state.agentsList?.agents ?? []).find(
    (entry) => entry.id.trim().toLowerCase() === normalized,
  );
  const name = agent?.identity?.name?.trim() || agent?.name?.trim() || "";
  return name && name !== agentIdRaw ? `${name} (${agentIdRaw})` : agentIdRaw;
}

function resolveSessionScopedOptionLabel(
  key: string,
  row?: SessionsListResult["sessions"][number],
  rest?: string,
) {
  const base = rest?.trim() || key;
  if (!row) {
    return base;
  }

  const label = row.label?.trim() || "";
  const displayName = row.displayName?.trim() || "";
  if ((label && label !== key) || (displayName && displayName !== key)) {
    return resolveSessionDisplayName(key, row);
  }

  return base;
}

type ThemeOption = { id: ThemeName; label: string; icon: string };
const THEME_OPTIONS: ThemeOption[] = [
  { id: "claw", label: "Claw", icon: "🦀" },
  { id: "knot", label: "Knot", icon: "🪢" },
  { id: "dash", label: "Dash", icon: "📊" },
];

type ThemeModeOption = { id: ThemeMode; label: string; short: string };
const THEME_MODE_OPTIONS: ThemeModeOption[] = [
  { id: "system", label: "System", short: "SYS" },
  { id: "light", label: "Light", short: "LIGHT" },
  { id: "dark", label: "Dark", short: "DARK" },
];

function currentThemeIcon(theme: ThemeName): string {
  return THEME_OPTIONS.find((o) => o.id === theme)?.icon ?? "🎨";
}

export function renderTopbarThemeModeToggle(state: AppViewState) {
  const modeIcon = (mode: ThemeMode) => {
    if (mode === "system") {
      return icons.monitor;
    }
    if (mode === "light") {
      return icons.sun;
    }
    return icons.moon;
  };

  const applyMode = (mode: ThemeMode, e: Event) => {
    if (mode === state.themeMode) {
      return;
    }
    state.setThemeMode(mode, { element: e.currentTarget as HTMLElement });
  };

  return html`
    <div class="topbar-theme-mode" role="group" aria-label="Color mode">
      ${THEME_MODE_OPTIONS.map(
        (opt) => html`
          <button
            type="button"
            class="topbar-theme-mode__btn ${opt.id === state.themeMode ? "topbar-theme-mode__btn--active" : ""}"
            title=${opt.label}
            aria-label="Color mode: ${opt.label}"
            aria-pressed=${opt.id === state.themeMode}
            @click=${(e: Event) => applyMode(opt.id, e)}
          >
            ${modeIcon(opt.id)}
          </button>
        `,
      )}
    </div>
  `;
}

export function renderSidebarConnectionStatus(state: AppViewState) {
  const label = state.connected ? t("common.online") : t("common.offline");
  const toneClass = state.connected
    ? "sidebar-connection-status--online"
    : "sidebar-connection-status--offline";

  return html`
    <span
      class="sidebar-version__status ${toneClass}"
      role="img"
      aria-live="polite"
      aria-label="Gateway status: ${label}"
      title="Gateway status: ${label}"
    ></span>
  `;
}

export function renderThemeToggle(state: AppViewState) {
  const setOpen = (orb: HTMLElement, nextOpen: boolean) => {
    orb.classList.toggle("theme-orb--open", nextOpen);
    const trigger = orb.querySelector<HTMLButtonElement>(".theme-orb__trigger");
    const menu = orb.querySelector<HTMLElement>(".theme-orb__menu");
    if (trigger) {
      trigger.setAttribute("aria-expanded", nextOpen ? "true" : "false");
    }
    if (menu) {
      menu.setAttribute("aria-hidden", nextOpen ? "false" : "true");
    }
  };

  const toggleOpen = (e: Event) => {
    const orb = (e.currentTarget as HTMLElement).closest<HTMLElement>(".theme-orb");
    if (!orb) {
      return;
    }
    const isOpen = orb.classList.contains("theme-orb--open");
    if (isOpen) {
      setOpen(orb, false);
    } else {
      setOpen(orb, true);
      const close = (ev: MouseEvent) => {
        if (!orb.contains(ev.target as Node)) {
          setOpen(orb, false);
          document.removeEventListener("click", close);
        }
      };
      requestAnimationFrame(() => document.addEventListener("click", close));
    }
  };

  const pick = (opt: ThemeOption, e: Event) => {
    const orb = (e.currentTarget as HTMLElement).closest<HTMLElement>(".theme-orb");
    if (orb) {
      setOpen(orb, false);
    }
    if (opt.id !== state.theme) {
      const context: ThemeTransitionContext = { element: orb ?? undefined };
      state.setTheme(opt.id, context);
    }
  };

  return html`
    <div class="theme-orb" aria-label="Theme">
      <button
        type="button"
        class="theme-orb__trigger"
        title="Theme"
        aria-haspopup="menu"
        aria-expanded="false"
        @click=${toggleOpen}
      >${currentThemeIcon(state.theme)}</button>
      <div class="theme-orb__menu" role="menu" aria-hidden="true">
        ${THEME_OPTIONS.map(
          (opt) => html`
            <button
              type="button"
              class="theme-orb__option ${opt.id === state.theme ? "theme-orb__option--active" : ""}"
              title=${opt.label}
              role="menuitemradio"
              aria-checked=${opt.id === state.theme}
              aria-label=${opt.label}
              @click=${(e: Event) => pick(opt, e)}
            >${opt.icon}</button>`,
        )}
      </div>
    </div>
  `;
}
