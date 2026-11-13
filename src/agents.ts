import { REACH } from "./world.js";
import type { BlueAction, BlueAgent, BlueObs, HostView, RedAction, RedAgent, RedObs } from "./types.js";

// ---------- red helpers ----------

const reach = (o: RedObs, h: HostView) => h.zone === "dmz" || o.owned.some((id) => REACH[o.hosts.find((x) => x.id === id)!.zone].includes(h.zone));
const owns = (o: RedObs, id: string) => o.owned.includes(id);
const byValue = (a: HostView, b: HostView) => b.value - a.value;
const wait: RedAction = { kind: "wait" };

function exploitable(o: RedObs, h: HostView): string | undefined {
  return (o.discovered[h.id] ?? [])[0];
}

/** Gets a first foothold: scan the internet-facing hosts, exploit what is found, fall back to phishing. */
function foothold(o: RedObs, preferPhish: boolean): RedAction {
  const dmz = o.hosts.filter((h) => h.zone === "dmz");
  if (preferPhish) return { kind: "phish", target: o.hosts.find((h) => h.role === "ws")!.id };
  for (const h of dmz) if (!(h.id in o.discovered)) return { kind: "scan", target: h.id };
  for (const h of dmz) { const v = exploitable(o, h); if (v) return { kind: "exploit", target: h.id, vuln: v }; }
  return { kind: "phish", target: o.hosts.find((h) => h.role === "ws")!.id };
}

/** Next unowned host worth taking: through credentials when we have them, otherwise by scanning and exploiting. */
function expand(o: RedObs, goal: (h: HostView) => boolean): RedAction | undefined {
  const targets = o.hosts.filter((h) => !owns(o, h.id) && reach(o, h)).sort((a, b) => Number(goal(b)) - Number(goal(a)) || byValue(a, b));
  for (const h of targets) if (o.creds.includes(h.id)) return { kind: "move", target: h.id };
  for (const h of targets) { if (!(h.id in o.discovered)) return { kind: "scan", target: h.id }; const v = exploitable(o, h); if (v) return { kind: "exploit", target: h.id, vuln: v }; }
  return undefined;
}

const stealFrom = (o: RedObs, role?: string): RedAction | undefined => {
  for (const id of o.owned) { const h = o.hosts.find((x) => x.id === id)!; if ((!role || h.role === role) && !(o.lastResult.startsWith(`stole credentials on ${id}`))) return { kind: "steal", target: id }; }
  return undefined;
};

// ---------- red agents ----------

export const noisyScanner: RedAgent = {
  name: "noisy-scanner",
  act(o) {
    if (!o.owned.length) return foothold(o, false);
    const db = o.hosts.find((h) => h.role === "db")!;
    if (owns(o, db.id) && !o.exfiltrated.includes(db.id)) return { kind: "exfil", target: db.id };
    const open = o.owned.find((id) => !o.encrypted.includes(id));
    if (open && o.turn % 3 === 0) return { kind: "encrypt", target: open };
    return expand(o, (h) => h.role === "db" || h.role === "dc") ?? (open ? { kind: "encrypt", target: open } : wait);
  },
};

export const stealthApt: RedAgent = {
  name: "stealth-apt",
  act(o) {
    if (!o.owned.length) return foothold(o, true);
    const db = o.hosts.find((h) => h.role === "db")!;
    const dc = o.hosts.find((h) => h.role === "dc")!;
    if (owns(o, db.id)) {
      if (!o.exfiltrated.includes(db.id)) return { kind: "exfil", target: db.id };
      return o.lastResult.startsWith("tampered") ? wait : { kind: "cleanup", target: db.id };
    }
    // quiet path: credentials first, then straight to the domain controller, then the database
    if (!o.creds.length) return stealFrom(o) ?? wait;
    if (!owns(o, dc.id) && o.creds.includes(dc.id) && reach(o, dc)) return { kind: "move", target: dc.id };
    if (owns(o, dc.id) && !o.creds.includes(db.id)) return { kind: "steal", target: dc.id };
    if (o.creds.includes(db.id) && reach(o, db)) return { kind: "move", target: db.id };
    const open = stealFrom(o);
    if (open && o.turn % 4 === 0) return open;
    return expand(o, (h) => h.role === "dc" || h.role === "db") ?? stealFrom(o) ?? wait;
  },
};

