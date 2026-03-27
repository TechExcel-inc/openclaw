import { html, nothing } from "lit";
import type { AppViewState } from "../app-view-state.js";
import { icons } from "../icons.js";

type ProjectType = "auto-testing" | "ai-coding" | "customer-support" | "general";

const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  "auto-testing": "Auto Testing",
  "ai-coding": "AI Coding & Testing",
  "customer-support": "Customer Support",
  general: "General",
};

export function renderProjectsView(state: AppViewState) {
  const activeProject = state.projectDetail;
  if (activeProject) {
    return renderProjectDetail(state);
  }

  return html`
    <div class="content content--scroll">
      <div class="content-header">
        <h1 class="page-title">Projects</h1>
        <p class="page-subtitle">Manage your AI workbench projects</p>
      </div>
      <div class="projects-empty-state" style="padding: 48px 24px; text-align: center;">
        <div style="margin-bottom: 16px; opacity: 0.5;">${icons.folder}</div>
        <p style="color: var(--text-tertiary, #8b8f98); margin-bottom: 16px;">
          ${
            state.projectsList.length === 0
              ? "Create your first project to get started"
              : "Select a project from the sidebar or create a new one"
          }
        </p>
        <button
          class="project-create-modal__btn project-create-modal__btn--primary"
          @click=${() => {
            state.showCreateModal = true;
          }}
        >
          ${icons.plus} New Project
        </button>
      </div>
    </div>
    ${state.showCreateModal ? renderCreateModal(state) : nothing}
  `;
}

