import "server-only";
import { promises as fs } from "fs";
import path from "path";
import { log } from "./log";

/**
 * Site configuration persisted to data/settings.json.
 *
 * Populated by the first-run setup wizard (/setup): hospital name, custom
 * departments and the admin username chosen at setup. Until the wizard runs,
 * the app falls back to demo defaults so the kiosk still works out of the box.
 */

const DATA_DIR = process.env.MEDIKIOSK_DATA_DIR || path.join(process.cwd(), "data");
const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
const DEFAULT_DEPARTMENTS = [
  "General Medicine",
  "Cardiology",
  "Neurology",
  "Pulmonology",
  "Gastroenterology",
  "Nephrology",
  "Endocrinology",
  "Orthopaedics",
  "Dermatology",
  "ENT",
  "Ophthalmology",
  "Gynaecology & Obstetrics",
  "Paediatrics",
  "Psychiatry",
  "Surgery",
  "Dentistry",
];

export type SiteSettings = {
  hospitalName: string;
  /** Departments the kiosk offers. */
  departments: string[];
  /** True when the first-run wizard has completed. */
  configured: boolean;
  configuredAt?: string;
};

export const DEFAULT_SETTINGS: SiteSettings = {
  hospitalName: "MediKiosk Hospital",
  departments: DEFAULT_DEPARTMENTS,
  configured: false,
};

export async function readSettings(): Promise<SiteSettings> {
  try {
    const raw = await fs.readFile(SETTINGS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SiteSettings>;
    return {
      hospitalName: parsed.hospitalName || DEFAULT_SETTINGS.hospitalName,
      departments:
        Array.isArray(parsed.departments) && parsed.departments.length
          ? parsed.departments
          : DEFAULT_SETTINGS.departments,
      configured: parsed.configured === true,
      configuredAt: parsed.configuredAt,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function isConfigured(): Promise<boolean> {
  return (await readSettings()).configured;
}

export async function writeSettings(settings: SiteSettings): Promise<SiteSettings> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(
    SETTINGS_FILE,
    JSON.stringify({ ...settings, configuredAt: settings.configuredAt ?? new Date().toISOString() }, null, 2),
    "utf8"
  );
  log("info", "settings", "site settings written", { hospitalName: settings.hospitalName });
  return { ...settings, configuredAt: settings.configuredAt ?? new Date().toISOString() };
}