import { LitElement, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { icons } from "../icons.js";

@customElement("url-bar")
export class UrlBar extends LitElement {
  override createRenderRoot() {
    return this;
  }

  @property() url = "";
  @property({ type: Boolean }) disabled = false;
  @property({ type: Boolean }) loading = false;

  private _inputValue = "";

  override updated() {
    this._inputValue = this.url;
  }

  private _handleInput(e: Event) {
    this._inputValue = (e.target as HTMLInputElement).value;
  }

  private _handleSubmit() {
    if (this._inputValue.trim() !== this.url) {
      this.dispatchEvent(
        new CustomEvent("url-change", {
          detail: this._inputValue.trim(),
          bubbles: true,
          composed: true,
        }),
      );
    }
  }

  private _handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      this._handleSubmit();
    }
  }

  override render() {
    return html`
      <div class="url-bar ${this.loading ? "url-bar--loading" : ""}">
        <span class="url-bar__icon" aria-hidden="true">${icons.globe}</span>
        <input
          class="url-bar__input"
          type="url"
          placeholder="Enter project URL..."
          .value=${this._inputValue}
          ?disabled=${this.disabled}
          @input=${(e: Event) => this._handleInput(e)}
          @keydown=${(e: KeyboardEvent) => this._handleKeydown(e)}
          @blur=${() => this._handleSubmit()}
          spellcheck="false"
        />
        ${this.loading ? html`<span class="url-bar__spinner">${icons.loader}</span>` : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "url-bar": UrlBar;
  }
}
