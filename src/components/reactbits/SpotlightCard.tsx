"use client";

// Adapted from React Bits SpotlightCard, copyright David Haz.
// Upstream d86fccbd477786f94ca7eb891fbe0ec039d3cd3b. See LICENSE.txt.
import { useRef, type ReactNode, type PointerEvent } from "react";

export function SpotlightCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  const card = useRef<HTMLDivElement>(null);
  function move(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const element = card.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    element.style.setProperty("--mouse-x", `${event.clientX - rect.left}px`);
    element.style.setProperty("--mouse-y", `${event.clientY - rect.top}px`);
  }
  return <div ref={card} onPointerMove={move} className={`spotlight-card ${className}`}>{children}</div>;
}
