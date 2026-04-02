import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { EadFmNodeRun, TestCaseRun } from "../../../../src/projects/types.js";
import type { AppViewState } from "../app-view-state.js";
import { switchChatSession } from "../chat/ead-chat-sync.js";
import { writePersistedProjectChatId } from "../chat/ead-project-chat-persist.js";
import { stripEadProjectSuffix } from "../chat/ead-project-session-key.js";
import { icons } from "../icons.js";
import { toSanitizedMarkdownHtml } from "../markdown.js";
import { renderChat, type ChatProps } from "./chat.js";

const DEFAULT_AI_PROMPT = `# Role & Objective
Act as an Expert Automated Website Documentation Agent. Your objective is to systematically explore a target web application and generate comprehensive, production-ready Markdown documentation complete with screenshots. This documentation will serve as a user manual, system guide, and training material.

# Operating Context & Setup
- **Browser State**: Open the target web application at 1920x1080 resolution.
- **Authentication**: If credentials are provided, locate the login page, enter the username/password, submit the form, and verify successful authentication before proceeding.

# Exploration Strategy (Top-Down)
Explore the application methodically to ensure 100% coverage:
1. **Global Scan**: Map out the top navigation, sidebars, menus, tabs, and dashboards.
2. **Deep Traversal**: Move from main modules to sub-modules, and overview pages to detailed views. 
3. **Thoroughness**: Do not skip *any* component. Visit all forms, popups, configuration screens, list/detail views, and operational workflows. Do not omit pages just because they look similar. 

# Data Capture & Documentation Rules
For *every single page* visited, you must capture and document the following:

## 1. Visual Capture (Screenshots)
- **Timing**: Wait until the page has fully loaded and all dynamic content has rendered.
- **Scrolling**: For long pages, take multiple overlapping screenshots to capture everything.
- **Naming Convention**: Save all images in an \`img/\` directory using the lowercase format: \`[module]-[feature].png\`.
- **Referencing**: Use relative paths in the markdown (e.g., \`![Login View](./img/auth-login.png)\`).

## 2. Page Metadata
- Module Name and exact Navigation Path.
- The primary business purpose of the page.

## 3. UI Element Breakdown
Document all interactive and static elements thoroughly. Never assume a control is simply "self-explanatory":
- **Element Types**: Input fields, dropdowns, checkboxes, date pickers, rich text editors, buttons, charts, tables, filters, modals, etc.
- **Field Details**: List the Name, Type, Status (Required/Optional), Default Value, Placeholder Text, Purpose, Dependencies, and Validation Rules.
- **System States**: Document any dynamic notifications, alerts, and error/validation messages. 

## 4. Workflow & Feature Mapping
Describe every feature and action available on the page:
- **Description**: What does the feature do?
- **Triggers**: How is it initiated (e.g., button click, automatic)?
- **Requirements**: Prerequisites and necessary inputs.
- **Outcomes**: System feedback, outputs, and resulting behavior.
- **Business Workflows**: Map end-to-end journeys for common processes (Create, Read, Update, Delete, Approve, Export). Detail decision points, success states, and failure states.

# Output Format Requirements
Generate a master Markdown file (e.g., \`system-documentation.md\`) structured exactly as follows:
1. **System Information**: URL, viewport resolution, and scan date.
2. **System Overview**: High-level summary of the application's purpose.
3. **Module Index**: A linked table of contents for major modules.
4. **Detailed Module Sections**: 
   - Page-by-page breakdown with embedded screenshots.
   - Field descriptions and UI element tables.
   - Key workflows and feature descriptions.
5. **Appendix**: Glossary, FAQs, or troubleshooting notes (if applicable).

# Quality Assurance & Constraints
- Prioritize absolute completeness and thoroughness for onboarding and auditing purposes. 
- Before finalizing the output, self-verify that:
  - All screenshots are accounted for in the \`img/\` directory.
  - All relative image links in the Markdown evaluate correctly.
  - No major modules, operational workflows, or subpages were missed.
- If the user later requests expansions or additional screenshots, continue extending the document strictly adhering to this exact structure and style.`;

