/**
 * The Nexus mark: an N built out of a graph — a node at the start of the
 * stroke, a node where the link lands, the diagonal standing in for the
 * connection between them. Drawn in currentColor so it inherits from context,
 * and weighted to stay legible at 16px.
 */
export function Mark({
  size = 24,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <g
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
      >
        <path d="M10 23V9" />
        <path d="M10 9l12 14" />
        <path d="M22 23V9" />
      </g>
      <g fill="currentColor">
        <circle cx="10" cy="9" r="3.1" />
        <circle cx="22" cy="23" r="3.1" />
      </g>
    </svg>
  );
}
