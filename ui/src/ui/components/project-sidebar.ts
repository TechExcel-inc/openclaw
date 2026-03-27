import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { icons } from "../icons.js";

export type ProjectType = "auto-testing" | "ai-coding" | "customer-support" | "general";

export type ProjectItem = {
  id: string;
  name: string;
  type: ProjectType;
  boundUrl: string;
};

const PROJECT_TYPE_LABELS: Record<ProjectType, string> = {
  "auto-testing": "Testing",
  "ai-coding": "Coding",
  "customer-support": "Support",
  general: "General",
};

@customElement("project-sidebar")
export class ProjectSidebar extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @property({ attribute: false }) projects: ProjectItem[] = [];
  @property({ type: String }) activeProjectId: string | null = null;
  @property({ type: Boolean }) collapsed = false;

  private _getTypeIcon(type: ProjectType) {
    switch (type) {
      case "auto-testing":
        return icons.zap;
      case "ai-coding":
        return icons.terminal;
      case "customer-support":
        return icons.messageSquare;
      default:
        return icons.folder;
    }
  }

  override render() {
    if (this.collapsed) {
      return html`
        <div class="project-sidebar project-sidebar--collapsed">
          <button
            class="project-sidebar__add-btn"
            title="New project"
            @click=${() => this.dispatchEvent(new CustomEvent("project-create", { bubbles: true, composed: true }))}
          >
            ${icons.plus}
          </button>
          ${this.projects.map(
            (p) => html`
              <button
                class="project-sidebar__item ${p.id === this.activeProjectId ? "project-sidebar__item--active" : ""}"
                title="${p.name}"
                @click=${() => this.dispatchEvent(new CustomEvent("project-select", { detail: p.id, bubbles: true, composed: true }))}
              >
                <span class="project-sidebar__item-icon">${this._getTypeIcon(p.type)}</span>
              </button>
            `,
          )}
        </div>
      `;
    }

    return html`
      <div class="project-sidebar">
        <div class="project-sidebar__header">
          <span class="project-sidebar__title">Projects</span>
          <button
            class="project-sidebar__add-btn"
            title="New project"
            @click=${() => this.dispatchEvent(new CustomEvent("project-create", { bubbles: true, composed: true }))}
          >
            ${icons.plus}
          </button>
        </div>
        ${
          this.projects.length === 0
            ? html`
                <div class="project-sidebar__empty">No projects yet</div>
              `
            : html`
              <div class="project-sidebar__list">
                ${this.projects.map(
                  (p) => html`
                    <button
                      class="project-sidebar__item ${p.id === this.activeProjectId ? "project-sidebar__item--active" : ""}"
                      @click=${() => this.dispatchEvent(new CustomEvent("project-select", { detail: p.id, bubbles: true, composed: true }))}
                    >
                      <span class="project-sidebar__item-icon">${this._getTypeIcon(p.type)}</span>
                      <div class="project-sidebar__item-info">
                        <span class="project-sidebar__item-name">${p.name}</span>
                        <span class="project-sidebar__item-meta">
                          <span class="project-sidebar__item-type">${PROJECT_TYPE_LABELS[p.type]}</span>
                          ${
                            p.boundUrl
                              ? html`<span class="project-sidebar__item-url">${p.boundUrl}</span>`
                              : nothing
                          }
                        </span>
                      </div>
                    </button>
                  `,
                )}
              </div>
            `
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "project-sidebar": ProjectSidebar;
  }
}
