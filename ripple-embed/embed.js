/* React Bits 官方 Ripple Distortion（reactbits.dev/animations/ripple-distortion）移植版。
   着色器、波浪生成/扩散/衰减逻辑与官方组件源码一致（MAX_WAVES=100、START_SCALE、
   LIFE_CONSTANT 等常量原样保留），仅把 React + ogl 依赖替换为原生 WebGL2。
   与官方组件的差异（本页所需）：
   1. 扭曲纹理不是静态图片，而是实时采样首页背景画布 #cv（随帧序列同步更新）；
   2. 合成阶段按 .landing-panel 的黑色透明板观感压暗（uDarken），
      并以 panelAlpha 半透明输出，盖在 .landing-panel 之上，工牌等下层内容仍可透出。
   配置：window.RIPPLE_EMBED_CONFIG = {
     brushSize, strength, swirl, rings, spread, fade, spacing,
     tint, tintAmount, grayscale, darken, panelAlpha, quality } */
(function () {
  var mount = document.getElementById("ripple-root");
  var bgCanvas = document.getElementById("cv");
  if (!mount || !bgCanvas || !window.WebGL2RenderingContext) return;
  var canvas = document.createElement("canvas");
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  mount.appendChild(canvas);
  var gl = canvas.getContext("webgl2", { alpha: true, antialias: false, depth: false });
  if (!gl) { mount.removeChild(canvas); return; }

  var cfg = Object.assign({
    brushSize: 150, strength: 0.2, swirl: 1, rings: 4, spread: 5, fade: 3,
    spacing: 15, tint: "#a855f7", tintAmount: 0.1, grayscale: false,
    darken: 1.0, panelAlpha: 6.0, quality: "low"
  }, window.RIPPLE_EMBED_CONFIG || {});

  /* ---- 以下着色器逐行取自官方 RippleDistortion.jsx ---- */
  var waveVertex = `
precision highp float;

attribute vec2 position;
attribute vec2 uv;
attribute vec2 iOffset;
attribute vec2 iScale;
attribute float iOpacity;

varying vec2 vUv;
varying float vOpacity;

void main() {
  vUv = uv;
  vOpacity = iOpacity;
  gl_Position = vec4(iOffset + position * iScale, 0.0, 1.0);
}
`;

  var waveFragment = `
precision highp float;

varying vec2 vUv;
varying float vOpacity;

uniform float uRings;

const float PI = 3.141592653589793;
const float EDGE = 0.006737947;

void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = dot(p, p);
  if (r > 1.0) discard;

  float brush = (exp(-r * 5.0) - EDGE) / (1.0 - EDGE);

  brush *= 0.55 + 0.45 * cos(sqrt(r) * PI * 2.0 * uRings);

  gl_FragColor = vec4(vec3(brush * vOpacity * vOpacity), 1.0);
}
`;

  var screenVertex = `
precision highp float;
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

  /* 官方 compositeFragment + 本页改动：输出 alpha 随波浪强度变化（uAlpha 为增益），
     无波处完全透明，仅水波经过处显示被扭曲的原始背景（黑板与模糊仍由 .landing-panel 提供） */
  var compositeFragment = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uTexture;
uniform sampler2D uDisplacement;
uniform vec2 uResolution;
uniform vec2 uTextureSize;
uniform vec2 uTexel;
uniform vec3 uTint;
uniform vec3 uHighlight;
uniform float uStrength;
uniform float uSwirl;
uniform float uDispersion;
uniform float uGlint;
uniform float uTintAmount;
uniform float uGrayscale;
uniform float uDarken;
uniform float uAlpha;

const float TAU = 6.283185307179586;

vec2 coverUV(vec2 uv) {
  vec2 safe = max(uTextureSize, vec2(1.0));
  vec2 s = uResolution / safe;
  vec2 scaledSize = safe * max(s.x, s.y);
  vec2 offset = (uResolution - scaledSize) * 0.5;
  return (uv * uResolution - offset) / scaledSize;
}

void main() {
  float amount = texture2D(uDisplacement, vUv).r;
  vec2 base = coverUV(vUv);

  float theta = amount * uSwirl * TAU;
  vec2 dir = vec2(sin(theta), cos(theta));
  vec2 push = dir * amount * uStrength;

  vec3 color;
  if (uDispersion > 0.001) {
    float split = uDispersion * 0.25;
    color.r = texture2D(uTexture, base + push * (1.0 + split)).r;
    color.g = texture2D(uTexture, base + push).g;
    color.b = texture2D(uTexture, base + push * (1.0 - split)).b;
  } else {
    color = texture2D(uTexture, base + push).rgb;
  }

  if (uGrayscale > 0.001) {
    color = mix(color, vec3(dot(color, vec3(0.2126, 0.7152, 0.0722))), uGrayscale);
  }

  if (uTintAmount > 0.001) {
    color = mix(color, color * uTint * 1.9, clamp(amount * 1.6, 0.0, 1.0) * uTintAmount);
  }

  if (uGlint > 0.001) {
    float ex = texture2D(uDisplacement, vUv + vec2(uTexel.x, 0.0)).r - texture2D(uDisplacement, vUv - vec2(uTexel.x, 0.0)).r;
    float ey = texture2D(uDisplacement, vUv + vec2(0.0, uTexel.y)).r - texture2D(uDisplacement, vUv - vec2(0.0, uTexel.y)).r;
    vec3 normal = normalize(vec3(-ex * 26.0, -ey * 26.0, 1.0));
    vec3 light = normalize(vec3(-0.35, 0.55, 1.0));
    float raw = pow(max(dot(normal, light), 0.0), 22.0);
    float flatSpec = pow(max(light.z, 0.0), 22.0);
    color += uHighlight * clamp((raw - flatSpec) / max(1.0 - flatSpec, 0.0001), 0.0, 1.0) * uGlint;
  }

  gl_FragColor = vec4(color, clamp(amount * uAlpha, 0.0, 1.0));
}
`;

  var MAX_WAVES = 100;
  var QUALITY_SCALE = { low: 0.4, medium: 0.7, high: 1 };
  var START_SCALE = 1.5;
  var LIFE_CONSTANT = Math.log(500);

  function compile(type, src) {
    var sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(sh));
    }
    return sh;
  }
  function program(vs, fs) {
    var p = gl.createProgram();
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(p));
    }
    return p;
  }
  function uniforms(p, names) {
    var u = {};
    names.forEach(function (n) { u[n] = gl.getUniformLocation(p, n); });
    return u;
  }

  var waveProg = program(waveVertex, waveFragment);
  var waveU = uniforms(waveProg, ["uRings"]);
  var compProg = program(screenVertex, compositeFragment);
  var compU = uniforms(compProg, [
    "uTexture", "uDisplacement", "uResolution", "uTextureSize", "uTexel",
    "uTint", "uHighlight", "uStrength", "uSwirl", "uDispersion", "uGlint",
    "uTintAmount", "uGrayscale", "uDarken", "uAlpha"
  ]);

  // 全屏四边形（6 顶点两三角形），波浪层作为 100 个实例的四边形
  var quadData = new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
    0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1
  ]);
  var quadVBO = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
  gl.bufferData(gl.ARRAY_BUFFER, quadData, gl.STATIC_DRAW);

  var offsets = new Float32Array(MAX_WAVES * 2);
  var scales = new Float32Array(MAX_WAVES * 2);
  var opacities = new Float32Array(MAX_WAVES);
  function instVBO(data) {
    var b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
    return b;
  }
  var offsetVBO = instVBO(offsets);
  var scaleVBO = instVBO(scales);
  var opacityVBO = instVBO(opacities);

  // 位移场渲染目标（质量档位与官方一致）
  var QUALITY = QUALITY_SCALE[cfg.quality] || QUALITY_SCALE.high;
  var rtTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, rtTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  var rtFB = gl.createFramebuffer();
  var rtW = 2, rtH = 2;

  // 背景纹理（实时取自 #cv）
  var bgTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, bgTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  var hexToRGB = function (hex) {
    var clean = hex.replace("#", "");
    var n = parseInt(clean.length === 3
      ? clean.split("").map(function (c) { return c + c; }).join("")
      : clean, 16);
    if (Number.isNaN(n)) return [1, 1, 1];
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255];
  };

  gl.useProgram(compProg);
  gl.uniform1i(compU.uTexture, 0);
  gl.uniform1i(compU.uDisplacement, 1);
  gl.uniform3fv(compU.uTint, hexToRGB(cfg.tint));
  gl.uniform3fv(compU.uHighlight, hexToRGB("#ffffff"));
  gl.uniform1f(compU.uStrength, cfg.strength);
  gl.uniform1f(compU.uSwirl, cfg.swirl);
  gl.uniform1f(compU.uDispersion, 0);
  gl.uniform1f(compU.uGlint, 0);
  gl.uniform1f(compU.uTintAmount, cfg.tintAmount);
  gl.uniform1f(compU.uGrayscale, cfg.grayscale ? 1 : 0);
  gl.uniform1f(compU.uDarken, cfg.darken);
  gl.uniform1f(compU.uAlpha, cfg.panelAlpha);

  var reduceMotion = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- 波浪状态（与官方 setNewWave / 循环逻辑一致） ----
  var waves = [];
  for (var i = 0; i < MAX_WAVES; i++) {
    waves.push({ x: 0, y: 0, scale: START_SCALE, target: START_SCALE, size: 1, opacity: 0 });
  }
  var current = 0;

  function setNewWave(x, y, power) {
    var wave = waves[current];
    current = (current + 1) % MAX_WAVES;
    wave.x = x;
    wave.y = y;
    wave.scale = START_SCALE * power;
    wave.target = START_SCALE * Math.max(1, cfg.spread) * power;
    wave.size = Math.max(1, cfg.brushSize);
    wave.opacity = 1;
  }

  var width = 1, height = 1;
  function localPoint(clientX, clientY) {
    var rect = mount.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) {
      return null;
    }
    return [clientX - rect.left, rect.height - (clientY - rect.top)];
  }

  var previousX = 0, previousY = 0;
  var onMove = function (event) {
    if (reduceMotion) return;
    var point = localPoint(event.clientX, event.clientY);
    if (!point) return;
    var step = Math.max(1, cfg.spacing);
    if (Math.abs(point[0] - previousX) > step || Math.abs(point[1] - previousY) > step) {
      setNewWave(point[0], point[1], 1);
      previousX = point[0];
      previousY = point[1];
    }
  };
  window.addEventListener("pointermove", onMove, { passive: true });

  function resize() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = Math.max(1, mount.clientWidth);
    height = Math.max(1, mount.clientHeight);
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    gl.useProgram(compProg);
    gl.uniform2f(compU.uResolution, width, height);
    gl.uniform2f(compU.uTextureSize, width, height); // 背景画布与视口同比例 → cover 退化为恒等映射
    rtW = Math.max(2, Math.round(width * QUALITY));
    rtH = Math.max(2, Math.round(height * QUALITY));
    gl.bindTexture(gl.TEXTURE_2D, rtTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, rtW, rtH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.useProgram(compProg);
    gl.uniform2f(compU.uTexel, 1 / rtW, 1 / rtH);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(resize).observe(mount);
  }
  window.addEventListener("resize", resize);
  resize();

  var uploadedFrame = -1;
  function uploadBackground() {
    if (!bgCanvas.width || !bgCanvas.height) return;
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bgCanvas);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }

  function bindQuadAttribs(prog) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quadVBO);
    var pos = gl.getAttribLocation(prog, "position");
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    var uv = gl.getAttribLocation(prog, "uv");
    gl.enableVertexAttribArray(uv);
    gl.vertexAttribPointer(uv, 2, gl.FLOAT, false, 0, 12 * 4); // uv 块紧随 6×2 position 之后
  }

  var raf = 0, previousTime = 0;
  window.__rippleDebug = { frames: 0, err: null };
  var loopBody = function (now) {
    raf = requestAnimationFrame(loop);
    var rect = mount.getBoundingClientRect();
    if (document.hidden || rect.bottom < 0 || rect.top > window.innerHeight) return;

    var delta = previousTime ? Math.min(0.05, (now - previousTime) / 1000) : 0;
    previousTime = now;

    var growth = reduceMotion ? 0 : 1 - Math.exp(-delta * 1.09);
    var decay = reduceMotion ? 1 : Math.exp((-delta * LIFE_CONSTANT) / Math.max(0.15, cfg.fade));

    for (var i = 0; i < MAX_WAVES; i++) {
      var wave = waves[i];
      if (wave.opacity <= 0) { opacities[i] = 0; continue; }
      wave.opacity *= decay;
      wave.scale += (wave.target - wave.scale) * growth;
      if (wave.opacity < 0.002) { wave.opacity = 0; opacities[i] = 0; continue; }
      var half = (wave.scale * wave.size) / 2;
      offsets[i * 2] = (wave.x / width) * 2 - 1;
      offsets[i * 2 + 1] = (wave.y / height) * 2 - 1;
      scales[i * 2] = (half / width) * 2;
      scales[i * 2 + 1] = (half / height) * 2;
      opacities[i] = wave.opacity;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, offsetVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, offsets);
    gl.bindBuffer(gl.ARRAY_BUFFER, scaleVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, scales);
    gl.bindBuffer(gl.ARRAY_BUFFER, opacityVBO);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, opacities);

    // pass 1：波浪 → 位移场（官方同为 ONE、ONE 叠加混合）
    gl.bindFramebuffer(gl.FRAMEBUFFER, rtFB);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rtTex, 0);
    gl.viewport(0, 0, rtW, rtH);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(waveProg);
    gl.uniform1f(waveU.uRings, cfg.rings);
    bindQuadAttribs(waveProg);
    gl.bindBuffer(gl.ARRAY_BUFFER, offsetVBO);
    var aOff = gl.getAttribLocation(waveProg, "iOffset");
    gl.enableVertexAttribArray(aOff);
    gl.vertexAttribPointer(aOff, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aOff, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, scaleVBO);
    var aScl = gl.getAttribLocation(waveProg, "iScale");
    gl.enableVertexAttribArray(aScl);
    gl.vertexAttribPointer(aScl, 2, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aScl, 1);
    gl.bindBuffer(gl.ARRAY_BUFFER, opacityVBO);
    var aOpa = gl.getAttribLocation(waveProg, "iOpacity");
    gl.enableVertexAttribArray(aOpa);
    gl.vertexAttribPointer(aOpa, 1, gl.FLOAT, false, 0, 0);
    gl.vertexAttribDivisor(aOpa, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE); // 官方同为 ONE、ONE 叠加混合
    gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, MAX_WAVES);
    gl.vertexAttribDivisor(aOff, 0);
    gl.vertexAttribDivisor(aScl, 0);
    gl.vertexAttribDivisor(aOpa, 0);

    // 背景帧变化时才重新上传纹理
    var f = window.__bgFrame;
    if (f !== uploadedFrame) {
      uploadedFrame = f;
      uploadBackground();
    }

    // pass 2：合成到屏幕（半透明黑板观感，SRC_ALPHA 混合）
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(compProg);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, bgTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, rtTex);
    bindQuadAttribs(compProg);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.disable(gl.BLEND);
    window.__rippleDebug.frames++;
  };
  var loop = function (now) {
    try { loopBody(now); }
    catch (e) { window.__rippleDebug.err = String((e && e.message) || e); }
  };
  raf = requestAnimationFrame(loop);
})();
