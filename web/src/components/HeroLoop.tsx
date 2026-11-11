"use client";
// Landing hero (CLAUDE.md §8 item 6): the ladder climbing through silence, then a sign of life
// snapping it back to All good. A loop, drawn in the page's own styles; static under reduced motion.
import { useEffect, useState } from "react";

const RUNGS = ["All good", "Quiet", "Welfare check", "Guardian vote", "Challenge"];
// Each frame: which rung is lit, and the caption. The last frames are the snap-back.
const FRAMES: { rung: number; caption: string; alive?: boolean }[] = [
  { rung: 0, caption: "NEAR transaction · 2 min ago" },
  { rung: 1, caption: "Silent longer than usual · checking in" },
  { rung: 2, caption: "No reply · asking friends and guardians" },
  { rung: 3, caption: "Guardians asked to vote" },
  { rung: 4, caption: "Owner alerted on every channel" },
  { rung: 4, caption: "Telegram reply received", alive: true },
  { rung: 0, caption: "Sign of life · back to All good · nothing moved", alive: true },
  { rung: 0, caption: "Sign of life · back to All good · nothing moved", alive: true },
];

export function HeroLoop() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % FRAMES.length), 1300);
    return () => clearInterval(t);
  }, []);
  const f = FRAMES[i];
  return (
    <div className="border border-line bg-card p-4" style={{ boxShadow: "8px 8px 0 var(--shadow)" }} aria-hidden>
      <div className="flex items-center justify-between font-mono text-[11px] uppercase tracking-wider">
        <span>Signs of life · live</span>
        <span className={f.alive ? "bg-accent-soft px-1 text-ink" : "hero-blink"}>{f.alive ? "● alive" : "● watching"}</span>
      </div>
      <ol className="mt-4 space-y-1.5">
        {RUNGS.map((r, k) => {
          const lit = k <= f.rung;
          const here = k === f.rung;
          return (
            <li key={r} className="flex items-center gap-3">
              <span className="w-6 font-mono text-xs text-muted">0{k + 1}</span>
              <span
                className={`flex-1 border-2 border-line px-2 py-1 font-serif text-sm transition-colors duration-300 ${
                  here ? (f.alive ? "bg-accent-soft text-ink" : "bg-accent text-accent-ink") : lit ? "bg-ink text-bg" : "bg-bg text-muted"
                }`}
              >
                {r}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={`mt-4 border-t-2 border-line pt-2 font-mono text-xs uppercase tracking-wider ${f.alive ? "font-bold" : "text-muted"}`}>{f.caption}</p>
    </div>
  );
}
