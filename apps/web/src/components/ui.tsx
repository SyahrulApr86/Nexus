import {
  forwardRef,
  useId,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost" | "danger";
}) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-control px-5 py-2.5 text-[16px] font-medium transition-colors duration-150 disabled:opacity-50 disabled:cursor-not-allowed";
  const variants = {
    primary: "bg-accent-fill text-on-accent hover:bg-accent-fill-hover",
    ghost: "border border-border text-ink hover:bg-surface",
    danger: "border border-danger text-danger hover:bg-danger/10",
  };
  return (
    <button className={`${base} ${variants[variant]} ${className}`} {...props} />
  );
}

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string | null;
  hint?: string;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, error, hint, id: idProp, className = "", ...props },
  ref,
) {
  const autoId = useId();
  const id = idProp ?? autoId;
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null]
      .filter(Boolean)
      .join(" ") || undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[14px] font-medium text-ink">
        {label}
      </label>
      <input
        ref={ref}
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={`rounded-control border border-border bg-card px-3.5 py-2.5 text-[16px] text-ink placeholder:text-mist ${className}`}
        {...props}
      />
      {hint && !error && (
        <p id={hintId} className="text-[14px] text-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-[14px] text-danger whitespace-pre-line">
          {error}
        </p>
      )}
    </div>
  );
});

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`rounded-card border border-border bg-card p-6 ${className}`}
    >
      {children}
    </div>
  );
}

export function AuthLayout({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="flex min-h-full items-center justify-center bg-surface px-4">
      <div className="w-full max-w-md">
        <h1 className="mb-2 text-center text-[32px] font-semibold tracking-heading text-ink">
          Nexus
        </h1>
        <p className="mb-8 text-center text-[16px] text-muted">{title}</p>
        <Card>{children}</Card>
      </div>
    </main>
  );
}
