import { playMatch } from "./engine.js";
import { BLUE, RED } from "./agents.js";
import type { BlueAgent, RedAgent } from "./types.js";

export interface Cell {
  red: string;
  blue: string;
  matches: number;
  blueMean: number;
  redMean: number;
  exfilRate: number;
  detectRate: number;
  ttdMean: number | null;
}

export interface Tournament {
  seeds: number;
  cells: Cell[];
  blueBoard: { name: string; mean: number }[];
  redBoard: { name: string; mean: number }[];
}

export function tournament(seeds: number, red: RedAgent[] = RED, blue: BlueAgent[] = BLUE, firstSeed = 1): Tournament {
  const cells: Cell[] = [];
  for (const r of red) for (const b of blue) {
    let bs = 0, rs = 0, ex = 0, det = 0, ttdSum = 0, ttdN = 0;
    for (let s = 0; s < seeds; s++) {
      const m = playMatch(firstSeed + s, r, b);
      bs += m.score.blue; rs += m.score.red;
      if (m.score.exfiltrated.some((id) => id.startsWith("db"))) ex++;
      if (m.score.detectedAt !== null) { det++; if (m.score.firstFootholdAt !== null) { ttdSum += m.score.detectedAt - m.score.firstFootholdAt; ttdN++; } }
    }
    cells.push({ red: r.name, blue: b.name, matches: seeds, blueMean: bs / seeds, redMean: rs / seeds, exfilRate: ex / seeds, detectRate: det / seeds, ttdMean: ttdN ? ttdSum / ttdN : null });
  }
  const board = (names: string[], pick: (c: Cell) => string, val: (c: Cell) => number) => names.map((n) => { const cs = cells.filter((c) => pick(c) === n); return { name: n, mean: cs.reduce((t, c) => t + val(c), 0) / cs.length }; }).sort((a, b) => b.mean - a.mean);
  return { seeds, cells, blueBoard: board(blue.map((b) => b.name), (c) => c.blue, (c) => c.blueMean), redBoard: board(red.map((r) => r.name), (c) => c.red, (c) => c.redMean) };
}
