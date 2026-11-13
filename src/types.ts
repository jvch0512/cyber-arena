export type Zone = "dmz" | "corp" | "srv";
export type Role = "web" | "mail" | "ws" | "file" | "dc" | "db" | "backup";

export interface Host {
  id: string;
  role: Role;
  zone: Zone;
  /** business value per turn of being up, and weight when it is lost */
  value: number;
  /** probability multiplier that activity on this host raises an alert */
  logging: number;
  vulns: string[];
}

export type RedAction =
  | { kind: "scan"; target: string }
  | { kind: "phish"; target: string }
  | { kind: "exploit"; target: string; vuln: string }
  | { kind: "steal"; target: string }
  | { kind: "move"; target: string }
  | { kind: "exfil"; target: string }
  | { kind: "encrypt"; target: string }
  | { kind: "cleanup"; target: string }
  | { kind: "wait" };

export type BlueAction =
  | { kind: "investigate"; target: string }
  | { kind: "isolate"; target: string }
  | { kind: "restore"; target: string }
  | { kind: "patch"; target: string; vuln: string }
  | { kind: "reset" }
  | { kind: "harden"; zone: Zone }
  | { kind: "wait" };

export interface Alert {
  turn: number;
  host: string;
  signal: "recon" | "exploit" | "phish" | "credential" | "lateral" | "exfil" | "encrypt" | "noise";
  confidence: number;
}

export interface HostView {
  id: string;
  role: Role;
  zone: Zone;
  value: number;
}

export interface RedObs {
  turn: number;
  hosts: HostView[];
  /** vulns seen by scanning */
  discovered: Record<string, string[]>;
  owned: string[];
  creds: string[];
  encrypted: string[];
  exfiltrated: string[];
  lastResult: string;
}

export interface BlueObs {
  turn: number;
  hosts: (HostView & { vulns: string[]; isolated: boolean; status: "unknown" | "compromised" | "cleared" })[];
  alerts: Alert[];
  hardened: Zone[];
  lastResult: string;
}

export interface Agent<A, O> {
  name: string;
  act(obs: O, rand: () => number): A;
}
export type RedAgent = Agent<RedAction, RedObs>;
export type BlueAgent = Agent<BlueAction, BlueObs>;

export interface HostState {
  owned: boolean;
  encrypted: boolean;
  isolated: boolean;
  exfiltrated: boolean;
  /** consecutive exfil steps; the data leaves on the third */
  exfilProgress: number;
  /** blue's belief */
  known: "unknown" | "compromised" | "cleared";
  logging: number;
  vulns: string[];
}

export interface TurnRecord {
  turn: number;
  red: RedAction;
  blue: BlueAction;
  redResult: string;
  blueResult: string;
  alerts: Alert[];
  state: Record<string, { o: boolean; e: boolean; i: boolean; x: boolean; k: string }>;
}

export interface Score {
  blue: number;
  red: number;
  exfiltrated: string[];
  encrypted: number;
  maxOwned: number;
  businessCost: number;
  /** first turn blue confirmed a real compromise, or null */
  detectedAt: number | null;
  /** first turn after red had a foothold when red owned nothing, or null */
  containedAt: number | null;
  firstFootholdAt: number | null;
}

export interface MatchResult {
  seed: number;
  red: string;
  blue: string;
  turns: number;
  score: Score;
  record: TurnRecord[];
}

export const TURNS = 60;
