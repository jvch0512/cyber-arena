import { playMatch } from "/lib/engine.js";
import { RED, BLUE, redByName, blueByName } from "/lib/agents.js";
import { tournament } from "/lib/tournament.js";
import { generateWorld } from "/lib/world.js";

const $ = (id) => document.getElementById(id);
const NS = "http://www.w3.org/2000/svg";
let match = null, hosts = [], timer = null;

for (const [id, list] of [["red", RED], ["blue", BLUE]]) for (const a of list) { const o = document.createElement("option"); o.value = o.textContent = a.name; $(id).append(o); }
$("red").value = "stealth-apt"; $("blue").value = "threat-hunter";

const POS = {};
function layout() {
  const cols = { dmz: 120, corp: 360, srv: 600 };
  const by = { dmz: [], corp: [], srv: [] };
  for (const h of hosts) by[h.zone].push(h);
  // spread evenly
  for (const z of Object.keys(by)) { const n = by[z].length; by[z].forEach((h, i) => { POS[h.id] = { x: cols[z], y: n === 1 ? 200 : 90 + (i * 220) / (n - 1) }; }); }
}

function mk(tag, attrs, text) {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

function drawNet(turn) {
  const svg = $("net");
  svg.replaceChildren();
  const zones = [["dmz", 40, "DMZ (internet facing)"], ["corp", 280, "Corporate"], ["srv", 520, "Servers"]];
  for (const [z, x, label] of zones) { svg.append(mk("rect", { class: "zone", x, y: 10, width: 160, height: 380, rx: 10 }), mk("text", { class: "zlabel", x: x + 80, y: 30, "text-anchor": "middle" }, label)); }
  for (const [a, b] of [["dmz", "srv"], ["corp", "srv"], ["corp", "dmz"]]) for (const h of hosts.filter((x) => x.zone === a)) for (const g of hosts.filter((x) => x.zone === b)) svg.append(mk("line", { class: "edge", x1: POS[h.id].x, y1: POS[h.id].y, x2: POS[g.id].x, y2: POS[g.id].y }));
  const st = turn > 0 ? match.record[turn - 1].state : null;
  for (const h of hosts) {
    const s = st ? st[h.id] : { o: false, e: false, i: false, x: false, k: "unknown" };
    const cls = ["node", s.e ? "enc" : s.o ? "own" : "", s.i ? "iso" : "", s.k === "compromised" ? "known" : ""].filter(Boolean).join(" ");
    svg.append(mk("circle", { class: cls, cx: POS[h.id].x, cy: POS[h.id].y, r: 17 }), mk("text", { x: POS[h.id].x, y: POS[h.id].y + 32, "text-anchor": "middle" }, h.id));
    if (s.x) svg.append(mk("text", { class: "badge", x: POS[h.id].x, y: POS[h.id].y + 4, "text-anchor": "middle" }, "$"));
  }
}

function drawScore() {
  const s = match.score;
  const box = $("score");
  box.replaceChildren();
  const add = (big, small) => { const d = document.createElement("div"); d.className = "s"; const b = document.createElement("b"); b.textContent = big; const sp = document.createElement("span"); sp.textContent = small; d.append(b, sp); box.append(d); };
  add(String(s.blue), "blue score (0 to 100)");
  add(String(s.red), "red score");
  add(s.exfiltrated.length ? s.exfiltrated.join(", ") : "none", "data stolen from");
  add(String(s.encrypted), "hosts encrypted");
  add(s.detectedAt === null ? "never" : "turn " + s.detectedAt, "first confirmed detection");
  add(String(s.businessCost), "business cost of isolation");
}

function drawLog(turn) {
  const log = $("log");
  log.replaceChildren();
  match.record.forEach((t) => {
    const r = document.createElement("div");
    r.className = "row" + (t.turn === turn ? " cur" : "");
    const a = document.createElement("span"); a.className = "t"; a.textContent = "t" + String(t.turn).padStart(2, "0") + " ";
    const b = document.createElement("span"); b.className = "r"; b.textContent = "RED " + t.redResult;
    const c = document.createElement("div"); c.className = "b"; c.textContent = "BLUE " + t.blueResult + (t.alerts.length ? "  [" + t.alerts.length + " alert(s)]" : "");
    r.append(a, b, c);
    log.append(r);
  });
  const cur = log.querySelector(".cur");
  if (cur) cur.scrollIntoView({ block: "nearest" });
}

function show(turn) {
  $("turn").value = String(turn);
  $("tlabel").textContent = "turn " + turn;
  drawNet(turn);
  drawLog(turn);
}

function fight() {
  clearInterval(timer);
  const seed = Math.max(1, Math.min(99999, Math.floor(Number($("seed").value) || 1)));
  match = playMatch(seed, redByName($("red").value), blueByName($("blue").value));
  hosts = generateWorld(seed);
  layout();
  $("match").hidden = false;
  drawScore();
  show(match.turns);
}

$("run").addEventListener("click", fight);
$("turn").addEventListener("input", (e) => show(Number(e.target.value)));
$("play").addEventListener("click", () => {
  clearInterval(timer);
  let t = 0;
  show(0);
  timer = setInterval(() => { t++; show(t); if (t >= match.turns) clearInterval(timer); }, 180);
});
$("tourney").addEventListener("click", () => {
  const t = tournament(30);
  $("tour").hidden = false;
  const m = $("matrix");
  m.replaceChildren();
  const head = document.createElement("tr");
  for (const h of ["red \\ blue", ...BLUE.map((b) => b.name)]) { const th = document.createElement("th"); th.textContent = h; head.append(th); }
  m.append(head);
  for (const r of RED) {
    const tr = document.createElement("tr");
    const n = document.createElement("td"); n.textContent = r.name; tr.append(n);
    for (const b of BLUE) {
      const c = t.cells.find((x) => x.red === r.name && x.blue === b.name);
      const td = document.createElement("td");
      td.textContent = c.blueMean.toFixed(1);
      td.style.color = c.blueMean >= 60 ? "#3fb950" : c.blueMean >= 30 ? "#e3b341" : "#f85149";
      tr.append(td);
    }
    m.append(tr);
  }
  $("boards").textContent = "Blue ranking: " + t.blueBoard.map((b) => `${b.name} ${b.mean.toFixed(1)}`).join(", ") + ". Red ranking: " + t.redBoard.map((b) => `${b.name} ${b.mean.toFixed(1)}`).join(", ") + ".";
});
fight();