function renderProjectDetail(state: AppViewState) {
  const project = state.projectDetail;
  if (!project) {
    return nothing;
  }

  const typeLabel = PROJECT_TYPE_LABELS[project.type as ProjectType] ?? project.type;

  return html`
    <div class="content content--scroll">
      <div class="project-detail">
        <div class="project-detail__header">
          <div style="display: flex; align-items: center; gap: 12px;">
            <h1 class="project-detail__name">${project.name}</h1>
            <span class="project-detail__type-badge">${typeLabel}</span>
          </div>
          <div class="project-detail__meta">
            <span>Created ${new Date(project.createdAt).toLocaleDateString()}</span>
            <span>${project.documents.length} documents</span>
          </div>
          ${
            project.boundUrl
              ? html`
                <div class="project-detail__url">
                  <span style="opacity: 0.5;">${icons.globe}</span>
                  <span class="project-detail__url-text">${project.boundUrl}</span>
                </div>
              `
              : nothing
          }
        </div>

        <!-- Analysis section -->
        <div class="project-detail__section">
          <h2 class="project-detail__section-title">
            ${icons.zap} AI Analysis
          </h2>
          ${
            project.boundUrl
              ? html`
                <div class="analysis-status analysis-status--${state.projectAnalysisStatus ?? "idle"}">
                  <span>
                    ${
                      state.projectAnalysisStatus === "fetching" ||
                      state.projectAnalysisStatus === "analyzing"
                        ? html`<span class="analysis-status__spinner">${icons.loader}</span>`
                        : state.projectAnalysisStatus === "complete"
                          ? html`
                              <span style="color: var(--success, #3fb950)">&#10003;</span>
                            `
                          : state.projectAnalysisStatus === "error"
                            ? html`
                                <span style="color: var(--danger, #f85149)">&#10007;</span>
                              `
                            : nothing
                    }
                  </span>
                  <span class="analysis-status__label">
                    ${
                      state.projectAnalysisStatus === "fetching"
                        ? "Fetching page content..."
                        : state.projectAnalysisStatus === "analyzing"
                          ? "Analyzing with AI..."
                          : state.projectAnalysisStatus === "complete"
                            ? "Analysis complete"
                            : state.projectAnalysisStatus === "error"
                              ? "Analysis failed"
                              : "Click to analyze the target URL"
                    }
                  </span>
                  <div style="margin-left: auto;">
                    <button
                      class="project-create-modal__btn project-create-modal__btn--primary"
                      ?disabled=${state.projectAnalysisStatus === "fetching" || state.projectAnalysisStatus === "analyzing"}
                      @click=${() => state.handleProjectAnalyze?.()}
                    >
                      ${
                        state.projectAnalysisStatus === "fetching" ||
                        state.projectAnalysisStatus === "analyzing"
                          ? "Analyzing..."
                          : "Analyze"
                      }
                    </button>
                  </div>
                </div>
              `
              : html`
                  <p style="color: var(--text-tertiary); font-size: 13px">
                    Bind a URL to this project to enable AI analysis.
                  </p>
                `
          }
        </div>

        <!-- Documents section -->
        <div class="project-detail__section">
          <h2 class="project-detail__section-title">
            ${icons.fileText} Documents
          </h2>
          <div style="margin-bottom: 12px;">
            <button
              class="project-create-modal__btn"
              @click=${() => state.handleDocumentCreate?.("New Document")}
            >
              ${icons.plus} Add Document
            </button>
          </div>
          ${
            state.projectDocuments.length === 0
              ? html`
                  <p style="color: var(--text-tertiary); font-size: 13px">
                    No documents yet. Analyze a URL or create one manually.
                  </p>
                `
              : html`
                <div class="document-list">
                  ${state.projectDocuments.map(
                    (doc) => html`
                      <button
                        class="document-list__item ${state.projectDocumentActive?.id === doc.id ? "document-list__item--active" : ""}"
                        @click=${() => {
                          state.projectDocumentActive = doc;
                        }}
                      >
                        <span class="document-list__item-icon">${icons.fileText}</span>
                        <div class="document-list__item-info">
                          <span class="document-list__item-name">${doc.name}</span>
                          <span class="document-list__item-date">${new Date(doc.updatedAt).toLocaleDateString()}</span>
                        </div>
                        <span class="document-list__item-type">${doc.type}</span>
                      </button>
                    `,
                  )}
                </div>
              `
          }
        </div>

        <!-- Document editor -->
        ${
          state.projectDocumentActive
            ? html`
              <div class="project-detail__section">
                <h2 class="project-detail__section-title">
                  ${icons.fileText} ${state.projectDocumentActive.name}
                </h2>
                <div class="document-editor">
                  <div class="document-editor__toolbar">
                    <span style="font-size: 12px; color: var(--text-tertiary);">
                      Markdown
                    </span>
                    <div class="document-editor__toolbar-actions">
                      <button
                        class="project-create-modal__btn"
                        style="color: var(--danger, #f85149); border-color: var(--danger, #f85149);"
                        @click=${() => {
                          if (state.projectDocumentActive && project) {
                            void state.handleDocumentDelete?.(
                              project.id,
                              state.projectDocumentActive.id,
                            );
                            state.projectDocumentActive = null;
                          }
                        }}
                      >
                        Delete
                      </button>
                      <button
                        class="project-create-modal__btn project-create-modal__btn--primary"
                        @click=${() => {
                          if (state.projectDocumentActive && project) {
                            void state.handleDocumentSave?.(
                              project.id,
                              state.projectDocumentActive.id,
                              state.projectDocumentDraft ?? state.projectDocumentActive.content,
                            );
                          }
                        }}
                      >
                        Save
                      </button>
                    </div>
                  </div>
                  <textarea
                    class="document-editor__content"
                    .value=${state.projectDocumentDraft ?? state.projectDocumentActive.content}
                    @input=${(e: Event) => {
                      state.projectDocumentDraft = (e.target as HTMLTextAreaElement).value;
                    }}
                    placeholder="Write your document content here..."
                  ></textarea>
                </div>
              </div>
            `
            : nothing
        }
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
        <h2 class="project-create-modal__title">New Project</h2>
        <div class="project-create-modal__field">
          <label class="project-create-modal__label">Name</label>
          <input
            class="project-create-modal__input"
            type="text"
            placeholder="My Project"
            .value=${state.createFormName}
            @input=${(e: Event) => {
              state.createFormName = (e.target as HTMLInputElement).value;
            }}
          />
        </div>
        <div class="project-create-modal__field">
          <label class="project-create-modal__label">Type</label>
          <select
            class="project-create-modal__select"
            .value=${state.createFormType}
            @change=${(e: Event) => {
              state.createFormType = (e.target as HTMLSelectElement).value as ProjectType;
            }}
          >
            <option value="auto-testing">Auto Testing</option>
            <option value="ai-coding">AI Coding & Testing</option>
            <option value="customer-support">Customer Support Training</option>
            <option value="general">General</option>
          </select>
        </div>
        <div class="project-create-modal__field">
          <label class="project-create-modal__label">Target URL (optional)</label>
          <input
            class="project-create-modal__input"
            type="url"
            placeholder="https://example.com"
            .value=${state.createFormUrl}
            @input=${(e: Event) => {
              state.createFormUrl = (e.target as HTMLInputElement).value;
            }}
          />
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
            ?disabled=${!state.createFormName.trim() || state.projectCreating}
            @click=${() => {
              void state.handleProjectCreate?.(
                state.createFormName.trim(),
                state.createFormType,
                state.createFormUrl.trim(),
              );
            }}
          >
            ${state.projectCreating ? "Creating..." : "Create"}
          </button>
        </div>
      </div>
    </div>
  `;
}
