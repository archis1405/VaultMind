import { useRef, type ReactNode } from "react";

/**
 * Aceternity-style animated gradient border: a slow, monochrome sheen travels
 * around the card edge (a rotating conic gradient masked to a 1px frame), with
 * the cursor-following glow kept inside. Pure CSS — the rotation reuses
 * Tailwind's built-in `spin` keyframes; no animation library.
 */
export function GlowBorderCard({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  const onMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${e.clientX - rect.left}px`);
    el.style.setProperty("--spot-y", `${e.clientY - rect.top}px`);
  };

  return (
    <div className="relative overflow-hidden rounded-2xl p-px shadow-sm">
      {/* Locally-scoped keyframes so the rotation doesn't depend on Tailwind config. */}
      <style>{"@keyframes gbc-spin{to{transform:rotate(360deg)}}"}</style>
      {/* Traveling sheen — a conic gradient slowly rotating behind the card. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-[-60%]"
        style={{
          animation: "gbc-spin 9s linear infinite",
          background:
            "conic-gradient(from 0deg, transparent 0deg, rgba(150,160,180,0.55) 40deg, transparent 90deg, transparent 360deg)",
        }}
      />
      {/* Static hairline so the frame reads even at the gradient's dim phase. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-2xl border border-neutral-200/70 dark:border-neutral-800/70"
      />

      <div
        ref={ref}
        onMouseMove={onMouseMove}
        className={`group relative overflow-hidden rounded-[15px] bg-white dark:bg-neutral-950 ${className}`}
      >
        {/* Cursor-following glow. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          style={{
            background:
              "radial-gradient(220px circle at var(--spot-x, 50%) var(--spot-y, 0px), rgba(100,116,139,0.14), transparent 65%)",
          }}
        />
        <div className="relative">{children}</div>
      </div>
    </div>
  );
}
