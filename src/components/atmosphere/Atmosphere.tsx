"use client";

import { useEffect, useRef, type CSSProperties } from "react";
import { daylightAt } from "./daylight";
import { selectAtmosphereQuality } from "./policy";
import type { AtmosphereScene } from "./scene";
import { normalizeIntensity, type AtmosphereProps } from "./types";
import styles from "./Atmosphere.module.css";

export type { AtmosphereCondition, AtmosphereProps } from "./types";

interface Connection extends EventTarget {
  saveData?: boolean;
}

type AtmosphereNavigator = Navigator & { deviceMemory?: number; connection?: Connection };

export default function Atmosphere({ condition = "clear", timezone = "UTC", intensity = 0.5 }: AtmosphereProps) {
  const host = useRef<HTMLDivElement>(null);
  const canvasMount = useRef<HTMLDivElement>(null);
  const scene = useRef<AtmosphereScene | null>(null);
  const current = useRef({ condition, timezone, intensity });

  useEffect(() => {
    current.current = { condition, timezone, intensity };
    scene.current?.update(condition, timezone, intensity);
    if (host.current) {
      const light = daylightAt(new Date(), timezone);
      host.current.style.setProperty("--daylight", String(light.daylight));
      host.current.style.setProperty("--twilight", String(light.twilight));
    }
  }, [condition, timezone, intensity]);

  useEffect(() => {
    const element = host.current;
    const mount = canvasMount.current;
    if (!element || !mount) return;
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const pointer = window.matchMedia("(pointer: coarse)");
    const device = navigator as AtmosphereNavigator;
    let disposed = false;
    let generation = 0;
    let intersecting = true;
    let lastQuality = "";

    const updateClock = () => {
      const light = daylightAt(new Date(), current.current.timezone);
      element.style.setProperty("--daylight", String(light.daylight));
      element.style.setProperty("--twilight", String(light.twilight));
    };
    const setVisible = () => {
      const visible = !document.hidden && intersecting;
      scene.current?.setActive(visible);
      if (visible) updateClock();
    };
    const mode = (quality: string) => {
      if (!disposed) element.dataset.renderer = quality;
    };
    const stopScene = () => {
      scene.current?.dispose();
      scene.current = null;
      mount.replaceChildren();
      mode("static");
    };

    const configure = async () => {
      const quality = selectAtmosphereQuality({
        reducedMotion: motion.matches,
        coarsePointer: pointer.matches,
        saveData: device.connection?.saveData === true,
        viewportWidth: window.innerWidth,
        hardwareConcurrency: device.hardwareConcurrency,
        deviceMemory: device.deviceMemory,
      });
      if (quality === lastQuality) {
        scene.current?.resize();
        return;
      }
      lastQuality = quality;
      const request = ++generation;
      stopScene();
      if (quality === "static" || typeof WebGL2RenderingContext === "undefined") return;
      try {
        // The expensive module is only requested after motion, data and device checks.
        const { createAtmosphereScene } = await import("./scene");
        if (disposed || generation !== request) return;
        const canvas = document.createElement("canvas");
        canvas.className = styles.canvas;
        canvas.setAttribute("aria-hidden", "true");
        mount.appendChild(canvas);
        scene.current = createAtmosphereScene(canvas, quality, mode);
        scene.current.update(current.current.condition, current.current.timezone, current.current.intensity);
        setVisible();
      } catch {
        if (!disposed && generation === request) stopScene();
      }
    };
    const resize = () => { void configure(); };
    const observer = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      intersecting = entry.isIntersecting;
      setVisible();
    });
    observer?.observe(element);
    motion.addEventListener("change", resize);
    pointer.addEventListener("change", resize);
    device.connection?.addEventListener("change", resize);
    window.addEventListener("resize", resize, { passive: true });
    document.addEventListener("visibilitychange", setVisible);
    // Static mode still changes with local time, without an animation loop.
    const clock = window.setInterval(() => { if (!document.hidden) updateClock(); }, 60_000);
    updateClock();
    void configure();

    return () => {
      disposed = true;
      generation += 1;
      observer?.disconnect();
      motion.removeEventListener("change", resize);
      pointer.removeEventListener("change", resize);
      device.connection?.removeEventListener("change", resize);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", setVisible);
      window.clearInterval(clock);
      stopScene();
    };
  }, []);

  return (
    <div
      ref={host}
      className={styles.host}
      data-condition={condition}
      data-renderer="static"
      aria-hidden="true"
      style={{ "--intensity": normalizeIntensity(intensity) } as CSSProperties}
    >
      <div className={styles.day} />
      <div className={styles.twilight} />
      <div className={styles.clouds} />
      <div className={styles.canvasMount} ref={canvasMount} />
      <div className={styles.veil} />
    </div>
  );
}
