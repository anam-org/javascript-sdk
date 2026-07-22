import {
  ClientMetricMeasurement,
  sendClientMetric,
} from '../lib/ClientMetrics';
import { TransparentBackgroundOptions } from '../types/TransparentBackgroundOptions';
import {
  PACKED_ALPHA_CPU_TRANSPORT,
  PACKED_ALPHA_TRANSPORT,
  TransparentBackgroundTransport,
} from '../types/TransparentBackgroundTransport';

// Calibrated on the held-out person-matting set after the engine's JPEG q90
// and H.264 Main/I420 path. A broad transition retains fractional-alpha hair;
// the exact carrier inverse below removes the selected carrier contribution.
const DEFAULT_SIMILARITY = 0.005;
const DEFAULT_SMOOTHNESS = 0.56;
const DEFAULT_SPILL = 1.0;
// H.264/JPEG ringing leaves a very small non-zero alpha tail in otherwise
// uniform background pixels. Keeping it produces a faint grey/coloured veil
// over the page. The five-person transport holdout put the live p99.9 tail at
// ~0.012; 0.02 clears it while changing edge error by only 0.2%.
const BACKGROUND_ALPHA_FLOOR = 0.02;
const SPILL_GUARD_START_ALPHA = 0.9;
const SPILL_GUARD_END_ALPHA = 0.995;
const TELEMETRY_FRAME_INTERVAL = 250;
const LEGACY_CARRIER_SAMPLE_SIZE = 64;
const LEGACY_CARRIER_MATCH_TOLERANCE = 48;
const LEGACY_CARRIER_MAX_DETECTION_ATTEMPTS = 3;

export interface LegacyChromaCarrier {
  name: 'green' | 'blue';
  rgb: readonly [number, number, number];
  axis: readonly [number, number, number];
  matchedSamples: number;
}

const LEGACY_GREEN_CARRIER: LegacyChromaCarrier = {
  name: 'green',
  rgb: [0, 122 / 255, 51 / 255],
  axis: [0, 1, 0],
  matchedSamples: 0,
};

const LEGACY_CARRIER_CANDIDATES: readonly LegacyChromaCarrier[] = [
  LEGACY_GREEN_CARRIER,
  {
    name: 'blue',
    rgb: [0, 71 / 255, 187 / 255],
    axis: [0, 0, 1],
    matchedSamples: 0,
  },
  {
    name: 'green',
    rgb: [0, 1, 0],
    axis: [0, 1, 0],
    matchedSamples: 0,
  },
];

const VERTEX_SHADER_SOURCE = `
attribute vec2 a_position;
varying vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = (a_position + 1.0) * 0.5;
}
`;

// Key in chroma space so luminance variation introduced by H.264 does not turn
// a uniform carrier into a noisy alpha plane. Avatar creation selects green or
// blue to avoid foreground colour collisions; a one-time decoded-border sample
// chooses the corresponding uniforms. Subtracting the gamma-encoded carrier
// contribution recovers premultiplied foreground at translucent edges.
/** @internal */
export const FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform sampler2D u_frame;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;
uniform vec3 u_carrierColor;
uniform vec3 u_carrierAxis;
varying vec2 v_texCoord;

vec2 chroma(vec3 rgb) {
  float cb = -0.168736 * rgb.r - 0.331264 * rgb.g + 0.5 * rgb.b;
  float cr = 0.5 * rgb.r - 0.418688 * rgb.g - 0.081312 * rgb.b;
  return vec2(cb, cr);
}

void main() {
  vec3 rgb = texture2D(u_frame, v_texCoord).rgb;
  float chromaDistance = distance(chroma(rgb), chroma(u_carrierColor));
  float alpha = smoothstep(
    u_similarity,
    u_similarity + max(u_smoothness, 0.0001),
    chromaDistance
  );
  alpha *= step(${BACKGROUND_ALPHA_FLOOR.toFixed(3)}, alpha);

  vec3 premultiplied = clamp(
    rgb - (1.0 - alpha) * u_carrierColor,
    vec3(0.0),
    vec3(alpha)
  );
  float spillGuard = 1.0 - smoothstep(
    ${SPILL_GUARD_START_ALPHA.toFixed(3)},
    ${SPILL_GUARD_END_ALPHA.toFixed(3)},
    alpha
  );
  float carrierValue = dot(premultiplied, u_carrierAxis);
  vec3 otherChannels = premultiplied * (vec3(1.0) - u_carrierAxis);
  float carrierExcess = max(
    carrierValue - max(otherChannels.r, max(otherChannels.g, otherChannels.b)),
    0.0
  );
  premultiplied = max(
    premultiplied - u_carrierAxis * carrierExcess * u_spill * spillGuard,
    vec3(0.0)
  );

  gl_FragColor = vec4(premultiplied, alpha);
}
`;

// Both packed transports carry already-premultiplied colour in the top half
// and a grayscale alpha plane in the bottom half. V1 keys pre-JPEG in M2F; v2
// is the engine-CPU post-JPEG control. The client reconstruction is identical.
/** @internal */
export const PACKED_ALPHA_FRAGMENT_SHADER_SOURCE = `
precision mediump float;

