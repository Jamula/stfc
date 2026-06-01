import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('stfc-telemetry-tab')
export class StfcTelemetryTab extends LitElement {
  static override styles = css`
    :host { display: block; padding: 1rem; }
  `;

  override render() {
    return html`<p>Telemetry tab loaded — data wiring in #121.</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-telemetry-tab': StfcTelemetryTab;
  }
}
