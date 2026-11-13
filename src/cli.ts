#!/usr/bin/env node
import { playMatch } from "./engine.js";
import { blueByName, redByName, BLUE, RED } from "./agents.js";
import { tournament } from "./tournament.js";

const USAGE = `cyber-arena match --red NAME --blue NAME [--seed N] [--json] [--log]
cyber-arena tournament [--seeds N] [--json]

red:  ${RED.map((a) => a.name).join(", ")}
blue: ${BLUE.map((a) => a.name).join(", ")}`;

function main(argv: string[]): number {
  const [cmd, ...rest] = argv.slice(2);
  const o: Record<string, string | true> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith("--")) { console.error(`unexpected ${a}`); return 2; }
    const k = a.slice(2);
    if (["json", "log"].includes(k)) o[k] = true;
    else if (["red", "blue", "seed", "seeds"].includes(k)) { const v = rest[++i]; if (v === undefined) { console.error(`--${k} needs a value`); return 2; } o[k] = v; }
    else { console.error(`unknown flag ${a}`); return 2; }
  }
  const int = (v: string | true | undefined, d: number) => { if (v === undefined) return d; const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 5000 ? n : NaN; };
  if (cmd === "match") {
    const red = redByName(String(o["red"] ?? "")), blue = blueByName(String(o["blue"] ?? ""));
    const seed = int(o["seed"], 1);
    if (!red || !blue || Number.isNaN(seed)) { console.error(USAGE); return 2; }
    const m = playMatch(seed, red, blue);
    if (o["json"]) { console.log(JSON.stringify(m)); return 0; }
    if (o["log"]) for (const t of m.record) console.log(`t${String(t.turn).padStart(2)}  red: ${t.redResult.padEnd(54)} blue: ${t.blueResult}`);
    const s = m.score;
    console.log(`${m.red} vs ${m.blue} (seed ${m.seed}): blue ${s.blue}, red ${s.red}, exfiltrated [${s.exfiltrated.join(", ")}], encrypted ${s.encrypted}, business cost ${s.businessCost}, detected at ${s.detectedAt ?? "never"}`);
    return 0;
  }
  if (cmd === "tournament") {
    const seeds = int(o["seeds"], 30);
    if (Number.isNaN(seeds)) { console.error(USAGE); return 2; }
    const t = tournament(seeds);
    if (o["json"]) { console.log(JSON.stringify(t, null, 2)); return 0; }
    console.log(`blue score (higher is better), mean of ${seeds} seeds\n`);
    console.log("".padEnd(16) + BLUE.map((b) => b.name.padStart(14)).join(""));
    for (const r of RED) console.log(r.name.padEnd(16) + BLUE.map((b) => t.cells.find((c) => c.red === r.name && c.blue === b.name)!.blueMean.toFixed(1).padStart(14)).join(""));
    console.log("\nblue leaderboard: " + t.blueBoard.map((b) => `${b.name} ${b.mean.toFixed(1)}`).join(" > "));
    console.log("red leaderboard:  " + t.redBoard.map((b) => `${b.name} ${b.mean.toFixed(1)}`).join(" > "));
    return 0;
  }
  console.error(USAGE);
  return 2;
}

process.exitCode = main(process.argv);
