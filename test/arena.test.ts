import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Arena, playMatch } from "../src/engine.js";
import { generateWorld } from "../src/world.js";
import { BLUE, RED, alertDriven, noisyScanner, passive, paranoid, ransomRush, stealthApt, threatHunter } from "../src/agents.js";
import { tournament } from "../src/tournament.js";
import type { BlueAgent, RedAgent } from "../src/types.js";

const cli = new URL("../src/cli.js", import.meta.url).pathname;
const quiet = (a: Arena) => { for (const s of a.state.values()) s.logging = 0; };

test("world generation is deterministic and well formed", () => {
  const a = generateWorld(5), b = generateWorld(5), c = generateWorld(6);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.equal(new Set(a.map((h) => h.id)).size, a.length);
  assert.ok(a.every((h) => h.vulns.length >= 1));
  for (const role of ["web", "mail", "ws", "file", "dc", "db", "backup"]) assert.ok(a.some((h) => h.role === role), role);
  assert.ok(a.every((h) => h.logging >= 0.1 && h.logging <= 1));
});

test("a match is reproducible and seeds differ", () => {
  const x = playMatch(3, ransomRush, alertDriven), y = playMatch(3, ransomRush, alertDriven), z = playMatch(4, ransomRush, alertDriven);
  assert.deepEqual(x, y);
  assert.notDeepEqual(x.record, z.record);
  assert.equal(x.record.length, 60);
  assert.deepEqual(Object.keys(x.record[0]!.state).sort(), generateWorld(3).map((h) => h.id).sort());
});

test("scanning is required before exploiting, and unreachable hosts are refused", () => {
  const a = new Arena(1);
  assert.match(a.applyRed({ kind: "scan", target: "db-1" }), /not reachable/);
  assert.match(a.applyRed({ kind: "exploit", target: "web-1", vuln: "rce-web" }), /not known/);
  assert.match(a.applyRed({ kind: "scan", target: "web-1" }), /scanned web-1/);
  assert.match(a.applyRed({ kind: "scan", target: "nope" }), /no host/);
  assert.match(a.applyRed({ kind: "phish", target: "web-1" }), /cannot phish/);
});

test("a foothold opens the inside of the network", () => {
  const a = new Arena(1);
  quiet(a);
  a.state.get("ws-1")!.owned = true;
  assert.match(a.applyRed({ kind: "scan", target: "db-1" }), /scanned db-1/);
  assert.match(a.applyRed({ kind: "steal", target: "web-1" }), /no access/);
});

test("isolation takes a compromised host away from the attacker", () => {
  const a = new Arena(1);
  quiet(a);
  a.state.get("ws-1")!.owned = true;
  a.applyBlue({ kind: "isolate", target: "ws-1" });
  assert.match(a.applyRed({ kind: "scan", target: "db-1" }), /not reachable/);
  assert.deepEqual(a.redObs().owned, []);
});

test("patching removes the weakness and the exploit then fails", () => {
  const a = new Arena(2);
  quiet(a);
  const web = a.hosts.find((h) => h.id === "web-1")!;
  const v = web.vulns[0]!;
  a.applyRed({ kind: "scan", target: "web-1" });
  assert.match(a.applyBlue({ kind: "patch", target: "web-1", vuln: v }), /patched/);
  assert.match(a.applyRed({ kind: "exploit", target: "web-1", vuln: v }), /patched/);
  assert.match(a.applyBlue({ kind: "patch", target: "web-1", vuln: "made-up" }), /not present/);
});

test("restore cleans a host but fails for encrypted hosts when backups are encrypted", () => {
  const a = new Arena(1);
  a.state.get("file-1")!.encrypted = true;
  a.state.get("file-1")!.owned = true;
  a.state.get("backup-1")!.encrypted = true;
  assert.match(a.applyBlue({ kind: "restore", target: "file-1" }), /backups are encrypted/);
  assert.match(a.applyBlue({ kind: "restore", target: "backup-1" }), /restored/);
  assert.match(a.applyBlue({ kind: "restore", target: "file-1" }), /restored/);
  assert.equal(a.state.get("file-1")!.owned, false);
  assert.equal(a.state.get("file-1")!.encrypted, false);
});

test("exfiltration takes three steps and isolation resets it", () => {
  const a = new Arena(1);
  quiet(a);
  a.state.get("db-1")!.owned = true;
  assert.match(a.applyRed({ kind: "exfil", target: "db-1" }), /1\/3/);
  assert.match(a.applyRed({ kind: "exfil", target: "db-1" }), /2\/3/);
  a.applyBlue({ kind: "isolate", target: "db-1" });
  a.applyBlue({ kind: "restore", target: "db-1" });
  a.state.get("db-1")!.owned = true;
  assert.match(a.applyRed({ kind: "exfil", target: "db-1" }), /1\/3/, "progress was reset");
});

test("credential theft from a domain controller reaches every host it can talk to, and a reset undoes it", () => {
  const a = new Arena(1);
  quiet(a);
  a.state.get("dc-1")!.owned = true;
  a.applyRed({ kind: "steal", target: "dc-1" });
  assert.equal(a.redObs().creds.length, a.hosts.filter((h) => h.id !== "dc-1" && (h.zone === "srv" || h.zone === "corp")).length);
  a.applyBlue({ kind: "reset" });
  assert.deepEqual(a.redObs().creds, []);
});

