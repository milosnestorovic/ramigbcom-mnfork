export const roomVertex = /* glsl */ `
attribute float aEdge;
varying vec2 vUv;
varying float vDepth;
varying float vEdge;

void main() {
  vUv = uv;
  vDepth = -position.z;
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

/*
 * Everything the room does on top of the source image happens here, in one pass:
 * depth-of-field from pre-blurred plates, the CRT's screensaver, the tape deck's controls, the hover light lift and outline, screen glow,
 * twinkling city lights, the lamp easter egg, rain behind the glass and a vignette.
 * Colors stay in the image's own (sRGB) space so the overview is untouched.
 */
export const roomFragment = /* glsl */ `
precision highp float;

uniform sampler2D uMap;
uniform sampler2D uDepth;
uniform sampler2D uFx;
uniform sampler2D uHover;
uniform sampler2D uOutline;
uniform mat3 uSaver;
uniform mat3 uInfo;
uniform sampler2D uInfoMap;
uniform sampler2D uPatch;
uniform sampler2D uDeck;
uniform vec4 uDeckRect;
uniform vec2 uImageSize;
uniform sampler2D uBlur1;
uniform sampler2D uBlur2;
uniform float uStretch;
uniform vec2 uResolution;
uniform float uTime;
uniform float uMotion;
uniform float uExposure;
uniform float uDof;
uniform float uFocusDepth;
uniform float uHoverAmt;
uniform vec3 uHoverTint;
uniform float uLamp;
uniform float uRain;
uniform float uVignette;

varying vec2 vUv;
varying float vDepth;
varying float vEdge;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float rainLayer(vec2 uv, float columns, float speed, float seed) {
  uv.x += uv.y * 0.06;
  vec2 st = vec2(uv.x * columns, uv.y * columns * 0.045);
  float col = floor(st.x);
  float r = hash(vec2(col, seed));
  float y = fract(st.y - uTime * speed * (0.75 + 0.5 * r) + r * 11.0);
  float streak = smoothstep(0.0, 0.04, y) * smoothstep(0.32, 0.04, y);
  float thin = smoothstep(0.16, 0.0, abs(fract(st.x) - 0.5));
  return streak * thin * step(0.62, hash(vec2(col, seed + 3.7)));
}

// The CRT's screensaver: falling columns of made-up glyphs. s is the glass, 0..1.
vec3 screensaver(vec2 s, float t) {
  vec2 grid = vec2(13.0, 10.0);
  vec2 cell = floor(s * grid);
  vec2 f = fract(s * grid);
  float len = 7.0 + 9.0 * hash(vec2(cell.x, 3.0));
  float speed = 1.5 + 4.0 * hash(vec2(cell.x, 1.0));
  float head = mod(t * speed + 40.0 * hash(vec2(cell.x, 2.0)), grid.y + len);
  float behind = head - cell.y;
  float trail = step(0.0, behind) * clamp(1.0 - behind / len, 0.0, 1.0);
  float lead = step(0.0, behind) * step(behind, 1.0);
  // Each cell holds a 3x5 dot glyph that reshuffles now and then.
  float glyph = hash(cell + 0.37 * floor(t * (0.6 + 2.4 * hash(cell))));
  vec2 pip = floor(f * vec2(4.0, 6.0));
  float lit = step(0.45, hash(pip + glyph * 91.7)) * step(pip.x, 2.5) * step(pip.y, 4.5);
  vec3 c = vec3(0.015, 0.07, 0.08);
  c += vec3(0.2, 0.9, 0.85) * lit * trail * trail;
  c += vec3(0.75, 1.0, 1.0) * lit * lead;
  vec2 q = s - 0.5;
  return c * (1.0 - 1.6 * dot(q, q));
}

// Where an image pixel falls on a screen's glass (0..1 inside it).
vec2 onGlass(mat3 m, vec2 uv) {
  vec3 p = m * vec3(uv * uImageSize, 1.0);
  return p.xy / p.z;
}

// 1 inside the glass, with corners rounded like the tube.
float glassMask(vec2 s) {
  vec2 corner = abs(s - 0.5) - 0.43;
  return 1.0 - smoothstep(-0.015, 0.0, length(max(corner, 0.0)) - 0.07);
}