uniform sampler2D u_frame;
varying vec2 v_texCoord;

void main() {
  vec2 colourCoord = vec2(
    v_texCoord.x,
    0.5 + v_texCoord.y * 0.5
  );
  vec2 alphaCoord = vec2(
    v_texCoord.x,
    v_texCoord.y * 0.5
  );
  vec3 premultiplied = texture2D(u_frame, colourCoord).rgb;
  vec3 alphaRgb = texture2D(u_frame, alphaCoord).rgb;
  float alpha = dot(alphaRgb, vec3(0.2126, 0.7152, 0.0722));

  // Compression can make an individual premultiplied colour channel exceed
  // alpha by a code value. Clamp only that invalid premultiplied state; do not
  // estimate, despill, or threshold the transported matte.
  gl_FragColor = vec4(min(premultiplied, vec3(alpha)), alpha);
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
  positionBuffer: WebGLBuffer;
  texture: WebGLTexture;
  legacyProgram: WebGLProgram;
  legacyPositionLocation: number;
  similarityLocation: WebGLUniformLocation;
  smoothnessLocation: WebGLUniformLocation;
  spillLocation: WebGLUniformLocation;
  carrierColorLocation: WebGLUniformLocation;
  carrierAxisLocation: WebGLUniformLocation;
  packedAlphaProgram: WebGLProgram;
  packedAlphaPositionLocation: number;
}

export type TransparentFrameMode =
  | 'green-key-v1'
  | 'packed-alpha-v1'
  | 'packed-alpha-v2'
  | 'unsupported';

export interface TransparentFrameGeometry {
  mode: TransparentFrameMode;
  canvasWidth: number;
  canvasHeight: number;
  reason?: string;
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
  private readonly transport: TransparentBackgroundTransport | undefined;
  private readonly gl: WebGLRenderingContext;
  private readonly maxTextureSize: number;
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
  private lastGeometrySignature: string | null = null;
  private legacyCarrier: LegacyChromaCarrier = LEGACY_GREEN_CARRIER;
  private legacyCarrierDetected = false;
  private legacyCarrierDetectionAttempts = 0;

  constructor(
    video: HTMLVideoElement,
    options?: TransparentBackgroundOptions,
    transport?: TransparentBackgroundTransport,
  ) {
    if (!video.parentElement) {
      this.report('initialization_failed', 1, { reason: 'missing_parent' });
      throw new Error(
        'Transparent background requires the target video element to be attached to the DOM.',
      );
    }

    this.video = video;
    this.parent = video.parentElement;
    this.keyOptions = resolveKeyOptions(options);
    this.transport = transport;
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
    this.maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
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
      requestedTransport: this.transport ?? 'green-key-v1',
      maxTextureSize: this.maxTextureSize,
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
    this.deleteGlResources(this.resources);
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
    // intrinsic bitmap is the reconstructed output plane (half the source
    // height for packed alpha), so browser object-fit/object-position applies
    // to the visible avatar rather than the vertically-stacked transport.
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
      const geometry = resolveTransparentFrameGeometry(
        this.video.videoWidth,
        this.video.videoHeight,
        this.transport,
        this.maxTextureSize,
      );
      this.applyFrameGeometry(geometry);
      if (geometry.mode === 'unsupported') return;

      if (
        this.canvas.width !== geometry.canvasWidth ||
        this.canvas.height !== geometry.canvasHeight
      ) {
        // Deliberately use source pixels, not devicePixelRatio. A DPR-scaled
        // backing canvas would add work without adding information.
        this.canvas.width = geometry.canvasWidth;
        this.canvas.height = geometry.canvasHeight;
      }

      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      const packedAlpha =
        geometry.mode === PACKED_ALPHA_TRANSPORT ||
        geometry.mode === PACKED_ALPHA_CPU_TRANSPORT;
      const program = packedAlpha
        ? this.resources.packedAlphaProgram
        : this.resources.legacyProgram;
      const positionLocation = packedAlpha
        ? this.resources.packedAlphaPositionLocation
        : this.resources.legacyPositionLocation;
      gl.useProgram(program);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.resources.positionBuffer);
      gl.enableVertexAttribArray(positionLocation);
      gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
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
      if (!packedAlpha) {
        if (!this.legacyCarrierDetected) {
          const candidate = this.detectLegacyCarrierFromVideo();
          this.legacyCarrierDetectionAttempts += 1;
          if (
            shouldFinalizeLegacyCarrierDetection(
              candidate,
              this.legacyCarrierDetectionAttempts,
            )
          ) {
            this.legacyCarrier = candidate;
            this.legacyCarrierDetected = true;
            this.report('legacy_carrier_detected', 1, {
              carrier: this.legacyCarrier.name,
              matchedSamples: this.legacyCarrier.matchedSamples,
              attempts: this.legacyCarrierDetectionAttempts,
            });
          }
        }
        gl.uniform1f(
          this.resources.similarityLocation,
          this.keyOptions.similarity,
        );
        gl.uniform1f(
          this.resources.smoothnessLocation,
          this.keyOptions.smoothness,
        );
        gl.uniform1f(this.resources.spillLocation, this.keyOptions.spill);
        gl.uniform3f(
          this.resources.carrierColorLocation,
          this.legacyCarrier.rgb[0],
          this.legacyCarrier.rgb[1],
          this.legacyCarrier.rgb[2],
        );
        gl.uniform3f(
          this.resources.carrierAxisLocation,
          this.legacyCarrier.axis[0],
          this.legacyCarrier.axis[1],
          this.legacyCarrier.axis[2],
        );
      }
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

