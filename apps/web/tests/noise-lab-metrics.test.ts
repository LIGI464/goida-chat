import assert from 'node:assert/strict';
import { test } from 'node:test';
import { estimateLag, measureSignal, wav } from '../src/features/voice/audio/noiseLabMetrics.ts';

function noise(length: number) {
  let seed = 137;
  return Float32Array.from({ length }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return (seed / 0xffffffff - 0.5) * 0.25;
  });
}
test('finds a non-frame-aligned delay and attenuation without labelling it speech quality', () => {
  const input = noise(96000),
    output = new Float32Array(input.length);
  for (let i = 137; i < output.length; i++) output[i] = input[i - 137]! * 0.5;
  const result = measureSignal(input, output, 48000);
  assert.equal(result.lag?.samples, 137);
  assert.ok(Math.abs(result.attenuationDb! - 6.0206) < 0.05);
  assert.ok(result.lag!.confidence > 0.99);
  assert.equal(result.outputSilent, false);
});
test('silence and decorrelated output do not report a confident delay', () => {
  assert.equal(estimateLag(new Float32Array(96000), new Float32Array(96000), 48000), null);
  const result = measureSignal(noise(96000), new Float32Array(96000), 48000);
  assert.equal(result.lag, null);
  assert.equal(result.outputDbfs, null);
  assert.equal(result.attenuationDb, null);
  assert.equal(result.outputSilent, true);
});
test('raw identity has zero DSP delay and zero attenuation', () => {
  const input = noise(96000);
  const result = measureSignal(input, input, 48000);
  assert.equal(result.lag?.samples, 0);
  assert.equal(result.attenuationDb, 0);
});
test('WAV export has a complete PCM header and clips samples safely', async () => {
  const data = new DataView(await wav(new Float32Array([-2, 0, 2])).arrayBuffer());
  assert.equal(data.getUint32(24, true), 48000);
  assert.equal(data.getUint32(40, true), 6);
  assert.equal(data.getInt16(44, true), -32767);
  assert.equal(data.getInt16(48, true), 32767);
});