function renderCustomChatHeader(state: AppViewState, chatProps?: ChatProps) {
  if (!chatProps) {
    return nothing;
  }

  const activeExecutionId = state.activeExecutionId;
  const execution =
    state.executionDetail || state.executionsList.find((e) => e.id === activeExecutionId);
  const template = state.templateDetail;

  const titleText =
    activeExecutionId && execution
      ? execution.status === "completed"
        ? `${execution.name} - Finished`
        : `${execution.name} - Learning In Progress`
      : template
        ? `Project Template: ${template.name}`
        : "Project Chat";

  return html`
    <div style="padding: 16px; border-bottom: 1px solid var(--border-color); display: flex; align-items: center; justify-content: space-between;">
      <div style="font-weight: 500; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
        ${titleText}
      </div>
      
      <div style="position: relative;">
        <button 
          class="btn btn--ghost" 
          style="padding: 4px 8px; font-weight: bold;"
          @click=${(e: Event) => {
            const btn = e.currentTarget as HTMLElement;
            const menu = btn.nextElementSibling as HTMLElement;
            const isVisible = menu.style.display === "block";

            document.querySelectorAll(".custom-chat-dropdown-menu").forEach((el) => {
              (el as HTMLElement).style.display = "none";
            });

            if (!isVisible) {
              menu.style.display = "block";
              const close = (ce: MouseEvent) => {
                if (!menu.contains(ce.target as Node) && !btn.contains(ce.target as Node)) {
                  menu.style.display = "none";
                  document.removeEventListener("click", close);
                }
              };
              setTimeout(() => document.addEventListener("click", close), 0);
            }
          }}
        >
          ...
        </button>
        
        <div 
          class="custom-chat-dropdown-menu"
          style="display: none; position: absolute; top: 100%; right: 0; margin-top: 4px; z-index: 100; min-width: 250px; background: var(--bg-surface-2, #161b22); border: 1px solid var(--border-color); border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); padding: 8px 0; max-height: 400px; overflow-y: auto;"
        >
          <div style="padding: 4px 12px; font-size: 11px; text-transform: uppercase; color: var(--muted); font-weight: 600;">Templates</div>
          ${state.templatesList.map(
            (t) => html`
            <div 
              style="padding: 8px 12px; font-size: 13px; cursor: pointer; color: ${template?.id === t.id && !activeExecutionId ? "var(--blue)" : "inherit"};"
              onmouseover="this.style.backgroundColor='rgba(255,255,255,0.05)'"
              onmouseout="this.style.backgroundColor='transparent'"
              @click=${() => {
                state.handleExecutionSetActive(null);
                state.handleTemplateSetActive(t.id);
              }}
            >
              ${t.name}
            </div>
          `,
          )}
          
          ${
            state.executionsList.length > 0
              ? html`
            <div style="border-top: 1px solid var(--border-color); margin: 8px 0;"></div>
            <div style="padding: 4px 12px; font-size: 11px; text-transform: uppercase; color: var(--muted); font-weight: 600;">Run Instances</div>
            ${state.executionsList.map(
              (e) => html`
              <div 
                style="padding: 8px 12px; font-size: 13px; cursor: pointer; color: ${activeExecutionId === e.id ? "var(--blue)" : "inherit"}; display: flex; justify-content: space-between; align-items: center;"
                onmouseover="this.style.backgroundColor='rgba(255,255,255,0.05)'"
                onmouseout="this.style.backgroundColor='transparent'"
                @click=${() => state.handleExecutionSetActive(e.id)}
              >
                <span style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px;">${e.name}</span>
                <span style="font-size: 11px; color: var(--muted); margin-left: 8px;">${new Date(e.startTime ?? Date.now()).toLocaleTimeString()}</span>
              </div>
            `,
            )}
          `
              : nothing
          }
        </div>
      </div>
    </div>
  `;
}

export function renderProjectsView(state: AppViewState, chatProps?: ChatProps) {
  const showExecution = !!state.activeExecutionId;
  const showDetail = !showExecution && !!state.templateDetail;

  if (showDetail) {
    return html`
      ${renderTemplateDetail(state, chatProps)}
    `;
  }

  if (showExecution) {
    return html`
      <div class="content content--scroll" style="flex: 1; overflow-y: auto;">
        ${renderExecutionDebugger(state, chatProps)}
      </div>
    `;
  }

  return html`
    <div class="content content--scroll" style="flex: 1; overflow-y: auto;">
      ${renderTemplateList(state)}
    </div>
    ${state.showCreateModal ? renderCreateModal(state) : nothing}
  `;
}

