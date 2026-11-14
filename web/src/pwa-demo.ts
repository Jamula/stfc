import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { DEMO_OTP, type DemoAccount, type DemoReceipt } from '../../shared/pwa-demo.js';

interface SessionView { id: string; email: string; screenshot: string }
class DemoRequestError extends Error {
  constructor(message: string, readonly status: number, readonly restart: boolean) { super(message); }
}

@customElement('stfc-login-demo')
export class StfcLoginDemo extends LitElement {
  static override styles = css`
    :host { display: block; max-width: 430px; margin: auto; padding: 16px;
      font-family: system-ui, sans-serif; color: #16324f; }
    h1 { font-size: 1.5rem; }
    label, select, input, button { display: block; margin: 12px 0; }
    select, input, button { box-sizing: border-box; width: 100%; min-height: 48px; font-size: 16px; }
    button { background: #16324f; color: white; border: 0; border-radius: 8px; }
    button:disabled { opacity: .6; }
    img { display: block; width: 100%; height: auto; border: 1px solid #ccc; }
    .warning { background: #fff4ce; padding: 12px; }
    .error { color: #a11212; }
  `;
  @state() private session?: SessionView;
  @state() private receipt?: DemoReceipt;
  @state() private screenshot = '';
  @state() private busy = false;
  @state() private error = '';
  @state() private installStatus = '';
  private account: DemoAccount = 'alpha';

  override connectedCallback() {
    super.connectedCallback();
    if ('serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/pwa-demo/sw.js', { scope: '/pwa-demo/' })
        .then(() => { this.installStatus = 'Demo service worker registered; network required.'; })
        .catch(() => { this.installStatus = 'Service worker unavailable; demo still works in this browser.'; });
    } else this.installStatus = 'Service worker unavailable; demo still works in this browser.';
  }

  private async request<T>(action: string, body: object): Promise<T> {
    const response = await fetch(`/prototype-api/${action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body), cache: 'no-store',
    });
    const result = await response.json();
    if (!response.ok) throw new DemoRequestError(result.error ?? 'Demo request failed', response.status,
      result.code === 'RESTART_SESSION');
    return result as T;
  }

  private async act(task: () => Promise<void>) {
    this.busy = true;
    this.error = '';
    try { await task(); }
    catch (error) {
      if (error instanceof DemoRequestError && (error.status === 404 || error.status === 410 || error.restart)) {
        this.session = undefined;
        this.screenshot = '';
      }
      this.error = error instanceof Error ? error.message : 'Demo unavailable';
    }
    finally { this.busy = false; }
  }

  private start() {
    return this.act(async () => {
      this.receipt = undefined;
      this.session = await this.request<SessionView>('start', { account: this.account });
      this.screenshot = this.session.screenshot;
    });
  }

  private verify(event: SubmitEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const otp = String(new FormData(form).get('otp'));
    form.reset();
    return this.act(async () => {
      const result = await this.request<{ receipt: DemoReceipt; screenshot: string }>('verify', {
        id: this.session?.id, otp,
      });
      this.receipt = result.receipt;
      this.screenshot = result.screenshot;
      this.session = undefined;
    });
  }

  private cancel() {
    return this.act(async () => {
      await this.request('cancel', { id: this.session?.id });
      this.session = undefined;
      this.screenshot = '';
    });
  }

  override render() {
    return html`
      <h1>PWA login feasibility demo</h1>
      <p class="warning"><strong>Synthetic only.</strong> Do not enter real email, OTP or tokens.
        No STFC connection, cloud service or redemption.</p>
      <p>Remote Chromium screenshot with an accessible local OTP form.
        This is not an embedded browser or arbitrary remote control.</p>
      ${this.session ? html`
        <p>Demo account: ${this.session.email}. Session expires after two minutes.</p>
        <p>Synthetic OTP: <strong>${DEMO_OTP}</strong></p>
        <form @submit=${this.verify}>
          <label for="otp">Synthetic OTP only</label>
          <input id="otp" name="otp" inputmode="numeric" autocomplete="one-time-code"
            pattern="[0-9]{6}" maxlength="6" required ?disabled=${this.busy} />
          <button ?disabled=${this.busy}>Verify demo OTP</button>
        </form>
        <button @click=${this.cancel} ?disabled=${this.busy}>Cancel session</button>
      ` : html`
        <label for="account">Synthetic account</label>
        <select id="account" .value=${this.account} ?disabled=${this.busy}
          @change=${(event: Event) => { this.account = (event.target as HTMLSelectElement).value as DemoAccount; }}>
          <option value="alpha">alpha@example.invalid</option>
          <option value="beta">beta@example.invalid</option>
        </select>
        <button @click=${this.start} ?disabled=${this.busy}>Start controlled browser</button>
      `}
      <p role="status" aria-live="polite">${this.busy ? 'Working...' : this.receipt
        ? `Synthetic token updated for ${this.receipt.email}, revision ${this.receipt.revision}. Stored in process memory only.` : ''}</p>
      <p role="alert" class="error">${this.error}</p>
      ${this.screenshot ? html`<img alt="Live screenshot of the controlled synthetic provider"
        src=${`data:image/png;base64,${this.screenshot}`} />` : ''}
      <p>${this.installStatus}</p>
      <p>On iPhone: Safari &gt; Share &gt; Add to Home Screen (requires a reachable HTTPS host).
        This local-only prototype is not deployed or reachable from your phone.</p>
    `;
  }
}
