export function rms(samples: Float32Array, start = 0, end = samples.length) {
  let energy = 0;
  for (let i = start; i < end; i++) energy += (samples[i] ?? 0) ** 2;
  return Math.sqrt(energy / Math.max(1, end - start));
}

export function dbfs(value: number): number | null {
  return value > 0 ? 20 * Math.log10(value) : null;
}

// Positive lag means the processor delayed its output. Confidence is normalized
// waveform correlation, not speech quality. A low-confidence lag is not reported.
export function estimateLag(input: Float32Array, output: Float32Array, sampleRate: number) {
  const start = Math.round(sampleRate * 0.5);
  const end = Math.min(input.length - Math.round(sampleRate * 0.25), start + sampleRate * 2);
  if (end <= start || rms(input, start, end) < 1e-6) return null;
  const maxLag = Math.min(Math.round(sampleRate * 0.2), output.length - end);
  function correlation(lag: number) {
    let dot = 0,
      a2 = 0,
      b2 = 0;
    for (let i = start; i < end; i += 16) {
      const a = input[i] ?? 0,
        b = output[i + lag] ?? 0;
      dot += a * b;
      a2 += a * a;
      b2 += b * b;
    }
    return a2 * b2 > 1e-18 ? dot / Math.sqrt(a2 * b2) : 0;
  }
  let lag = 0,
    confidence = -1;
  for (let candidate = 0; candidate <= maxLag; candidate++) {
    const value = correlation(candidate);
    if (value > confidence) {
      confidence = value;
      lag = candidate;
    }
  }
  return confidence >= 0.5 && lag < maxLag
    ? { samples: lag, ms: (lag / sampleRate) * 1000, confidence }
    : null;
}

export function measureSignal(input: Float32Array, output: Float32Array, sampleRate: number) {
  const lag = estimateLag(input, output, sampleRate);
  const start = Math.round(sampleRate * 0.5);
  const end = Math.min(input.length, output.length) - Math.round(sampleRate * 0.25);
  const inputLevel = dbfs(rms(input, start, end));
  const outputLevel = dbfs(rms(output, start + (lag?.samples ?? 0), end + (lag?.samples ?? 0)));
  return {
    lag,
    inputDbfs: inputLevel,
    outputDbfs: outputLevel,
    attenuationDb: inputLevel !== null && outputLevel !== null ? inputLevel - outputLevel : null,
    outputSilent: rms(output) < 1e-7,
    clippedSamples: output.reduce((count, value) => count + (Math.abs(value) >= 0.999 ? 1 : 0), 0),
  };
}

export function wav(samples: Float32Array, sampleRate = 48000): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const ascii = (offset: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
  ascii(0, 'RIFF');
  view.setUint32(4, buffer.byteLength - 8, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((value, i) =>
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true),
  );
  return new Blob([buffer], { type: 'audio/wav' });
}