  private detectLegacyCarrierFromVideo(): LegacyChromaCarrier {
    try {
      const sampleCanvas = document.createElement('canvas');
      sampleCanvas.width = LEGACY_CARRIER_SAMPLE_SIZE;
      sampleCanvas.height = 4;
      const context = sampleCanvas.getContext('2d', {
        willReadFrequently: true,
      });
      if (!context) return LEGACY_GREEN_CARRIER;

      const sourceWidth = this.video.videoWidth;
      const sourceHeight = this.video.videoHeight;
      const border = Math.max(
        1,
        Math.floor(Math.min(sourceWidth, sourceHeight) / 64),
      );
      context.drawImage(
        this.video,
        0,
        0,
        sourceWidth,
        border,
        0,
        0,
        LEGACY_CARRIER_SAMPLE_SIZE,
        1,
      );
      context.drawImage(
        this.video,
        0,
        sourceHeight - border,
        sourceWidth,
        border,
        0,
        1,
        LEGACY_CARRIER_SAMPLE_SIZE,
        1,
      );
      context.drawImage(
        this.video,
        0,
        0,
        border,
        sourceHeight,
        0,
        2,
        LEGACY_CARRIER_SAMPLE_SIZE,
        1,
      );
      context.drawImage(
        this.video,
        sourceWidth - border,
        0,
        border,
        sourceHeight,
        0,
        3,
        LEGACY_CARRIER_SAMPLE_SIZE,
        1,
      );
      return detectLegacyChromaCarrier(
        context.getImageData(0, 0, LEGACY_CARRIER_SAMPLE_SIZE, 4).data,
      );
    } catch {
      // WebRTC video is normally origin-clean. If a custom media source taints
      // the sampling canvas, retain the historical green fallback.
      return LEGACY_GREEN_CARRIER;
    }
  }

  private applyFrameGeometry(geometry: TransparentFrameGeometry): void {
    const signature = `${geometry.mode}:${this.video.videoWidth}x${this.video.videoHeight}`;
    if (signature === this.lastGeometrySignature) return;
    this.lastGeometrySignature = signature;

    if (geometry.mode === 'unsupported') {
      // Never hide the only usable pixels when a server or intermediary
      // delivers an unexpected geometry. If a later frame returns to a valid
      // geometry, the renderer automatically takes over again.
      this.canvas.style.opacity = '0';
      this.video.style.opacity = this.originalVideoOpacity;
      console.warn(
        `Transparent background received unsupported video geometry ${this.video.videoWidth}x${this.video.videoHeight}; showing the source video unchanged.`,
      );
      this.report('unsupported_geometry', 1, {
        width: this.video.videoWidth,
        height: this.video.videoHeight,
        reason: geometry.reason ?? 'unknown',
      });
      return;
    }

    this.canvas.style.opacity = '';
    this.video.style.opacity = '0';
    if (
      (this.transport === PACKED_ALPHA_TRANSPORT ||
        this.transport === PACKED_ALPHA_CPU_TRANSPORT) &&
      geometry.mode === 'green-key-v1'
    ) {
      console.warn(
        'Packed transparent-background transport returned a legacy chroma-carrier frame; using the adaptive compatibility keyer.',
      );
      this.report('transport_fallback', 1, {
        deliveredTransport: 'green-key-v1',
        width: this.video.videoWidth,
        height: this.video.videoHeight,
      });
    } else {
      this.report('transport_selected', 1, {
        deliveredTransport: geometry.mode,
        width: this.video.videoWidth,
        height: this.video.videoHeight,
      });
    }
  }

