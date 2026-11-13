import { Rng } from "./rng.js";
import type { Host, Role, Zone } from "./types.js";

const VULNS: Record<Role, string[]> = {
  web: ["rce-web", "sqli", "weak-tls"],
  mail: ["mail-relay", "unpatched-os"],
  ws: ["phishable", "unpatched-os", "weak-rdp"],
  file: ["smb-relay", "weak-rdp"],
  dc: ["kerberoast", "unpatched-os"],
  db: ["default-creds", "sqli-backend"],
  backup: ["exposed-share"],
};

const SPEC: [Role, Zone, number, number][] = [
  ["web", "dmz", 6, 0.7], ["mail", "dmz", 4, 0.6],
  ["ws", "corp", 2, 0.4], ["ws", "corp", 2, 0.4], ["ws", "corp", 2, 0.4], ["ws", "corp", 2, 0.4],
  ["file", "corp", 5, 0.5],
  ["dc", "srv", 8, 0.8], ["db", "srv", 10, 0.7], ["backup", "srv", 6, 0.5],
];

/** Same seed, same estate: hosts, their weaknesses and how well each one is logged. */
export function generateWorld(seed: number): Host[] {
  const rng = new Rng(seed * 2654435761 + 17);
  const count: Record<string, number> = {};
  return SPEC.map(([role, zone, value, logging]) => {
    count[role] = (count[role] ?? 0) + 1;
    const pool = [...VULNS[role]];
    const vulns: string[] = [];
    // every host has at least one weakness, so the game is about choices and not about luck
    const n = 1 + Math.floor(rng.next() * Math.min(2, pool.length));
    for (let i = 0; i < n; i++) vulns.push(pool.splice(Math.floor(rng.next() * pool.length), 1)[0]!);
    const jitter = (rng.next() - 0.5) * 0.2;
    return { id: `${role}-${count[role]}`, role, zone, value, logging: Math.max(0.1, Math.min(1, logging + jitter)), vulns };
  });
}

export const REACH: Record<Zone, Zone[]> = { dmz: ["dmz", "srv"], corp: ["corp", "srv", "dmz"], srv: ["srv", "corp"] };
