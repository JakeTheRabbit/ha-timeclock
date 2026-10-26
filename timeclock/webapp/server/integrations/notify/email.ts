import type { Notifier, NotifyMessage } from "./index";

/**
 * Email via Microsoft Graph (app-only, Mail.Send) — Microsoft 365 tenants
 * usually have SMTP AUTH disabled, so Graph is the reliable path. Configured
 * from the add-on options (exported as EMAIL_* env by the run script), so the
 * client secret never lands in the app database or the settings UI.
 */
const env = () => ({
  tenantId: process.env.EMAIL_TENANT_ID ?? "",
  clientId: process.env.EMAIL_CLIENT_ID ?? "",
  clientSecret: process.env.EMAIL_CLIENT_SECRET ?? "",
  from: process.env.EMAIL_FROM ?? "",
  to: (process.env.EMAIL_TO ?? "").split(",").map((s) => s.trim()).filter(Boolean),
});

export function emailConfigured(): boolean {
  const e = env();
  return !!(e.tenantId && e.clientId && e.clientSecret && e.from && e.to.length);
}

let token: { value: string; exp: number } | null = null;

async function graphToken(): Promise<string> {
  if (token && token.exp > Date.now() + 60_000) return token.value;
  const e = env();
  const res = await fetchImpl(`https://login.microsoftonline.com/${e.tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: e.clientId,
      client_secret: e.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) throw new Error(`Graph token ${res.status}`);
  const d = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: d.access_token, exp: Date.now() + d.expires_in * 1000 };
  return token.value;
}

export const emailNotifier: Notifier = {
  id: "email",
  async send(msg: NotifyMessage): Promise<void> {
    if (!emailConfigured()) throw new Error("email not configured (add-on options email_*)");
    const e = env();
    const res = await fetchImpl(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(e.from)}/sendMail`, {
      method: "POST",
      headers: { authorization: `Bearer ${await graphToken()}`, "content-type": "application/json" },
      body: JSON.stringify({
        message: {
          subject: `Time Clock: ${msg.title}`,
          body: { contentType: "Text", content: msg.message },
          toRecipients: e.to.map((address) => ({ emailAddress: { address } })),
        },
        saveToSentItems: false,
      }),
    });
    if (!res.ok) throw new Error(`Graph sendMail ${res.status}`);
  },
};

// Injectable for tests.
export let fetchImpl: typeof fetch = fetch;
export function setFetchImpl(f: typeof fetch) {
  fetchImpl = f;
}
