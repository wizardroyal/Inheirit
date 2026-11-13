"use client";
// A row of cards that slides sideways (swipe, scroll or the arrows). Used on the landing page.
import { useRef, type ReactNode } from "react";

export function Carousel({ label, children }: { label: string; children: ReactNode }) {
  const row = useRef<HTMLDivElement>(null);
  const slide = (dir: 1 | -1) => row.current?.scrollBy({ left: dir * Math.min(row.current.clientWidth, 320), behavior: "smooth" });
  const btn = "flex h-11 w-11 items-center justify-center rounded-full border border-line bg-card text-lg hover:bg-accent-soft";
  return (
    <div className="space-y-4">
      <div ref={row} role="region" aria-label={label} tabIndex={0} className="-mx-4 flex snap-x snap-mandatory gap-4 overflow-x-auto scroll-smooth px-4 pb-2 [scrollbar-width:none]">
        {children}
      </div>
      <div className="flex justify-center gap-3">
        <button type="button" aria-label="Previous" className={btn} onClick={() => slide(-1)}>
          ‹
        </button>
        <button type="button" aria-label="Next" className={btn} onClick={() => slide(1)}>
          ›
        </button>
      </div>
    </div>
  );
}
