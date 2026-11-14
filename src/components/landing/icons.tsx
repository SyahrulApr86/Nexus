/*
 * The landing's icon set: 16px line glyphs on one 1.5 stroke, drawn for the interface fragments and the
 * page's few controls. Always decorative (aria-hidden): every control that holds one also has a label.
 */

type Name =
  | "files"
  | "search"
  | "graph"
  | "canvas"
  | "settings"
  | "folder"
  | "file"
  | "link"
  | "arrow"
  | "chevron"
  | "hash"
  | "check"
  | "cloud"
  | "phone"
  | "copy"
  | "terminal"
  | "calendar"
  | "plus";

const PATHS: Record<Name, React.ReactNode> = {
  files: <path d="M3.5 2.5h6l3 3v8h-9zM9.5 2.5v3h3" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </>
  ),
  graph: (
    <>
      <circle cx="4" cy="4.5" r="1.75" />
      <circle cx="12" cy="6" r="1.75" />
      <circle cx="7" cy="12" r="1.75" />
      <path d="m5.7 5 4.6.8M5 6.1l1.3 4.2M10.9 7.4l-2.6 3.3" />
    </>
  ),
  canvas: (
    <>
      <rect x="2.5" y="2.5" width="5" height="4" rx="1" />
      <rect x="8.5" y="9.5" width="5" height="4" rx="1" />
      <path d="M5 6.5v2.5a1.5 1.5 0 0 0 1.5 1.5h2" />
    </>
  ),
  settings: (
    <>
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.75v2M8 12.25v2M1.75 8h2M12.25 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" />
    </>
  ),
  folder: <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />,
  file: <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3M6 8.5h4M6 11h3" />,
  link: <path d="M6.5 9.5 9.5 6.5M7 4.5l1.2-1.2a2.6 2.6 0 0 1 3.7 3.7L10.7 8.2M9 11.5l-1.2 1.2a2.6 2.6 0 0 1-3.7-3.7L5.3 7.8" />,
  arrow: <path d="M3 8h9.5M8.5 4 12.5 8l-4 4" />,
  chevron: <path d="m6 4 4 4-4 4" />,
  hash: <path d="M6 2.5 5 13.5M11 2.5l-1 11M3 6h10.5M2.5 10H13" />,
  check: <path d="m3.5 8.5 3 3 6-7" />,
  cloud: <path d="M4.5 12.5a3 3 0 0 1-.3-6 4 4 0 0 1 7.6-.9 3.4 3.4 0 0 1 .2 6.9z" />,
  phone: (
    <>
      <rect x="4.5" y="1.5" width="7" height="13" rx="1.5" />
      <path d="M7 12.25h2" />
    </>
  ),
  copy: (
    <>
      <rect x="5.5" y="5.5" width="8" height="8" rx="1" />
      <path d="M3.5 10.5h-1v-8h8v1" />
    </>
  ),
  terminal: <path d="m3 4.5 3.5 3.5L3 11.5M8 12h5" />,
  calendar: (
    <>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1" />
      <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
    </>
  ),
  plus: <path d="M8 3v10M3 8h10" />,
};

export function Icon({ name, size = 16, className }: { name: Name; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      aria-hidden="true"
      focusable="false"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {PATHS[name]}
    </svg>
  );
}
