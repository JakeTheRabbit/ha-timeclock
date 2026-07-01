import { haNotifier } from "./ha-notify";
import { smtpNotifier } from "./smtp";
import { getSettings } from "@/server/domain/settings";

export interface NotifyMessage {
  title: string;
  message: string;
}

/** Notification transport seam. */
export interface Notifier {
  id: string;
  send(msg: NotifyMessage): Promise<void>;
}

/**
 * Fan out to every enabled transport. Failures are logged, never thrown — a
 * dead notify channel must not break punches or crons.
 */
export async function notify(msg: NotifyMessage): Promise<{ sent: string[]; failed: string[] }> {
  const settings = await getSettings();
  const targets: Notifier[] = [];
  if (settings.notifications.haNotifyEnabled) targets.push(haNotifier);
  if (settings.notifications.smtp.enabled) targets.push(smtpNotifier);

  const sent: string[] = [];
  const failed: string[] = [];
  for (const t of targets) {
    try {
      await t.send(msg);
      sent.push(t.id);
    } catch (e) {
      failed.push(t.id);
      console.error(`[notify] ${t.id} failed:`, e instanceof Error ? e.message : e);
    }
  }
  return { sent, failed };
}
