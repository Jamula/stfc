import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('stfc-runs-tab')
export class StfcRunsTab extends LitElement {
  static override styles = css`
    :host { display: block; padding: 1rem; }
  `;

  override render() {
    return html`<p>Runs tab loaded — data wiring in #121.</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-runs-tab': StfcRunsTab;
  }
}
