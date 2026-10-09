export type AtmosphereQuality = "balanced" | "low" | "static";

export interface AtmosphereCapabilities {
  reducedMotion: boolean;
  saveData: boolean;
  coarsePointer: boolean;
  viewportWidth: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

export function selectAtmosphereQuality(capabilities: AtmosphereCapabilities): AtmosphereQuality {
  if (
    capabilities.reducedMotion ||
    capabilities.saveData ||
    (capabilities.coarsePointer && capabilities.viewportWidth < 900) ||
    (capabilities.hardwareConcurrency !== undefined && capabilities.hardwareConcurrency < 4) ||
    (capabilities.deviceMemory !== undefined && capabilities.deviceMemory < 4)
  ) return "static";
  if (
    capabilities.coarsePointer ||
    capabilities.viewportWidth < 1100 ||
    (capabilities.deviceMemory !== undefined && capabilities.deviceMemory < 8)
  ) return "low";
  return "balanced";
}

export function frameInterval(quality: AtmosphereQuality): number {
  if (quality === "static") return Infinity;
  return quality === "balanced" ? 1000 / 30 : 1000 / 20;
}

/** Cap the drawing buffer even on wide monitors with high device pixel ratios. */
export function drawingSize(width: number, height: number, dpr: number, quality: AtmosphereQuality) {
  const safeWidth = Math.max(1, Number.isFinite(width) ? width : 1);
  const safeHeight = Math.max(1, Number.isFinite(height) ? height : 1);
  const pixelRatio = Math.max(1, Math.min(1.5, Number.isFinite(dpr) ? dpr : 1));
  const pixelBudget = quality === "balanced" ? 480_000 : 270_000;
  const targetScale = quality === "balanced" ? 0.65 : 0.45;
  const scale = Math.min(targetScale, Math.sqrt(pixelBudget / (safeWidth * safeHeight * pixelRatio ** 2)));
  return {
    width: Math.max(1, Math.floor(safeWidth * scale)),
    height: Math.max(1, Math.floor(safeHeight * scale)),
    pixelRatio,
    pixelBudget,
  };
}

/** Sustained poor frame pacing reduces visual work; this is not a GPU benchmark. */
export function degradeQuality(quality: AtmosphereQuality, averageFrameMs: number): AtmosphereQuality {
  if (!Number.isFinite(averageFrameMs)) return quality;
  if (quality === "balanced" && averageFrameMs > 70) return "low";
  if (quality === "low" && averageFrameMs > 110) return "static";
  return quality;
}
