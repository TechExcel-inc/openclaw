import { html, nothing } from "lit";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { icons } from "../icons.ts";
import { toSanitizedMarkdownHtml } from "../markdown.ts";

export type MarkdownSidebarProps = {
  content: string | null;
  error: string | null;
  /** When omitted, the panel has no close control (e.g. Project Run summary stays visible). */
  onClose?: () => void;
  onViewRawText: () => void;
  /** Defaults to "Tool Output". */
  title?: string;
  /** When true, adds log-stream class to sidebar-content for auto-scroll. */
  autoScroll?: boolean;
};

export function renderMarkdownSidebar(props: MarkdownSidebarProps) {
  const title = props.title?.trim() || "Tool Output";
  return html`
    <div class="sidebar-panel">
      <div class="sidebar-header">
        <div class="sidebar-title">${title}</div>
        ${
          props.onClose
            ? html`
                <button @click=${props.onClose} class="btn" title="Close sidebar">
                  ${icons.x}
                </button>
              `
            : nothing
        }
      </div>
      <div class="sidebar-content${props.autoScroll ? " log-stream" : ""}">
        ${
          props.error
            ? html`
              <div class="callout danger">${props.error}</div>
              <button @click=${props.onViewRawText} class="btn" style="margin-top: 12px;">
                View Raw Text
              </button>
            `
            : props.content
              ? html`<div class="sidebar-markdown">${unsafeHTML(toSanitizedMarkdownHtml(props.content))}</div>`
              : html`
                  <div class="muted">No content available</div>
                `
        }
      </div>
    </div>
  `;
}
