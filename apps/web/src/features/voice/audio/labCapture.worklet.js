/* global AudioWorkletProcessor, registerProcessor, currentFrame */
// Observe input and output on one audio clock. Output remains silent.
class LabCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.remaining = 0;
    this.offset = 0;
    this.port.onmessage = ({ data }) => {
      if (data.type === 'record') {
        this.start = data.start;
        this.remaining = data.frames;
        this.input = new Float32Array(data.frames);
        this.output = new Float32Array(data.frames);
        this.offset = 0;
      }
    };
  }
  process(inputs) {
    if (!this.remaining) return true;
    const input = inputs[0]?.[0];
    const output = inputs[1]?.[0];
    for (let i = 0; i < 128; i++) {
      if (currentFrame + i < this.start || !this.remaining) continue;
      this.input[this.offset] = input?.[i] ?? 0;
      this.output[this.offset] = output?.[i] ?? 0;
      this.offset++;
      this.remaining--;
    }
    if (!this.remaining) {
      this.port.postMessage({ input: this.input, output: this.output }, [
        this.input.buffer,
        this.output.buffer,
      ]);
      this.input = this.output = null;
    }
    return true;
  }
}
registerProcessor('goida-noise-lab-capture', LabCapture);
