import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('stfc-crew-tab')
export class StfcCrewTab extends LitElement {
  static override styles = css`
    :host { display: block; padding: 1rem; }
  `;

  override render() {
    return html`<p>Crew tab loaded — data wiring in #121.</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-crew-tab': StfcCrewTab;
  }
}
