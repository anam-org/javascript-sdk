import {
  ClientMetricMeasurement,
  sendClientMetric,
} from '../lib/ClientMetrics';
import { TransparentBackgroundOptions } from '../types/TransparentBackgroundOptions';

// Calibrated on the held-out person-matting set after the engine's JPEG q90
// and H.264 Main/I420 path. A broad transition retains fractional-alpha hair;
// the exact carrier inverse below removes the green contribution from it.
const DEFAULT_SIMILARITY = 0.005;
const DEFAULT_SMOOTHNESS = 0.56;
const DEFAULT_SPILL = 1.0;
const SPILL_GUARD_START_ALPHA = 0.9;
const SPILL_GUARD_END_ALPHA = 0.995;
const TELEMETRY_FRAME_INTERVAL = 250;

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = (a_position + 1.0) * 0.5;
}
`;

// Key in chroma space so luminance variation introduced by H.264 does not
// turn a uniformly-green background into a noisy alpha plane. The source
// asset is composited over green directly in gamma-encoded sRGB, so subtracting
// the estimated green contribution recovers premultiplied foreground. Merely
// multiplying the carrier RGB by alpha would retain that green contribution
// and produce a bright fringe at translucent edges.
/** @internal */
export const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform sampler2D u_frame;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;
varying vec2 v_texCoord;

vec2 chroma(vec3 rgb) {
  float cb = -0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b;
  float cr = 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;
  return vec2(cb, cr);
}

void main() {
  vec3 rgb = texture2D(u_frame, v_texCoord).rgb;
  vec2 greenChroma = chroma(vec3(0.0, 1.0, 0.0));
  float chromaDistance = distance(chroma(rgb), greenChroma);
  float alpha = smoothstep(
    u_similarity,
    u_similarity + max(u_smoothness, 0.0001),
    chromaDistance
  );

  vec3 premultiplied = clamp(
    rgb - (1.0 - alpha) * vec3(0.0, 1.0, 0.0),
    vec3(0.0),
    vec3(alpha)
  );
  float spillGuard = 1.0 - smoothstep(
    ${SPILL_GUARD_START_ALPHA.toFixed(3)},
    ${SPILL_GUARD_END_ALPHA.toFixed(3)},
    alpha
  );
  float greenExcess = max(
    premultiplied.g - max(premultiplied.r, premultiplied.b),
    0.0
  );
  premultiplied.g = max(
    premultiplied.g - greenExcess * u_spill * spillGuard,
    0.0
  );

  gl_FragColor = vec4(premultiplied, alpha);
}
`;

