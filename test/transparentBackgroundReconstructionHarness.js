const assert = require('assert');
const {
  FRAGMENT_SHADER_SOURCE,
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  detectLegacyChromaCarrier,
  reconstructPremultipliedForeground,
  resolveKeyOptions,
  shouldFinalizeLegacyCarrierDetection,
} = require('../dist/main/modules/TransparentBackgroundRenderer');

const rgba = (pixels) => pixels.flatMap((pixel) => [...pixel, 255]);

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

const detectedGreen = detectLegacyChromaCarrier(
  rgba([
    [2, 120, 53],
    [0, 122, 51],
    [4, 124, 50],
    [210, 170, 130],
  ]),
);
assert.equal(detectedGreen.name, 'green');
closeTo(
  detectedGreen.rgb,
  [0, 122 / 255, 51 / 255],
  'decoded dark-green border must select the deployed green carrier',
);
assert.equal(detectedGreen.matchedSamples, 3);

const detectedBlue = detectLegacyChromaCarrier(
  rgba([
    [1, 72, 185],
    [0, 71, 187],
    [3, 69, 190],
    [0, 220, 40],
  ]),
);
assert.equal(detectedBlue.name, 'blue');
closeTo(
  detectedBlue.axis,
  [0, 0, 1],
  'decoded blue border must select only the blue key channel',
);
assert.equal(detectedBlue.matchedSamples, 3);

const legacyBrightGreen = detectLegacyChromaCarrier(
  rgba([
    [0, 253, 1],
    [2, 255, 0],
  ]),
);
closeTo(
  legacyBrightGreen.rgb,
  [0, 1, 0],
  'legacy pure-green avatars must retain their original key colour',
);

const unmatchedCarrier = detectLegacyChromaCarrier(
  rgba([
    [32, 128, 224],
    [180, 120, 90],
  ]),
);
assert.equal(unmatchedCarrier.name, 'green');
assert.equal(unmatchedCarrier.matchedSamples, 0);
closeTo(
  unmatchedCarrier.rgb,
  [0, 122 / 255, 51 / 255],
  'an inconclusive sample must fail closed to the current green carrier',
);
assert.equal(
  shouldFinalizeLegacyCarrierDetection(unmatchedCarrier, 1),
  false,
  'an inconclusive first decoded frame must be retried',
);
assert.equal(
  shouldFinalizeLegacyCarrierDetection(unmatchedCarrier, 2),
  false,
  'an inconclusive second decoded frame must still be retried',
);
assert.equal(
  shouldFinalizeLegacyCarrierDetection(unmatchedCarrier, 3),
  true,
  'inconclusive or tainted sampling must stop after a bounded third attempt',
);
assert.equal(
  shouldFinalizeLegacyCarrierDetection(detectedBlue, 1),
  true,
  'a conclusive blue carrier must lock on the first valid frame',
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

const blueForeground = [0.1, 0.8, 0.2];
const blueAlpha = 0.5;
const blueKey = [0, 71 / 255, 187 / 255];
const blueComposite = blueForeground.map(
  (channel, index) => blueAlpha * channel + (1 - blueAlpha) * blueKey[index],
);
closeTo(
  reconstructPremultipliedForeground(blueComposite, blueAlpha, 0, blueKey),
  blueForeground.map((channel) => channel * blueAlpha),
  'blue-carrier inversion must preserve a deliberately green foreground',
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
  /rgb - \(1\.0 - alpha\) \* u_carrierColor/,
  'shader must invert the selected gamma-encoded carrier',
);
assert.match(
  FRAGMENT_SHADER_SOURCE,
  /premultiplied - u_carrierAxis \* carrierExcess/,
  'shader must despill only the selected green or blue channel',
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

console.log('transparent background reconstruction harness passed');
