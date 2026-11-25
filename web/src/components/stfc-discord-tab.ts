import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { loadDashboard } from "../dashboard-client.js";
import type { DashboardData } from "../../../shared/dashboard.js";

@customElement("stfc-discord-tab")
export class StfcDiscordTab extends LitElement {
  static override styles = css`
    :host { display: block; padding: 1rem; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    button { min-height: 48px; padding: .65rem 1rem; font: inherit; }
    [role=alert] { color: #b10e1e; }
    .notice { padding: .8rem; background: #eef6fc; }
  `;

  @state() private _digests: DashboardData | null = null;
  @state() private _runs: DashboardData | null = null;
  @state() private _loadError = "";
  @state() private _actionError = "";
  @state() private _message = "";
  @state() private _busy = false;
  private readonly _request = new AbortController();

  override connectedCallback(): void {
    super.connectedCallback();
    void this._load();
  }

  override disconnectedCallback(): void {
    this._request.abort();
    super.disconnectedCallback();
  }

  private async _load(): Promise<void> {
    this._loadError = "";
    try {
      const [digests, runs] = await Promise.all([
        loadDashboard("digests", this._request.signal),
        loadDashboard("runs", this._request.signal, { workflow: "discord-monitor", limit: 5 }),
      ]);
      if (!this._request.signal.aborted) {
        this._digests = digests;
        this._runs = runs;
      }
    } catch (error) {
      if (!this._request.signal.aborted) {
        this._loadError = error instanceof Error ? error.message : "Discord status could not be loaded.";
      }
    }
  }

  private readonly _triggerRedeem = async (): Promise<void> => {
    if (!window.confirm("Start a live gift redemption run now? This contacts the STFC store and may claim available gifts.")) {
      return;
    }
    this._busy = true;
    this._actionError = "";
    this._message = "";
    try {
      const response = await fetch("/api/discord-command/trigger-redeem", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          "X-STFC-PWA-Action": "trigger-redeem",
        },
        cache: "no-store",
      });
      const contentType = response.headers.get("content-type") ?? "";
      const value: unknown = contentType.includes("application/json") ? await response.json() : null;
      if (!response.ok || typeof value !== "object" || value === null ||
          !("accepted" in value) || value.accepted !== true) {
        const message = typeof value === "object" && value !== null && "error" in value &&
          typeof value.error === "string" ? value.error : `Could not start redemption (HTTP ${response.status}).`;
        throw new Error(message);
      }
      this._message = "Redemption run accepted. Refresh Runs to check its status.";
    } catch (error) {
      this._actionError = error instanceof Error ? error.message : "Redemption could not be started.";
    } finally {
      this._busy = false;
    }
  };

  private readonly _refresh = async (): Promise<void> => {
    this._digests = null;
    this._runs = null;
    await this._load();
  };

  override render() {
    if (!this._digests || !this._runs) return html`
      ${this._loadError
        ? html`<p role="alert">${this._loadError}</p>`
        : html`<p role="status">Loading Discord status...</p>`}
      <button @click=${this._refresh}>Refresh status</button>
    `;
    return html`
      <h2>Discord monitoring</h2>
      <p class="notice">Shows committed monitor digests and recent Discord-monitor workflow runs. The bot's game-state upload command remains available in Discord.</p>
      <h3>Recent monitoring runs</h3>
      ${this._runs.runs.length === 0 ? html`<p>No Discord-monitor runs available.</p>` : html`
        <ul>${this._runs.runs.map(run => html`<li>
          ${run.started_at ?? run.created_at}: ${run.conclusion ?? run.status}
          ${run.business_result ? html`<pre>${JSON.stringify(run.business_result, null, 2)}</pre>` : ""}
        </li>`)}</ul>
      `}
      <h3>Latest digests</h3>
      ${!this._digests.available ? html`<p role="status">${this._digests.message ?? "Digest data unavailable."}</p>` :
        this._digests.documents.length === 0 ? html`<p>No committed digests available.</p>` :
        this._digests.documents.map(document => html`<section><h4>${document.path}</h4><pre>${document.content}</pre></section>`)}
      <button ?disabled=${this._busy} @click=${this._triggerRedeem}>
        ${this._busy ? "Starting…" : "Run redemption now"}
      </button>
      ${this._actionError ? html`<p role="alert">${this._actionError}</p>` : ""}
      <button ?disabled=${this._busy} @click=${this._refresh}>Refresh status</button>
      ${this._message ? html`<p role="status">${this._message}</p>` : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "stfc-discord-tab": StfcDiscordTab;
  }
}