type OptionalVideoFrameCallbacks = {
  requestVideoFrameCallback?: (
    callback: (now: DOMHighResTimeStamp) => void,
  ) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

interface ResolvedKeyOptions {
  similarity: number;
  smoothness: number;
  spill: number;
}

interface GlResources {
  program: WebGLProgram;
  positionBuffer: WebGLBuffer;
  texture: WebGLTexture;
  positionLocation: number;
  similarityLocation: WebGLUniformLocation;
  smoothnessLocation: WebGLUniformLocation;
  spillLocation: WebGLUniformLocation;
}

export interface TransparentRendererDiagnostics {
  framesRendered: number;
  averageSubmissionMs: number;
  maxSubmissionMs: number;
}

export class TransparentBackgroundRenderer {
  private readonly video: HTMLVideoElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly parent: HTMLElement;
  private readonly keyOptions: ResolvedKeyOptions;
  private readonly gl: WebGLRenderingContext;
  private resources: GlResources;
  private resizeObserver: ResizeObserver | null = null;
  private videoFrameCallbackHandle: number | null = null;
  private animationFrameHandle: number | null = null;
  private destroyed = false;
  private started = false;
  private contextLost = false;
  private renderErrorReported = false;
  private frameCount = 0;
  private submissionTimeTotalMs = 0;
  private submissionTimeMaxMs = 0;
  private readonly originalVideoOpacity: string;
  private readonly originalParentPosition: string;
  private changedParentPosition = false;

  constructor(video: HTMLVideoElement, options?: TransparentBackgroundOptions) {
    if (!video.parentElement) {
      this.report('initialization_failed', 1, { reason: 'missing_parent' });
      throw new Error(
        'Transparent background requires the target video element to be attached to the DOM.',
      );
    }

    this.video = video;
    this.parent = video.parentElement;
    this.keyOptions = resolveKeyOptions(options);
    this.originalVideoOpacity = video.style.opacity;
    this.originalParentPosition = this.parent.style.position;

    this.canvas = document.createElement('canvas');
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.dataset.anamTransparentBackground = 'true';
    if (video.id) {
      this.canvas.id = `${video.id}--anam-transparent`;
    }

    const gl = this.canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
    });
    if (!gl) {
      this.report('initialization_failed', 1, {
        reason: 'webgl_unavailable',
      });
      throw new Error(
        'Transparent background is unavailable because WebGL could not be initialized on this device.',
      );
    }
    this.gl = gl;
    this.resources = this.createGlResources();

    this.onContextLost = this.onContextLost.bind(this);
    this.onContextRestored = this.onContextRestored.bind(this);
    this.syncOverlayGeometry = this.syncOverlayGeometry.bind(this);
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    );

    this.installOverlay();
    this.report('initialized', 1, {
      renderer: 'webgl1',
      scheduling: getFrameCallbackApi(this.video).requestVideoFrameCallback
        ? 'rvfc'
        : 'raf',
    });
  }

  public start(): void {
    if (this.destroyed || this.started) return;
    this.started = true;
    this.scheduleNextFrame();
  }

  public getCanvas(): HTMLCanvasElement {
    return this.canvas;
  }

  public getDiagnostics(): TransparentRendererDiagnostics {
    return {
      framesRendered: this.frameCount,
      averageSubmissionMs:
        this.frameCount === 0
          ? 0
          : roundMetric(this.submissionTimeTotalMs / this.frameCount),
      maxSubmissionMs: roundMetric(this.submissionTimeMaxMs),
    };
  }

  public destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;

    const frameCallbackApi = getFrameCallbackApi(this.video);
    if (
      this.videoFrameCallbackHandle !== null &&
      frameCallbackApi.cancelVideoFrameCallback
    ) {
      frameCallbackApi.cancelVideoFrameCallback(this.videoFrameCallbackHandle);
    }
    if (this.animationFrameHandle !== null) {
      cancelAnimationFrame(this.animationFrameHandle);
    }
    this.videoFrameCallbackHandle = null;
    this.animationFrameHandle = null;

    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener('resize', this.syncOverlayGeometry);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener(
      'webglcontextrestored',
      this.onContextRestored,
    );
    this.canvas.remove();
    this.video.style.opacity = this.originalVideoOpacity;
    if (
      this.changedParentPosition &&
      this.parent.style.position === 'relative'
    ) {
      this.parent.style.position = this.originalParentPosition;
    }

    if (this.frameCount > 0) {
      this.report(
        'renderer_summary',
        this.submissionTimeTotalMs / this.frameCount,
        {
          frames: this.frameCount,
          maxSubmissionMs: roundMetric(this.submissionTimeMaxMs),
        },
      );
    }
  }

  private installOverlay(): void {
    const parentStyle = window.getComputedStyle(this.parent);
    if (parentStyle.position === 'static') {
      this.parent.style.position = 'relative';
      this.changedParentPosition = true;
    }

    Object.assign(this.canvas.style, {
      position: 'absolute',
      pointerEvents: 'none',
      background: 'transparent',
    });
    // Keep the canvas immediately above the source video in DOM paint order.
    // Appending it to the parent would put it above later sibling UI (for
    // example call controls) unless every overlay supplied an explicit z-index.
    this.video.insertAdjacentElement('afterend', this.canvas);
    this.syncOverlayGeometry();

    // Opacity keeps the source element active for media playback and iOS
    // frame delivery while the transparent canvas supplies the visible pixels.
    this.video.style.opacity = '0';

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(this.syncOverlayGeometry);
      this.resizeObserver.observe(this.video);
      this.resizeObserver.observe(this.parent);
    } else {
      window.addEventListener('resize', this.syncOverlayGeometry);
    }
  }

  private syncOverlayGeometry(): void {
    if (this.destroyed) return;
    const computedVideoStyle = window.getComputedStyle(this.video);

    // Keep the canvas's replaced-element box exactly on the video box. Its
    // intrinsic bitmap remains videoWidth x videoHeight, so the browser can
    // apply the same object-fit/object-position algorithm to both elements.
    // Replaced content is clipped to its own content box, which prevents
    // `cover` pixels escaping when the parent has visible overflow. Delegating
    // positioning to CSS also preserves the full <position> grammar (lengths,
    // edge offsets, and calc()), rather than approximating it in JavaScript.
    Object.assign(this.canvas.style, {
      left: `${this.video.offsetLeft}px`,
      top: `${this.video.offsetTop}px`,
      width: `${this.video.offsetWidth}px`,
      height: `${this.video.offsetHeight}px`,
      objectFit: computedVideoStyle.objectFit,
      objectPosition: computedVideoStyle.objectPosition,
      borderRadius: computedVideoStyle.borderRadius,
      clipPath: computedVideoStyle.clipPath,
      transform: computedVideoStyle.transform,
      transformOrigin: computedVideoStyle.transformOrigin,
      zIndex: computedVideoStyle.zIndex,
    });
  }

  private scheduleNextFrame(): void {
    if (this.destroyed) return;

    const frameCallbackApi = getFrameCallbackApi(this.video);
    if (frameCallbackApi.requestVideoFrameCallback) {
      this.videoFrameCallbackHandle =
        frameCallbackApi.requestVideoFrameCallback(() => {
          this.videoFrameCallbackHandle = null;
          this.drawFrame();
          this.scheduleNextFrame();
        });
      return;
    }

    this.animationFrameHandle = requestAnimationFrame(() => {
      this.animationFrameHandle = null;
      this.drawFrame();
      this.scheduleNextFrame();
    });
  }

  private drawFrame(): void {
    if (
      this.destroyed ||
      this.contextLost ||
      this.video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      this.video.videoWidth === 0 ||
      this.video.videoHeight === 0
    ) {
      return;
    }

    const startedAt = performance.now();
    const gl = this.gl;
    try {
      if (
        this.canvas.width !== this.video.videoWidth ||
        this.canvas.height !== this.video.videoHeight
      ) {
        // Deliberately use source pixels, not devicePixelRatio. A DPR-scaled
        // backing canvas would add work without adding information.
        this.canvas.width = this.video.videoWidth;
        this.canvas.height = this.video.videoHeight;
      }

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.resources.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.positionBuffer);
      gl.enableVertexAttribArray(this.resources.positionLocation);
      gl.vertexAttribPointer(
        this.resources.positionLocation,
        2,
        gl.FLOAT,
        false,
        0,
        0,
      );
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.resources.texture);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        this.video,
      );
      gl.uniform1f(
        this.resources.similarityLocation,
        this.keyOptions.similarity,
      );
      gl.uniform1f(
        this.resources.smoothnessLocation,
        this.keyOptions.smoothness,
      );
      gl.uniform1f(this.resources.spillLocation, this.keyOptions.spill);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    } catch (error) {
      if (!this.renderErrorReported) {
        this.renderErrorReported = true;
        console.warn(
          'Transparent background renderer failed to process a frame.',
          error,
        );
        this.report('render_error', 1, {
          reason: error instanceof Error ? error.name : 'unknown',
        });
      }
      return;
    }

    const submissionMs = performance.now() - startedAt;
    this.frameCount += 1;
    this.submissionTimeTotalMs += submissionMs;
    this.submissionTimeMaxMs = Math.max(this.submissionTimeMaxMs, submissionMs);
    if (this.frameCount === 1) {
      this.report('first_frame', submissionMs);
    } else if (this.frameCount % TELEMETRY_FRAME_INTERVAL === 0) {
      this.report(
        'submission_sample',
        this.submissionTimeTotalMs / this.frameCount,
        {
          frames: this.frameCount,
          maxSubmissionMs: roundMetric(this.submissionTimeMaxMs),
        },
      );
    }
  }

  private createGlResources(): GlResources {
    const gl = this.gl;
    const vertexShader = compileShader(
      gl,
      gl.VERTEX_SHADER,
      VERTEX_SHADER_SOURCE,
    );
    const fragmentShader = compileShader(
      gl,
      gl.FRAGMENT_SHADER,
      FRAGMENT_SHADER_SOURCE,
    );
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to create WebGL program.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`Unable to link transparent renderer: ${message}`);
    }

    const positionBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    if (!positionBuffer || !texture) {
      throw new Error('Unable to allocate transparent renderer resources.');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const positionLocation = gl.getAttribLocation(program, 'a_position');
    const similarityLocation = gl.getUniformLocation(program, 'u_similarity');
    const smoothnessLocation = gl.getUniformLocation(program, 'u_smoothness');
    const spillLocation = gl.getUniformLocation(program, 'u_spill');
    if (
      positionLocation < 0 ||
      !similarityLocation ||
      !smoothnessLocation ||
      !spillLocation
    ) {
      throw new Error('Unable to resolve transparent renderer shader inputs.');
    }

    return {
      program,
      positionBuffer,
      texture,
      positionLocation,
      similarityLocation,
      smoothnessLocation,
      spillLocation,
    };
  }

  private onContextLost(event: Event): void {
    event.preventDefault();
    this.contextLost = true;
    this.report('context_lost', 1);
  }

  private onContextRestored(): void {
    try {
      this.resources = this.createGlResources();
      this.contextLost = false;
      this.renderErrorReported = false;
      this.report('context_restored', 1);
    } catch (error) {
      console.warn(
        'Transparent background WebGL context did not restore.',
        error,
      );
      this.report('context_restore_failed', 1);
    }
  }

  private report(
    event: string,
    value: number,
    tags: Record<string, string | number> = {},
  ): void {
    void sendClientMetric(
      ClientMetricMeasurement.CLIENT_METRIC_MEASUREMENT_TRANSPARENT_RENDERER,
      roundMetric(value),
      { event, ...tags },
    );
  }
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Unable to create WebGL shader.');
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) ?? 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`Unable to compile transparent renderer: ${message}`);
  }
  return shader;
}

