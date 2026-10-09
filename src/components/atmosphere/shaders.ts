// Original procedural shader. Four cloud slices suggest depth without a volume texture.
export const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

export const fragmentShader = `
  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform float uDaylight;
  uniform float uTwilight;
  uniform vec2 uSun;
  uniform float uCloudiness;
  uniform float uRain;
  uniform float uSnow;
  uniform float uFog;
  uniform float uFlash;
  uniform float uLayers;

  float hash(vec2 p) {
    p = fract(p * vec2(127.13, 311.71));
    p += dot(p, p + 17.17);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    vec2 blend = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(cell), hash(cell + vec2(1.0, 0.0)), blend.x),
      mix(hash(cell + vec2(0.0, 1.0)), hash(cell + vec2(1.0)), blend.x), blend.y);
  }

  float cloudNoise(vec2 p) {
    return noise(p) * 0.56 + noise(p * 2.08 + 9.7) * 0.29 + noise(p * 4.17 + 21.3) * 0.15;
  }

  float rain(vec2 uv, float layer) {
    vec2 p = uv * vec2(88.0 * uAspect, 46.0) * layer;
    p.x += uTime * 3.2 * layer;
    p.y += uTime * 24.0 * layer;
    vec2 cell = floor(p);
    vec2 f = fract(p);
    float seed = hash(cell);
    float center = 0.15 + 0.7 * hash(cell + 32.0);
    float drop = (1.0 - smoothstep(0.014, 0.035, abs(f.x - center))) *
      (1.0 - smoothstep(0.05, 0.31, abs(f.y - 0.5)));
    return drop * step(0.80, seed);
  }

  float snow(vec2 uv, float layer) {
    vec2 p = uv * vec2(32.0 * uAspect, 20.0) * layer;
    p.y += uTime * 0.72 * layer;
    p.x += sin(uTime * 0.16 + uv.y * 7.0) * 0.30 + uTime * 0.08;
    vec2 cell = floor(p);
    float seed = hash(cell);
    vec2 center = vec2(hash(cell + 5.7), hash(cell + 43.7)) * 0.65 + 0.175;
    float radius = 0.045 + seed * 0.035;
    return (1.0 - smoothstep(radius * 0.3, radius, length(fract(p) - center))) * step(0.76, seed);
  }

  void main() {
    vec2 uv = vUv;
    vec2 landscape = vec2(uv.x * uAspect, uv.y);
    vec3 nightTop = vec3(0.019, 0.027, 0.049);
    vec3 nightBottom = vec3(0.039, 0.062, 0.094);
    vec3 dayTop = vec3(0.145, 0.315, 0.435);
    vec3 dayBottom = vec3(0.29, 0.405, 0.43);
    vec3 top = mix(nightTop, dayTop, uDaylight);
    vec3 bottom = mix(nightBottom, dayBottom, uDaylight);
    vec3 color = mix(bottom, top, smoothstep(0.0, 0.95, uv.y));
    float horizon = exp(-abs(uv.y - 0.22) * 4.0);
    color += vec3(0.24, 0.095, 0.035) * horizon * uTwilight * 0.46;

    vec2 sunDelta = vec2((uv.x - uSun.x) * uAspect, uv.y - uSun.y);
    float glow = exp(-dot(sunDelta, sunDelta) * 5.0);
    color += mix(vec3(0.20, 0.115, 0.06), vec3(0.22, 0.25, 0.22), uDaylight) *
      glow * (0.14 + 0.42 * uDaylight) * (1.0 - uCloudiness * 0.6);
    float clearHaze = exp(-dot(sunDelta, sunDelta) * 1.65) * uDaylight * (1.0 - uCloudiness);
    color += vec3(0.22, 0.18, 0.105) * clearHaze * 0.11;

    vec2 starGrid = landscape * vec2(106.0, 72.0);
    float starSeed = hash(floor(starGrid));
    float star = (1.0 - smoothstep(0.008, 0.065, length(fract(starGrid) - 0.5))) *
      step(0.995, starSeed) * (1.0 - uDaylight) * (1.0 - uCloudiness);
    color += vec3(0.32, 0.37, 0.45) * star;

    vec2 cloudUv = landscape * vec2(2.5, 3.4);
    cloudUv.x += uTime * 0.006;
    float altitude = smoothstep(0.14, 0.54, uv.y);
    float threshold = mix(0.69, 0.36, uCloudiness);
    for (int i = 0; i < 4; i++) {
      if (float(i) >= uLayers) break;
      float depth = float(i);
      vec2 layer = cloudUv * (1.0 + depth * 0.16) + vec2(depth * 0.37, depth * 0.13);
      float density = smoothstep(threshold, threshold + 0.20, cloudNoise(layer)) * altitude;
      float light = cloudNoise(layer + vec2(-0.10, 0.08));
      vec3 cloud = mix(vec3(0.077, 0.097, 0.127), vec3(0.26, 0.33, 0.35), uDaylight);
      cloud += light * vec3(0.09, 0.095, 0.10) * (0.25 + uDaylight * 0.75);
      cloud += vec3(0.045, 0.026, 0.012) * uTwilight;
      color = mix(color, cloud, density * (0.13 + uCloudiness * 0.17));
    }

    if (uRain > 0.0) {
      float drops = rain(uv, 1.0) + rain(uv + 0.13, 0.67) * 0.7;
      color += vec3(0.14, 0.20, 0.25) * drops * uRain * 0.25;
    }
    if (uSnow > 0.0) {
      float flakes = snow(uv, 1.0) + snow(uv + 0.41, 0.62) * 0.55;
      color += vec3(0.35, 0.39, 0.40) * flakes * uSnow * 0.4;
    }
    if (uFog > 0.0) {
      float haze = (1.0 - smoothstep(0.0, 0.83, uv.y)) *
        (0.45 + 0.30 * noise(landscape * 3.0 + uTime * 0.005));
      color = mix(color, vec3(0.17, 0.22, 0.25), haze * uFog * 0.45);
    }
    // A broad, gentle storm glow; no bolts or abrupt repeated flashing.
    color += vec3(0.06, 0.075, 0.09) * uFlash * altitude;
    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;
