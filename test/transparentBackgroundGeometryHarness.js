const assert = require('assert');
const { setClientMetricsDisabled } = require('../dist/main/lib/ClientMetrics');
const {
  TransparentBackgroundRenderer,
} = require('../dist/main/modules/TransparentBackgroundRenderer');

setClientMetricsDisabled(true);

const createWebGlStub = () => ({
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
  deleteProgram: () => {},
  createBuffer: () => ({}),
  createTexture: () => ({}),
  bindBuffer: () => {},
  bufferData: () => {},
  bindTexture: () => {},
  texParameteri: () => {},
  getAttribLocation: () => 0,
  getUniformLocation: () => ({}),
});

const createRendererHarness = ({ objectFit, objectPosition }) => {
  const parent = {
    style: { position: '' },
  };
  const canvas = {
    style: {},
    dataset: {},
    id: '',
    setAttribute: () => {},
    getContext: () => createWebGlStub(),
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
  return { canvas, renderer };
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
