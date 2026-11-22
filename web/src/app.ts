import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import './components/stfc-redeems-tab.js';
import './components/stfc-digests-tab.js';
import './components/stfc-telemetry-tab.js';
import './components/stfc-crew-tab.js';
import './components/stfc-runs-tab.js';
import './components/stfc-token-update-tab.js';
import './components/stfc-discord-tab.js';

type Tab = 'redeems' | 'digests' | 'telemetry' | 'crew' | 'runs' | 'discord' | 'token-update';
const TABS: readonly Tab[] = ['redeems', 'digests', 'telemetry', 'crew', 'runs', 'discord', 'token-update'] as const;
const TAB_LABELS: Record<Tab, string> = {
  redeems: 'Redeems',
  digests: 'Digests',
  telemetry: 'Telemetry',
  crew: 'Crew',
  runs: 'Runs',
  discord: 'Discord',
  'token-update': 'Token update',
};

function readHash(): Tab {
  const hash = location.hash.replace('#', '') as Tab;
  return TABS.includes(hash) ? hash : 'redeems';
}

@customElement('stfc-app')
export class StfcApp extends LitElement {
  static override styles = css`
    :host {
      display: block;
      font-family: system-ui, sans-serif;
      max-width: 1200px;
      margin: 0 auto;
      padding: 1rem;
    }

    nav {
      display: flex;
      gap: 0.5rem;
      overflow-x: auto;
      border-bottom: 2px solid #333;
      margin-bottom: 1rem;
    }

    button {
      background: none;
      border: none;
      padding: 0.5rem 1rem;
      cursor: pointer;
      font-size: 1rem;
      border-bottom: 3px solid transparent;
      margin-bottom: -2px;
      text-transform: capitalize;
    }

    button[aria-selected='true'] {
      border-bottom-color: #0078d4;
      font-weight: 600;
    }

    button:hover {
      background: #f0f0f0;
    }

    .tab-content {
      display: block;
    }
  `;

  @state() private _tab: Tab = readHash();
  @state() private _tokenTabOpened = this._tab === 'token-update';

  override connectedCallback(): void {
    super.connectedCallback();
    window.addEventListener('hashchange', this._onHashChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    window.removeEventListener('hashchange', this._onHashChange);
  }

  private readonly _onHashChange = (): void => {
    this._tab = readHash();
  };

  private _selectTab(tab: Tab): void {
    if (tab === 'token-update') this._tokenTabOpened = true;
    location.hash = tab;
    this._tab = tab;
  }

  override render() {
    return html`
      <header>
        <h1>STFC Control Panel</h1>
      </header>
      <nav role="tablist">
        ${TABS.map(
          (tab) => html`
            <button
              role="tab"
              aria-selected=${this._tab === tab ? 'true' : 'false'}
              @click=${() => this._selectTab(tab)}
            >${TAB_LABELS[tab]}</button>
          `,
        )}
      </nav>
      <div class="tab-content" role="tabpanel">
        ${this._renderTab()}
      </div>
      <div ?hidden=${this._tab !== 'token-update'}>
        ${this._tokenTabOpened ? html`<stfc-token-update-tab></stfc-token-update-tab>` : ''}
      </div>
    `;
  }

  private _renderTab() {
    switch (this._tab) {
      case 'redeems':   return html`<stfc-redeems-tab></stfc-redeems-tab>`;
      case 'digests':   return html`<stfc-digests-tab></stfc-digests-tab>`;
      case 'telemetry': return html`<stfc-telemetry-tab></stfc-telemetry-tab>`;
      case 'crew':      return html`<stfc-crew-tab></stfc-crew-tab>`;
      case 'runs':      return html`<stfc-runs-tab></stfc-runs-tab>`;
      case 'discord':   return html`<stfc-discord-tab></stfc-discord-tab>`;
      case 'token-update': return html``;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'stfc-app': StfcApp;
  }
}