test("log tampering lowers the chance of being seen", () => {
  const a = new Arena(1);
  a.state.get("db-1")!.owned = true;
  const before = a.state.get("db-1")!.logging;
  a.applyRed({ kind: "cleanup", target: "db-1" });
  assert.ok(a.state.get("db-1")!.logging < before);
  assert.ok(a.state.get("db-1")!.logging >= 0.05);
});

test("each side only sees its own half of the world", () => {
  const a = new Arena(1);
  a.state.get("web-1")!.owned = true;
  const red = JSON.stringify(a.redObs()), blue = JSON.stringify(a.blueObs());
  assert.ok(!red.includes('"vulns"') && !red.includes("logging"), "red cannot read weaknesses it has not scanned");
  assert.ok(!blue.includes('"owned"') && !blue.includes("exfilProgress"), "blue cannot read the truth");
  assert.deepEqual(a.blueObs().hosts.every((h) => h.status === "unknown"), true);
});

test("investigating tells a compromised host from a clean one (statistically)", () => {
  let hits = 0, clean = 0;
  for (let s = 1; s <= 60; s++) {
    const a = new Arena(s);
    a.state.get("ws-1")!.owned = true;
    if (/COMPROMISED/.test(a.applyBlue({ kind: "investigate", target: "ws-1" }))) hits++;
    if (/clean/.test(a.applyBlue({ kind: "investigate", target: "ws-2" }))) clean++;
  }
  assert.ok(hits > 40 && clean > 45, `hits ${hits} clean ${clean}`);
});

test("scores stay in range and follow the formula", () => {
  for (const r of RED) for (const b of BLUE) {
    const m = playMatch(7, r, b);
    assert.ok(m.score.blue >= 0 && m.score.blue <= 100);
    assert.ok(m.score.red >= 0);
  }
  const a = new Arena(1);
  a.state.get("db-1")!.exfiltrated = true;
  a.state.get("web-1")!.encrypted = true;
  a.state.get("web-1")!.owned = true;
  const s = a.score();
  assert.equal(s.blue, 100 - 40 - 4 - 2);
});

test("a misbehaving agent wastes turns but cannot crash the arena", () => {
  const bad: RedAgent = { name: "bad", act: () => ({ kind: "exploit", target: "ghost", vuln: "x" }) };
  const worse: BlueAgent = { name: "worse", act: () => ({ kind: "patch", target: "db-1", vuln: "nope" }) };
  const m = playMatch(1, bad, worse);
  assert.equal(m.record.length, 60);
  assert.ok(m.record.every((t) => t.redResult.startsWith("invalid")));
  assert.equal(m.score.blue, 100);
});

test("passive defence loses to ransomware and proactive defence does better", () => {
  const avg = (r: RedAgent, b: BlueAgent) => { let t = 0; for (let s = 1; s <= 30; s++) t += playMatch(s, r, b).score.blue; return t / 30; };
  assert.ok(avg(ransomRush, threatHunter) > avg(ransomRush, passive) + 10);
  assert.ok(avg(noisyScanner, threatHunter) > avg(noisyScanner, alertDriven) + 20);
});

test("isolating on every alert burns business value", () => {
  let p = 0, h = 0;
  for (let s = 1; s <= 20; s++) { p += playMatch(s, stealthApt, paranoid).score.businessCost; h += playMatch(s, stealthApt, threatHunter).score.businessCost; }
  assert.ok(p > h * 3, `paranoid ${p} vs hunter ${h}`);
});

test("tournament covers every pairing and ranks boards", () => {
  const t = tournament(8);
  assert.equal(t.cells.length, RED.length * BLUE.length);
  assert.ok(t.cells.every((c) => c.matches === 8 && c.blueMean >= 0 && c.blueMean <= 100 && c.exfilRate >= 0 && c.exfilRate <= 1));
  assert.deepEqual(t.blueBoard.map((b) => b.mean), [...t.blueBoard.map((b) => b.mean)].sort((a, b) => b - a));
  assert.equal(t.blueBoard.length, BLUE.length);
});

test("cli: match, tournament and errors", () => {
  const m = spawnSync("node", [cli, "match", "--red", "stealth-apt", "--blue", "threat-hunter", "--seed", "2"], { encoding: "utf8" });
  assert.equal(m.status, 0);
  assert.match(m.stdout, /stealth-apt vs threat-hunter \(seed 2\)/);
  const j = spawnSync("node", [cli, "match", "--red", "noisy-scanner", "--blue", "passive", "--json"], { encoding: "utf8" });
  assert.equal(JSON.parse(j.stdout).record.length, 60);
  const t = spawnSync("node", [cli, "tournament", "--seeds", "3"], { encoding: "utf8" });
  assert.match(t.stdout, /blue leaderboard/);
  for (const args of [["match", "--red", "x", "--blue", "passive"], ["match", "--bogus"], ["tournament", "--seeds", "0"], ["nope"], []]) assert.equal(spawnSync("node", [cli, ...args], { encoding: "utf8" }).status, 2, args.join(" "));
});
