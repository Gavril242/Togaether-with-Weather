# Ambient atmosphere

`Atmosphere` is decorative and does not supply weather data. Its `condition`, `timezone` and `intensity` props come from the selected weather card. Place the dashboard content above the background's `z-index: 0`. The host is hidden from assistive technology and does not intercept input.

The light cycle follows the location's local clock through `Intl.DateTimeFormat`, including daylight saving changes. It uses a stylized 06:00 dawn and 18:00 dusk. It is not a latitude based sunrise calculation. Invalid timezones fall back to UTC.

## Work limits

1. The Three.js module loads after browser capability checks. Reduced motion, data saving, narrow touch screens and reported low device resources use static CSS gradients. Failed context creation or shader compilation also preserves that fallback.
2. The enhanced background draws one plane with at most four cloud slices and three noise octaves. Rain and snow are computed in the same shader. It has no downloaded textures, volume allocation, bloom, shadow map or postprocessing passes.
3. The drawing buffer is capped at 480,000 physical pixels for balanced quality and 270,000 for low quality. Device pixel ratio is clamped between 1 and 1.5, then drawing dimensions are reduced to respect that budget.
4. Frames are capped at 30 or 20 per second. Hidden tabs and invisible hosts cancel both the frame request and scheduler timer. Geometry, material, renderer, context and event listeners are released on unmount.
5. Sixty rendered frame intervals inform a conservative reduction in quality when pacing stays poor. This measures browser pacing, not GPU execution time. It cannot guarantee a particular battery cost or frame rate on an untested device.
6. Thunderstorms use a gentle three second glow every 47 seconds of visible animation. Reduced motion removes all animation. The background remains optional presentation and should never be required to understand a card.

The Three.js [volumetric cloud example](https://threejs.org/examples/webgpu_volume_cloud.html) and React Bits [Aurora](https://reactbits.dev/backgrounds/aurora) informed the visual direction. This shader is original code. The example's volume texture, default 100 step raymarch and unrestricted device pixel ratio were not copied. [Three.js renderer documentation](https://threejs.org/docs/pages/WebGLRenderer.html) describes the WebGL 2 renderer and disposal methods used here.

Unit tests cover timezone changes, daylight boundaries, capability selection, resolution caps and degradation thresholds. Device profiling and visual checks must be reported with the browser and hardware used. No Lighthouse, GPU time or battery result is claimed by these tests.

On 9 October 2026, an isolated local harness rendered all six conditions in Chromium, Playwright browser build 1243, using SwiftShader on Windows. Shader compilation produced no console or page errors. A 1440 × 900 viewport produced an 876 × 547 drawing buffer. Pausing and disposal stopped draw calls; simulated context loss switched to the fallback and restoration resumed rendering. This checks the shader and lifecycle using software rendering. Hardware profiling remains outstanding.
