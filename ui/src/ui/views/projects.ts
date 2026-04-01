import { html, nothing } from "lit";
import type { EadFmNodeRun, TestCaseRun, TestCaseStepRun } from "../../../../src/projects/types.js";
import type { AppViewState } from "../app-view-state.js";
import { icons } from "../icons.js";

export function renderProjectsView(state: AppViewState) {
  if (state.activeExecutionId) {
    return renderExecutionDebugger(state);
  }

  const activeTemplate = state.templateDetail;
  if (activeTemplate) {
    return renderTemplateDetail(state);
  }

  return html`
    <div class="content content--scroll">
      <div class="content-header">
        <h1 class="page-title">Project Templates</h1>
        <p class="page-subtitle">Manage your EAD_AutoTest blueprints and test suites</p>
      </div>
      
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
            Create your first Project Template blueprint to get started.
          </p>
          <button
            class="project-create-modal__btn project-create-modal__btn--primary"
            @click=${() => {
              state.createFormAiPrompt =
                "Auto test a web site and navigate to all the pages and test all the functions and features. For each function, name it as an EAD-FM Node. And for each node create one or more test cases, and for each test case create test steps and expected results.";
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
                state.createFormAiPrompt =
                  "Auto test a web site and navigate to all the pages and test all the functions and features. For each function, name it as an EAD-FM Node. And for each node create one or more test cases, and for each test case create test steps and expected results.";
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
                <th style="padding: 12px 0;">Target URL</th>
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
                  <td style="padding: 16px 0; color: var(--muted); font-family: monospace; font-size: 13px;">
                    ${template.targetUrl || "N/A"}
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
    </div>
    ${state.showCreateModal ? renderCreateModal(state) : nothing}
  `;
}

