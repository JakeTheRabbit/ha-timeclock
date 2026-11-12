import type { Employee } from "@/db/schema";
import type { NotifyMessage } from "./index";

/**
 * Push to ONE person's phone via their HA notify service (Admin → Employees →
 * notify service). No-op outside HA or when the person has none. Never throws.
 */
export async function notifyEmployee(emp: Pick<Employee, "notifyService" | "displayName">, msg: NotifyMessage) {
  const token = process.env.SUPERVISOR_TOKEN;
  const [domain, service] = (emp.notifyService ?? "").split(".");
  if (!token || domain !== "notify" || !service) return;
  try {
    const res = await fetch(`http://supervisor/core/api/services/notify/${service}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ title: msg.title, message: msg.message }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (e) {
    console.error(`[notify] ${emp.displayName} failed:`, e instanceof Error ? e.message : e);
  }
}
