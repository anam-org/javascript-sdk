const assert = require('assert');
const {
  FRAGMENT_SHADER_SOURCE,
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  PACKED_STRAIGHT_ALPHA_FRAGMENT_SHADER_SOURCE,
  reconstructPremultipliedForeground,
  resolveKeyOptions,
} = require('../dist/main/modules/TransparentBackgroundRenderer');

const closeTo = (actual, expected, message, epsilon = 1e-7) => {
  assert.equal(actual.length, expected.length, message);
  actual.forEach((value, index) => {
    assert.ok(
      Math.abs(value - expected[index]) <= epsilon,
      `${message}: channel ${index} expected ${expected[index]}, got ${value}`,
    );
  });
};

assert.deepEqual(
  resolveKeyOptions(),
  { similarity: 0.005, smoothness: 0.56, spill: 1 },
  'calibrated defaults must remain explicit and covered by regression tests',
);
assert.deepEqual(
  resolveKeyOptions({ similarity: 0.1, smoothness: 0.2, spill: 0 }),
  { similarity: 0.1, smoothness: 0.2, spill: 0 },
  'all public key controls must remain configurable, including inverse-only spill=0',
);

closeTo(
  reconstructPremultipliedForeground([0, 1, 0], 0),
  [0, 0, 0],
  'fully transparent exact green must reconstruct to transparent black',
);

closeTo(
  reconstructPremultipliedForeground([0.01, 0.99, 0.01], 0.019),
  [0, 0, 0],
  'sub-threshold codec noise must become fully transparent',
);

const blonde = [0.8, 0.7, 0.55];
const blondeAlpha = 0.5;
const blondeCarrier = [
  blondeAlpha * blonde[0],
  blondeAlpha * blonde[1] + (1 - blondeAlpha),
  blondeAlpha * blonde[2],
];
closeTo(
  reconstructPremultipliedForeground(blondeCarrier, blondeAlpha),
  blonde.map((channel) => channel * blondeAlpha),
  'fractional blonde-like sRGB carrier must recover its premultiplied foreground',
);

closeTo(
  reconstructPremultipliedForeground([0.2, 0.3, 0.4], 1),
  [0.2, 0.3, 0.4],
  'opaque ordinary colour must stay unchanged',
);
closeTo(
  reconstructPremultipliedForeground([0.05, 0.9, 0.08], 1),
  [0.05, 0.9, 0.08],
  'opaque genuine green must stay unchanged',
);

const guardEndAlpha = 0.995;
const nearOpaqueGreen = [0.05, 0.9, 0.08];
const nearOpaqueGreenCarrier = [
  guardEndAlpha * nearOpaqueGreen[0],
  guardEndAlpha * nearOpaqueGreen[1] + (1 - guardEndAlpha),
  guardEndAlpha * nearOpaqueGreen[2],
];
closeTo(
  reconstructPremultipliedForeground(nearOpaqueGreenCarrier, guardEndAlpha),
  nearOpaqueGreen.map((channel) => channel * guardEndAlpha),
  'green-spill clamp must be fully faded out by alpha 0.995',
);

const greenForeground = [0.1, 0.9, 0.1];
const greenAlpha = 0.5;
const greenCarrier = [
  greenAlpha * greenForeground[0],
  greenAlpha * greenForeground[1] + (1 - greenAlpha),
  greenAlpha * greenForeground[2],
];
closeTo(
  reconstructPremultipliedForeground(greenCarrier, greenAlpha, 0),
  greenForeground.map((channel) => channel * greenAlpha),
  'spill=0 must perform only the exact carrier inverse',
);
closeTo(
  reconstructPremultipliedForeground(greenCarrier, greenAlpha, 1),
  [0.05, 0.05, 0.05],
  'spill=1 must apply the full guarded green-excess clamp at low alpha',
);

for (const { rgb, alpha, spill } of [
  { rgb: [-0.2, 1.4, 0.7], alpha: 0.3, spill: 0 },
  { rgb: [0.8, 0.1, 1.2], alpha: 0.6, spill: 1 },
  { rgb: [0.5, 0.9, 0.2], alpha: 0.95, spill: 0.5 },
]) {
  const reconstructed = reconstructPremultipliedForeground(rgb, alpha, spill);
  reconstructed.forEach((channel) => {
    assert.ok(channel >= 0, 'premultiplied channels must not be negative');
    assert.ok(
      channel <= alpha + 1e-7,
      'premultiplied channels must not exceed alpha',
    );
  });
}

assert.match(
  FRAGMENT_SHADER_SOURCE,
  /rgb - \(1\.0 - alpha\) \* vec3\(0\.0, 1\.0, 0\.0\)/,
  'shader must invert the gamma-encoded green carrier',
);
assert.match(
  FRAGMENT_SHADER_SOURCE,
  /gl_FragColor = vec4\(premultiplied, alpha\)/,
  'shader must submit already-premultiplied RGB',
);
assert.match(
  FRAGMENT_SHADER_SOURCE,
  /alpha \*= step\(0\.020, alpha\)/,
  'shader must clear the measured codec-noise alpha tail',
);
assert.doesNotMatch(
  FRAGMENT_SHADER_SOURCE,
  /gl_FragColor = vec4\(rgb \* alpha, alpha\)/,
  'shader must not multiply the green carrier by alpha',
);

assert.match(
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  /0\.5 \+ v_texCoord\.y \* 0\.5/,
  'packed renderer must sample colour from the top half',
);
assert.match(
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  /v_texCoord\.y \* 0\.5/,
  'packed renderer must sample alpha from the bottom half',
);
assert.match(
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  /gl_FragColor = vec4\(min\(premultiplied, vec3\(alpha\)\), alpha\)/,
  'packed renderer must submit the transported premultiplied colour and alpha',
);
assert.doesNotMatch(
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  /u_similarity|u_smoothness|u_spill|chroma\(/,
  'packed renderer must not run the legacy key or despill operations',
);
assert.doesNotMatch(
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  /alpha\s*\*=\s*step|smoothstep\(/,
  'packed renderer must not threshold or reshape transported alpha',
);

assert.match(
  PACKED_STRAIGHT_ALPHA_FRAGMENT_SHADER_SOURCE,
  /vec3 premultiplied = straight \* alpha/,
  'v2 must premultiply its padded straight colour by the explicit alpha in the client',
);
assert.match(
  PACKED_STRAIGHT_ALPHA_FRAGMENT_SHADER_SOURCE,
  /gl_FragColor = vec4\(min\(premultiplied, vec3\(alpha\)\), alpha\)/,
  'v2 must submit valid premultiplied canvas colour',
);
assert.doesNotMatch(
  PACKED_STRAIGHT_ALPHA_FRAGMENT_SHADER_SOURCE,
  /u_similarity|u_smoothness|u_spill|chroma\(/,
  'v2 must not re-key or despill its explicit server matte',
);

console.log('transparent background reconstruction harness passed');
