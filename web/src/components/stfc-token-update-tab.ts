import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";

interface LoginStart {
  id: string;
  screenshot: string;
}

interface Receipt {
  accountName: string;
  added: boolean;
  updatedAt: string;
}

class TokenUpdateError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "TokenUpdateError";
  }
}

async function api<T>(action: string, method: "GET" | "POST", body?: object): Promise<T> {
  const response = await fetch(`/api/token-session/${action}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    cache: "no-store",
    credentials: "same-origin",
  });
  let value: unknown;
  try {
    value = await response.json();
  } catch {
    throw new TokenUpdateError("The token-update service returned an invalid response.", 502);
  }
  if (!response.ok) {
    const message = typeof value === "object" && value !== null &&
      "error" in value && typeof value.error === "string"
      ? value.error
      : "The token update could not be completed.";
    throw new TokenUpdateError(message, response.status);
  }
  return value as T;
}

@customElement('stfc-token-update-tab')
export class StfcTokenUpdateTab extends LitElement {
  static override styles = css`
    :host { display: block; max-width: 42rem; }
    form { display: grid; gap: 1rem; }
    label { display: grid; gap: 0.4rem; font-weight: 600; }
    input, button { box-sizing: border-box; min-height: 48px; font: inherit; padding: 0.65rem; }
    input { border: 1px solid #777; border-radius: 0.35rem; }
    button { border: 0; border-radius: 0.35rem; background: #075a9c; color: white; font-weight: 600; cursor: pointer; }
    button.secondary { background: #444; }
    button:disabled { opacity: 0.6; cursor: wait; }
    .otp { font-size: 1.2rem; letter-spacing: 0.3rem; text-align: center; }
    img { display: block; width: min(100%, 390px); height: auto; border: 1px solid #888; border-radius: 0.4rem; }
    .notice { padding: 0.8rem; border-radius: 0.35rem; background: #eef6fc; }
    .error { color: #a4262c; }
    .success { color: #107c10; }
    @media (max-width: 520px) { :host { width: 100%; } }
  `;

  @state() private _accountNames: string[] = [];
  @state() private _accountName = "";
  @state() private _email = "";
  @state() private _sessionId = "";
  @state() private _screenshot = "";
  @state() private _otp = "";
  @state() private _busy = false;
  @state() private _error = "";
  @state() private _receipt?: Receipt;

  override connectedCallback(): void {
    super.connectedCallback();
    void this._loadAccountNames();
  }

  override render() {
    return html`
      <h2>Update an STFC token</h2>
      <p class="notice">
        Sign in through the official STFC store. Your verification code and token are sent
        only to the authenticated service; neither is saved in this browser or shown here.
        Choose an existing account label to replace it, or enter a new label to add an account.
      </p>
      ${this._error ? html`<p class="error" role="alert">${this._error}</p>` : ""}
      ${this._receipt ? html`
        <p class="success" role="status">
          Token updated for <strong>${this._receipt.accountName}</strong>
          ${this._receipt.added ? "(new account)" : ""}.
        </p>
        <button class="secondary" @click=${this._reset}>Update another account</button>
      ` : this._sessionId ? this._renderOtp() : this._renderStart()}
    `;
  }

  private _renderStart() {
    return html`
      <form @submit=${this._start}>
        <label>
          Account label
          <input
            name="accountName"
            list="stfc-account-names"
            autocomplete="off"
            required
            maxlength="64"
            pattern="[A-Za-z0-9._-]+"
            .value=${this._accountName}
            @input=${(event: InputEvent) => { this._accountName = (event.target as HTMLInputElement).value; }}
          />
          <datalist id="stfc-account-names">
            ${this._accountNames.map((name) => html`<option value=${name}></option>`)}
          </datalist>
        </label>
        <label>
          STFC sign-in email
          <input
            name="email"
            type="email"
            autocomplete="email"
            required
            maxlength="254"
            .value=${this._email}
            @input=${(event: InputEvent) => { this._email = (event.target as HTMLInputElement).value; }}
          />
        </label>
        <button ?disabled=${this._busy}>${this._busy ? "Opening secure sign-in…" : "Continue to STFC sign-in"}</button>
      </form>
    `;
  }

  private _renderOtp() {
    return html`
      <p>Enter the one-time code sent by Scopely to <strong>${this._email}</strong>.</p>
      <img src="data:image/png;base64,${this._screenshot}" alt="STFC sign-in page showing the verification-code prompt" />
      <form @submit=${this._verify}>
        <label>
          6-digit verification code
          <input
            class="otp"
            name="otp"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]{6}"
            minlength="6"
            maxlength="6"
            required
            .value=${this._otp}
            @input=${(event: InputEvent) => { this._otp = (event.target as HTMLInputElement).value; }}
          />
        </label>
        <button ?disabled=${this._busy}>${this._busy ? "Validating and saving…" : "Verify and update token"}</button>
        <button class="secondary" type="button" ?disabled=${this._busy} @click=${this._cancel}>Cancel sign-in</button>
      </form>
    `;
  }

  private readonly _loadAccountNames = async (): Promise<void> => {
    try {
      const result = await api<{ accounts: string[] }>("accounts", "GET");
      this._accountNames = result.accounts;
      if (result.accounts.length === 1) this._accountName = result.accounts[0]!;
    } catch (error) {
      this._error = error instanceof Error ? error.message : "The account list could not be loaded.";
    }
  };

  private readonly _start = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    this._busy = true;
    this._error = "";
    try {
      const started = await api<LoginStart>("start", "POST", {
        accountName: this._accountName,
        email: this._email,
      });
      this._sessionId = started.id;
      this._screenshot = started.screenshot;
    } catch (error) {
      this._error = error instanceof Error ? error.message : "The sign-in session could not be started.";
    } finally {
      this._busy = false;
    }
  };

  private readonly _verify = async (event: SubmitEvent): Promise<void> => {
    event.preventDefault();
    this._busy = true;
    this._error = "";
    try {
      this._receipt = await api<Receipt>("verify", "POST", { id: this._sessionId, otp: this._otp });
      this._accountNames = this._receipt.added
        ? [...this._accountNames, this._receipt.accountName].sort()
        : this._accountNames;
      this._sessionId = "";
      this._screenshot = "";
      this._otp = "";
    } catch (error) {
      this._error = error instanceof Error ? error.message : "The token update could not be completed.";
      if (!(error instanceof TokenUpdateError) ||
          (error.status !== 422 && error.status !== 429)) {
        this._sessionId = "";
        this._screenshot = "";
      } else if (!/verification code was not accepted/i.test(error.message)) {
        this._sessionId = "";
        this._screenshot = "";
      }
    } finally {
      this._otp = "";
      this._busy = false;
    }
  };

  private readonly _cancel = async (): Promise<void> => {
    this._busy = true;
    try {
      await api("cancel", "POST", { id: this._sessionId });
      this._reset();
    } catch {
      this._error = "The session could not be cancelled; it will expire automatically.";
      this._sessionId = "";
      this._screenshot = "";
      this._otp = "";
    } finally {
      this._busy = false;
    }
  };

  private readonly _reset = (): void => {
    this._sessionId = "";
    this._screenshot = "";
    this._otp = "";
    this._receipt = undefined;
    this._error = "";
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "stfc-token-update-tab": StfcTokenUpdateTab;
  }
}
