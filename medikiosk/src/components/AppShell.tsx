"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { Icon, type IconName } from "@/components/Icon";
import { useSession } from "@/lib/useSession";
import { t } from "@/lib/i18n";
import { useSyncStatus } from "@/lib/outbox";
import SyncBanner from "@/components/SyncBanner";
import StaffDutyBar from "@/components/StaffDutyBar";
import type { Role, StaffUser } from "@/lib/types";

/** Browser online/offline as an external store: the server snapshot (true)
 *  is what the server renders, and React reconciles a differing client value
 *  without a hydration error. A lazy useState initializer here mismatches
 *  whenever the kiosk boots offline (server true vs client false). */
function subscribeOnline(callback: () => void) {
  window.addEventListener("online", callback);
  window.addEventListener("offline", callback);
  return () => {
    window.removeEventListener("online", callback);
    window.removeEventListener("offline", callback);
  };
}

function getOnlineSnapshot(): boolean {
  return typeof navigator === "undefined" || navigator.onLine;
}

function getServerOnlineSnapshot(): boolean {
  return true;
}

/** Honest connectivity strip: derives online/offline from the browser +
 *  queued writes instead of hardcoding "All systems operational". */
function OnlineStatus() {
  const { pending } = useSyncStatus();
  const online = useSyncExternalStore(subscribeOnline, getOnlineSnapshot, getServerOnlineSnapshot);
  const ok = online && pending === 0;
  // No "all operational" strip: only warn when actually offline or unsynced.
  if (ok) return null;
  return (
    <div className="border-b border-line bg-surface px-4 py-1 text-center text-[12px] font-medium text-ink-2" role="status">
      <span className="inline-flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-warning" aria-hidden="true" />
        Offline · ऑफ़लाइन — records queue on this kiosk and sync later · बाद में भेजा जाएगा
      </span>
    </div>
  );
}

type NavItem = { href: string; label: string; icon: IconName; roles: Role[] };

// Roles mirror what each page's own auth check accepts, so the nav never
// offers a screen that will bounce the user back to /login.
const STAFF_NAV: NavItem[] = [
  { href: "/physician", label: "Doctor Clinic", icon: "stethoscope", roles: ["doctor", "admin"] },
  { href: "/triage", label: "Triage & Vitals", icon: "activity", roles: ["nurse", "doctor", "admin"] },
  { href: "/pharmacy", label: "Pharmacy", icon: "pill", roles: ["pharmacist", "admin"] },
  { href: "/camp", label: "Community Camp", icon: "users", roles: ["doctor", "nurse", "admin"] },
  { href: "/display", label: "Queue Board", icon: "grid", roles: ["doctor", "nurse", "pharmacist", "admin"] },
  { href: "/admin", label: "Admin & Settings", icon: "settings", roles: ["admin"] },
];

const KIOSK_NAV: NavItem[] = [
  { href: "/", label: "New OPD Ticket", icon: "play", roles: [] },
  { href: "/display", label: "Queue Board", icon: "grid", roles: [] },
];

/** Progress-rail keys shown during the patient-facing intake flow.
 *  Labels resolve through the kiosk's chosen language (see useT / t). */
const INTAKE_STEP_KEYS = [
  { id: "identify", key: "stepIdentify" },
  { id: "history", key: "stepHistory" },
  { id: "scan", key: "stepDocuments" },
  { id: "summary", key: "confirm" },
  { id: "done", key: "stepToken" },
] as const;

