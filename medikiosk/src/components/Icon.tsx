import type { ReactElement, SVGProps } from "react";

/**
 * Single-source icon set. Inline SVG on a 24px grid with a consistent 1.75px
 * stroke, so glyphs sit on the same optical weight as the surrounding text.
 * Replaces decorative emoji, which render differently on every platform and
 * read as placeholder art rather than product UI.
 */

export type IconName =
  | "stethoscope"
  | "hospital"
  | "pill"
  | "leaf"
  | "globe"
  | "languages"
  | "file"
  | "clipboard"
  | "printer"
  | "bandage"
  | "lock"
  | "bell"
  | "camera"
  | "mic"
  | "pencil"
  | "user"
  | "users"
  | "flag"
  | "accessible"
  | "ticket"
  | "lightbulb"
  | "save"
  | "dna"
  | "note"
  | "hammer"
  | "image"
  | "pregnant"
  | "refresh"
  | "hand"
  | "play"
  | "calendar"
  | "chart"
  | "upload"
  | "download"
  | "alert"
  | "check"
  | "checkCircle"
  | "siren"
  | "brain"
  | "trending"
  | "arrowRight"
  | "arrowLeft"
  | "close"
  | "chevronRight"
  | "chevronDown"
  | "plus"
  | "minus"
  | "search"
  | "settings"
  | "logout"
  | "clock"
  | "shield"
  | "activity"
  | "droplet"
  | "stethoscopeLine"
  | "logoutDoor"
  | "wifi"
  | "wifiOff"
  | "external"
  | "info"
  | "scan"
  | "translate"
  | "volume"
  | "menu"
  | "grid"
  | "list"
  | "filter"
  | "qr"
  | "link"
  | "copy"
  | "eye"
  | "eyeOff"
  | "mail"
  | "phone"
  | "mapPin"
  | "building"
  | "sunrise"
  | "sun"
  | "sunset"
  | "moon"
  | "bowl"
  | "syringe"
  | "dropper"
  | "spoon"
  | "tube";

