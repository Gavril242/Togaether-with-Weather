"use client";

// Round, lightweight variant of React Bits Blob Cursor by David Haz.
// https://reactbits.dev/animations/blob-cursor. See LICENSE.txt.
import { useEffect, useRef } from "react";
import styles from "./RoundBlobCursor.module.css";

const nativeTargets = "input, textarea, select, [contenteditable]:not([contenteditable='false']), :disabled, [aria-disabled='true']";

export function RoundBlobCursor() {
  const cursor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = cursor.current;
    if (!element) return;
    const pointer = window.matchMedia("(hover: hover) and (pointer: fine)");
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let frame = 0;
    let visible = false;
    let lastTime = 0;
    let x = 0;
    let y = 0;
    let targetX = 0;
    let targetY = 0;

    const paint = () => {
      element.style.transform = `translate3d(${x}px, ${y}px, 0) translate(-50%, -50%)`;
    };
    const hide = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      visible = false;
      element.dataset.visible = "false";
      document.documentElement.removeAttribute("data-blob-cursor");
    };
    const follow = (time: number) => {
      const seconds = Math.max(0, Math.min((time - lastTime) / 1000, 0.05));
      lastTime = time;
      const ease = 1 - Math.exp(-45 * seconds);
      x += (targetX - x) * ease;
      y += (targetY - y) * ease;
      if (Math.hypot(targetX - x, targetY - y) < 0.1) {
        x = targetX;
        y = targetY;
        frame = 0;
        paint();
        return;
      }
      paint();
      frame = requestAnimationFrame(follow);
    };
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse" || !pointer.matches || motion.matches || document.hidden) {
        hide();
        return;
      }
      if (event.target instanceof Element && event.target.closest(nativeTargets)) {
        hide();
        return;
      }
      targetX = event.clientX;
      targetY = event.clientY;
      if (!visible) {
        x = targetX;
        y = targetY;
        paint();
        visible = true;
        element.dataset.visible = "true";
        document.documentElement.setAttribute("data-blob-cursor", "active");
      }
      if (!frame) {
        lastTime = performance.now();
        frame = requestAnimationFrame(follow);
      }
    };
    const press = (event: PointerEvent) => {
      move(event);
      if (!visible) return;
      cancelAnimationFrame(frame);
      frame = 0;
      x = targetX;
      y = targetY;
      paint();
    };
    const leave = (event: PointerEvent) => { if (!event.relatedTarget) hide(); };
    const visibility = () => { if (document.hidden) hide(); };

    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerdown", press, { passive: true });
    document.addEventListener("pointerout", leave, { passive: true });
    document.addEventListener("keydown", hide);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("blur", hide);
    pointer.addEventListener("change", hide);
    motion.addEventListener("change", hide);
    return () => {
      hide();
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", press);
      document.removeEventListener("pointerout", leave);
      document.removeEventListener("keydown", hide);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", hide);
      pointer.removeEventListener("change", hide);
      motion.removeEventListener("change", hide);
    };
  }, []);

  return <div ref={cursor} className={styles.cursor} data-round-cursor aria-hidden="true" />;
}
