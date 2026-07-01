import type { Notifier, NotifyMessage } from "./index";
import { getSettings } from "@/server/domain/settings";

/**
 * Home Assistant notify via the Supervisor proxy. Available because
 * config.yaml sets homeassistant_api: true, which injects SUPERVISOR_TOKEN.
 * Service name (e.g. "notify.mobile_app_bens_phone") comes from settings.
 */
export const haNotifier: Notifier = {
  id: "ha",
  async send(msg: NotifyMessage): Promise<void> {
    const token = process.env.SUPERVISOR_TOKEN;
    if (!token) throw new Error("SUPERVISOR_TOKEN missing (not running under HA?)");
    const { notifications } = await getSettings();
    const [domain, service] = notifications.haNotifyService.split(".");
    if (domain !== "notify" || !service) throw new Error(`bad notify service: ${notifications.haNotifyService}`);

    const res = await fetchImpl(`http://supervisor/core/api/services/notify/${service}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: msg.title, message: msg.message }),
    });
    if (!res.ok) throw new Error(`HA notify ${res.status}`);
  },
};

// Injectable for tests.
export let fetchImpl: typeof fetch = fetch;
export function setFetchImpl(f: typeof fetch) {
  fetchImpl = f;
}
