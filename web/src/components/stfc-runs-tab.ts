import { customElement } from 'lit/decorators.js';
import { DashboardTabElement } from './stfc-dashboard-tab.js';

@customElement('stfc-runs-tab')
export class StfcRunsTab extends DashboardTabElement {
  protected readonly tab = 'runs';
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-runs-tab': StfcRunsTab;
  }
}
