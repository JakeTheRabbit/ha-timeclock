import type { PayrollExporter } from "./adapter";
import { NotImplementedError } from "./adapter";

/** STUB (deferred): Xero Payroll NZ API push. Interface wired; ships CSV until
 * OAuth credentials + pay-item mapping are configured. */
export const xeroExporter: PayrollExporter = {
  id: "xero",
  label: "Xero Payroll NZ (coming soon)",
  exportPeriod(): never {
    throw new NotImplementedError("Xero");
  },
};