function DpdpNotice({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-labelledby="dpdp-title">
      <div className="panel w-full max-w-md p-5">
        <h2 id="dpdp-title" className="text-base font-bold text-ink">आपका डेटा कैसे सुरक्षित है? · How your data is protected</h2>
        <ul className="prose-clin mt-3 list-disc pl-5">
          <li><strong>Purpose:</strong> OPD registration and treatment only · सिर्फ ओपीडी पर्ची व इलाज हेतु।</li>
          <li><strong>Consent:</strong> Separate consent for treatment, ABHA linking and voice recording.</li>
          <li><strong>Retention:</strong> Kept as per hospital record rules; deleted on request subject to law.</li>
          <li><strong>Rights:</strong> Access / correction at the help desk. Grievance Officer details in footer.</li>
          <li><strong>DPDP Act 2023</strong> applies. Emergency access (Sec 7) is audit-logged.</li>
        </ul>
        <button type="button" onClick={onClose} autoFocus className="btn btn-primary kiosk-touch mt-4 w-full min-h-[56px]">समझ गया · Understood</button>
      </div>
    </div>
  );
}

export function AppShell({
  children,
  variant = "staff",
  user,
  onSignOut,
}: {
  children: React.ReactNode;
  variant?: "staff" | "kiosk";
  user?: StaffUser | null;
  onSignOut?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { session } = useSession();
  const [dpdpOpen, setDpdpOpen] = useState(false);

  // Staff navigation shows only the sections this role can actually work in,
  // so nobody is offered a screen that will reject them. The current page is
  // always kept visible so a role change never strands someone on a dead nav.
  const role = user?.role;
  const allNav = variant === "staff" ? STAFF_NAV : KIOSK_NAV;
  const nav = allNav.filter(
    (item) =>
      variant === "kiosk" ||
      !role ||
      item.roles.includes(role) ||
      pathname === item.href ||
      pathname.startsWith(`${item.href}/`)
  );

  // Intake progress is derived from the route so the rail stays truthful
  // even if a patient navigates backwards. Labels follow the kiosk's chosen
  // language; staff variant has no session language so it stays English.
  const kioskLang = variant === "kiosk" ? session.language?.code ?? "en" : "en";
  const INTAKE_STEPS = INTAKE_STEP_KEYS.map((s) => ({ ...s, label: t(s.key, kioskLang) }));
  const intakeIndex = INTAKE_STEPS.findIndex((s) => pathname === `/${s.id}` || pathname.startsWith(`/${s.id}/`));
  const showProgress = variant === "kiosk" && intakeIndex >= 0;

  return (
    <div className="flex min-h-full flex-col bg-canvas">
      {/* Govt. of India official strip */}
      <div className="bg-white text-ink">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-1 px-4 py-1 text-[12px] sm:px-6">
          <p className="flex items-center gap-2 font-medium">
            <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-[#0b3d91] text-[10px] font-bold text-white" aria-hidden="true">स</span>
            <span>भारत सरकार · Govt. of India</span>
            <span className="hidden text-ink-3 sm:inline">|</span>
            <span className="hidden sm:inline">National Health Mission · राष्ट्रीय स्वास्थ्य मिशन</span>
          </p>
          <p className="flex items-center gap-2 text-ink-2">
            <span className="chip chip-success text-[11px]"><Icon name="shield" size={12} /> ABDM Enabled</span>
            <span className="chip chip-neutral text-[11px]"><Icon name="checkCircle" size={12} /> ABHA Accepted</span>
            <span className="hidden items-center gap-1 md:flex"><Icon name="phone" size={12} /> Helpline 104 / 108</span>
          </p>
        </div>
        <div className="govt-tricolor" aria-hidden="true" />
      </div>
      <SyncBanner />
      <OnlineStatus />
      {variant === "staff" && user && <StaffDutyBar user={user} />}
      <header className="sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1400px] items-center gap-4 px-4 sm:px-6">
            <Link
              href={variant === "staff" ? (nav[0]?.href ?? "/physician") : "/"}
              className="flex items-center gap-2.5 font-semibold tracking-tight text-ink no-underline"
            >
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand text-white">
              <Icon name="hospital" size={16} />
            </span>
            <span className="text-[15px]">MediKiosk</span>
            <span className="hidden border-l border-line pl-2.5 text-[13px] font-normal text-ink-3 sm:inline">
              District Hospital · जिला अस्पताल · OPD — निःशुल्क सेवा
            </span>
          </Link>

          <nav className="ml-2 hidden items-center gap-0.5 md:flex" aria-label="Primary">
            {nav.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`flex min-h-[44px] items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[13px] font-medium no-underline transition-colors ${
                    active
                      ? "bg-brand-subtle text-brand"
                      : "text-ink-2 hover:bg-sunken hover:text-ink"
                  }`}
                >
                  <Icon name={item.icon} size={15} />
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            {variant === "kiosk" && session.language ? (
              <span className="chip chip-neutral">
                <Icon name="translate" size={13} />
                {session.language.native}
              </span>
            ) : null}

            {variant === "staff" && user ? (
              <>
                <div className="hidden items-center gap-2.5 border-l border-line pl-3 sm:flex">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-sunken text-ink-2">
                    <Icon name="user" size={15} />
                  </span>
                  <span className="leading-tight">
                    <span className="block text-[13px] font-medium text-ink">{user.name}</span>
                    <span className="block text-[11px] text-ink-3">{user.role}</span>
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onSignOut?.();
                    router.push("/login");
                  }}
                  className="btn btn-ghost btn-sm min-h-[44px]"
                  title="Sign out"
                >
                  <Icon name="logout" size={15} />
                  <span className="hidden lg:inline">Sign out</span>
                </button>
              </>
            ) : null}

          </div>
        </div>

        {showProgress && (
          <div className="border-t border-line bg-surface">
            <p className="sr-only">Step {intakeIndex + 1} of {INTAKE_STEPS.length}</p>
            <ol className="mx-auto flex max-w-[1400px] items-center gap-1 overflow-x-auto px-4 py-2 sm:px-6" aria-label="OPD progress">
              {INTAKE_STEPS.map((step, i) => {
                const done = i < intakeIndex;
                const current = i === intakeIndex;
                return (
                  <li key={step.id} className="flex shrink-0 items-center gap-1">
                    <span
                      aria-current={current ? "step" : undefined}
                      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium ${
                        current
                          ? "bg-brand text-white"
                          : done
                          ? "text-success"
                          : "text-ink-3"
                      }`}
                    >
                      {done ? <Icon name="check" size={13} /> : current ? <Icon name="arrowRight" size={13} /> : <span className="tabular">{i + 1}</span>}
                      {step.label}
                    </span>
                    {i < INTAKE_STEPS.length - 1 && <Icon name="chevronRight" size={12} className="text-ink-3" />}
                  </li>
                );
              })}
            </ol>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-line bg-surface">
        <div className="govt-tricolor" aria-hidden="true" />
        <div className="mx-auto flex max-w-[1400px] flex-col items-center justify-between gap-2 px-4 py-4 text-[12px] text-ink-3 sm:flex-row sm:px-6">
          <p>
            © District Health Society · जिला स्वास्थ्य समिति · Free OPD Service
          </p>
          <p className="flex flex-wrap items-center justify-center gap-4">
            <button type="button" onClick={() => setDpdpOpen(true)} className="flex min-h-[44px] items-center gap-1.5 text-ink-3 hover:text-ink">
              <Icon name="shield" size={13} /> Privacy (DPDP Act 2023)
            </button>
            <Link href="/display" className="flex min-h-[44px] items-center gap-1.5 text-ink-3 no-underline hover:text-ink">
              <Icon name="grid" size={13} /> Queue board
            </Link>
            <Link href="/login" className="flex min-h-[44px] items-center gap-1.5 text-ink-3 no-underline hover:text-ink">
              <Icon name="lock" size={13} /> Staff sign in
            </Link>
            <span className="flex min-h-[44px] items-center gap-1.5"><Icon name="phone" size={13} /> Complaint? 104 / Meri Shikayat</span>
          </p>
        </div>
        <DpdpNotice open={dpdpOpen} onClose={() => setDpdpOpen(false)} />
      </footer>
    </div>
  );
}

/** Convenience wrapper for pages that don't need a signed-in staff user. */
export function KioskShell({ children }: { children: React.ReactNode }) {
  return <AppShell variant="kiosk">{children}</AppShell>;
}