const PATHS: Record<IconName, ReactElement> = {
  stethoscope: (
    <>
      <path d="M5 3v6a5 5 0 0 0 10 0V3" />
      <path d="M3.5 3h3M11.5 3h3" />
      <path d="M10 14v2.5a5.5 5.5 0 0 0 11 0V15" />
      <circle cx="21" cy="13" r="2" />
    </>
  ),
  hospital: (
    <>
      <path d="M3 21h18" />
      <path d="M5 21V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v15" />
      <path d="M10 4v3M14 4v3" />
      <path d="M9 12h6M12 9v6" />
    </>
  ),
  pill: (
    <>
      <rect x="2.5" y="8.5" width="19" height="7" rx="3.5" transform="rotate(-45 12 12)" />
      <path d="M8.8 8.8l6.4 6.4" />
    </>
  ),
  leaf: (
    <>
      <path d="M4 20c0-8 5-14 16-15 0 10-5 15-13 15H4z" />
      <path d="M9 15c2.5-3 5.5-5 9-6" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18z" />
    </>
  ),
  languages: (
    <>
      <path d="M3 5h8M7 3v2c0 4-1.8 7-4 8.5" />
      <path d="M5 9c1.5 2.5 3.5 4 6 4.8" />
      <path d="M12.5 20l4-10 4 10" />
      <path d="M13.8 17h5.4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
      <path d="M9 13h6M9 17h4" />
    </>
  ),
  clipboard: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1" />
      <path d="M9 10h6M9 14h6M9 18h3" />
    </>
  ),
  printer: (
    <>
      <path d="M7 8V3h10v5" />
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7 14h10v7H7z" />
    </>
  ),
  bandage: (
    <>
      <rect x="2" y="8" width="20" height="8" rx="4" transform="rotate(-40 12 12)" />
      <path d="M10.5 10.5l3 3M13 13l-3 3" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
      <path d="M10.5 20a2 2 0 0 0 3 0" />
    </>
  ),
  camera: (
    <>
      <path d="M3 8.5A2.5 2.5 0 0 1 5.5 6h1.7a1 1 0 0 0 .8-.4l1-1.3a1 1 0 0 1 .8-.3h4.4a1 1 0 0 1 .8.3l1 1.3a1 1 0 0 0 .8.4h1.7A2.5 2.5 0 0 1 21 8.5v8A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z" />
      <circle cx="12" cy="12.5" r="3.2" />
    </>
  ),
  mic: (
    <>
      <rect x="9" y="2.5" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0" />
      <path d="M12 17.5V21M9 21h6" />
    </>
  ),
  pencil: (
    <>
      <path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z" />
      <path d="M14 7l3 3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M2.5 20a6.5 6.5 0 0 1 13 0" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 6.1" />
      <path d="M17.5 14.2A6.5 6.5 0 0 1 21.5 20" />
    </>
  ),
  flag: (
    <>
      <path d="M5 21V4" />
      <path d="M5 5h11l-1.6 3.5L16 12H5z" />
    </>
  ),
  accessible: (
    <>
      <circle cx="12" cy="4.5" r="1.6" />
      <path d="M12 8v5h4" />
      <path d="M12 13l-3 7" />
      <path d="M16 13a5.5 5.5 0 1 1-4-5.3" />
    </>
  ),
  ticket: (
    <>
      <path d="M3 8.5V6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v2.5a2.5 2.5 0 0 0 0 5V18a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-2.5a2.5 2.5 0 0 0 0-5z" />
      <path d="M13 5v3M13 11v2M13 16v3" strokeDasharray="2 2" />
    </>
  ),
  lightbulb: (
    <>
      <path d="M9 17h6" />
      <path d="M10 21h4" />
      <path d="M12 3a6 6 0 0 0-3.5 10.9c.5.4.8 1 .8 1.6h5.4c0-.6.3-1.2.8-1.6A6 6 0 0 0 12 3z" />
    </>
  ),
  save: (
    <>
      <path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" />
      <path d="M8 3v6h7V3" />
      <rect x="7" y="13" width="10" height="8" rx="1" />
    </>
  ),
  dna: (
    <>
      <path d="M6 3c0 6 12 6 12 12M18 3c0 6-12 6-12 12" />
      <path d="M6 21c0-2 2-2.5 3-3.5M18 21c0-2-2-2.5-3-3.5" />
      <path d="M8.5 7h7M7 11h10M7.5 15h9" />
    </>
  ),
  note: (
    <>
      <path d="M4 20l1-4L16 5a2.1 2.1 0 0 1 3 3L8 19z" />
      <path d="M13 7.5l3.5 3.5" />
      <path d="M4 20h5" />
    </>
  ),
  hammer: (
    <>
      <path d="M14.5 3.5l6 6-3 3-6-6z" />
      <path d="M11.5 6.5L3 15v6h6l8.5-8.5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.6" />
      <path d="M3.5 17l5-5 4.5 4.5 3-2.5 4.5 4" />
    </>
  ),
  pregnant: (
    <>
      <circle cx="11" cy="4" r="2" />
      <path d="M11 6.5v5.5" />
      <circle cx="11" cy="16.5" r="4.5" />
      <path d="M13 12.5h4.5a2 2 0 0 1 2 2v1" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 0 0-13.7-5.3L3 9" />
      <path d="M3 4v5h5" />
      <path d="M4 13a8 8 0 0 0 13.7 5.3L21 15" />
      <path d="M21 20v-5h-5" />
    </>
  ),
  hand: (
    <>
      <path d="M9 11V4.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M12 10.5V3.5a1.5 1.5 0 0 1 3 0V11" />
      <path d="M15 11V6a1.5 1.5 0 0 1 3 0v7a8 8 0 0 1-8 8h-.5a6 6 0 0 1-4.4-1.9L3 16.5a1.6 1.6 0 0 1 2.3-2.2L9 17" />
    </>
  ),
  play: <path d="M7 4.5l12 7.5-12 7.5z" />,
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  chart: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <rect x="7" y="12" width="3" height="5" rx="0.5" />
      <rect x="12.5" y="8" width="3" height="9" rx="0.5" />
      <rect x="18" y="14" width="3" height="3" rx="0.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4" />
      <path d="M8 8l4-4 4 4" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="M8 12l4 4 4-4" />
      <path d="M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16" />
    </>
  ),
  alert: (
    <>
      <path d="M12 3.5L22 20H2z" />
      <path d="M12 10v4.5M12 17.5v.01" />
    </>
  ),
  check: <path d="M4 12.5l5 5L20 6.5" />,
  checkCircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12.5l2.5 2.5L16 9.5" />
    </>
  ),
  siren: (
    <>
      <path d="M7 14a5 5 0 0 1 10 0v4H7z" />
      <path d="M4 21h16" />
      <path d="M12 4V2M5 6L3.5 4.5M19 6l1.5-1.5" />
    </>
  ),
  brain: (
    <>
      <path d="M12 5.5a2.5 2.5 0 0 0-4.7 1.2A2.5 2.5 0 0 0 4.5 9a2.5 2.5 0 0 0 .8 1.9A2.5 2.5 0 0 0 5 15a2.5 2.5 0 0 0 2.5 2.5c1 0 1.8-.5 2.3-1.2V6.8A2.5 2.5 0 0 0 12 5.5z" />
      <path d="M12 5.5a2.5 2.5 0 0 1 4.7 1.2A2.5 2.5 0 0 1 19.5 9a2.5 2.5 0 0 1-.8 1.9A2.5 2.5 0 0 1 19 15a2.5 2.5 0 0 1-2.5 2.5c-1 0-1.8-.5-2.3-1.2" />
    </>
  ),
  trending: (
    <>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M15 7h6v6" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M4 12h16" />
      <path d="M14 6l6 6-6 6" />
    </>
  ),
  arrowLeft: (
    <>
      <path d="M20 12H4" />
      <path d="M10 6l-6 6 6 6" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronDown: <path d="M5 9l7 7 7-7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 14.5a1.5 1.5 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.5 1.5 0 0 0-2.5 1v.2a2 2 0 1 1-4 0V20a1.5 1.5 0 0 0-2.6-1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.5 1.5 0 0 0 4 13.6H4a2 2 0 1 1 0-4h.1A1.5 1.5 0 0 0 5.7 7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.5 1.5 0 0 0 11 3.6V3.5a2 2 0 1 1 4 0v.1a1.5 1.5 0 0 0 2.5 1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.5 1.5 0 0 0 1 2.5h.2a2 2 0 1 1 0 4H21a1.5 1.5 0 0 0-1.5 1.5z" />
    </>
  ),
  logout: (
    <>
      <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
      <path d="M10 16l-4-4 4-4" />
      <path d="M6 12h10" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5.2l3.2 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3l7.5 3v5.5c0 4.5-3 8-7.5 9.5c-4.5-1.5-7.5-5-7.5-9.5V6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  activity: <path d="M2 12h4l3-8 4 16 3-8h6" />,
  droplet: <path d="M12 3s6 6.5 6 10.5A6 6 0 0 1 6 13.5C6 9.5 12 3 12 3z" />,
  stethoscopeLine: (
    <>
      <path d="M6 3v5a4 4 0 0 0 8 0V3" />
      <path d="M10 12v3a4.5 4.5 0 0 0 9 0v-1.5" />
      <circle cx="19" cy="11.5" r="1.8" />
    </>
  ),
  logoutDoor: (
    <>
      <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
      <path d="M16 8l4 4-4 4M20 12H9" />
    </>
  ),
  wifi: (
    <>
      <path d="M2.5 9a14 14 0 0 1 19 0" />
      <path d="M6 12.5a9 9 0 0 1 12 0" />
      <path d="M9.5 16a4.5 4.5 0 0 1 5 0" />
      <path d="M12 19.5v.01" />
    </>
  ),
  wifiOff: (
    <>
      <path d="M2 2l20 20" />
      <path d="M6 12.5a9 9 0 0 1 4-2.3" />
      <path d="M2.5 9a14 14 0 0 1 5-3.2" />
      <path d="M14 10a9 9 0 0 1 4 2.5" />
      <path d="M9.5 16a4.5 4.5 0 0 1 3-1" />
      <path d="M12 19.5v.01" />
    </>
  ),
  external: (
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-9 9" />
      <path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8v.01" />
    </>
  ),
  scan: (
    <>
      <path d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8" />
      <path d="M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8" />
      <path d="M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16" />
      <path d="M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16" />
      <path d="M3 12h18" />
    </>
  ),
  translate: (
    <>
      <path d="M3 5h9M7.5 5V4M9 5c0 4-2.5 7-6 8.5" />
      <path d="M4.5 9.5c1.5 2 3.5 3.3 5.5 4" />
      <path d="M12.5 20l3.5-9 3.5 9" />
      <path d="M13.8 16.5h4.4" />
    </>
  ),
  volume: (
    <>
      <path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" />
      <path d="M18 7a7 7 0 0 1 0 10" />
    </>
  ),
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  grid: (
    <>
      <rect x="3.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="3.5" width="7" height="7" rx="1" />
      <rect x="3.5" y="13.5" width="7" height="7" rx="1" />
      <rect x="13.5" y="13.5" width="7" height="7" rx="1" />
    </>
  ),
  list: (
    <>
      <path d="M8 6h13M8 12h13M8 18h13" />
      <path d="M3.5 6v.01M3.5 12v.01M3.5 18v.01" />
    </>
  ),
  filter: <path d="M3 5h18l-7 8v6l-4 2v-8z" />,
  qr: (
    <>
      <rect x="3.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="14.5" y="3.5" width="6" height="6" rx="1" />
      <rect x="3.5" y="14.5" width="6" height="6" rx="1" />
      <path d="M14.5 14.5h2.5v2.5h-2.5z" />
      <path d="M20.5 14.5v3M17.5 20.5h3" />
    </>
  ),
  link: (
    <>
      <path d="M10 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" />
      <path d="M14 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" />
    </>
  ),
  copy: (
    <>
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </>
  ),
  eye: (
    <>
      <path d="M2 12s3.8-6.5 10-6.5S22 12 22 12s-3.8 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M9.5 5.8A9.6 9.6 0 0 1 12 5.5c6.2 0 10 6.5 10 6.5a17 17 0 0 1-3.2 3.9" />
      <path d="M6.3 7.8A16.7 16.7 0 0 0 2 12s3.8 6.5 10 6.5a9.9 9.9 0 0 0 4.2-.9" />
      <path d="M3 3l18 18" />
      <path d="M9.9 9.9a2.8 2.8 0 0 0 4.1 4.1" />
    </>
  ),
  mail: (
    <>
      <rect x="2.5" y="5" width="19" height="14" rx="2" />
      <path d="M3 6.5l9 6.5 9-6.5" />
    </>
  ),
  phone: (
    <>
      <path d="M7 3.5h2.5l1.5 4-2 1.5a11 11 0 0 0 5 5l1.5-2 4 1.5V16a2 2 0 0 1-2.2 2A16 16 0 0 1 5 5.7 2 2 0 0 1 7 3.5z" />
    </>
  ),
  mapPin: (
    <>
      <path d="M12 21s7-5.5 7-11a7 7 0 1 0-14 0c0 5.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  building: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M9 7h2M13 7h2M9 11h2M13 11h2M9 15h2M13 15h2" />
      <path d="M10 21v-3h4v3" />
    </>
  ),
  sunrise: (
    <>
      <path d="M12 3.5v3" />
      <path d="M5.6 6.6l1.4 1.4" />
      <path d="M18.4 6.6L17 8" />
      <path d="M2.5 15h19" />
      <path d="M7.5 15a4.5 4.5 0 0 1 9 0" />
      <path d="M6.5 18.5h11" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.2 5.2l1.8 1.8M17 17l1.8 1.8M18.8 5.2L17 7M7 17l-1.8 1.8" />
    </>
  ),
  sunset: (
    <>
      <path d="M12 6.5v3" />
      <path d="M5.6 6.6l1.4 1.4" />
      <path d="M18.4 6.6L17 8" />
      <path d="M2.5 15h19" />
      <path d="M7.5 15a4.5 4.5 0 0 1 9 0" />
      <path d="M6.5 19.5h11" />
    </>
  ),
  moon: <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" />,
  bowl: (
    <>
      <path d="M3.5 11h17a8.5 8.5 0 0 1-8.5 8 8.5 8.5 0 0 1-8.5-8z" />
      <path d="M12 8.5c-1.4 0-2 .8-2 1.8M15 6.5c-1 .6-1.4 1.2-1.4 2" />
    </>
  ),
  syringe: (
    <>
      <path d="M14.5 3.5l6 6" />
      <path d="M17.5 6.5l-9 9" />
      <path d="M10.5 9.5l4 4" />
      <path d="M7 13l-2.5 2.5" />
      <path d="M13.5 19.5l-4-4" />
      <path d="M4 20.5l1.5-1.5" />
      <path d="M11 17l1.5 1.5a1.8 1.8 0 0 1-2.5 2.5L8.5 19.5" />
    </>
  ),
  dropper: (
    <>
      <path d="M13 3.5h5v4h-5z" />
      <path d="M15.5 7.5v7" />
      <path d="M12.5 14.5h6v3a3 3 0 0 1-6 0z" />
      <path d="M15.5 20.5c0 0 1.2 1 1.2 1.6a1.2 1.2 0 0 1-2.4 0c0-.6 1.2-1.6 1.2-1.6z" />
    </>
  ),
  spoon: (
    <>
      <ellipse cx="12" cy="7" rx="3.2" ry="4" />
      <path d="M12 11v9" />
    </>
  ),
  tube: (
    <>
      <rect x="8" y="3" width="8" height="18" rx="1.5" />
      <path d="M8 7h8" />
      <path d="M10 3v4M14 3v4" />
    </>
  ),
};

type IconProps = Omit<SVGProps<SVGSVGElement>, "name"> & {
  name: IconName;
  /** Rendered size in px. Defaults to 16 to sit on the text baseline. */
  size?: number;
};

export function Icon({ name, size = 16, className, ...rest }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className ? `shrink-0 ${className}` : "shrink-0"}
      {...rest}
    >
      {PATHS[name]}
    </svg>
  );
}