function renderTemplateList(state: AppViewState) {
  return html`
    ${
      state.templatesError
        ? html`
      <div style="margin: 0 24px 24px; color: #ffffff; background: rgba(248,81,73,0.4); padding: 12px 16px; border-radius: 6px; font-size: 14px; border: 1px solid rgba(248,81,73,0.6); display: flex; align-items: flex-start; gap: 8px;">
        <span style="opacity: 0.8; margin-top: 2px;">${icons.zap}</span>
        <div style="font-family: monospace; white-space: pre-wrap; word-break: break-all;">
          ${state.templatesError}
        </div>
      </div>
    `
        : nothing
    }
    
    ${
      state.templatesList.length === 0
        ? html`
      <div class="projects-empty-state" style="padding: 48px 24px; text-align: center;">
        <div style="margin-bottom: 16px; opacity: 0.5;">${icons.folder}</div>
        <p style="color: var(--muted, #838387); margin-bottom: 16px;">
          Create your first Test Plan Project to get started.
        </p>
        <button
          class="project-create-modal__btn project-create-modal__btn--primary"
          @click=${() => {
            state.templateModalMode = "create";
            state.createFormName = "";
            state.createFormDescription = "";
            state.createFormTargetUrl = "";
            state.createFormAiPrompt = DEFAULT_AI_PROMPT;
            state.templateModalPreviewMarkdown = false;
            state.showCreateModal = true;
          }}
        >
          ${icons.plus} New Template
        </button>
      </div>
    `
        : html`
      <div style="padding: 24px;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 24px;">
          <h2 style="font-size: 16px; font-weight: 500; margin: 0;">Defined Templates</h2>
          <button
            class="project-create-modal__btn project-create-modal__btn--primary"
            @click=${() => {
              state.templateModalMode = "create";
              state.createFormName = "";
              state.createFormDescription = "";
              state.createFormTargetUrl = "";
              state.createFormAiPrompt = DEFAULT_AI_PROMPT;
              state.templateModalPreviewMarkdown = false;
              state.showCreateModal = true;
            }}
          >
            ${icons.plus} Create Template
          </button>
        </div>
        
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="border-bottom: 1px solid var(--border-color); color: var(--muted, #838387); font-size: 13px;">
              <th style="padding: 12px 0;">Template Name</th>
              <th style="padding: 12px 0;">Total Executions</th>
              <th style="padding: 12px 0;">Success Rate</th>
            </tr>
          </thead>
          <tbody>
            ${state.templatesList.map(
              (template) => html`
              <tr 
                style="border-bottom: 1px solid var(--border-color); cursor: pointer;"
                @click=${() => state.handleTemplateSetActive(template.id)}
              >
                <td style="padding: 16px 0; font-weight: 500;">
                  ${template.name}
                </td>
                <td style="padding: 16px 0;">
                  <span class="pill">0 runs</span>
                </td>
                <td style="padding: 16px 0;">
                  <span class="pill">N/A</span>
                </td>
              </tr>
            `,
            )}
          </tbody>
        </table>
      </div>
    `
    }
  `;
}