  private createGlResources(): GlResources {
    const gl = this.gl;
    let legacyProgram: WebGLProgram | null = null;
    let packedAlphaProgram: WebGLProgram | null = null;
    let positionBuffer: WebGLBuffer | null = null;
    let texture: WebGLTexture | null = null;

    try {
      legacyProgram = createProgram(
        gl,
        VERTEX_SHADER_SOURCE,
        FRAGMENT_SHADER_SOURCE,
      );
      packedAlphaProgram = createProgram(
        gl,
        VERTEX_SHADER_SOURCE,
        PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
      );

      positionBuffer = gl.createBuffer();
      texture = gl.createTexture();
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

      const legacyPositionLocation = gl.getAttribLocation(
        legacyProgram,
        'a_position',
      );
      const packedAlphaPositionLocation = gl.getAttribLocation(
        packedAlphaProgram,
        'a_position',
      );
      const similarityLocation = gl.getUniformLocation(
        legacyProgram,
        'u_similarity',
      );
      const smoothnessLocation = gl.getUniformLocation(
        legacyProgram,
        'u_smoothness',
      );
      const spillLocation = gl.getUniformLocation(legacyProgram, 'u_spill');
      const carrierColorLocation = gl.getUniformLocation(
        legacyProgram,
        'u_carrierColor',
      );
      const carrierAxisLocation = gl.getUniformLocation(
        legacyProgram,
        'u_carrierAxis',
      );
      if (
        legacyPositionLocation < 0 ||
        packedAlphaPositionLocation < 0 ||
        !similarityLocation ||
        !smoothnessLocation ||
        !spillLocation ||
        !carrierColorLocation ||
        !carrierAxisLocation
      ) {
        throw new Error(
          'Unable to resolve transparent renderer shader inputs.',
        );
      }

      return {
        positionBuffer,
        texture,
        legacyProgram,
        legacyPositionLocation,
        similarityLocation,
        smoothnessLocation,
        spillLocation,
        carrierColorLocation,
        carrierAxisLocation,
        packedAlphaProgram,
        packedAlphaPositionLocation,
      };
    } catch (error) {
      if (positionBuffer) gl.deleteBuffer(positionBuffer);
      if (texture) gl.deleteTexture(texture);
      if (legacyProgram) gl.deleteProgram(legacyProgram);
      if (packedAlphaProgram) gl.deleteProgram(packedAlphaProgram);
      throw error;
    }
  }

