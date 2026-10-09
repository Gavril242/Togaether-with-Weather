import { describe, expect, it } from "vitest";
import { daylightAt } from "../src/components/atmosphere/daylight";
import { degradeQuality, drawingSize, frameInterval, selectAtmosphereQuality } from "../src/components/atmosphere/policy";
import { normalizeIntensity } from "../src/components/atmosphere/types";

describe("the decorative 24 hour atmosphere cycle", () => {
  it("uses the selected location timezone instead of the browser timezone", () => {
    const instant = new Date("2026-10-09T12:30:00Z");
    expect(daylightAt(instant, "UTC").localHour).toBe(12.5);
    expect(daylightAt(instant, "Europe/Bucharest").localHour).toBe(15.5);
    expect(daylightAt(instant, "America/Los_Angeles").localHour).toBe(5.5);
    expect(daylightAt(instant, "Asia/Kolkata").localHour).toBe(18);
  });

  it("crosses midnight and daylight saving transitions through Intl", () => {
    expect(daylightAt(new Date("2026-10-09T21:00:00Z"), "Europe/Bucharest").localHour).toBe(0);
    const before = daylightAt(new Date("2026-03-29T00:59:00Z"), "Europe/Paris");
    const after = daylightAt(new Date("2026-03-29T01:01:00Z"), "Europe/Paris");
    expect(before.localHour).toBeCloseTo(1 + 59 / 60);
    expect(after.localHour).toBeCloseTo(3 + 1 / 60);
  });

  it("has bright noon, dark midnight, gentle twilight and no invalid uniforms", () => {
    expect(daylightAt(new Date("2026-10-09T12:00:00Z"), "UTC").daylight).toBe(1);
    expect(daylightAt(new Date("2026-10-09T00:00:00Z"), "UTC").daylight).toBe(0);
    expect(daylightAt(new Date("2026-10-09T06:00:00Z"), "UTC").twilight).toBe(1);
    for (let hour = 0; hour < 24; hour += 1) {
      const light = daylightAt(new Date(Date.UTC(2026, 9, 9, hour)), "UTC");
      for (const value of [light.daylight, light.twilight, light.sunX, light.sunY]) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
    expect(daylightAt(new Date("2026-10-09T12:00:00Z"), "bad/timezone").localHour).toBe(12);
    expect(() => daylightAt(new Date(NaN), "UTC")).toThrow(RangeError);
  });
});

describe("the ambient graphics budget", () => {
  const desktop = {
    reducedMotion: false,
    saveData: false,
    coarsePointer: false,
    viewportWidth: 1440,
    hardwareConcurrency: 8,
    deviceMemory: 8,
  };

  it("uses a static CSS sky when motion, data or device limits require it", () => {
    expect(selectAtmosphereQuality(desktop)).toBe("balanced");
    expect(selectAtmosphereQuality({ ...desktop, reducedMotion: true })).toBe("static");
    expect(selectAtmosphereQuality({ ...desktop, saveData: true })).toBe("static");
    expect(selectAtmosphereQuality({ ...desktop, viewportWidth: 390, coarsePointer: true })).toBe("static");
    expect(selectAtmosphereQuality({ ...desktop, deviceMemory: 2 })).toBe("static");
    expect(selectAtmosphereQuality({ ...desktop, hardwareConcurrency: 2 })).toBe("static");
    expect(selectAtmosphereQuality({ ...desktop, viewportWidth: 1024 })).toBe("low");
    expect(selectAtmosphereQuality({ ...desktop, deviceMemory: 4 })).toBe("low");
  });

  it("bounds the actual drawing buffer on high DPR and very large screens", () => {
    for (const quality of ["balanced", "low"] as const) {
      for (const [width, height, dpr] of [[1440, 900, 1], [3840, 2160, 2], [7680, 4320, 4]]) {
        const size = drawingSize(width, height, dpr, quality);
        expect(size.width * size.height * size.pixelRatio ** 2).toBeLessThanOrEqual(size.pixelBudget);
        expect(size.pixelRatio).toBeLessThanOrEqual(1.5);
        expect(size.pixelRatio).toBeGreaterThanOrEqual(1);
        expect(size.width / size.height).toBeCloseTo(width / height, 1);
      }
    }
    expect(drawingSize(NaN, 0, Infinity, "low")).toMatchObject({ width: 1, height: 1, pixelRatio: 1 });
  });

  it("reduces work for sustained poor pacing and never automatically increases it", () => {
    expect(frameInterval("balanced")).toBeCloseTo(1000 / 30);
    expect(frameInterval("low")).toBe(50);
    expect(frameInterval("static")).toBe(Infinity);
    expect(degradeQuality("balanced", 40)).toBe("balanced");
    expect(degradeQuality("balanced", 90)).toBe("low");
    expect(degradeQuality("low", 120)).toBe("static");
    expect(degradeQuality("low", 30)).toBe("low");
    expect(degradeQuality("static", 10)).toBe("static");
    expect(degradeQuality("balanced", NaN)).toBe("balanced");
    expect(normalizeIntensity(Infinity)).toBe(0.5);
    expect(normalizeIntensity(-1)).toBe(0);
    expect(normalizeIntensity(2)).toBe(1);
  });
});
