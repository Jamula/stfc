import { LitElement, html, css } from "lit";
import { state } from "lit/decorators.js";
import { loadDashboard } from "../dashboard-client.js";
import type { DashboardData, DashboardTab } from "../../../shared/dashboard.js";

export abstract class DashboardTabElement extends LitElement {
  protected abstract readonly tab: DashboardTab;
  @state() private data: DashboardData | null = null;
  @state() private error: string | null = null;
  private request: AbortController | null = null;

  static override styles = css`
    :host { display: block; padding: 1rem; }
    pre { white-space: pre-wrap; overflow-wrap: anywhere; }
    table { border-collapse: collapse; width: 100%; }
    th, td { padding: .5rem; border-bottom: 1px solid #ccc; text-align: left; }
    .table { overflow-x: auto; }
    [role=alert] { color: #b10e1e; }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
    this.request = new AbortController();
    void this.load(this.request);
  }

  override disconnectedCallback(): void {
    this.request?.abort();
    super.disconnectedCallback();
  }

  private async load(request: AbortController): Promise<void> {
    this.data = null;
    this.error = null;
    try {
      const data = await loadDashboard(this.tab, request.signal);
      if (!request.signal.aborted) this.data = data;
    } catch (error) {
      if (!request.signal.aborted) {
        this.error = error instanceof Error ? error.message : "Dashboard read failed.";
      }
    }
  }

  override render() {
    if (this.error) return html`<p role="alert">${this.error}</p>`;
    if (!this.data) return html`<p role="status">Loading ${this.tab}...</p>`;
    if (!this.data.available) return html`<p role="status">${this.data.message ?? "Data unavailable."}</p>`;
    if (this.tab === "runs") {
      if (this.data.runs.length === 0) return html`<p>No runs available.</p>`;
      return html`<div class="table"><table>
        <thead><tr><th>Started</th><th>Workflow</th><th>Actor</th><th>Trigger</th><th>Status</th><th>Correlation</th><th>Business result</th></tr></thead>
        <tbody>${this.data.runs.map(run => html`<tr>
          <td>${run.started_at ?? (["in_progress", "completed"].includes(run.status) ? "Start time unavailable" : "Not started")}</td><td>${run.workflow}</td><td>${run.actor}</td>
          <td>${run.trigger}</td><td>${run.conclusion ?? run.status}</td>
          <td>${run.correlation_id ?? "Not correlated"}</td>
          <td><pre>${run.business_result ? JSON.stringify(run.business_result, null, 2) : "Not emitted"}</pre></td>
        </tr>`)}</tbody>
      </table></div>`;
    }
    if (this.data.documents.length === 0) return html`<p>No ${this.tab} data available.</p>`;
    return html`${this.data.documents.map(document => html`<section>
      <h2>${document.path}</h2><p>Source: ${document.ref}</p>
      <pre>${document.content}</pre>
    </section>`)}`;
  }
}
