import { customElement } from "lit/decorators.js";
import { DashboardTabElement } from "./stfc-dashboard-tab.js";

@customElement("stfc-redeems-tab")
export class StfcRedeemsTab extends DashboardTabElement {
  protected readonly tab = "redeems";
}

declare global {
  interface HTMLElementTagNameMap {
    "stfc-redeems-tab": StfcRedeemsTab;
  }
}
