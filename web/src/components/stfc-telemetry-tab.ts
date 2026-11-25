import { customElement } from "lit/decorators.js";
import { DashboardTabElement } from "./stfc-dashboard-tab.js";

@customElement("stfc-telemetry-tab")
export class StfcTelemetryTab extends DashboardTabElement {
  protected readonly tab = "telemetry";
}

declare global {
  interface HTMLElementTagNameMap {
    "stfc-telemetry-tab": StfcTelemetryTab;
  }
}
