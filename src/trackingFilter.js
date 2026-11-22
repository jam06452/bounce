const POINTS = 21, LAYER = POINTS * 3, SIZE = LAYER * 2;
const MAX_GAP_S = 0.3;
export const LOW_LATENCY = { medianFrames: 1, minCutoff: 4, beta: [30, 100], derivativeCutoff: 4 };
export class LandmarkFilter {
  constructor(options = LOW_LATENCY) {
    this.options = { ...LOW_LATENCY, ...options };
    this.reset();
  }
  reset() {
    this.history = [];
    this.value = this.previous = this.velocity = null;
    this.timestamp = null;
    this.label = null;
  }
  update(result, timestamp) {
    const hand = result.landmarks?.[0], world = result.worldLandmarks?.[0];
    const empty = { landmarks: null, worldLandmarks: null, label: null };
    if (!hand || !world) {
      this.reset();
      return empty;
    }
    const label = (result.handedness ?? result.handednesses)?.[0]?.[0]?.categoryName ?? null;
    if (hand.length !== POINTS || world.length !== POINTS) {
      this.reset();
      return empty;
    }
    const raw = new Float64Array(SIZE);
    let i = 0;
    for (const layer of [hand, world]) for (const p of layer) {
      raw[i++] = p.x;
      raw[i++] = p.y;
      raw[i++] = p.z;
    }
    if (!raw.every(Number.isFinite)) {
      this.reset();
      return empty;
    }
    if (this.timestamp !== null && (timestamp <= this.timestamp || timestamp - this.timestamp > MAX_GAP_S || label !== this.label)) this.reset();
    this.history.push(raw);
    if (this.history.length > this.options.medianFrames) this.history.shift();
    const sample = median(this.history);
    if (this.value === null) {
      this.value = sample.slice();
      this.velocity = new Float64Array(SIZE);
    } else {
      const dt = timestamp - this.timestamp;
      const { minCutoff, beta, derivativeCutoff } = this.options;
      const alphaD = 1 / (1 + 1 / (2 * Math.PI * derivativeCutoff * dt));
      for (let k = 0; k < SIZE; k++)
        this.velocity[k] += alphaD * ((sample[k] - this.previous[k]) / dt - this.velocity[k]);
      for (let p = 0; p < POINTS * 2; p++) {
        const o = p * 3;
        const speed = Math.hypot(this.velocity[o], this.velocity[o + 1], this.velocity[o + 2]);
        const cutoff = minCutoff + beta[p < POINTS ? 0 : 1] * speed;
        const alpha = 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));
        for (let a = 0; a < 3; a++) this.value[o + a] += alpha * (sample[o + a] - this.value[o + a]);
      }
    }
    this.previous = sample;
    this.timestamp = timestamp;
    this.label = label;
    const unpack = (offset) => Array.from({ length: POINTS }, (_, p) => ({
      x: this.value[offset + p * 3],
      y: this.value[offset + p * 3 + 1],
      z: this.value[offset + p * 3 + 2]
    }));
    return { landmarks: unpack(0), worldLandmarks: unpack(LAYER), label };
  }
}
function median(history) {
  if (history.length === 1) return history[0].slice();
  const out = new Float64Array(SIZE);
  for (let k = 0; k < SIZE; k++) {
    const v = history.map((h) => h[k]).sort((a, b) => a - b);
    out[k] = v.length % 2 ? v[v.length >> 1] : (v[0] + v[1]) / 2;
  }
  return out;
}
