import { missionById } from '../data/missions';
import { directTransfer, jgaTransfer } from '../physics/porkchop';
import { Design } from './state';

// ---------- share links ----------
interface Packed extends Omit<Design, 'transfer'> {
  t?: { k: 'direct' | 'jga'; L: number; tof: number; t1?: number };
}

export function encodeDesign(d: Design): string {
  const { transfer, ...rest } = d;
  const p: Packed = { ...rest };
  if (transfer)
    p.t = {
      k: transfer.kind,
      L: transfer.launchJD,
      tof: transfer.tofDays,
      t1: transfer.flyby ? transfer.flyby.jd - transfer.launchJD : undefined,
    };
  const bytes = new TextEncoder().encode(JSON.stringify(p));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function decodeDesign(code: string): Design | null {
  try {
    let json: string;
    if (/^[0-9a-f]+$/.test(code) && code.length % 2 === 0) {
      const bytes = new Uint8Array(code.match(/../g)!.map((h) => parseInt(h, 16)));
      json = new TextDecoder().decode(bytes);
    } else {
      json = decodeURIComponent(escape(atob(code.replace(/-/g, '+').replace(/_/g, '/'))));
    }
    const p = JSON.parse(json) as Packed;
    const m = missionById(p.missionId);
    let transfer = null;
    if (p.t) {
      transfer = p.t.k === 'direct' ? directTransfer(m.target, p.t.L, p.t.tof) : jgaTransfer(m.target, p.t.L, p.t.t1!, p.t.tof - p.t.t1!);
    }
    const { t: _t, ...rest } = p;
    return { ...(rest as Omit<Design, 'transfer'>), transfer };
  } catch {
    return null;
  }
}

// ---------- leaderboard (this browser only) ----------
export interface LeaderEntry {
  missionId: string;
  name: string;
  score: number;
  grade: string;
  outcome: string;
  difficulty: string;
  date: string;
  code: string;
}

const KEY = 'mission-architect-leaderboard-v1';

export function loadLeaderboard(): LeaderEntry[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveLeader(e: LeaderEntry) {
  try {
    const all = loadLeaderboard();
    all.push(e);
    all.sort((a, b) => b.score - a.score);
    localStorage.setItem(KEY, JSON.stringify(all.slice(0, 100)));
  } catch {
    /* storage unavailable */
  }
}
