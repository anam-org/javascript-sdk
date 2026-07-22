const assert = require('assert');
const { setClientMetricsDisabled } = require('../dist/main/lib/ClientMetrics');
const {
  resolveTransparentFrameGeometry,
  TransparentBackgroundRenderer,
} = require('../dist/main/modules/TransparentBackgroundRenderer');
const {
  PACKED_ALPHA_CPU_TRANSPORT,
  PACKED_ALPHA_TRANSPORT,
} = require('../dist/main/types/TransparentBackgroundTransport');

setClientMetricsDisabled(true);

const createWebGlStub = (deletedResources) => ({
  VERTEX_SHADER: 1,
  FRAGMENT_SHADER: 2,
  COMPILE_STATUS: 3,
  LINK_STATUS: 4,
  ARRAY_BUFFER: 5,
  STATIC_DRAW: 6,
  TEXTURE_2D: 7,
  TEXTURE_MIN_FILTER: 8,
  TEXTURE_MAG_FILTER: 9,
  LINEAR: 10,
  TEXTURE_WRAP_S: 11,
  TEXTURE_WRAP_T: 12,
  CLAMP_TO_EDGE: 13,
  MAX_TEXTURE_SIZE: 14,
  createShader: () => ({}),
  shaderSource: () => {},
  compileShader: () => {},
  getShaderParameter: () => true,
  getShaderInfoLog: () => '',
  deleteShader: () => {},
  createProgram: () => ({}),
  attachShader: () => {},
  linkProgram: () => {},
  getProgramParameter: () => true,
  getProgramInfoLog: () => '',
  deleteProgram: (program) => deletedResources.programs.push(program),
  createBuffer: () => ({}),
  createTexture: () => ({}),
  deleteBuffer: (buffer) => deletedResources.buffers.push(buffer),
  deleteTexture: (texture) => deletedResources.textures.push(texture),
  bindBuffer: () => {},
  bufferData: () => {},
  bindTexture: () => {},
  texParameteri: () => {},
  getAttribLocation: () => 0,
  getUniformLocation: () => ({}),
  getParameter: () => 2048,
});

const createRendererHarness = ({ objectFit, objectPosition }) => {
  const deletedResources = { programs: [], buffers: [], textures: [] };
  const parent = {
    style: { position: '' },
  };
  const canvas = {
    style: {},
    dataset: {},
    id: '',
    setAttribute: () => {},
    getContext: () => createWebGlStub(deletedResources),
    addEventListener: () => {},
    removeEventListener: () => {},
    remove: () => {},
  };
  const video = {
    parentElement: parent,
    id: 'persona-video',
    style: { opacity: '' },
    offsetLeft: 13,
    offsetTop: 17,
    offsetWidth: 100,
    offsetHeight: 100,
    videoWidth: 200,
    videoHeight: 100,
    insertAdjacentElement: (position, element) => {
      assert.equal(position, 'afterend');
      assert.equal(element, canvas);
    },
  };

  global.document = {
    createElement: (tagName) => {
      assert.equal(tagName, 'canvas');
      return canvas;
    },
  };
  global.window = {
    getComputedStyle: (element) =>
      element === parent
        ? { position: 'relative', overflow: 'visible' }
        : {
            objectFit,
            objectPosition,
            borderRadius: '12px',
            clipPath: 'none',
            transform: 'none',
            transformOrigin: '50% 50%',
            zIndex: 'auto',
          },
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  global.ResizeObserver = class {
    observe() {}
    disconnect() {}
  };

  const renderer = new TransparentBackgroundRenderer(video);
  return { canvas, deletedResources, renderer };
};

const cover = createRendererHarness({
  objectFit: 'cover',
  objectPosition: '50% 50%',
});
assert.deepEqual(
  {
    left: cover.canvas.style.left,
    top: cover.canvas.style.top,
    width: cover.canvas.style.width,
    height: cover.canvas.style.height,
    objectFit: cover.canvas.style.objectFit,
    objectPosition: cover.canvas.style.objectPosition,
  },
  {
    left: '13px',
    top: '17px',
    width: '100px',
    height: '100px',
    objectFit: 'cover',
    objectPosition: '50% 50%',
  },
  'cover must stay inside the video element box even when the parent overflow is visible',
);
cover.renderer.destroy();
cover.renderer.destroy();
assert.deepEqual(
  {
    programs: cover.deletedResources.programs.length,
    buffers: cover.deletedResources.buffers.length,
    textures: cover.deletedResources.textures.length,
  },
  { programs: 2, buffers: 1, textures: 1 },
  'destroy must release each shader program, buffer, and texture exactly once',
);

assert.deepEqual(
  resolveTransparentFrameGeometry(1152, 1536, PACKED_ALPHA_TRANSPORT, 2048),
  {
    mode: 'packed-alpha-v1',
    canvasWidth: 1152,
    canvasHeight: 768,
  },
  'packed Cara 4 frames must expose a 1152x768 canvas',
);
assert.deepEqual(
  resolveTransparentFrameGeometry(576, 768, PACKED_ALPHA_TRANSPORT, 2048),
  {
    mode: 'packed-alpha-v1',
    canvasWidth: 576,
    canvasHeight: 384,
  },
  'proportionally downscaled packed frames must preserve the two-plane layout',
);
assert.deepEqual(
  resolveTransparentFrameGeometry(1152, 1536, PACKED_ALPHA_CPU_TRANSPORT, 2048),
  {
    mode: 'packed-alpha-v2',
    canvasWidth: 1152,
    canvasHeight: 768,
  },
  'the engine-CPU control must use the same premultiplied two-plane geometry',
);
assert.deepEqual(
  resolveTransparentFrameGeometry(1152, 768, PACKED_ALPHA_TRANSPORT, 2048),
  {
    mode: 'green-key-v1',
    canvasWidth: 1152,
    canvasHeight: 768,
  },
  'a standard Cara 4 frame must select the legacy keyer compatibility path',
);
assert.equal(
  resolveTransparentFrameGeometry(1280, 720, PACKED_ALPHA_TRANSPORT, 2048).mode,
  'unsupported',
  'unexpected packed transport geometry must not be sampled as two planes',
);
assert.equal(
  resolveTransparentFrameGeometry(1152, 1536, PACKED_ALPHA_TRANSPORT, 1024)
    .reason,
  'exceeds_webgl_texture_limit',
  'the runtime WebGL texture limit must be enforced',
);

for (const objectPosition of [
  '10px 20px',
  'calc(100% - 12px) calc(50% + 4px)',
  'right 10px bottom 20px',
]) {
  const harness = createRendererHarness({
    objectFit: 'contain',
    objectPosition,
  });
  assert.equal(
    harness.canvas.style.objectPosition,
    objectPosition,
    `object-position must be delegated to CSS without rewriting ${objectPosition}`,
  );
  harness.renderer.destroy();
}

console.log('transparent background geometry harness passed');
