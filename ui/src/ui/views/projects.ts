import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import type { EadFmNodeRun, TestCaseRun } from "../../../../src/projects/types.js";
import type { AppViewState } from "../app-view-state.js";
import { icons } from "../icons.js";
import { toSanitizedMarkdownHtml } from "../markdown.js";
import { renderChat, type ChatProps } from "./chat.js";

const DEFAULT_AI_PROMPT = `# Role & Objective
Act as an Expert Automated Website Documentation Agent. Your objective is to systematically explore a target web application and generate comprehensive, production-ready Markdown documentation complete with screenshots. This documentation will serve as a user manual, system guide, and training material.

# Project Run chat first (before heavy automation)
- When a run starts, the **executor may pause** so the human can message here **before** the browser automation continues.
- **Always prioritize this chat** for: login URL, username/password or secure handoff, which **modules or areas** to test first, compliance constraints, and test data rules.
- Do **not** assume credentials are in the Test Plan alone; ask in chat if anything is missing.
- After the user signals readiness (e.g. **Resume run** in the UI), coordinate with any live browser capture and keep answering questions here.

# Operating Context & Setup
- **Browser State**: Open the target web application at 1920x1080 resolution.
- **Authentication**: If credentials are provided, locate the login page, enter the username/password, submit the form, and verify successful authentication before proceeding.

# Execution discipline (Learning runs)
- Navigate the **entire** functional surface of the target web application (major modules, workflows, and interactive controls) unless blocked by access, environment, or explicit scope limits.
- **Exercise and verify** major features and user-visible flows (not only page loads): use controls, submit forms where safe, and confirm expected behavior when you can.
- **Keep progressing** through the run until the operator stops or pauses it, or the plan is complete.
- When **human input** is required (credentials, confirmations, ambiguous choices), ask clearly in **this Project Run chat** and wait for the user before continuing.

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

function authStrategyLabel(mode: string | undefined): string {
  if (mode === "reuse-session") {
    return "Reuse existing session";
  }
  if (mode === "manual-bootstrap") {
    return "Manual bootstrap";
  }
  return "No authentication";
}

function browserProfileOptionLabel(profile: {
  name: string;
  driver?: "openclaw" | "existing-session";
  isDefault?: boolean;
}): string {
  const bits = [profile.name];
  if (profile.driver === "existing-session") {
    bits.push("existing session");
  } else if (profile.driver === "openclaw") {
    bits.push("openclaw");
  }
  if (profile.isDefault) {
    bits.push("default");
  }
  return bits.join(" - ");
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
        <div style="width: 16px; height: 16px; display: inline-flex; justify-content: center; align-items: center; opacity: 0.8; margin-top: 2px;">${icons.zap}</div>
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
            void state.handleProjectAuthProfilesLoad();
            state.templateModalMode = "create";
            state.createFormName = "";
            state.createFormDescription = "";
            state.createFormTargetUrl = "";
            state.createFormAiPrompt = DEFAULT_AI_PROMPT;
            state.createFormAuthMode = "none";
            state.createFormAuthLoginUrl = "";
            state.createFormAuthSessionProfile = "";
            state.createFormAuthInstructions = "";
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
        <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(248, 81, 73, 0.1); border: 1px solid rgba(248, 81, 73, 0.6); padding: 12px 20px; border-radius: 8px; margin-bottom: 24px;">
          <h2 style="font-size: 18px; font-weight: 600; color: var(--fg-default); margin: 0;">Defined Templates</h2>
          <div style="display: flex; gap: 8px;">
            <button
              class="btn btn--primary"
              style="font-size: 13px; font-weight: 600; padding: 6px 12px; border-radius: 6px; box-shadow: 0 4px 12px var(--shadow-color); display: inline-flex; align-items: center; gap: 6px;"
              @click=${() => {
                void state.handleProjectAuthProfilesLoad();
                state.templateModalMode = "create";
                state.createFormName = "";
                state.createFormDescription = "";
                state.createFormTargetUrl = "";
                state.createFormAiPrompt = DEFAULT_AI_PROMPT;
                state.createFormAuthMode = "none";
                state.createFormAuthLoginUrl = "";
                state.createFormAuthSessionProfile = "";
                state.createFormAuthInstructions = "";
                state.templateModalPreviewMarkdown = false;
                state.showCreateModal = true;
              }}
            >
              <div style="width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center;">${icons.plus}</div> Create Template
            </button>
          </div>
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
            ${(() => {
              const pageSize = 15;
              const totalRows = state.templatesList.length;
              const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
              const page = Math.max(0, Math.min(state.testPlanPage, totalPages - 1));
              const paginated = state.templatesList.slice(page * pageSize, (page + 1) * pageSize);

              return paginated.map(
                (template, index) => html`
                  <tr 
                    style="border-bottom: 1px solid var(--border-color); cursor: pointer;"
                    @click=${() => state.handleTemplateSetActive(template.id)}
                  >
                    <td style="padding: 16px 0; font-weight: 500;">
                      <span style="color: var(--muted); padding-right: 12px; font-size: 13px;">${page * pageSize + index + 1}.</span>
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
              );
            })()}
          </tbody>
        </table>

        ${(() => {
          const pageSize = 15;
          const totalRows = state.templatesList.length;
          const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
          const page = Math.max(0, Math.min(state.testPlanPage, totalPages - 1));
          return totalRows > pageSize
            ? html`
                <div class="data-table-pagination" style="padding: 16px 0; display: flex; justify-content: space-between; align-items: center;">
                  <div class="data-table-pagination__info" style="color: var(--muted); font-size: 13px;">
                    ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, totalRows)}
                    of ${totalRows} plan${totalRows === 1 ? "" : "s"}
                  </div>
                  <div class="data-table-pagination__controls" style="display: flex; gap: 8px;">
                    <button
                      class="btn btn--flat"
                      style="padding: 4px 12px; font-size: 13px;"
                      ?disabled=${page <= 0}
                      @click=${() => state.setTestPlanPage(page - 1)}
                    >
                      Previous
                    </button>
                    <button
                      class="btn btn--flat"
                      style="padding: 4px 12px; font-size: 13px;"
                      ?disabled=${page >= totalPages - 1}
                      @click=${() => state.setTestPlanPage(page + 1)}
                    >
                      Next
                    </button>
                  </div>
                </div>
              `
            : nothing;
        })()}
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
        <div style="max-width: 900px; margin: 0 auto; padding: 40px 24px; min-height: 100%; display: flex; flex-direction: column; gap: 32px;">
          
          <!-- Back Button -->
          <div style="margin-bottom: -16px;">
            <button 
              class="btn btn--ghost" 
              @click=${() => state.handleTemplateSetActive(null)} 
              style="color: var(--muted); font-size: 14px; display: inline-flex; align-items: center; gap: 6px; padding: 0;"
            >
              <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;">${icons.chevronLeft}</div> Back to Templates
            </button>
          </div>

          <!-- Title Toolbar Container (Project Property) -->
          <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(248, 81, 73, 0.1); border: 1px solid rgba(248, 81, 73, 0.6); border-radius: 8px; padding: 16px 20px;">
            <div style="display: flex; flex-direction: column; gap: 6px;">
              <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: var(--fg-default);">
                Project Plan: ${template.name}
              </h2>
              <span style="color: var(--muted); font-size: 14px; max-width: 600px;">
                ${template.description || "No description provided for this test plan."}
              </span>
            </div>

            <div style="display: flex; gap: 12px; align-items: center;">
              <button 
                class="btn btn--ghost" 
                style="padding: 8px 16px; font-size: 13px; border: 1px solid var(--border-color); border-radius: 6px;"
                @click=${() => {
                  void state.handleProjectAuthProfilesLoad();
                  state.templateModalMode = "edit";
                  state.createFormName = template.name;
                  state.createFormDescription = template.description || "";
                  state.createFormTargetUrl = template.targetUrl || "";
                  state.createFormAiPrompt = template.aiPrompt || "";
                  state.createFormAuthMode = template.authMode || "none";
                  state.createFormAuthLoginUrl = template.authLoginUrl || "";
                  state.createFormAuthSessionProfile = template.authSessionProfile || "";
                  state.createFormAuthInstructions = template.authInstructions || "";
                  state.templateModalPreviewMarkdown = false;
                  state.showCreateModal = true;
                }}
              >
                <div style="width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; margin-right: 6px;">${icons.book}</div> Edit Details
              </button>

              <div style="position: relative;">
                <button
                  type="button"
                  class="btn btn--primary"
                  style="font-size: 13px; font-weight: 600; padding: 8px 16px; border-radius: 6px; box-shadow: 0 4px 12px var(--shadow-color); display: inline-flex; align-items: center; gap: 6px;"
                  @click=${(e: Event) => {
                    e.stopPropagation();
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
                  <div style="width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center;">${icons.spark}</div> Test Run <div style="width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center;">${icons.chevronDown}</div>
                </button>
                <div
                  class="custom-chat-dropdown-menu ead-test-run-dropdown"
                  style="display: none; position: absolute; top: 100%; right: 0; margin-top: 4px; z-index: 100; min-width: 260px; background: var(--bg-surface-2, #161b22); border: 1px solid var(--border-color); border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.5); padding: 8px 0;"
                >
                  <button
                    type="button"
                    class="btn btn--ghost"
                    style="width: 100%; justify-content: flex-start; border-radius: 0; padding: 10px 16px; font-size: 13px; border: none;"
                    @click=${(e: Event) => {
                      e.stopPropagation();
                      const menu = (e.currentTarget as HTMLElement).closest(
                        ".ead-test-run-dropdown",
                      ) as HTMLElement;
                      if (menu) {
                        menu.style.display = "none";
                      }
                      void state.handleProjectAuthProfilesLoad();
                      state.templateModalMode = "run";
                      state.createFormName = template.name;
                      state.createFormDescription = template.description || "";
                      state.createFormTargetUrl = template.targetUrl || "";
                      state.createFormAiPrompt = template.aiPrompt || "";
                      state.createFormAuthMode = template.authMode || "none";
                      state.createFormAuthLoginUrl = template.authLoginUrl || "";
                      state.createFormAuthSessionProfile = template.authSessionProfile || "";
                      state.createFormAuthInstructions = template.authInstructions || "";
                      state.templateModalPreviewMarkdown = true;
                      state.showCreateModal = true;
                    }}
                  >
                    <div style="width: 14px; height: 14px; display: inline-flex; align-items: center; justify-content: center; margin-right: 6px;">${icons.spark}</div> Test Run for Learning
                  </button>
                  <button
                    type="button"
                    disabled
                    title="Coming soon"
                    style="width: 100%; text-align: left; padding: 10px 16px; font-size: 13px; border: none; background: transparent; color: var(--muted); cursor: not-allowed; opacity: 0.7;"
                  >
                    Test Run for Testing
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Main Content Container with Top-to-Bottom Flow -->
          <div style="display: flex; flex-direction: column; gap: 32px;">

            <!-- Learning Summary (formerly AI Testing Instructions) -->
            <div>
              <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 500; color: var(--fg-default); display: flex; align-items: center; gap: 8px;">
                <div style="width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;">${icons.zap}</div> Learning Summary
              </h3>
              <div 
                class="sidebar-markdown" 
                style="background: rgba(30, 31, 34, 0.5); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; padding: 24px; min-height: 150px; overflow-y: auto; font-size: 14px; line-height: 1.7; color: var(--fg-default);"
              >
                ${unsafeHTML(toSanitizedMarkdownHtml(template.aiPrompt || "_No instructions provided._"))}
              </div>
            </div>

            <!-- Testing Summary (Execution History) -->
            <div>
              <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 500; color: var(--fg-default); display: flex; align-items: center; gap: 8px;">
                <div style="width: 16px; height: 16px; display: inline-flex; align-items: center; justify-content: center;">${icons.book}</div> Testing Summary
              </h3>
              
              ${
                state.executionsList.length === 0
                  ? html`
                      <div style="padding: 40px 24px; text-align: center; border: 1px dashed rgba(255, 255, 255, 0.1); border-radius: 8px; background: rgba(30, 31, 34, 0.5);">
                        <div style="color: var(--muted); margin-bottom: 12px; display: flex; justify-content: center;">
                          <div style="width: 24px; height: 24px; display: inline-flex; align-items: center; justify-content: center;">${icons.spark}</div>
                        </div>
                        <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 500; color: var(--fg-default);">No runs yet</h3>
                        <p style="margin: 0; color: var(--muted); font-size: 13px;">
                          Use <strong style="color: var(--fg-default);">Test Run</strong> → <strong style="color: var(--fg-default);">Test Run for Learning</strong> above to start a run.
                        </p>
                      </div>
                    `
                  : html`
                      <div style="border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 8px; overflow: hidden; background: rgba(30, 31, 34, 0.5);">
                        <table style="width: 100%; border-collapse: collapse;">
                          <thead style="background: rgba(255, 255, 255, 0.05);">
                            <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.1); text-align: left; color: var(--muted); font-size: 12px; text-transform: uppercase;">
                              <th style="padding: 16px 24px; font-weight: 600;">Run Name</th>
                              <th style="padding: 16px 24px; font-weight: 600;">Status</th>
                              <th style="padding: 16px 24px; font-weight: 600; text-align: right;">Time</th>
                            </tr>
                          </thead>
                          <tbody>
                            ${state.executionsList.map(
                              (run) => html`
                                  <tr 
                                    style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); cursor: pointer; transition: background-color 0.2s;"
                                    @mouseover=${(e: Event) => ((e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.03)")}
                                    @mouseout=${(e: Event) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
                                    @click=${() => state.handleExecutionSetActive(run.id)}
                                  >
                                    <td style="padding: 16px 24px; font-weight: 500; color: var(--fg-default); font-size: 14px;">
                                      ${run.name}
                                    </td>
                                    <td style="padding: 16px 24px;">
                                      <span class="pill ${run.status === "completed" ? "success" : run.status === "running" ? "primary" : "danger"}" style="font-size: 12px;">
                                        ${run.status.toUpperCase()}
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
    </div>
    ${state.showCreateModal ? renderCreateModal(state) : nothing}
  `;
}

function renderCreateModal(state: AppViewState) {
  const isEdit = state.templateModalMode === "edit";
  const isRun = state.templateModalMode === "run";
  const showTemplateFields =
    state.templateModalMode === "create" || state.templateModalMode === "edit";
  const showTargetUrlField = showTemplateFields || isRun;
  const availableProfiles = state.projectAuthProfiles ?? [];
  const selectedProfile = state.createFormAuthSessionProfile.trim();
  const selectedProfileInfo = selectedProfile
    ? availableProfiles.find((profile) => profile.name === selectedProfile)
    : undefined;
  const hasSelectedProfile = selectedProfile
    ? availableProfiles.some((profile) => profile.name === selectedProfile)
    : false;
  const requiresSessionProfile = state.createFormAuthMode === "reuse-session";
  const missingSessionProfile = requiresSessionProfile && !selectedProfile;
  const unknownSessionProfile =
    requiresSessionProfile &&
    Boolean(selectedProfile) &&
    availableProfiles.length > 0 &&
    !hasSelectedProfile;
  const submitBlocked =
    !state.createFormName.trim() || state.templateCreating || missingSessionProfile;
  const title = isRun
    ? "Test run for learning"
    : isEdit
      ? "Edit Project Template"
      : "New Project Template";
  const submitText = state.templateCreating
    ? isRun
      ? "Starting..."
      : "Saving..."
    : isRun
      ? "Start learning run"
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
            showTemplateFields
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
              `
              : nothing
          }
          ${
            showTargetUrlField
              ? html`
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
            <label class="project-create-modal__label">Authentication strategy</label>
            <select
              class="project-create-modal__input"
              .value=${state.createFormAuthMode}
              @change=${(e: Event) => {
                state.createFormAuthMode = (e.target as HTMLSelectElement).value as
                  | "none"
                  | "reuse-session"
                  | "manual-bootstrap";
              }}
            >
              <option value="none">None</option>
              <option value="reuse-session">Reuse existing session</option>
              <option value="manual-bootstrap">Manual bootstrap</option>
            </select>
            <div style="margin-top: 6px; color: var(--muted); font-size: 12px;">
              ${
                state.createFormAuthMode === "reuse-session"
                  ? "Preferred for headless runs when an authenticated browser/session state already exists."
                  : state.createFormAuthMode === "manual-bootstrap"
                    ? "Use when the operator needs to log in or complete setup before the run can continue."
                    : "Use this for public pages or apps that do not require login."
              }
            </div>
          </div>
          ${
            state.createFormAuthMode !== "none"
              ? html`
                  <div class="project-create-modal__field">
                    <label class="project-create-modal__label">Authentication URL</label>
                    <input
                      class="project-create-modal__input"
                      type="text"
                      placeholder="https://example.com/login"
                      .value=${state.createFormAuthLoginUrl}
                      @input=${(e: Event) => {
                        state.createFormAuthLoginUrl = (e.target as HTMLInputElement).value;
                      }}
                    />
                  </div>
                  <div class="project-create-modal__field">
                    <label class="project-create-modal__label">Authentication notes</label>
                    <textarea
                      class="project-create-modal__input"
                      style="min-height: 84px; resize: vertical;"
                      placeholder="Explain how OpenClaw should authenticate or what the operator must do first."
                      .value=${state.createFormAuthInstructions}
                      @input=${(e: Event) => {
                        state.createFormAuthInstructions = (e.target as HTMLTextAreaElement).value;
                      }}
                    ></textarea>
                  </div>
                `
              : nothing
          }
          ${
            state.createFormAuthMode === "reuse-session"
              ? html`
                  <div class="project-create-modal__field">
                    <label class="project-create-modal__label">Browser profile</label>
                    ${
                      availableProfiles.length > 0
                        ? html`
                            <select
                              class="project-create-modal__input"
                              .value=${selectedProfile}
                              @change=${(e: Event) => {
                                state.createFormAuthSessionProfile = (
                                  e.target as HTMLSelectElement
                                ).value;
                              }}
                            >
                              <option value="">Select a browser profile</option>
                              ${
                                !hasSelectedProfile && selectedProfile
                                  ? html`
                                      <option value=${selectedProfile}>
                                        ${selectedProfile} - current value
                                      </option>
                                    `
                                  : nothing
                              }
                              ${availableProfiles.map(
                                (profile) => html`
                                  <option value=${profile.name}>
                                    ${browserProfileOptionLabel(profile)}
                                  </option>
                                `,
                              )}
                            </select>
                          `
                        : html`
                            <input
                              class="project-create-modal__input"
                              type="text"
                              placeholder="qa-admin-session"
                              .value=${state.createFormAuthSessionProfile}
                              @input=${(e: Event) => {
                                state.createFormAuthSessionProfile = (
                                  e.target as HTMLInputElement
                                ).value;
                              }}
                            />
                          `
                    }
                    <div style="margin-top: 6px; color: var(--muted); font-size: 12px;">
                      ${
                        state.projectAuthProfilesLoading
                          ? "Loading available browser profiles..."
                          : availableProfiles.length > 0
                            ? "Project Run will use this browser profile by default for browser actions in this run."
                            : "No browser profiles were loaded from the gateway yet. You can still enter a profile name manually."
                      }
                    </div>
                    ${
                      state.projectAuthProfilesError
                        ? html`
                            <div style="margin-top: 6px; color: #ffb4b4; font-size: 12px;">
                              ${state.projectAuthProfilesError}
                            </div>
                          `
                        : nothing
                    }
                    <div style="margin-top: 8px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                      <button
                        type="button"
                        class="project-create-modal__btn"
                        style="padding: 4px 10px; font-size: 12px;"
                        ?disabled=${state.projectAuthProfilesLoading}
                        @click=${() => void state.handleProjectAuthProfilesLoad(true)}
                      >
                        Refresh profiles
                      </button>
                      ${
                        selectedProfileInfo
                          ? html`
                              <span style="font-size: 12px; color: var(--muted);">
                                Driver: ${selectedProfileInfo.driver}
                                ${selectedProfileInfo.running ? " | running" : " | not running"}
                                ${selectedProfileInfo.isDefault ? " | default" : ""}
                              </span>
                            `
                          : nothing
                      }
                    </div>
                    ${
                      missingSessionProfile
                        ? html`
                            <div
                              style="
                                margin-top: 8px;
                                color: #ffffff;
                                background: rgba(248, 81, 73, 0.35);
                                padding: 8px 12px;
                                border-radius: 4px;
                                font-size: 12px;
                                border: 1px solid rgba(248, 81, 73, 0.55);
                              "
                            >
                              Choose a browser profile before using <strong>Reuse existing session</strong>.
                            </div>
                          `
                        : nothing
                    }
                    ${
                      unknownSessionProfile
                        ? html`
                            <div
                              style="margin-top: 8px; color: #ffffff; background: rgba(210,153,34,0.22); padding: 8px 12px; border-radius: 4px; font-size: 12px; border: 1px solid rgba(210,153,34,0.45);"
                            >
                              The selected profile <strong>${selectedProfile}</strong> is not currently available from the gateway. The run may fall back or fail to reuse login state.
                            </div>
                          `
                        : nothing
                    }
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
            ?disabled=${submitBlocked}
            @click=${async () => {
              if (isRun && state.templateDetail) {
                state.templateCreating = true;
                try {
                  const res = await state.handleExecutionRun(state.templateDetail.id, {
                    targetUrl: state.createFormTargetUrl.trim(),
                    aiPrompt: state.createFormAiPrompt.trim(),
                    authMode: state.createFormAuthMode,
                    authLoginUrl: state.createFormAuthLoginUrl.trim(),
                    authSessionProfile: state.createFormAuthSessionProfile.trim(),
                    authInstructions: state.createFormAuthInstructions.trim(),
                  });
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
                  authMode: state.createFormAuthMode,
                  authLoginUrl: state.createFormAuthLoginUrl.trim(),
                  authSessionProfile: state.createFormAuthSessionProfile.trim(),
                  authInstructions: state.createFormAuthInstructions.trim(),
                });
                state.showCreateModal = false;
              } else {
                void state.handleTemplateCreate(
                  state.createFormName.trim(),
                  state.createFormDescription.trim(),
                  state.createFormTargetUrl.trim(),
                  state.createFormAiPrompt.trim(),
                  {
                    authMode: state.createFormAuthMode,
                    authLoginUrl: state.createFormAuthLoginUrl.trim(),
                    authSessionProfile: state.createFormAuthSessionProfile.trim(),
                    authInstructions: state.createFormAuthInstructions.trim(),
                  },
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
  const executionProfileInfo = execution.authSessionProfile?.trim()
    ? (state.projectAuthProfiles ?? []).find(
        (profile) => profile.name === execution.authSessionProfile?.trim(),
      )
    : undefined;
  const executionProfileMissing =
    execution.authMode === "reuse-session" &&
    Boolean(execution.authSessionProfile?.trim()) &&
    (state.projectAuthProfiles?.length ?? 0) > 0 &&
    !executionProfileInfo;
  const executionHint = execution.executorHint?.trim();
  const executionWaitingForBootstrap =
    execution.status === "running" &&
    Boolean(execution.paused) &&
    execution.authMode === "manual-bootstrap";
  const executionStatusLabel =
    execution.status === "running" && execution.paused
      ? executionWaitingForBootstrap
        ? "WAITING"
        : "PAUSED"
      : execution.status.toUpperCase();
  const executionStatusPillClass =
    execution.status === "completed"
      ? "success"
      : execution.status === "running"
        ? execution.paused
          ? "warning"
          : "primary"
        : "danger";
  const shouldShowActiveRunFooter = execution.status === "running" && !execution.paused;

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
               <span class="pill ${executionStatusPillClass}">${executionStatusLabel}</span>
             </div>
             <p style="color: var(--muted); margin-top: 8px; font-size: 14px;">
               🧠 Phase: Learning & Mapping Product <br/>
               Execution ID: ${execution.id} $\middot Started: ${dateInfo} (${durationSec}s elapsed)
             </p>
             <p style="color: var(--muted); margin-top: 8px; font-size: 13px;">
               Auth: ${authStrategyLabel(execution.authMode)}
               ${execution.authSessionProfile ? html`<br />Session hint: ${execution.authSessionProfile}` : nothing}
               ${execution.authLoginUrl ? html`<br />Auth URL: ${execution.authLoginUrl}` : nothing}
               ${
                 executionProfileInfo
                   ? html`
                       <br />
                       Profile driver: ${executionProfileInfo.driver}
                       ${executionProfileInfo.running ? " | running" : " | not running"}
                       ${executionProfileInfo.isDefault ? " | default" : ""}
                     `
                   : nothing
               }
             </p>
             ${
               executionProfileMissing
                 ? html`
                     <div
                       style="margin-top: 10px; color: #ffffff; background: rgba(210,153,34,0.22); padding: 8px 12px; border-radius: 4px; font-size: 12px; border: 1px solid rgba(210,153,34,0.45); max-width: 520px;"
                     >
                       Browser profile <strong>${execution.authSessionProfile}</strong> was selected for session reuse, but it is not currently available from the gateway.
                     </div>
                   `
                 : nothing
             }
             ${
               executionHint
                 ? html`
                     <div
                       style="margin-top: 12px; color: #ffffff; background: ${executionWaitingForBootstrap ? "rgba(210,153,34,0.22)" : "rgba(56,139,253,0.14)"}; padding: 10px 12px; border-radius: 6px; font-size: 13px; border: 1px solid ${executionWaitingForBootstrap ? "rgba(210,153,34,0.45)" : "rgba(56,139,253,0.3)"}; max-width: 560px;"
                     >
                       ${executionHint}
                     </div>
                   `
                 : nothing
             }
           </div>
           <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 8px;">
             ${
               execution.status === "running"
                 ? html`
                     ${
                       execution.paused
                         ? html`
                             <button
                               class="project-create-modal__btn project-create-modal__btn--primary"
                               style="padding: 8px 16px;"
                               @click=${() => void state.handleExecutionResume(execution.id)}
                             >
                               ${
                                 execution.authMode === "manual-bootstrap"
                                   ? "Login complete, continue run"
                                   : "Resume Execution"
                               }
                             </button>
                           `
                         : html`
                             <button
                               class="project-create-modal__btn"
                               style="padding: 8px 16px;"
                               @click=${() => void state.handleExecutionPause(execution.id)}
                             >
                               Pause Execution
                             </button>
                           `
                     }
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
                 state.projectLeftPanelDismissed = false;
                 state.setProjectRunTab(execution.id);
               }}
             >
               Open Project Run
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
              ${
                shouldShowActiveRunFooter
                  ? html`
                      <div style="display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500;">
                        <span class="spinner" style="width: 14px; height: 14px; border: 2px solid var(--accent-color); border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></span>
                        ⏳ Drafting Test Cases (${testCases.length}/... )
                      </div>
                      <div style="display: flex; align-items: center; gap: 12px; font-size: 14px; font-weight: 500; margin-top: 8px;">
                        <span class="spinner" style="width: 14px; height: 14px; border: 2px solid var(--accent-color); border-top-color: transparent; border-radius: 50%; animation: spin 1s linear infinite;"></span>
                        ⏳ Compiling EAD-FM Document...
                      </div>
                    `
                  : execution.paused
                    ? html`
                        <div style="font-size: 14px; font-weight: 500; color: #f2cc60;">
                          ${
                            executionWaitingForBootstrap
                              ? "Waiting for operator login/setup confirmation before continuing discovery."
                              : "Project Run is paused. Resume when you want OpenClaw to continue discovery."
                          }
                        </div>
                        <div style="margin-top: 8px; font-size: 13px; color: var(--muted);">
                          The run chat remains available while the browser work is paused.
                        </div>
                      `
                    : html`
                        <div style="font-size: 14px; font-weight: 500; color: var(--muted)">
                          Project Run is no longer actively discovering new areas.
                        </div>
                      `
              }
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

function renderExecutionSummary(state: AppViewState, chatProps?: ChatProps) {
  const execution = state.activeExecutionId
    ? state.globalExecutionsList.find((e) => e.id === state.activeExecutionId)
    : undefined;
  if (!execution) {
    return nothing;
  }

  // Render the chat widget if showing
  const canShowChat = state.showExecutionChat && chatProps && execution.status !== "running";

  const headerHtml = html`
    <!-- Back Button -->
    <div style="margin-bottom: 24px;">
      <button 
        class="btn btn--ghost" 
        @click=${() => state.handleExecutionSetActive(null)} 
        style="color: var(--muted); font-size: 14px; display: inline-flex; align-items: center; gap: 6px; padding: 0;"
      >
        <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;">${icons.chevronLeft}</div> Back to run list
      </button>
    </div>

    <!-- Title Toolbar Container -->
    <div style="display: flex; justify-content: space-between; align-items: center; background: rgba(248, 81, 73, 0.1); border: 1px solid rgba(248, 81, 73, 0.6); border-radius: 8px; padding: 16px 20px; margin-bottom: 24px;">
      <div style="display: flex; align-items: center; gap: 16px;">
        <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: var(--fg-default);">
          Execution: ${execution.name || execution.targetUrl}
        </h2>
        <span class="pill ${execution.status === "completed" ? "success" : execution.status === "running" ? "primary" : "danger"}">
          ${execution.status.toUpperCase()}
        </span>
      </div>

      <div style="display: flex; gap: 12px; align-items: center;">
        <div style="display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 13px;">
          <span>${new Date(execution.startTime ?? Date.now()).toLocaleString()}</span>
        </div>
        
        <!-- Interactive Checkbox AI Chat Toggle -> Button -->
        <button 
          class="btn btn--primary" 
          @click=${() => {
            if (execution.status === "running") {
              state.setProjectRunTab(execution.id);
            } else {
              state.setShowExecutionChat(!state.showExecutionChat);
            }
          }}
          style="display: flex; align-items: center; gap: 6px; padding: 6px 12px; font-size: 13px; border-radius: 6px;"
        >
          <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icons.messageSquare}</div>
          AI Chat
        </button>
      </div>
    </div>
  `;

  const contentHtml = html`
    <!-- Main Content Container with Top-to-Bottom Flow -->
    <div style="display: flex; flex-direction: column; gap: 32px;">

      <!-- Execution Steps -->
      <div>
        <h3 style="margin: 0 0 16px 0; font-size: 16px; font-weight: 500; color: var(--fg-default); display: flex; align-items: center; gap: 8px;">
          <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icons.circle}</div> Execution Steps
        </h3>
        <div style="display: flex; flex-direction: column; gap: 16px;">
          ${
            execution.results && execution.results.length > 0
              ? execution.results.map(
                  (node) => html`
                <details class="test-case-accordion" style="background: var(--bg-surface-2, #21262d); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;" open>
                  <summary style="padding: 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-weight: 500; outline: none; user-select: none;">
                    <div style="display: flex; align-items: center; gap: 12px;">
                      <span style="font-size: 16px;">▾ 🧩 ${node.title}</span>
                    </div>
                    <span style="opacity: 0.5;"><div style="width: 16px; height: 16px; display: inline-flex; justify-content: center; align-items: center;">${icons.chevronDown}</div></span>
                  </summary>

                  <div style="border-top: 1px solid var(--border-color); padding: 16px;">
                    <h4 style="margin: 0 0 12px; font-size: 13px; color: var(--muted); text-transform: uppercase;">Generated Test Cases</h4>
                    ${(node.testCaseRuns || []).map(
                      (tc) => html`
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
                )
              : html`
                  <div
                    style="
                      background: rgba(30, 31, 34, 0.5);
                      border: 1px solid rgba(255, 255, 255, 0.1);
                      border-radius: 8px;
                      padding: 40px;
                      text-align: center;
                      color: var(--muted);
                    "
                  >
                    No execution steps recorded yet.
                  </div>
                `
          }
        </div>
      </div>

    </div>
  `;

  return html`
    <div style="display: flex; flex-direction: column; width: 100%; height: 100%; overflow: hidden; background: var(--bg-body);">
      
      <!-- Top Global Header spanning the full width -->
      <div style="padding: 24px 24px 0 24px; flex-shrink: 0; width: 100%; max-width: 1400px; margin: 0 auto;">
        ${headerHtml}
      </div>
      
      <!-- Split View for the body and chat -->
      <div style="display: flex; flex: 1; width: 100%; max-width: 1400px; margin: 0 auto; min-height: 0;">
        <div 
          class="content content--scroll" 
          style="flex: 1; min-width: 0; overflow-y: auto; padding: 0 24px 24px 24px;"
        >
          ${contentHtml}
        </div>
        
        ${
          canShowChat
            ? html`
            <div style="width: 450px; flex-shrink: 0; border: 1px solid var(--border-color); border-radius: 8px; background: rgba(30, 31, 34, 0.5); display: flex; flex-direction: column; overflow: hidden; position: relative; margin: 0 24px 24px 0;">
              <div style="padding: 16px 20px; border-bottom: 1px solid var(--border-color); background: rgba(0,0,0,0.2); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0;">
                <h3 style="margin: 0; font-size: 15px; font-weight: 500; display: flex; align-items: center; gap: 8px;">
                  <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icons.messageSquare}</div> Execution Analysis
                </h3>
                <button 
                  class="btn btn--icon" 
                  @click=${() => state.setShowExecutionChat(false)} 
                  title="Close chat"
                >
                  <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; flex-shrink: 0;">${icons.x}</div>
                </button>
              </div>
              <div style="flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column;">
                ${renderChat(chatProps)}
              </div>
            </div>
          `
            : nothing
        }
      </div>
    </div>
  `;
}

export function renderAutoTestRunView(state: AppViewState, chatProps?: ChatProps) {
  if (state.activeExecutionId) {
    return renderExecutionSummary(state, chatProps);
  }

  return html`
    <div style="display: flex; flex: 1; width: 100%; overflow: hidden; background: var(--bg-body);">
      <div class="content content--scroll" style="flex: 1; min-width: 0; overflow-y: auto;">
        <div style="padding: 24px; max-width: 1200px; margin: 0 auto; width: 100%;">
          
          <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px; background: rgba(248, 81, 73, 0.1); border: 1px solid rgba(248, 81, 73, 0.6); border-radius: 8px; padding: 16px 20px;">
            <div style="display: flex; align-items: center; gap: 16px;">
              <h2 style="margin: 0; font-size: 20px; font-weight: 600; color: var(--fg-default);">
                Test Run Project List
              </h2>
            </div>
            <div style="display: flex; gap: 12px; align-items: center; opacity: 0.5;" title="Monitor real-time or historical execution metrics.">
              <div style="width: 16px; height: 16px; display: flex; align-items: center; justify-content: center;">${icons.helpCircle}</div>
            </div>
          </div>

          <div style="border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; overflow: hidden; background: rgba(30, 31, 34, 0.5);">
            ${
              state.globalExecutionsLoading
                ? html`
                    <div style="padding: 24px; text-align: center; color: var(--muted)">Loading executions...</div>
                  `
                : state.globalExecutionsList.length === 0
                  ? html`
                      <div style="padding: 40px 24px; text-align: center">
                        <p style="color: var(--muted); margin: 0">No executions have been run yet across any template.</p>
                      </div>
                    `
                  : html`
                    <table style="width: 100%; border-collapse: collapse; text-align: left;">
                      <thead>
                        <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.15); color: var(--fg-default); font-size: 13px;">
                          <th style="padding: 14px 24px; font-weight: 500;">No.</th>
                          <th style="padding: 14px 24px; font-weight: 500;">Plan Project Name</th>
                          <th style="padding: 14px 24px; font-weight: 500;">Start Time</th>
                          <th style="padding: 14px 24px; font-weight: 500;">Duration</th>
                          <th style="padding: 14px 24px; font-weight: 500; width: 150px;">Progress</th>
                          <th style="padding: 14px 24px; font-weight: 500; text-align: right;">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${(() => {
                          const pageSize = 15;
                          const totalRows = state.globalExecutionsList.length;
                          const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
                          const page = Math.max(0, Math.min(state.testRunPage, totalPages - 1));
                          const paginated = state.globalExecutionsList.slice(
                            page * pageSize,
                            (page + 1) * pageSize,
                          );

                          return paginated.map((execution, index) => {
                            const globalIndex = page * pageSize + index + 1;
                            const dateInfo = new Date(
                              execution.startTime ?? Date.now(),
                            ).toLocaleString();
                            const formatDuration = (ms: number) => {
                              const totalSecs = Math.round(ms / 1000);
                              const days = Math.floor(totalSecs / 86400);
                              const hours = Math.floor((totalSecs % 86400) / 3600);
                              const mins = Math.floor((totalSecs % 3600) / 60);

                              if (days > 0) {
                                return days + "d" + hours + "h" + mins + "m";
                              }
                              if (hours > 0) {
                                return hours + "h" + mins + "m";
                              }
                              if (mins > 0) {
                                return mins + "m";
                              }
                              return totalSecs + "s";
                            };
                            const durationStr = formatDuration(execution.durationMs || 0);

                            return html`
                            <tr 
                              style="border-bottom: 1px solid rgba(255, 255, 255, 0.05); transition: background-color 0.2s; cursor: pointer;"
                              @mouseover=${(e: Event) => ((e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255,255,255,0.03)")}
                              @mouseout=${(e: Event) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
                              @click=${() => state.handleExecutionSetActive(execution.id)}
                            >
                              <td style="padding: 16px 24px; font-family: monospace; font-size: 13px; color: var(--muted);">
                                ${globalIndex}
                              </td>
                              <td style="padding: 16px 24px; font-weight: 500; font-size: 14px; max-width: 250px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${execution.name}">
                                ${execution.name}
                              </td>
                              <td style="padding: 16px 24px; color: var(--muted); font-size: 14px; white-space: nowrap;">
                                ${dateInfo}
                              </td>
                              <td style="padding: 16px 24px; font-size: 14px; color: var(--muted);">
                                ${durationStr}
                              </td>
                              <td style="padding: 16px 24px;">
                                <div style="width: 100%; max-width: 150px; background: rgba(255,255,255,0.1); border-radius: 4px; overflow: hidden; height: 6px;">
                                  <div style="width: ${execution.progressPercentage || 0}%; background: var(--accent-color, #2f81f7); height: 100%;"></div>
                                </div>
                              </td>
                              <td style="padding: 16px 24px; text-align: right;">
                                <span class="pill ${execution.status === "completed" ? "success" : execution.status === "running" ? "primary" : "danger"}">
                                  ${execution.status.toUpperCase()}
                                </span>
                                ${
                                  execution.status === "running"
                                    ? html`
                                      <button 
                                        class="btn btn--danger" 
                                        style="margin-left: 12px; padding: 4px 10px; font-size: 12px; border-radius: 4px;"
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
                          });
                        })()}
                      </tbody>
                    </table>

                    ${(() => {
                      const pageSize = 15;
                      const totalRows = state.globalExecutionsList.length;
                      const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
                      const page = Math.max(0, Math.min(state.testRunPage, totalPages - 1));
                      return totalRows > pageSize
                        ? html`
                            <div class="data-table-pagination" style="padding: 16px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;">
                              <div class="data-table-pagination__info" style="color: var(--muted); font-size: 13px;">
                                ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, totalRows)}
                                of ${totalRows} run${totalRows === 1 ? "" : "s"}
                              </div>
                              <div class="data-table-pagination__controls" style="display: flex; gap: 8px;">
                                <button
                                  class="btn btn--flat"
                                  style="padding: 4px 12px; font-size: 13px; background: rgba(255,255,255,0.05);"
                                  ?disabled=${page <= 0}
                                  @click=${() => state.setTestRunPage(page - 1)}
                                >
                                  Previous
                                </button>
                                <button
                                  class="btn btn--flat"
                                  style="padding: 4px 12px; font-size: 13px; background: rgba(255,255,255,0.05);"
                                  ?disabled=${page >= totalPages - 1}
                                  @click=${() => state.setTestRunPage(page + 1)}
                                >
                                  Next
                                </button>
                              </div>
                            </div>
                          `
                        : nothing;
                    })()}
                  `
            }
          </div>
        </div>
      </div>
    </div>
  `;
}