function renderTemplateDetail(state: AppViewState, _chatProps?: ChatProps) {
  const template = state.templateDetail;
  if (!template) {
    return nothing;
  }

  return html`
    <div style="display: flex; flex: 1; width: 100%; overflow: hidden; background: var(--bg-body);">
      <div class="content content--scroll" style="flex: 1; min-width: 0; overflow-y: auto;">
        
        <!-- Premium Centered Container -->
        <div style="max-width: 900px; margin: 0 auto; padding: 40px 24px; min-height: 100%; display: flex; flex-direction: column; gap: 40px;">
          
          <!-- Header Section -->
          <div style="display: flex; flex-direction: column; gap: 20px;">
            <div>
              <button 
                class="btn btn--ghost" 
                @click=${() => state.handleTemplateSetActive(null)} 
                style="margin-bottom: 24px; color: var(--muted); font-size: 14px; display: inline-flex; align-items: center; gap: 6px; padding: 0;"
              >
                ${icons.chevronLeft} Back to Templates
              </button>

              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 24px; flex-wrap: wrap;">
                <div style="flex: 1; min-width: 300px;">
                  <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 12px;">
                    <h1 style="margin: 0; font-size: 32px; font-weight: 700; letter-spacing: -0.02em; color: var(--fg-default);">
                      ${template.name}
                    </h1>
                    <span class="pill" style="background: var(--accent); color: white; border: none;">Test Plan</span>
                  </div>
                  <p style="color: var(--muted); margin: 0; font-size: 16px; line-height: 1.6; max-width: 600px;">
                     ${template.description || "No description provided for this test plan."}
                  </p>
                </div>

                <div style="display: flex; gap: 12px; align-items: center;">
                  <button 
                    class="btn btn--ghost" 
                    style="padding: 10px 16px; font-size: 14px; border: 1px solid var(--border-color); border-radius: 8px;"
                    @click=${() => {
                      state.templateModalMode = "edit";
                      state.createFormName = template.name;
                      state.createFormDescription = template.description || "";
                      state.createFormTargetUrl = template.targetUrl || "";
                      state.createFormAiPrompt = template.aiPrompt || "";
                      state.templateModalPreviewMarkdown = false;
                      state.showCreateModal = true;
                    }}
                  >
                    ${icons.book} Edit Details
                  </button>

                  <button
                    class="btn btn--primary"
                    style="font-size: 15px; font-weight: 600; padding: 12px 24px; border-radius: 8px; box-shadow: 0 4px 12px var(--shadow-color);"
                    @click=${() => {
                      state.templateModalMode = "run";
                      state.createFormName = template.name;
                      state.createFormDescription = template.description || "";
                      state.createFormTargetUrl = template.targetUrl || "";
                      state.createFormAiPrompt = template.aiPrompt || "";
                      state.templateModalPreviewMarkdown = true;
                      state.showCreateModal = true;
                    }}
                  >
                    ${icons.spark} Run Learning
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Instructions Card -->
          <div style="background: var(--bg-surface-1); border: 1px solid var(--border-color); border-radius: 16px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.02);">
            <div style="padding: 20px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; background: var(--bg-surface-2);">
              <h2 style="margin: 0; font-size: 18px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
                ${icons.zap} AI Testing Instructions
              </h2>
              <button 
                class="btn btn--ghost" 
                style="padding: 6px 12px; font-size: 13px; color: var(--accent); border: 1px solid var(--accent); border-radius: 6px; display: flex; align-items: center; gap: 6px;"
                ?disabled=${state.templateAutoFormatting}
                @click=${async () => {
                  if (!template.aiPrompt) {
                    return;
                  }
                  state.templateAutoFormatting = true;
                  try {
                    const formatted = await state.handleAutoFormatPrompt(template.aiPrompt);
                    await state.handleTemplateUpdate(template.id, { aiPrompt: formatted });
                  } finally {
                    state.templateAutoFormatting = false;
                  }
                }}
              >
                ${
                  state.templateAutoFormatting
                    ? html`
                        <span class="spinner spinner--small"></span> Formatting...
                      `
                    : "Auto Improve ✨"
                }
              </button>
            </div>
            
            <div 
              class="sidebar-markdown" 
              style="min-height: 150px; padding: 24px; background: var(--bg-surface-1); overflow-y: auto; font-size: 15px; line-height: 1.7;"
            >
              ${unsafeHTML(toSanitizedMarkdownHtml(template.aiPrompt || "_No instructions provided._"))}
            </div>
          </div>

          <!-- Executions History Section -->
          <div>
            <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; display: flex; align-items: center; gap: 8px;">
              ${icons.book} Execution History
            </h2>
            
            ${
              state.executionsList.length === 0
                ? html`
                    <div style="padding: 40px 24px; text-align: center; border: 1px dashed var(--border-color); border-radius: 12px; background: var(--bg-surface-2);">
                      <div style="color: var(--muted); margin-bottom: 12px;">${icons.spark}</div>
                      <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">No runs yet</h3>
                      <p style="margin: 0; color: var(--muted); font-size: 14px;">Click "Run Learning" above to test this plan.</p>
                    </div>
                  `
                : html`
                    <div style="border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; background: var(--bg-surface-1);">
                      <table style="width: 100%; border-collapse: collapse;">
                        <thead style="background: var(--bg-surface-2);">
                          <tr style="border-bottom: 1px solid var(--border-color); text-align: left; color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.05em;">
                            <th style="padding: 16px 24px; font-weight: 600;">Run Name</th>
                            <th style="padding: 16px 24px; font-weight: 600;">Status</th>
                            <th style="padding: 16px 24px; font-weight: 600; text-align: right;">Time</th>
                          </tr>
                        </thead>
                        <tbody>
                          ${state.executionsList.map(
                            (run) => html`
                                <tr 
                                  style="border-bottom: 1px solid var(--border-color); cursor: pointer; transition: background 0.15s ease;"
                                  onmouseover="this.style.background='var(--bg-surface-2)'"
                                  onmouseout="this.style.background='transparent'"
                                  @click=${() => state.handleExecutionSetActive(run.id)}
                                >
                                  <td style="padding: 16px 24px; font-weight: 500; color: var(--fg-default);">
                                    ${run.name}
                                  </td>
                                  <td style="padding: 16px 24px;">
                                    <span class="pill ${run.status === "completed" ? "success" : run.status === "running" ? "primary" : "danger"}" style="font-size: 12px; font-weight: 500;">
                                      ${run.status}
                                    </span>
                                  </td>
                                  <td style="padding: 16px 24px; color: var(--muted); font-size: 13px; text-align: right;">
                                    ${new Date(run.startTime ?? Date.now()).toLocaleString()}
                                  </td>
                                </tr>
                              `,
                          )}
                        </tbody>
                      </table>
                    </div>
                  `
            }
          </div>

        </div>
      </div>
    </div>
    ${state.showCreateModal ? renderCreateModal(state) : nothing}
  `;
}

