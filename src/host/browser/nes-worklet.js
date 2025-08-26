class NesProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._queue = [];
    this._index = 0;
    this.port.onmessage = (e) => {
      const { type, data } = e.data || {};
      if (type === 'samples' && data && data.buffer) {
        // data is a Float32Array; copy a reference by retaining its buffer
        this._queue.push(new Float32Array(data.buffer));
      }
    };
  }
  process(inputs, outputs) {
    const output = outputs[0][0];
    let i = 0;
    while (i < output.length) {
      if (this._queue.length === 0) {
        output[i++] = 0;
        continue;
      }
      const chunk = this._queue[0];
      if (this._index >= chunk.length) {
        this._queue.shift();
        this._index = 0;
        continue;
      }
      output[i++] = chunk[this._index++];
    }
    return true;
  }
}
registerProcessor('nes-processor', NesProcessor);

