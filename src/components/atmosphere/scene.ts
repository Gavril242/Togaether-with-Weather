import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  WebGLRenderer,
} from "three";
import { daylightAt } from "./daylight";
import { degradeQuality, drawingSize, frameInterval, type AtmosphereQuality } from "./policy";
import { fragmentShader, vertexShader } from "./shaders";
import { normalizeIntensity, type AtmosphereCondition } from "./types";

export interface AtmosphereScene {
  setActive: (active: boolean) => void;
  update: (condition: AtmosphereCondition, timezone: string, intensity: number) => void;
  resize: () => void;
  dispose: () => void;
}

export function createAtmosphereScene(
  canvas: HTMLCanvasElement,
  initialQuality: Exclude<AtmosphereQuality, "static">,
  reportMode: (mode: AtmosphereQuality) => void,
): AtmosphereScene {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: "low-power",
    failIfMajorPerformanceCaveat: true,
    preserveDrawingBuffer: false,
  });
  const scene = new Scene();
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const geometry = new PlaneGeometry(2, 2);
  const uniforms = {
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uDaylight: { value: 0.4 },
    uTwilight: { value: 0 },
    uSun: { value: new Vector2(0.5, 0.8) },
    uCloudiness: { value: 0.15 },
    uRain: { value: 0 },
    uSnow: { value: 0 },
    uFog: { value: 0 },
    uFlash: { value: 0 },
    uLayers: { value: initialQuality === "balanced" ? 4 : 3 },
  };
  const material = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    depthTest: false,
    depthWrite: false,
  });
  const plane = new Mesh(geometry, material);
  plane.frustumCulled = false;
  scene.add(plane);

  let quality: AtmosphereQuality = initialQuality;
  let active = false;
  let disposed = false;
  let contextLost = false;
  let compiled = false;
  let frameId = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let lastFrame = 0;
  let totalSpacing = 0;
  let samples = 0;
  let condition: AtmosphereCondition = "clear";
  let timezone = "UTC";
  let intensity = 0.5;
  let lastClockUpdate = -Infinity;

  const cancel = () => {
    if (frameId) cancelAnimationFrame(frameId);
    if (timer !== undefined) clearTimeout(timer);
    frameId = 0;
    timer = undefined;
  };

  const resize = () => {
    if (disposed || contextLost) return;
    const size = drawingSize(window.innerWidth, window.innerHeight, window.devicePixelRatio, quality);
    renderer.setPixelRatio(size.pixelRatio);
    renderer.setSize(size.width, size.height, false);
    uniforms.uAspect.value = window.innerWidth / Math.max(1, window.innerHeight);
  };

  const clock = () => {
    const light = daylightAt(new Date(), timezone);
    uniforms.uDaylight.value = light.daylight;
    uniforms.uTwilight.value = light.twilight;
    uniforms.uSun.value.set(light.sunX, light.sunY);
  };

  const fail = () => {
    quality = "static";
    cancel();
    reportMode("static");
  };

  const schedule = () => {
    if (!active || disposed || contextLost || !compiled || quality === "static") return;
    const remaining = frameInterval(quality) - (performance.now() - lastFrame);
    timer = setTimeout(() => {
      timer = undefined;
      frameId = requestAnimationFrame(render);
    }, Math.max(0, remaining - 4));
  };

  const render = (now: number) => {
    frameId = 0;
    if (!active || disposed || contextLost || quality === "static") return;
    const delta = lastFrame ? now - lastFrame : 0;
    if (lastFrame && delta < frameInterval(quality)) {
      schedule();
      return;
    }
    // Only visible, rendered frames advance precipitation and cloud movement.
    uniforms.uTime.value += Math.min(delta / 1000, 0.1);
    if (now - lastClockUpdate > 30_000) {
      clock();
      lastClockUpdate = now;
    }
    const stormPhase = uniforms.uTime.value % 47;
    uniforms.uFlash.value = condition === "storm" && stormPhase > 44
      ? Math.sin(((stormPhase - 44) / 3) * Math.PI) ** 2 * intensity
      : 0;
    lastFrame = now;
    try {
      renderer.render(scene, camera);
    } catch {
      fail();
      return;
    }
    if (delta > 0) {
      totalSpacing += delta;
      samples += 1;
    }
    if (samples >= 60) {
      const next = degradeQuality(quality, totalSpacing / samples);
      samples = 0;
      totalSpacing = 0;
      if (next !== quality) {
        quality = next;
        uniforms.uLayers.value = 3;
        reportMode(quality);
        if (quality === "static") {
          cancel();
          return;
        }
        resize();
      }
    }
    schedule();
  };

  const setActive = (next: boolean) => {
    active = next;
    cancel();
    lastFrame = 0;
    totalSpacing = 0;
    samples = 0;
    if (next) {
      clock();
      schedule();
    }
  };

  const update = (nextCondition: AtmosphereCondition, nextTimezone: string, nextIntensity: number) => {
    condition = nextCondition;
    timezone = nextTimezone;
    intensity = normalizeIntensity(nextIntensity);
    uniforms.uCloudiness.value = {
      clear: 0.12,
      cloudy: 0.76,
      rain: 0.88,
      snow: 0.75,
      storm: 0.96,
      fog: 0.50,
    }[condition];
    uniforms.uRain.value = condition === "rain" || condition === "storm" ? intensity : 0;
    uniforms.uSnow.value = condition === "snow" ? intensity : 0;
    uniforms.uFog.value = condition === "fog" ? intensity : 0;
    clock();
  };

  const onContextLost = (event: Event) => {
    event.preventDefault();
    contextLost = true;
    cancel();
    reportMode("static");
  };
  const onContextRestored = () => {
    if (disposed) return;
    contextLost = false;
    // Three reconstructs its context internally; original geometry and uniforms remain reusable.
    resize();
    if (quality !== "static") reportMode(quality);
    setActive(active);
  };
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  renderer.debug.onShaderError = fail;
  resize();
  void renderer.compileAsync(scene, camera).then(() => {
    if (disposed || quality === "static") return;
    compiled = true;
    reportMode(quality);
    schedule();
  }).catch(fail);

  return {
    setActive,
    update,
    resize,
    dispose() {
      if (disposed) return;
      disposed = true;
      cancel();
      canvas.removeEventListener("webglcontextlost", onContextLost);
      canvas.removeEventListener("webglcontextrestored", onContextRestored);
      scene.remove(plane);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}
