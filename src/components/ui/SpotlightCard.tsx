import { useRef, type ReactNode } from "react";

/**
 * Aceternity-style spotlight card: a faded dot grid with a soft glow that
 * tracks the cursor. Pure CSS + a CSS variable for the pointer position —
 * no animation library. Theme-neutral tones keep it subtle in light and dark.
 */
export function SpotlightCard({
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
    <div ref={ref} onMouseMove={onMouseMove} className={`group relative overflow-hidden ${className}`}>
      {/* Faded dot grid — masked so it dissolves toward the edges. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: "radial-gradient(rgba(120,120,130,0.35) 1px, transparent 1px)",
          backgroundSize: "16px 16px",
          maskImage: "radial-gradient(ellipse 80% 70% at center, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse 80% 70% at center, black 30%, transparent 75%)",
        }}
      />
      {/* Cursor-following glow — invisible until hover. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(220px circle at var(--spot-x, 50%) var(--spot-y, 0px), rgba(100,116,139,0.16), transparent 65%)",
        }}
      />
      <div className="relative">{children}</div>
    </div>
  );
}