export const ransomRush: RedAgent = {
  name: "ransom-rush",
  act(o) {
    if (!o.owned.length) return foothold(o, false);
    const backup = o.hosts.find((h) => h.role === "backup")!;
    const db = o.hosts.find((h) => h.role === "db")!;
    if (owns(o, db.id) && !o.exfiltrated.includes(db.id)) return { kind: "exfil", target: db.id };
    if (owns(o, backup.id) && !o.encrypted.includes(backup.id)) return { kind: "encrypt", target: backup.id };
    if (!o.creds.length) { const s = stealFrom(o); if (s) return s; }
    const step = expand(o, (h) => h.role === "backup" || h.role === "db");
    if (step && step.kind !== "scan") return step;
    const open = o.owned.find((id) => !o.encrypted.includes(id) && o.hosts.find((h) => h.id === id)!.role !== "ws");
    if (open) return { kind: "encrypt", target: open };
    return step ?? stealFrom(o) ?? { kind: "encrypt", target: o.owned.find((id) => !o.encrypted.includes(id)) ?? o.owned[0]! };
  },
};

// ---------- blue helpers ----------

const BLUE_WAIT: BlueAction = { kind: "wait" };

function strong(o: BlueObs, min: number) {
  return o.alerts.filter((a) => a.confidence >= min && a.signal !== "noise" || a.confidence >= min + 0.1).sort((a, b) => b.confidence - a.confidence);
}

// ---------- blue agents ----------

export const passive: BlueAgent = {
  name: "passive",
  act(o) {
    const enc = o.alerts.find((a) => a.signal === "encrypt");
    if (enc) return { kind: "restore", target: enc.host };
    return BLUE_WAIT;
  },
};

function respond(o: BlueObs, minConf: number): BlueAction | undefined {
  // ransomware leaves no doubt: recover from backups, and when those are gone, rebuild the backup host first
  if (/backups are encrypted/.test(o.lastResult)) { const b = o.hosts.find((h) => h.role === "backup"); if (b) return { kind: "restore", target: b.id }; }
  const enc = o.alerts.find((a) => a.signal === "encrypt");
  if (enc) return { kind: "restore", target: enc.host };
  const bad = o.hosts.filter((h) => h.status === "compromised");
  const restorable = bad.find((h) => h.isolated);
  if (restorable) return { kind: "restore", target: restorable.id };
  const live = bad.find((h) => !h.isolated);
  if (live) return { kind: "isolate", target: live.id };
  if (bad.length && !/reset credentials/.test(o.lastResult) && o.turn % 5 === 0) return { kind: "reset" };
  const a = strong(o, minConf).find((x) => o.hosts.find((h) => h.id === x.host)!.status === "unknown");
  if (a) return { kind: "investigate", target: a.host };
  return undefined;
}

export const alertDriven: BlueAgent = {
  name: "alert-driven",
  act(o) {
    return respond(o, 0.55) ?? BLUE_WAIT;
  },
};

export const threatHunter: BlueAgent = {
  name: "threat-hunter",
  act(o) {
    const r = respond(o, 0.45);
    if (r) return r;
    // quiet turn: harden, patch the crown jewels, then sweep high value hosts
    if (!o.hardened.includes("srv")) return { kind: "harden", zone: "srv" };
    for (const role of ["db", "dc", "backup", "web", "file"]) {
      const h = o.hosts.find((x) => x.role === role && x.vulns.length > 0);
      if (h) return { kind: "patch", target: h.id, vuln: h.vulns[0]! };
    }
    const sweep = o.hosts.filter((h) => h.status === "unknown").sort((a, b) => b.value - a.value)[0];
    return sweep ? { kind: "investigate", target: sweep.id } : BLUE_WAIT;
  },
};

export const paranoid: BlueAgent = {
  name: "paranoid",
  act(o) {
    const a = o.alerts.filter((x) => x.confidence >= 0.3 && !o.hosts.find((h) => h.id === x.host)!.isolated).sort((x, y) => y.confidence - x.confidence)[0];
    if (a) return { kind: "isolate", target: a.host };
    const iso = o.hosts.find((h) => h.isolated && h.status === "unknown");
    if (iso) return { kind: "investigate", target: iso.id };
    const bad = o.hosts.find((h) => h.isolated && h.status === "compromised");
    if (bad) return { kind: "restore", target: bad.id };
    const clean = o.hosts.find((h) => h.isolated && h.status === "cleared");
    if (clean) return { kind: "restore", target: clean.id };
    return BLUE_WAIT;
  },
};

export const RED: RedAgent[] = [noisyScanner, stealthApt, ransomRush];
export const BLUE: BlueAgent[] = [passive, alertDriven, threatHunter, paranoid];
export const redByName = (n: string) => RED.find((a) => a.name === n);
export const blueByName = (n: string) => BLUE.find((a) => a.name === n);
