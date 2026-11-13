/** Seeded generator (mulberry32) so a report can be reproduced and audited. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  normal(): number {
    const u = Math.max(this.next(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.next());
  }
  /** Marsaglia-Tsang gamma sampler, shape > 0, scale 1. */
  gamma(k: number): number {
    if (k < 1) return this.gamma(k + 1) * Math.pow(Math.max(this.next(), 1e-12), 1 / k);
    const d = k - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = this.next();
      if (u < 1 - 0.0331 * x ** 4 || Math.log(Math.max(u, 1e-12)) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }
  beta(a: number, b: number): number {
    const x = this.gamma(a);
    return x / (x + this.gamma(b));
  }
  /** Modified PERT on [min, max] with the given mode. */
  pert(min: number, mode: number, max: number, lambda = 4): number {
    if (max <= min) return min;
    const m = Math.min(Math.max(mode, min), max);
    const a = 1 + (lambda * (m - min)) / (max - min);
    const b = 1 + (lambda * (max - m)) / (max - min);
    return min + this.beta(a, b) * (max - min);
  }
}
