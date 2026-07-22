const assert = require('assert');
const {
  FRAGMENT_SHADER_SOURCE,
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  detectLegacyChromaCarrier,
  keyLegacyPixel,
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
  { similarity: 0.01, smoothness: 0.44, spill: 0.5 },
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
  keyLegacyPixel([0, 122 / 255, 51 / 255]),
  [0, 0, 0, 0],
  'the exact dark-green carrier must reconstruct to transparent black',
);

closeTo(
  keyLegacyPixel([0.02, 122 / 255, 51 / 255]),
  [0, 0, 0, 0],
  'the measured codec-noise alpha tail must be floored to transparent',
);

closeTo(
  keyLegacyPixel([0.05, 122 / 255, 51 / 255]),
  [
    0.0011645379413974457, 0.007900590739676788, 0.004658151765589783,
    0.023290758827948913,
  ],
  'a just-visible carrier deviation must match the held-out RGB key fixture',
);

const darkGreen = [0, 122 / 255, 51 / 255];
closeTo(
  keyLegacyPixel([0.12, 0.42, 0.18], darkGreen),
  [
    0.026715424077240528, 0.057808537750836525, 0.03477855641001681,
    0.19615563544778447,
  ],
  'green-carrier guarded recovery must match the held-out CPU fixture',
);

const blueKey = [0, 71 / 255, 187 / 255];
closeTo(
  keyLegacyPixel([0.08, 0.35, 0.62], blueKey),
  [
    0.02658094751407277, 0.09548590370748197, 0.12334501296618385,
    0.257536997095212,
  ],
  'blue-carrier guarded recovery must match the held-out CPU fixture',
);

closeTo(
  keyLegacyPixel([0.05, 0.95, 0.08], darkGreen),
  [0.05, 0.95, 0.08, 1],
  'opaque genuine green must stay unchanged',
);

closeTo(
  reconstructPremultipliedForeground([0.01, 0.99, 0.01], 0.019),
  [0, 0, 0],
  'the colour-recovery helper must apply the same background alpha floor',
);

const guardedInput = [0.12, 0.42, 0.18];
const guardedAlpha = 0.19615563544778447;
const withoutDespill = reconstructPremultipliedForeground(
  guardedInput,
  guardedAlpha,
  0,
  darkGreen,
);
const withDespill = reconstructPremultipliedForeground(
  guardedInput,
  guardedAlpha,
  1,
  darkGreen,
);
assert.ok(
  withDespill[1] < withoutDespill[1],
  'despill must reduce only the carrier channel when it is excessive',
);
closeTo(
  [withDespill[0], withDespill[2]],
  [withoutDespill[0], withoutDespill[2]],
  'despill must preserve the non-carrier channels',
);

const nearOpaqueGreen = [0.05, 0.9, 0.08];
closeTo(
  reconstructPremultipliedForeground(nearOpaqueGreen, 1, 1, darkGreen),
  nearOpaqueGreen,
  'recovery and despill must preserve opaque foreground colour',
);

for (const { rgb, alpha, spill, carrier } of [
  { rgb: [0.2, 0.7, 0.3], alpha: 0.3, spill: 0, carrier: darkGreen },
  { rgb: [0.8, 0.1, 1], alpha: 0.6, spill: 1, carrier: blueKey },
  { rgb: [0.5, 0.9, 0.2], alpha: 0.95, spill: 0.5, carrier: darkGreen },
]) {
  const reconstructed = reconstructPremultipliedForeground(
    rgb,
    alpha,
    spill,
    carrier,
  );
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
  /distance\(rgb, u_carrierColor\)/,
  'shader must use normalized RGB distance from the detected carrier',
);
assert.match(
  FRAGMENT_SHADER_SOURCE,
  /rgb - \(1\.0 - alpha\) \* u_carrierColor/,
  'shader must compute carrier-subtracted colour recovery',
);
assert.match(
  FRAGMENT_SHADER_SOURCE,
  /vec3 observed = rgb \* alpha/,
  'shader must include observed-colour premultiplication',
);
assert.match(
  FRAGMENT_SHADER_SOURCE,
  /mix\(observed, subtracted, recoveryBlend\)/,
  'shader must guard carrier subtraction with the calibrated blend',
);
assert.match(
  FRAGMENT_SHADER_SOURCE,
  /smoothstep\(\s*0\.120,\s*0\.820,\s*alpha/,
  'shader must use the calibrated guarded-recovery alpha interval',
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
  /u_similarity|u_smoothness|u_spill|carrierDistance|recoveryBlend/,
  'packed renderer must not run the legacy key or despill operations',
);
assert.doesNotMatch(
  PACKED_ALPHA_FRAGMENT_SHADER_SOURCE,
  /alpha\s*\*=\s*step|smoothstep\(/,
  'packed renderer must not threshold or reshape transported alpha',
);

console.log('transparent background reconstruction harness passed');