/** @internal */
export function resolveKeyOptions(
  options?: TransparentBackgroundOptions,
): ResolvedKeyOptions {
  return {
    similarity: clampUnit(options?.similarity ?? DEFAULT_SIMILARITY),
    smoothness: clampUnit(options?.smoothness ?? DEFAULT_SMOOTHNESS),
    spill: clampUnit(options?.spill ?? DEFAULT_SPILL),
  };
}

/**
 * CPU reference for the fragment shader's carrier inversion. Kept alongside
 * the shader so focused tests can verify edge cases without a GPU dependency.
 *
 * @internal
 */
export function reconstructPremultipliedForeground(
  rgb: readonly [number, number, number],
  alphaValue: number,
  spillValue = DEFAULT_SPILL,
): [number, number, number] {
  const alpha = clampUnit(alphaValue);
  const spill = clampUnit(spillValue);
  const premultiplied: [number, number, number] = [
    Math.min(alpha, Math.max(0, rgb[0])),
    Math.min(alpha, Math.max(0, rgb[1] - (1 - alpha))),
    Math.min(alpha, Math.max(0, rgb[2])),
  ];
  const spillGuard =
    1 - smoothstep(SPILL_GUARD_START_ALPHA, SPILL_GUARD_END_ALPHA, alpha);
  const greenExcess = Math.max(
    premultiplied[1] - Math.max(premultiplied[0], premultiplied[2]),
    0,
  );
  premultiplied[1] = Math.max(
    premultiplied[1] - greenExcess * spill * spillGuard,
    0,
  );
  return premultiplied;
}

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = clampUnit((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function roundMetric(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function getFrameCallbackApi(
  video: HTMLVideoElement,
): OptionalVideoFrameCallbacks {
  // Older WebViews can lack rVFC even though it is present in the current DOM
  // TypeScript definitions, so runtime detection is still required.
  return video as unknown as OptionalVideoFrameCallbacks;
}
