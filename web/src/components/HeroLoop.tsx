"use client";
// Landing hero (CLAUDE.md §8 item 6): the ladder climbing through silence and a sign of life snapping it
// back to All good, then a will that is carried out: guardians confirm, the challenge passes, 10% is sent.
// The snap-back is the site's one moment of motion; static under reduced motion.
import { useEffect, useState } from "react";

const RUNGS = ["All good", "Quiet", "Welfare check", "Guardian vote", "Challenge period", "Released in stages"];
// Two stories in turn: silence that a sign of life cancels, then a will that is carried out.
const FRAMES: { rung: number; caption: string; alive?: boolean; sent?: boolean }[] = [
  { rung: 0, caption: "NEAR transaction · 2 min ago" },
  { rung: 1, caption: "silent longer than usual · checking in" },
  { rung: 2, caption: "no reply · asking friends and guardians" },
  { rung: 3, caption: "guardians asked to vote" },
  { rung: 0, caption: "Telegram reply · back to All good · nothing moved", alive: true },
  { rung: 0, caption: "Telegram reply · back to All good · nothing moved", alive: true },
  { rung: 3, caption: "guardians confirm" },
  { rung: 4, caption: "owner alerted on every channel · no reply" },
  { rung: 5, caption: "10% sent · NEAR · Ethereum · Bitcoin", sent: true },
  { rung: 5, caption: "the longest wait · any sign of life stops the rest", sent: true },
];

export function HeroLoop() {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % FRAMES.length), 1600);
    return () => clearInterval(t);
  }, []);
  const f = FRAMES[i];
  return (
    <div key={f.alive ? "alive" : "watching"} className={`tech rounded-2xl border border-line bg-card p-5 ${f.alive ? "snap-wash" : ""}`} aria-hidden>
      <div className="flex items-center justify-between">
        <span className="tech-label">Signs of life</span>
        <span className={f.alive || f.sent ? "text-accent" : "text-muted"}>{f.alive ? "● sign of life" : f.sent ? "● releasing" : "○ watching"}</span>
      </div>
      <ol className="mt-4 space-y-1">
        {RUNGS.map((r, k) => {
          const here = k === f.rung;
          const past = k < f.rung;
          return (
            <li
              key={r}
              className={`flex items-center gap-3 rounded border px-3 py-1.5 ${
                here ? "border-accent bg-accent-soft text-ink" : past ? "border-line text-ink" : "border-line text-muted"
              }`}
            >
              <span className="w-5 text-muted">{k + 1}</span>
              <span className="flex-1">{r}</span>
              {here && <span className="text-accent">{f.alive ? "✓" : f.sent ? "10%" : "●"}</span>}
            </li>
          );
        })}
      </ol>
      <p className={`mt-4 border-t border-line pt-2 ${f.alive || f.sent ? "text-accent" : "text-muted"}`}>{f.caption}</p>
    </div>
  );
}
