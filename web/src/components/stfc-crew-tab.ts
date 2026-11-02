import { customElement } from 'lit/decorators.js';
import { DashboardTabElement } from './stfc-dashboard-tab.js';

@customElement('stfc-crew-tab')
export class StfcCrewTab extends DashboardTabElement {
  protected readonly tab = 'crew';
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-crew-tab': StfcCrewTab;
  }
}
