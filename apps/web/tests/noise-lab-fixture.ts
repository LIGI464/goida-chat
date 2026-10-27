export function syntheticFixture() {
  const pcm = new Float32Array(48000);
  let seed = 97;
  for (let i = 0; i < pcm.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const t = i / 48000;
    pcm[i] =
      0.14 *
        (Math.sin(2 * Math.PI * 173 * t) + 0.5 * Math.sin(2 * Math.PI * 346 * t)) *
        (0.6 + 0.4 * Math.sin(2 * Math.PI * 4 * t)) +
      0.006 * (seed / 4294967295 - 0.5);
  }
  return pcm;
}