void main() {
  vec2 uv = vUv;
  float disparity = texture2D(uDepth, clamp(uv, 0.0, 1.0)).r;
  float city = smoothstep(0.075, 0.052, disparity);

  // Circle of confusion in diopters: distance from the focal plane in 1/depth.
  float coc = clamp(abs(1.0 / vDepth - 1.0 / uFocusDepth) * 7.0, 0.0, 1.0) * uDof;
  // Where the mesh had to stretch across a depth jump, the camera is looking at
  // pixels that were never photographed. Blur them away once the camera has moved.
  float soft = max(coc, smoothstep(0.2, 0.7, vEdge) * uStretch);
  vec3 col = texture2D(uMap, uv).rgb;
  // The tape deck's corner of the picture has a sharper copy for close-ups, feathered in.
  vec2 dq = (uv - uDeckRect.xy) / (uDeckRect.zw - uDeckRect.xy);
  vec2 dEdge = smoothstep(0.0, 0.07, dq) * smoothstep(0.0, 0.07, 1.0 - dq);
  float inDeck = dEdge.x * dEdge.y;
  col = mix(col, texture2D(uPatch, clamp(dq, 0.0, 1.0)).rgb, inDeck);
  if (soft > 0.01) {
    vec3 b1 = texture2D(uBlur1, uv).rgb;
    vec3 b2 = texture2D(uBlur2, uv).rgb;
    col = soft < 0.5 ? mix(col, b1, soft * 2.0) : mix(b1, b2, soft * 2.0 - 1.0);
  }

  // Both CRTs show something live in place of the painted glass. Out of focus,
  // either one melts into a glow.
  vec3 glow = vec3(0.03, 0.13, 0.13);
  float melt = clamp(soft * 1.6, 0.0, 1.0);
  vec2 gs = onGlass(uSaver, uv);
  float inSaver = glassMask(gs);
  if (inSaver > 0.0) {
    // Frozen on one frame for reduced motion.
    col = mix(col, mix(screensaver(gs, mix(7.0, uTime, uMotion)), glow, melt), inSaver);
  }
  vec2 is = onGlass(uInfo, uv);
  // Sampled outside the branch: mip selection needs derivatives everywhere.
  vec3 board = texture2D(uInfoMap, clamp(is, 0.0, 1.0)).rgb;
  col = mix(col, mix(board, glow, melt), glassMask(is));
  // What is drawn onto the deck: its display, keys, slot and the stack of cassettes.
  vec4 art = texture2D(uDeck, clamp(dq, 0.0, 1.0)) * inDeck * (1.0 - melt);
  col = col * (1.0 - art.a) + art.rgb;

  // Hover: lift the object, let everything else settle back a touch.
  float h = texture2D(uHover, uv).r * uHoverAmt;
  col = col * (1.0 + 0.5 * h) + uHoverTint * h * 0.035;
  col *= 1.0 - 0.14 * uHoverAmt * (1.0 - h);

  vec4 fx = texture2D(uFx, uv);

  // Screens breathe.
  col += col * fx.g * (0.05 + 0.05 * sin(uTime * 1.6)) * uMotion;

  // City lights twinkle, only the bright ones, only some of them.
  float lum = dot(col, vec3(0.299, 0.587, 0.114));
  vec2 cell = floor(uv * vec2(520.0, 390.0));
  float r = hash(cell);
  float tw = sin(uTime * (0.5 + 2.5 * r) + r * 40.0) * smoothstep(0.32, 0.7, lum) * step(0.55, r);
  // Only on in-focus pixels: blurred or magnified, the per-cell flicker shows as squares.
  col *= 1.0 + 0.3 * tw * city * uMotion * (1.0 - soft) * (1.0 - uStretch);

  // Lamp easter egg: the fixture goes dark and the room loses a little light.
  col = mix(col, col * 0.12, fx.b * (1.0 - uLamp));
  col *= mix(0.8, 1.0, uLamp);

  // Rain behind the glass.
  if (uRain > 0.001 && city > 0.0) {
    // Screen space, so the drops stay fine-grained however far the camera zooms in.
    vec2 sp = gl_FragCoord.xy / uResolution.y;
    sp.y = 1.0 - sp.y;
    float rain = rainLayer(sp * 0.42, 420.0, 0.9, 1.0) * 0.55 + rainLayer(sp * 0.7 + 0.3, 260.0, 0.6, 2.0) * 0.3;
    col = mix(col, vec3(0.13, 0.18, 0.21), 0.07 * uRain * city);
    col += vec3(0.62, 0.74, 0.82) * rain * 0.22 * uRain * city;
  }

  // Hover outline: the silhouette mask crosses one half at the object's edge. Measured
  // in screen pixels, so the line stays hair-thin however far the camera zooms in.
  float outline = texture2D(uOutline, uv).r;
  float edge = abs(outline - 0.5) / max(fwidth(outline), 1e-4);
  col = mix(col, uHoverTint, (1.0 - smoothstep(0.4, 1.1, edge)) * uHoverAmt * 0.8);

  vec2 q = gl_FragCoord.xy / uResolution - 0.5;
  col *= 1.0 - dot(q, q) * uVignette;

  gl_FragColor = vec4(col * uExposure, 1.0);
}
`
