import { LitElement, html, css } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('stfc-redeems-tab')
export class StfcRedeemsTab extends LitElement {
  static override styles = css`
    :host { display: block; padding: 1rem; }
  `;

  override render() {
    return html`<p>Redeems tab loaded — data wiring in #121.</p>`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-redeems-tab': StfcRedeemsTab;
  }
}
