import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { log } from "./log";

/**
 * Patient notification provider (SMS / WhatsApp) — pluggable stub.
 *
 * Without a provider URL configured this writes every notification to
 * data/notifications.log and logs to the console, which is perfect for the
 * demo and for CI. Configure SMS_PROVIDER_URL + SMS_API_KEY to forward to a
 * real gateway (Twilio, Netcore, MSG91, WhatsApp Business API...) via a tiny
 * webhook contract.
 */

const NOTIF_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const NOTIF_FILE = path.join(NOTIF_DIR, "notifications.log");

export type NotifyTemplate =
  | "token_issued"
  | "you_are_called"
  | "follow_up"
  | "appointment_reminder"
  | "er_escalation";

const TEMPLATES: Record<NotifyTemplate, string> = {
  token_issued:
    "MediKiosk: Namaste {name}! Aapka token number {token} hai ({department}). Kripya pratiksha karein. - Hospital",
  appointment_reminder:
    "MediKiosk: Namaste {name}! Kal ({date}) {slot} baje {department} me aapka appointment hai. Kripya samay par pahunchein. - Hospital",
  you_are_called:
    "MediKiosk: {token} — aapki baari hai! Kripya doctor ke kachre mein jayein. - Hospital",
  follow_up:
    "MediKiosk: {name}, aapka follow-up appointment {date} ko hai ({department}). - Hospital",
  er_escalation:
    "MediKiosk: Medical emergency — patient {token} ko turant Emergency department mein bheja gaya hai.",
};

export type NotifyPayload = {
  mobile: string;
  template: NotifyTemplate;
  vars: Record<string, string>;
};

export async function notifyPatient(payload: NotifyPayload): Promise<boolean> {
  const text = TEMPLATES[payload.template].replace(/\{(\w+)\}/g, (_, k) => payload.vars[k] ?? "");
  const url = process.env.SMS_PROVIDER_URL;
  const key = process.env.SMS_API_KEY;

  // Always persist an audit trail FIRST — a provider outage or crash must not
  // erase the fact that a notification was attempted.
  await fs.mkdir(NOTIF_DIR, { recursive: true }).catch(() => {});
  const entry = {
    at: new Date().toISOString(),
    to: payload.mobile.replace(/.(?=.{4})/g, "*"), // mask: keep last 4
    template: payload.template,
    body: text,
    provider: url ? "external" : "stub",
  };
  await fs.appendFile(NOTIF_FILE, JSON.stringify(entry) + "\n", "utf8").catch(() => {});

  if (!url) {
    log("info", "notify", `[stub] ${payload.template} → ${entry.to}`, { body: text });
    return false;
  }

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(key ? { Authorization: `Bearer ${key}` } : {}),
      },
      body: JSON.stringify({ mobile: payload.mobile, message: text, template: payload.template }),
    });
    return res.ok;
  } catch (err) {
    log("error", "notify", "provider call failed", { error: String(err) });
    return false;
  }
}