function renderTemplateDetail(state: AppViewState) {
  const template = state.templateDetail;
  if (!template) {
    return nothing;
  }

  return html`
    <div class="content content--scroll">
      <div class="project-detail">
        <div class="project-detail__header" style="display: flex; justify-content: space-between; align-items: flex-start;">
          <div>
            <button class="project-create-modal__btn" @click=${() => state.handleTemplateSetActive(null)} style="margin-bottom: 16px;">
              ${icons.chevronRight} Return to List
            </button>
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
              <h1 class="project-detail__name" style="margin: 0;">${template.name}</h1>
              <span class="pill primary">Template</span>
            </div>
            ${
              template.targetUrl
                ? html`
              <div class="project-detail__url" style="margin-top: 8px;">
                <span style="opacity: 0.5;">${icons.globe}</span>
                <span class="project-detail__url-text">${template.targetUrl}</span>
              </div>
            `
                : nothing
            }
            <p style="color: var(--muted); margin-top: 12px; font-size: 14px;">
               ${template.description || "No description provided."}
            </p>
          </div>
          <div>
            <button
              class="project-create-modal__btn project-create-modal__btn--primary"
              style="font-size: 14px; padding: 12px 24px; border-radius: 8px;"
              @click=${() => void state.handleExecutionRun(template.id)}
            >
              ${icons.spark} Run Execution
            </button>
          </div>
        </div>

        <div class="project-detail__section" style="margin-top: 32px;">
          <h2 class="project-detail__section-title" style="margin-bottom: 12px;">
            ${icons.zap} AI Auto-Testing Instructions
          </h2>
          <textarea
            class="document-editor__content"
            style="min-height: 200px; font-family: monospace; padding: 16px; border: 1px solid var(--border-color, #30363d); border-radius: 6px;"
            .value=${template.aiPrompt}
            @change=${(e: Event) => {
              void state.handleTemplateUpdate(template.id, {
                aiPrompt: (e.target as HTMLTextAreaElement).value,
              });
            }}
            placeholder="Write master AI testing instructions here..."
          ></textarea>
        </div>

        <div class="project-detail__section" style="margin-top: 32px;">
          <h2 class="project-detail__section-title" style="margin-bottom: 16px;">
            ${icons.book} Execution History
          </h2>
          ${
            state.executionsList.length === 0
              ? html`
                  <div
                    style="
                      padding: 24px;
                      text-align: center;
                      border: 1px dashed var(--border-color);
                      border-radius: 6px;
                    "
                  >
                    <p style="color: var(--muted)">No executions have been run yet.</p>
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
                ${state.executionsList.map((execution) => {
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
                            @click=${() => void state.handleExecutionCancel(execution.id)}
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
    </div>
    ${state.showCreateModal ? renderCreateModal(state) : nothing}
  `;
}

function renderCreateModal(state: AppViewState) {
  return html`
    <div
      class="project-create-modal"
      @click=${(e: MouseEvent) => {
        if (e.target === e.currentTarget) {
          state.showCreateModal = false;
        }
      }}
    >
      <div class="project-create-modal__dialog">
        <h2 class="project-create-modal__title">New Project Template</h2>
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
          <label class="project-create-modal__label">Target URL (Required)</label>
          <input
            class="project-create-modal__input"
            type="url"
            placeholder="https://test.example.com"
            .value=${state.createFormTargetUrl}
            @input=${(e: Event) => {
              state.createFormTargetUrl = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
        <div class="project-create-modal__field">
          <label class="project-create-modal__label">AI Prompt</label>
          <textarea
            class="project-create-modal__input"
            style="min-height: 120px; resize: vertical;"
            placeholder="Auto test a web site..."
            .value=${state.createFormAiPrompt}
            @input=${(e: Event) => {
              state.createFormAiPrompt = (e.target as HTMLTextAreaElement).value;
            }}
          ></textarea>
        </div>
        <div class="project-create-modal__actions">
          <button
            class="project-create-modal__btn"
            @click=${() => {
              state.showCreateModal = false;
            }}
          >
            Cancel
          </button>
          <button
            class="project-create-modal__btn project-create-modal__btn--primary"
            ?disabled=${!state.createFormName.trim() || !state.createFormTargetUrl.trim() || state.templateCreating}
            @click=${() => {
              void state.handleTemplateCreate(
                state.createFormName.trim(),
                state.createFormDescription.trim(),
                state.createFormTargetUrl.trim(),
                state.createFormAiPrompt.trim(),
              );
            }}
          >
            ${state.templateCreating ? "Creating..." : "Create Template"}
          </button>
        </div>
      </div>
    </div>
  `;
}

function renderExecutionDebugger(state: AppViewState) {
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
    <div style="display: flex; height: 100%; width: 100%; overflow: hidden;">
      <!-- Main Debugger View -->
      <div class="content content--scroll" style="flex: 1; min-width: 0; overflow-y: auto;">
        <div class="project-detail" style="border-right: 1px solid var(--border-color); min-height: 100%;">
        <div class="project-detail__header" style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 24px;">
           <div>
             <button class="project-create-modal__btn" @click=${() => state.handleExecutionSetActive(null)} style="margin-bottom: 16px;">
               ${icons.chevronRight} ${state.tab === "autoTestRun" ? "Back to Auto Run List" : `Back to ${template?.name || "Template"}`}
             </button>
             <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 8px;">
               <h1 class="project-detail__name" style="margin: 0;">Execution Debugger</h1>
               <span class="pill ${execution.status === "completed" ? "success" : execution.status === "running" ? "primary" : "danger"}">${execution.status.toUpperCase()}</span>
             </div>
             <p style="color: var(--muted); margin-top: 8px; font-size: 14px;">
               Execution ID: ${execution.id} <br/>
               Started: ${dateInfo} (${durationSec}s elapsed)
             </p>
           </div>
           ${
             execution.status === "running"
               ? html`
             <button class="project-create-modal__btn project-create-modal__btn--danger" style="padding: 8px 16px;" @click=${() => void state.handleExecutionCancel(execution.id)}>
               Cancel Execution
             </button>
           `
               : nothing
           }
        </div>

        <div class="project-detail__section">
          <h2 class="project-detail__section-title" style="margin-bottom: 16px;">Test Cases (${testCases.length} total)</h2>
          
          <div style="display: flex; flex-direction: column; gap: 16px;">
            ${testCases.map(
              (tc: TestCaseRun) => html`
              <details class="test-case-accordion" style="background: var(--bg-surface-2, #21262d); border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden;" ?open=${tc.status === "Failed" || execution.status === "running"}>
                <summary style="padding: 16px; cursor: pointer; display: flex; align-items: center; justify-content: space-between; font-weight: 500; outline: none; user-select: none;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <span class="pill ${tc.status === "Success" ? "success" : tc.status === "Failed" ? "danger" : ""}">${tc.status}</span>
                    <span>${tc.title}</span>
                  </div>
                  <span style="opacity: 0.5;">${icons.chevronDown}</span>
                </summary>

                ${
                  tc.testCaseStepRuns.length > 0
                    ? html`
                  <div style="border-top: 1px solid var(--border-color); padding: 0;">
                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 13px;">
                      <thead>
                        <tr style="background: rgba(0,0,0,0.2); border-bottom: 1px solid var(--border-color);">
                          <th style="padding: 12px 16px;">Procedure</th>
                          <th style="padding: 12px 16px;">Expected</th>
                          <th style="padding: 12px 16px;">Actual</th>
                          <th style="padding: 12px 16px; width: 80px;">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        ${tc.testCaseStepRuns.map(
                          (step: TestCaseStepRun, idx: number) => html`
                          <tr style="border-bottom: ${idx === tc.testCaseStepRuns.length - 1 ? "none" : "1px solid var(--border-color)"};">
                            <td style="padding: 12px 16px;">${step.procedureText}</td>
                            <td style="padding: 12px 16px; color: var(--muted);">${step.expectedResult}</td>
                            <td style="padding: 12px 16px;">${step.actualResult || "--"}</td>
                            <td style="padding: 12px 16px;">
                               <span style="color: ${step.status === "Success" ? "#3fb950" : step.status === "Failed" ? "#f85149" : "#838387"}; display: flex; align-items: center; gap: 4px;">
                                 ${step.status === "Success" ? icons.check : step.status === "Failed" ? icons.x : "--"}
                               </span>
                            </td>
                          </tr>
                          ${
                            step.screenshotUrl
                              ? html`
                            <tr style="border-bottom: ${idx === tc.testCaseStepRuns.length - 1 ? "none" : "1px solid var(--border-color)"}; background: rgba(0,0,0,0.1);">
                              <td colspan="4" style="padding: 16px;">
                                <div style="font-weight: 500; margin-bottom: 8px; font-size: 12px; color: var(--muted);">Screenshot Evidence:</div>
                                <div style="width: 100%; overflow: hidden; border: 1px solid var(--border-color); border-radius: 4px; display: flex; align-items: center; justify-content: center; background: #000;">
                                   <img src=${step.screenshotUrl} style="max-width: 100%; max-height: 400px; display: block;" alt="Evidence for ${step.procedureText}" />
                                </div>
                              </td>
                            </tr>
                          `
                              : nothing
                          }
                        `,
                        )}
                      </tbody>
                    </table>
                  </div>
                `
                    : html`
                        <div
                          style="
                            border-top: 1px solid var(--border-color);
                            padding: 16px;
                            color: var(--muted);
                            font-size: 13px;
                          "
                        >
                          No steps available to display.
                        </div>
                      `
                }
              </details>
            `,
            )}
            </div>
          </div>
        </div>
      </div>
      
      <!-- Embedded Contextual Chat widget -->
      <div style="width: 450px; flex-shrink: 0; display: flex; flex-direction: column; background: var(--bg-surface-1, #0d1117); padding: 24px; color: var(--muted);">
        Chat panel coming soon
      </div>
    </div>
  `;
}

export function renderAutoTestRunView(state: AppViewState) {
  if (state.activeExecutionId) {
    return renderExecutionDebugger(state);
  }

  return html`
    <div class="content content--scroll">
      <div class="content-header">
        <h1 class="page-title">Auto Test Run</h1>
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