  private deleteGlResources(resources: GlResources): void {
    const gl = this.gl;
    gl.deleteBuffer(resources.positionBuffer);
    gl.deleteTexture(resources.texture);
    gl.deleteProgram(resources.legacyProgram);
    gl.deleteProgram(resources.packedAlphaProgram);
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

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
): WebGLProgram {
  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  let fragmentShader: WebGLShader | null = null;
  try {
    fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
    const program = gl.createProgram();
    if (!program) throw new Error('Unable to create WebGL program.');
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) ?? 'unknown link error';
      gl.deleteProgram(program);
      throw new Error(`Unable to link transparent renderer: ${message}`);
    }
    return program;
  } finally {
    gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
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

/**
 * Resolve the decoded frame layout before uploading it to WebGL. Packed
 * frames are 3:4 because two 3:2 planes are stacked vertically; legacy Cara 4
 * frames are 3:2. Ratio-based matching also permits a decoder to deliver a
 * proportionally downscaled frame without silently sampling the wrong plane.
 *
 * @internal
 */
export function resolveTransparentFrameGeometry(
  width: number,
  height: number,
  transport: TransparentBackgroundTransport | undefined,
  maxTextureSize = 2048,
): TransparentFrameGeometry {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return {
      mode: 'unsupported',
      canvasWidth: 0,
      canvasHeight: 0,
      reason: 'invalid_dimensions',
    };
  }
  if (width > maxTextureSize || height > maxTextureSize) {
    return {
      mode: 'unsupported',
      canvasWidth: width,
      canvasHeight: height,
      reason: 'exceeds_webgl_texture_limit',
    };
  }

  if (
    transport !== PACKED_ALPHA_TRANSPORT &&
    transport !== PACKED_ALPHA_CPU_TRANSPORT
  ) {
    return {
      mode: 'green-key-v1',
      canvasWidth: width,
      canvasHeight: height,
    };
  }

  if (height % 2 === 0 && height * 3 === width * 4) {
    return {
      mode: transport,
      canvasWidth: width,
      canvasHeight: height / 2,
    };
  }
  if (width * 2 === height * 3) {
    return {
      mode: 'green-key-v1',
      canvasWidth: width,
      canvasHeight: height,
    };
  }

  return {
    mode: 'unsupported',
    canvasWidth: width,
    canvasHeight: height,
    reason: 'unexpected_packed_alpha_aspect_ratio',
  };
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
 * Pick one legacy carrier from a small decoded border sample. The server-side
 * packed path never calls this; it exists only for the compatibility keyer
 * used when packed H.264 support cannot be confirmed on a device.
 *
 * @internal
 */
export function detectLegacyChromaCarrier(
  rgbaSamples: ArrayLike<number>,
): LegacyChromaCarrier {
  if (rgbaSamples.length < 4) return { ...LEGACY_GREEN_CARRIER };

  let winner = LEGACY_GREEN_CARRIER;
  let winnerMatches = 0;
  let winnerMatchedDistance = Number.POSITIVE_INFINITY;
  for (const candidate of LEGACY_CARRIER_CANDIDATES) {
    const carrierBytes = candidate.rgb.map((channel) => channel * 255);
    let matches = 0;
    let matchedDistance = 0;
    for (let offset = 0; offset + 2 < rgbaSamples.length; offset += 4) {
      const redDelta = Math.abs(rgbaSamples[offset] - carrierBytes[0]);
      const greenDelta = Math.abs(rgbaSamples[offset + 1] - carrierBytes[1]);
      const blueDelta = Math.abs(rgbaSamples[offset + 2] - carrierBytes[2]);
      if (
        Math.max(redDelta, greenDelta, blueDelta) <=
        LEGACY_CARRIER_MATCH_TOLERANCE
      ) {
        matches += 1;
        matchedDistance +=
          redDelta * redDelta + greenDelta * greenDelta + blueDelta * blueDelta;
      }
    }
    if (
      matches > winnerMatches ||
      (matches === winnerMatches &&
        matches > 0 &&
        matchedDistance < winnerMatchedDistance)
    ) {
      winner = candidate;
      winnerMatches = matches;
      winnerMatchedDistance = matchedDistance;
    }
  }

  return {
    ...winner,
    matchedSamples: winnerMatches,
  };
}

/** @internal */
export function shouldFinalizeLegacyCarrierDetection(
  carrier: LegacyChromaCarrier,
  attempts: number,
): boolean {
  return (
    carrier.matchedSamples > 0 ||
    attempts >= LEGACY_CARRIER_MAX_DETECTION_ATTEMPTS
  );
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
  carrierRgb: readonly [number, number, number] = [0, 1, 0],
): [number, number, number] {
  const unclippedAlpha = clampUnit(alphaValue);
  const alpha = unclippedAlpha < BACKGROUND_ALPHA_FLOOR ? 0 : unclippedAlpha;
  const spill = clampUnit(spillValue);
  const premultiplied: [number, number, number] = [
    Math.min(alpha, Math.max(0, rgb[0] - (1 - alpha) * carrierRgb[0])),
    Math.min(alpha, Math.max(0, rgb[1] - (1 - alpha) * carrierRgb[1])),
    Math.min(alpha, Math.max(0, rgb[2] - (1 - alpha) * carrierRgb[2])),
  ];
  const spillGuard =
    1 - smoothstep(SPILL_GUARD_START_ALPHA, SPILL_GUARD_END_ALPHA, alpha);
  const carrierChannel =
    carrierRgb[2] > carrierRgb[1] && carrierRgb[2] > carrierRgb[0]
      ? 2
      : carrierRgb[1] > carrierRgb[0]
        ? 1
        : 0;
  const otherChannels = [0, 1, 2].filter(
    (channel) => channel !== carrierChannel,
  );
  const carrierExcess = Math.max(
    premultiplied[carrierChannel] -
      Math.max(
        premultiplied[otherChannels[0]],
        premultiplied[otherChannels[1]],
      ),
    0,
  );
  premultiplied[carrierChannel] = Math.max(
    premultiplied[carrierChannel] - carrierExcess * spill * spillGuard,
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
