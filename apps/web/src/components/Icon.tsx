import type { SVGProps } from "react";

const paths: Record<string, string | string[]> = {
  "chevron-right": "m9 6 6 6-6 6",
  "chevron-down": "m6 9 6 6 6-6",
  folder:
    "M4 5h5l2 2h9a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z",
  file: [
    "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z",
    "M13 3v6h6",
  ],
  search: ["m21 21-4.7-4.7", "M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z"],
  plus: ["M12 5v14", "M5 12h14"],
  trash: [
    "M4 7h16",
    "M9 7V4h6v3",
    "M6 7l1 13h10l1-13",
  ],
  graph: [
    "M5 6a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    "M19 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    "M12 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
    "m6.6 7 4.4 8.5M17.5 7.6 13 17",
  ],
  dots: [
    "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    "M5 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
    "M19 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z",
  ],
  sort: ["M7 4v13m0 0-3-3m3 3 3-3", "M17 20V7m0 0-3 3m3-3 3 3"],
  download: ["M12 4v11m0 0-4-4m4 4 4-4", "M5 20h14"],
  upload: ["M12 15V4m0 0L8 8m4-4 4 4", "M5 20h14"],
  tag: [
    "M3 11V4a1 1 0 0 1 1-1h7l10 10-8 8L3 11Z",
    "M8 8h.01",
  ],
  settings: [
    "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z",
    "M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z",
  ],
};

export function Icon({
  name,
  size = 15,
  ...props
}: { name: keyof typeof paths & string; size?: number } & SVGProps<SVGSVGElement>) {
  const d = paths[name];
  const ds = Array.isArray(d) ? d : [d!];
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {ds.map((p, i) => (
        <path key={i} d={p} />
      ))}
    </svg>
  );
}
