import type { Notifier, NotifyMessage } from "./index";
import { getSettings } from "@/server/domain/settings";

/**
 * SMTP transport — INTERFACE WIRED, DELIVERY DEFERRED. Credentials and a
 * from-address are supplied later; until settings.notifications.smtp is
 * enabled + configured this transport reports not-configured. When creds land,
 * implement delivery here (nodemailer) — callers do not change.
 */
export const smtpNotifier: Notifier = {
  id: "smtp",
  async send(_msg: NotifyMessage): Promise<void> {
    const { notifications } = await getSettings();
    const s = notifications.smtp;
    if (!s.enabled || !s.host || !s.from) {
      throw new Error("SMTP not configured (deferred — supply credentials in settings)");
    }
    // Deferred: actual SMTP delivery lands with credentials.
    throw new Error("SMTP delivery not implemented yet");
  },
};
