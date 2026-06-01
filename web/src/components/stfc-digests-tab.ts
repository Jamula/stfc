import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('stfc-digests-tab')
export class StfcDigestsTab extends LitElement {
  static override styles = css`
    :host { display: block; padding: 1rem; }
  `;

  override render() {
    return html`<p>Digests tab loaded — data wiring in #121.</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-digests-tab': StfcDigestsTab;
  }
}
