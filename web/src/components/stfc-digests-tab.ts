import { customElement } from 'lit/decorators.js';
import { DashboardTabElement } from './stfc-dashboard-tab.js';

@customElement('stfc-digests-tab')
export class StfcDigestsTab extends DashboardTabElement {
  protected readonly tab = 'digests';
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-digests-tab': StfcDigestsTab;
  }
}
