import type { PayrollExporter } from "./adapter";
import { NotImplementedError } from "./adapter";

/** STUB (deferred): iPayroll (NZ) API push. Interface wired; ships CSV until
 * API credentials + leave/earnings code mapping are configured. */
export const iPayrollExporter: PayrollExporter = {
  id: "ipayroll",
  label: "iPayroll NZ (coming soon)",
  exportPeriod(): never {
    throw new NotImplementedError("iPayroll");
  },
};
