import { Rng } from "./rng.js";
import { generateWorld, REACH } from "./world.js";
import { TURNS, type Alert, type BlueAction, type BlueAgent, type BlueObs, type Host, type HostState, type MatchResult, type RedAction, type RedAgent, type RedObs, type Score, type TurnRecord, type Zone } from "./types.js";

type Signal = Alert["signal"];

const LOUD: Record<string, [Signal, number]> = {
  scan: ["recon", 0.35], phish: ["phish", 0.25], exploit: ["exploit", 0.5], steal: ["credential", 0.45],
  move: ["lateral", 0.4], exfil: ["exfil", 0.7], encrypt: ["encrypt", 0.95], cleanup: ["lateral", 0],
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export class Arena {
  readonly hosts: Host[];
  readonly state = new Map<string, HostState>();
  private creds = new Set<string>();
  private discovered: Record<string, string[]> = {};
  private hardened = new Set<Zone>();
  private rng: Rng;
  turn = 0;
  private redLast = "";
  private blueLast = "";
  private businessCost = 0;
  private detectedAt: number | null = null;
  private containedAt: number | null = null;
  private firstFootholdAt: number | null = null;
  private maxOwned = 0;
  private alertsNow: Alert[] = [];

  constructor(readonly seed: number) {
    this.hosts = generateWorld(seed);
    for (const h of this.hosts) this.state.set(h.id, { owned: false, encrypted: false, isolated: false, exfiltrated: false, exfilProgress: 0, known: "unknown", logging: h.logging, vulns: [...h.vulns] });
    this.rng = new Rng(seed * 40503 + 99);
  }

  private host(id: string): Host | undefined { return this.hosts.find((h) => h.id === id); }
  private st(id: string): HostState { return this.state.get(id)!; }
  private active(): Host[] { return this.hosts.filter((h) => this.st(h.id).owned && !this.st(h.id).isolated); }

  private reachable(h: Host): boolean {
    if (this.st(h.id).isolated) return false;
    if (h.zone === "dmz") return true; // exposed to the internet
    return this.active().some((o) => REACH[o.zone].includes(h.zone));
  }

  redObs(): RedObs {
    const owned = this.hosts.filter((h) => this.st(h.id).owned && !this.st(h.id).isolated).map((h) => h.id);
    return {
      turn: this.turn, hosts: this.hosts.map((h) => ({ id: h.id, role: h.role, zone: h.zone, value: h.value })), discovered: JSON.parse(JSON.stringify(this.discovered)),
      owned, creds: [...this.creds], encrypted: this.hosts.filter((h) => this.st(h.id).encrypted).map((h) => h.id), exfiltrated: this.hosts.filter((h) => this.st(h.id).exfiltrated).map((h) => h.id), lastResult: this.redLast,
    };
  }

  blueObs(): BlueObs {
    return {
      turn: this.turn, alerts: [...this.alertsNow], hardened: [...this.hardened], lastResult: this.blueLast,
      hosts: this.hosts.map((h) => ({ id: h.id, role: h.role, zone: h.zone, value: h.value, vulns: [...this.st(h.id).vulns], isolated: this.st(h.id).isolated, status: this.st(h.id).known })),
    };
  }

  private alert(signal: Signal, host: string, loud: number, failed: boolean): void {
    const p = loud * (failed ? 0.6 : 1) * this.st(host).logging;
    if (this.rng.next() < p) this.alertsNow.push({ turn: this.turn, host, signal, confidence: Math.round(clamp(0.4 + 0.5 * loud + (this.rng.next() - 0.5) * 0.3, 0.2, 0.99) * 100) / 100 });
  }

  /** Returns a human readable result. Invalid actions waste the turn, as a buggy agent would in real life. */
  applyRed(a: RedAction): string {
    if (a.kind === "wait") return "waited";
    const h = this.host(a.target);
    if (!h) return `invalid: no host ${a.target}`;
    const s = this.st(h.id);
    const loud = LOUD[a.kind];
    let ok = false;
    let msg: string;
    switch (a.kind) {
      case "scan":
        if (!this.reachable(h)) return `invalid: ${h.id} is not reachable`;
        this.discovered[h.id] = [...s.vulns];
        ok = true; msg = `scanned ${h.id}: ${s.vulns.length} weakness(es) found`;
        break;
      case "phish":
        if (h.role !== "ws" || s.isolated) return `invalid: cannot phish ${h.id}`;
        ok = this.rng.next() < (s.vulns.includes("phishable") ? 0.7 : 0.45);
        if (ok) s.owned = true;
        msg = ok ? `phished ${h.id}: foothold` : `phish on ${h.id} failed`;
        break;
      case "exploit":
        if (!this.reachable(h)) return `invalid: ${h.id} is not reachable`;
        if (!(this.discovered[h.id] ?? []).includes(a.vuln)) return `invalid: ${a.vuln} on ${h.id} is not known (scan first)`;
        if (!s.vulns.includes(a.vuln)) return `exploit failed: ${a.vuln} on ${h.id} was patched`;
        ok = this.rng.next() < (this.hardened.has(h.zone) ? 0.4 : 0.65);
        if (ok) s.owned = true;
        msg = ok ? `exploited ${a.vuln} on ${h.id}: owned` : `exploit of ${a.vuln} on ${h.id} failed`;
        break;
      case "steal": {
        if (!s.owned || s.isolated) return `invalid: no access to ${h.id}`;
        let n = 0;
        for (const o of this.hosts) {
          if (o.id === h.id || !REACH[h.zone].includes(o.zone)) continue;
          if (h.role === "dc" || this.rng.next() < 0.5) { if (!this.creds.has(o.id)) n++; this.creds.add(o.id); }
        }
        ok = true; msg = `stole credentials on ${h.id}: ${n} new target(s)`;
        break;
      }
      case "move":
        if (!this.creds.has(h.id) || !this.reachable(h) || s.owned) return `invalid: cannot move to ${h.id}`;
        ok = this.rng.next() < 0.85;
        if (ok) s.owned = true;
        msg = ok ? `moved laterally to ${h.id}` : `lateral move to ${h.id} failed`;
        break;
      case "exfil":
        if (!s.owned || s.isolated || (h.role !== "db" && h.role !== "file") || s.exfiltrated) return `invalid: nothing to exfiltrate from ${h.id}`;
        s.exfilProgress++;
        if (s.exfilProgress < 3) { this.alert("exfil", h.id, 0.35, false); return `staging data on ${h.id} (${s.exfilProgress}/3)`; }
        ok = this.rng.next() < 0.9;
        if (ok) s.exfiltrated = true; else s.exfilProgress = 2;
        msg = ok ? `exfiltrated data from ${h.id}` : `exfiltration from ${h.id} failed`;
        break;
      case "encrypt":
        if (!s.owned || s.isolated || s.encrypted) return `invalid: cannot encrypt ${h.id}`;
        ok = this.rng.next() < 0.95;
        if (ok) s.encrypted = true;
        msg = ok ? `encrypted ${h.id}` : `encryption of ${h.id} failed`;
        break;
      case "cleanup":
        if (!s.owned || s.isolated) return `invalid: no access to ${h.id}`;
        s.logging = Math.max(0.05, s.logging - 0.25);
        return `tampered with logs on ${h.id}`;
    }
    if (loud && loud[1] > 0) this.alert(loud[0], h.id, loud[1], !ok);
    return msg;
  }

  applyBlue(a: BlueAction): string {
    if (a.kind === "wait") return "waited";
    if (a.kind === "reset") { const n = this.creds.size; this.creds.clear(); return `reset credentials (${n} stolen credential(s) invalidated)`; }
    if (a.kind === "harden") { this.hardened.add(a.zone); return `hardened zone ${a.zone}`; }
    const h = this.host(a.target);
    if (!h) return `invalid: no host ${a.target}`;
    const s = this.st(h.id);
    switch (a.kind) {
      case "investigate":
        if (s.owned) {
          if (this.rng.next() < 0.85) { s.known = "compromised"; if (this.detectedAt === null) this.detectedAt = this.turn; return `investigated ${h.id}: COMPROMISED`; }
          return `investigated ${h.id}: inconclusive`;
        }
        if (this.rng.next() < 0.9) { s.known = "cleared"; return `investigated ${h.id}: clean`; }
        return `investigated ${h.id}: inconclusive`;
      case "isolate":
        s.isolated = true; s.exfilProgress = 0;
        return `isolated ${h.id}`;
      case "restore": {
        const backupsGone = this.hosts.some((b) => b.role === "backup" && this.st(b.id).encrypted);
        if (s.encrypted && backupsGone && h.role !== "backup") return `restore of ${h.id} failed: backups are encrypted`;
        s.owned = false; s.encrypted = false; s.isolated = false; s.exfilProgress = 0; s.known = "cleared";
        return `restored ${h.id} from clean image`;
      }
      case "patch":
        if (!s.vulns.includes(a.vuln)) return `invalid: ${a.vuln} is not present on ${h.id}`;
        s.vulns = s.vulns.filter((v) => v !== a.vuln);
        return `patched ${a.vuln} on ${h.id}`;
    }
  }

  private track(): void {
    const n = this.active().length;
    this.maxOwned = Math.max(this.maxOwned, this.hosts.filter((h) => this.st(h.id).owned).length);
    if (n > 0 && this.firstFootholdAt === null) this.firstFootholdAt = this.turn;
    if (n === 0 && this.firstFootholdAt !== null && this.containedAt === null) this.containedAt = this.turn;
    if (n > 0 && this.containedAt !== null) this.containedAt = null; // red came back: not contained
  }

  step(red: RedAgent, blue: BlueAgent, rand: () => number): TurnRecord {
    this.turn++;
    this.alertsNow = [];
    const ra = red.act(this.redObs(), rand);
    this.redLast = this.applyRed(ra);
    if (this.rng.next() < 0.25) { const h = this.hosts[Math.floor(this.rng.next() * this.hosts.length)]!; this.alertsNow.push({ turn: this.turn, host: h.id, signal: "noise", confidence: Math.round((0.3 + this.rng.next() * 0.3) * 100) / 100 }); }
    const ba = blue.act(this.blueObs(), rand);
    this.blueLast = this.applyBlue(ba);
    for (const h of this.hosts) if (this.st(h.id).isolated) this.businessCost += h.value * 0.15;
    this.track();
    const snap: TurnRecord["state"] = {};
    for (const h of this.hosts) { const s = this.st(h.id); snap[h.id] = { o: s.owned, e: s.encrypted, i: s.isolated, x: s.exfiltrated, k: s.known }; }
    return { turn: this.turn, red: ra, blue: ba, redResult: this.redLast, blueResult: this.blueLast, alerts: [...this.alertsNow], state: snap };
  }

  score(): Score {
    const ex = this.hosts.filter((h) => this.st(h.id).exfiltrated);
    const enc = this.hosts.filter((h) => this.st(h.id).encrypted).length;
    const dataLoss = ex.reduce((t, h) => t + (h.role === "db" ? 40 : 15), 0);
    const owned = this.hosts.filter((h) => this.st(h.id).owned).length;
    return {
      blue: Math.round(clamp(100 - dataLoss - 4 * enc - 2 * owned - this.businessCost, 0, 100) * 10) / 10,
      red: Math.round((dataLoss + 3 * enc + 2 * this.maxOwned) * 10) / 10,
      exfiltrated: ex.map((h) => h.id), encrypted: enc, maxOwned: this.maxOwned, businessCost: Math.round(this.businessCost * 10) / 10,
      detectedAt: this.detectedAt, containedAt: this.containedAt, firstFootholdAt: this.firstFootholdAt,
    };
  }
}

export function playMatch(seed: number, red: RedAgent, blue: BlueAgent, turns = TURNS): MatchResult {
  const arena = new Arena(seed);
  const rr = new Rng(seed * 7 + 1);
  const rand = () => rr.next();
  const record: TurnRecord[] = [];
  for (let i = 0; i < turns; i++) record.push(arena.step(red, blue, rand));
  return { seed, red: red.name, blue: blue.name, turns, score: arena.score(), record };
}