function renderCreateModal(state: AppViewState) {
  const isEdit = state.templateModalMode === "edit";
  const isRun = state.templateModalMode === "run";
  const title = isRun
    ? "Run Project Execution"
    : isEdit
      ? "Edit Project Template"
      : "New Project Template";
  const submitText = state.templateCreating
    ? isRun
      ? "Starting..."
      : "Saving..."
    : isRun
      ? "Run Learning"
      : isEdit
        ? "Save Changes"
        : "Create Template";

  return html`
    <div
      class="project-create-modal"
      @click=${(e: Event) => {
        if (e.target === e.currentTarget && !state.templateCreating) {
          state.showCreateModal = false;
        }
      }}
    >
      <div 
        class="project-create-modal__dialog project-create-modal__dialog--wide" 
        style="max-width: 800px; width: 90vw; max-height: 90vh; display: flex; flex-direction: column;"
      >
        <h2 class="project-create-modal__title">${title}</h2>

        <div style="overflow-y: auto; flex: 1; padding-right: 8px;">
          ${
            state.templateModalMode === "create" || state.templateModalMode === "edit"
              ? html`
                ${
                  state.templatesError
                    ? html`
                        <div style="color: #ffffff; background: rgba(248,81,73,0.4); padding: 8px 12px; border-radius: 4px; font-size: 13px; margin-bottom: 16px; border: 1px solid rgba(248,81,73,0.6);">
                          ${state.templatesError}
                        </div>
                      `
                    : nothing
                }
                <div class="project-create-modal__field">
                  <label class="project-create-modal__label">Name</label>
                  <input
                    class="project-create-modal__input"
                    type="text"
                    placeholder="E-Commerce Regression Suite"
                    .value=${state.createFormName}
                    @input=${(e: Event) => {
                      state.createFormName = (e.target as HTMLInputElement).value;
                    }}
                  />
                </div>
                <div class="project-create-modal__field">
                  <label class="project-create-modal__label">Description</label>
                  <input
                    class="project-create-modal__input"
                    type="text"
                    placeholder="Brief description of the test suite"
                    .value=${state.createFormDescription}
                    @input=${(e: Event) => {
                      state.createFormDescription = (e.target as HTMLInputElement).value;
                    }}
                  />
                </div>
                <div class="project-create-modal__field">
                  <label class="project-create-modal__label">Target URL</label>
                  <input
                    class="project-create-modal__input"
                    type="text"
                    placeholder="https://example.com"
                    .value=${state.createFormTargetUrl}
                    @input=${(e: Event) => {
                      state.createFormTargetUrl = (e.target as HTMLInputElement).value;
                    }}
                  />
                </div>
              `
              : nothing
          }
          <div class="project-create-modal__field">
            <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
              <label class="project-create-modal__label" style="margin: 0;">AI Prompt</label>
              <div style="display: flex; gap: 8px; background: var(--bg-surface-2); padding: 4px; border-radius: 6px; border: 1px solid var(--border-color);">
                <button 
                  class="project-create-modal__btn" 
                  style="padding: 4px 12px; font-size: 12px; font-weight: 500; border-radius: 4px; background: ${!state.templateModalPreviewMarkdown ? "var(--bg-surface-3)" : "transparent"}; color: ${!state.templateModalPreviewMarkdown ? "#fff" : "var(--muted)"}; box-shadow: ${!state.templateModalPreviewMarkdown ? "0 1px 2px rgba(0,0,0,0.2)" : "none"}; border: none;"
                  @click=${() => (state.templateModalPreviewMarkdown = false)}
                >
                  Edit
                </button>
                <button 
                  class="project-create-modal__btn" 
                  style="padding: 4px 12px; font-size: 12px; font-weight: 500; border-radius: 4px; background: ${state.templateModalPreviewMarkdown ? "var(--bg-surface-3, #21262d)" : "transparent"}; color: ${state.templateModalPreviewMarkdown ? "#fff" : "var(--muted)"}; box-shadow: ${state.templateModalPreviewMarkdown ? "0 1px 2px rgba(0,0,0,0.2)" : "none"}; border: none;"
                  @click=${() => (state.templateModalPreviewMarkdown = true)}
                >
                  Preview
                </button>
              </div>
            </div>
            ${
              state.templateModalPreviewMarkdown
                ? html`
              <div 
                class="project-create-modal__input sidebar-markdown" 
                style="min-height: 240px; max-height: 400px; overflow-y: auto; background: var(--bg-surface-2, #161b22); color: #ffffff;"
              >
                ${unsafeHTML(toSanitizedMarkdownHtml(state.createFormAiPrompt || "_No instructions provided._"))}
              </div>
            `
                : html`
              <textarea
                class="project-create-modal__input document-editor__content"
                style="min-height: 240px; max-height: 400px; resize: vertical; font-family: monospace; color: #ffffff; background: var(--bg-surface-2, #161b22);"
                placeholder="Auto test a web site..."
                .value=${state.createFormAiPrompt}
                @input=${(e: Event) => {
                  state.createFormAiPrompt = (e.target as HTMLTextAreaElement).value;
                }}
              ></textarea>
            `
            }
          </div>
        </div>

        <div class="project-create-modal__actions" style="margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border-color); flex-shrink: 0;">
          <button
            class="project-create-modal__btn"
            ?disabled=${state.templateCreating}
            @click=${() => {
              state.showCreateModal = false;
            }}
          >
            Cancel
          </button>
          <button
            class="project-create-modal__btn project-create-modal__btn--primary"
            ?disabled=${!state.createFormName.trim() || state.templateCreating}
            @click=${async () => {
              if (isRun && state.templateDetail) {
                state.templateCreating = true;
                try {
                  const res = await state.handleExecutionRun(state.templateDetail.id);
                  state.showCreateModal = false;
                  if (res) {
                    state.handleExecutionSetActive(res.id);
                  }
                } finally {
                  state.templateCreating = false;
                }
              } else if (isEdit && state.templateDetail) {
                await state.handleTemplateUpdate(state.templateDetail.id, {
                  name: state.createFormName.trim(),
                  description: state.createFormDescription.trim(),
                  targetUrl: state.createFormTargetUrl.trim(),
                  aiPrompt: state.createFormAiPrompt.trim(),
                });
                state.showCreateModal = false;
              } else {
                void state.handleTemplateCreate(
                  state.createFormName.trim(),
                  state.createFormDescription.trim(),
                  state.createFormTargetUrl.trim(),
                  state.createFormAiPrompt.trim(),
                );
              }
            }}
          >
            ${submitText}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderExecutionDebugger(state: AppViewState, chatProps?: ChatProps) {
  const execution =
    state.executionDetail || state.executionsList.find((e) => e.id === state.activeExecutionId);
  const template = state.templateDetail;
  if (!execution) {
    return html`
      <div class="content content--scroll">
        <div style="padding: 24px">Loading Execution...</div>
      </div>
    `;
  }

  const dateInfo = new Date(execution.startTime ?? Date.now()).toLocaleString();
  const durationSec = Math.round((execution.durationMs || 0) / 1000);

  const testCases: TestCaseRun[] = (execution.results || []).flatMap(
    (node: EadFmNodeRun) => node.testCaseRuns || [],
  );

  return html`
    <div style="display: flex; flex: 1; width: 100%; overflow: hidden;">
      <!-- Main Debugger View (Learning Phase layout) -->
      <div class="content content--scroll" style="flex: 1; min-width: 0; overflow-y: auto;">
        <div class="project-detail" style="border-right: 1px solid var(--border-color); min-height: 100%;">
        <div class="project-detail__header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
           <div>
             <button class="project-create-modal__btn" @click=${() => state.handleExecutionSetActive(null)} style="margin-bottom: 16px;">
               ${icons.chevronRight} ${state.tab === "autoTestRun" ? "Back to Auto Run List" : `Back to ${template?.name || "Template"}`}
             </button>
             <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
               <h1 class="project-detail__name" style="margin: 0;">Project Run & Chat</h1>
               <span class="pill ${execution.status === "completed" ? "success" : execution.status === "running" ? "primary" : "danger"}">${execution.status.toUpperCase()}</span>
             </div>
             <p style="color: var(--muted); margin-top: 8px; font-size: 14px;">
               🧠 Phase: Learning & Mapping Product <br/>
               Execution ID: ${execution.id} $\middot Started: ${dateInfo} (${durationSec}s elapsed)
             </p>
           </div>
           <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
             ${
               execution.status === "running"
                 ? html`
               <button class="project-create-modal__btn project-create-modal__btn--danger" style="padding: 8px 16px;" @click=${() => void state.handleExecutionCancel(execution.id)}>
                 Cancel Execution
               </button>
             `
                 : nothing
             }
             <button
               type="button"
               class="project-create-modal__btn"
               style="padding: 8px 16px; white-space: nowrap;"
               @click=${() => {
                 state.chatActiveTemplateId = execution.id;
                 state.chatSelectedTemplateId = execution.id;
                 state.chatProjectTab = "executions";
                 state.projectLeftPanelDismissed = false;
                 writePersistedProjectChatId(execution.id);
                 state.setTab("chatProject");
                 if (state.connected) {
                   switchChatSession(state, stripEadProjectSuffix(state.sessionKey));
                 }
               }}
             >
               Open in Project Chat
             </button>
           </div>
        </div>

        <div class="project-detail__section">
          <h2 class="project-detail__section-title" style="margin-bottom: 16px;">📍 Discovered Feature Map (EAD-FM)</h2>
          
          <div style="display: flex; flex-direction: column; gap: 16px;">
            ${(execution.results || []).map(
              (node: EadFmNodeRun) => html`
              <details class="test-case-accordion" style="background: var(--bg-surface-2, #21262d); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;" open>
                <summary style="padding: 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-weight: 500; outline: none; user-select: none;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span style="font-size: 16px;">▾ 🧩 ${node.title}</span>
                  </div>
                  <span style="opacity: 0.5;">${icons.chevronDown}</span>
                </summary>

                <div style="border-top: 1px solid var(--border-color); padding: 16px;">
                  <!-- List the Test Cases generated for this Node -->
                  <h4 style="margin: 0 0 12px; font-size: 13px; color: var(--muted); text-transform: uppercase;">Generated Test Cases</h4>
                  ${(node.testCaseRuns || []).map(
                    (tc: TestCaseRun) => html`
                    <div style="margin-bottom: 16px; padding: 12px; background: rgba(0,0,0,0.1); border-radius: 6px; border: 1px solid var(--border-color);">
                      <div style="display: flex; align-items: center; gap: 8px; font-weight: 500; margin-bottom: 8px;">
                        <span class="pill ${tc.status === "Success" ? "success" : tc.status === "Failed" ? "danger" : ""}">${tc.status}</span>
                        ${tc.title}
                      </div>
                      ${
                        tc.testCaseStepRuns && tc.testCaseStepRuns.length > 0
                          ? html`
                            <ul style="margin: 0; padding-left: 20px; color: var(--text-color); font-size: 13px; line-height: 1.6;">
                              ${tc.testCaseStepRuns.map(
                                (step) => html`
                                <li>
                                  <div>Found: <strong>${step.procedureText}</strong></div>
                                  ${step.screenshotUrl ? html`<img src=${step.screenshotUrl} style="max-width: 100%; max-height: 200px; display: block; margin-top: 8px; border: 1px solid var(--border-color); border-radius: 4px;" alt="Evidence" />` : nothing}
                                </li>
                              `,
                              )}
                            </ul>
                          `
                          : html`
                              <div style="color: var(--muted); font-size: 13px">Scanning steps...</div>
                            `
                      }
                    </div>
                  `,
                  )}
                  ${
                    !node.testCaseRuns || node.testCaseRuns.length === 0
                      ? html`
                          <div style="color: var(--muted); font-size: 13px">No test cases drafted yet...</div>
                        `
                      : nothing
                  }
                </div>
              </details>
            `,
            )}
            
            ${
              !execution.results || execution.results.length === 0
                ? html`
                    <div
                      style="
                        padding: 24px;
                        text-align: center;
                        color: var(--muted);
                        border: 1px dashed var(--border-color);
                        border-radius: 8px;
                      "
                    >
                      Waiting for AI to discover feature nodes...
                    </div>
                  `
                : nothing
            }
            </div>
            
            <div style="margin-top: 24px; padding: 16px; background: var(--bg-surface-2, #21262d); border-radius: 8px; border: 1px solid var(--border-color);">
               <div style="display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500;">
                 <span class="spinner" style="width: 14px; height: 14px; border: 2px solid var(--accent-color); border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></span>
                 ⏳ Drafting Test Cases (${testCases.length}/... )
               </div>
               <div style="display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500; margin-top: 8px;">
                 <span class="spinner" style="width: 14px; height: 14px; border: 2px solid var(--accent-color); border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></span>
                 ⏳ Compiling EAD-FM Document...
               </div>
            </div>
          </div>
        </div>
      </div>
      
      <!-- Embedded Contextual Chat widget -->
      ${
        chatProps
          ? html`
        <div style="width: 450px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--bg-surface-1, #0d1117); border-left: 1px solid var(--border-color);">
          ${renderCustomChatHeader(state, chatProps)}
          ${renderChat(chatProps)}
        </div>
      `
          : nothing
      }
    </div>
  `;
}

export function renderAutoTestRunView(state: AppViewState, chatProps?: ChatProps) {
  if (state.activeExecutionId) {
    return renderExecutionDebugger(state, chatProps);
  }

  return html`
    <div class="content content--scroll">
      <div class="content-header">
        <h1 class="page-title">Test Run Project</h1>
        <p class="page-subtitle">Watch live executions and review historical test results</p>
      </div>

      <div style="padding: 24px;">
        ${
          state.globalExecutionsLoading
            ? html`
                <div style="padding: 24px; text-align: center; color: var(--muted)">Loading executions...</div>
              `
            : state.globalExecutionsList.length === 0
              ? html`
                  <div
                    style="
                      padding: 24px;
                      text-align: center;
                      border: 1px dashed var(--border-color);
                      border-radius: 6px;
                    "
                  >
                    <p style="color: var(--muted)">No executions have been run yet across any template.</p>
                  </div>
                `
              : html`
          <table style="width: 100%; border-collapse: collapse; text-align: left;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border-color); color: var(--muted, #838387); font-size: 13px;">
                <th style="padding: 12px 0;">Execution ID</th>
                <th style="padding: 12px 0;">Start Time</th>
                <th style="padding: 12px 0;">Duration</th>
                <th style="padding: 12px 0;">Progress</th>
                <th style="padding: 12px 0;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${state.globalExecutionsList.map((execution) => {
                const dateInfo = new Date(execution.startTime ?? Date.now()).toLocaleString();
                const durationSec = Math.round((execution.durationMs || 0) / 1000);

                return html`
                  <tr 
                    style="border-bottom: 1px solid var(--border-color); transition: background-color 0.2s; cursor: pointer;"
                    @click=${() => state.handleExecutionSetActive(execution.id)}
                  >
                    <td style="padding: 16px 0; font-family: monospace; font-size: 13px;">
                      ${execution.id.split("-")[0]}...
                    </td>
                    <td style="padding: 16px 0; color: var(--muted); font-size: 14px;">
                      ${dateInfo}
                    </td>
                    <td style="padding: 16px 0; font-size: 14px;">
                      ${durationSec}s
                    </td>
                    <td style="padding: 16px 0; padding-right: 24px;">
                      <div style="width: 100%; background: var(--bg-surface-2, #21262d); border-radius: 4px; overflow: hidden; height: 8px;">
                        <div style="width: ${execution.progressPercentage || 0}%; background: var(--accent-color, #2f81f7); height: 100%;"></div>
                      </div>
                    </td>
                    <td style="padding: 16px 0;">
                      <span class="pill ${execution.status === "completed" ? "success" : execution.status === "running" ? "primary" : "danger"}">
                        ${execution.status.toUpperCase()}
                      </span>
                      ${
                        execution.status === "running"
                          ? html`
                        <button 
                          class="project-create-modal__btn" 
                          style="margin-left: 8px; padding: 2px 8px;"
                          @click=${(e: Event) => {
                            e.stopPropagation();
                            void state.handleExecutionCancel(execution.id);
                          }}
                        >
                          Cancel
                        </button>
                      `
                          : nothing
                      }
                    </td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
        `
        }
      </div>
    </div>
  `;
}
