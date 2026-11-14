import { MissionDef, missionById } from '../data/missions';
import { Transfer } from '../physics/porkchop';

export type Difficulty = 'easy' | 'normal' | 'hard' | 'sandbox';
export type Tab = 'trajectory' | 'spacecraft' | 'science' | 'comms' | 'launch';
export const TABS: Tab[] = ['trajectory', 'spacecraft', 'science', 'comms', 'launch'];

export type RoleId = 'flight' | 'engineer' | 'science' | 'ops';

export interface ProgramEvent {
  id: 'budgetCut' | 'overrun' | 'none';
  title: string;
  text: string;
  budgetDeltaM: number; // negative = less budget
  costDeltaM: number;
}

export interface Design {
  missionId: string;
  difficulty: Difficulty;
  trajectoryKind: 'direct' | 'jga';
  transfer: Transfer | null;
  powerId: string;
  batteryId: string; // 'none' allowed
  antennaId: string;
  txId: string;
  avionicsId: string;
  shieldId: string;
  landingId?: string;
  orbitId?: string;
  instruments: string[];
  propellantKg: number;
  rocketId: string;
  dsnDish: 34 | 70;
  dsnHours: number;
  programEvent?: ProgramEvent;
}

export interface TeamState {
  enabled: boolean;
  players: string[]; // 1-4 names
  signoffs: Record<RoleId, boolean>;
}

export function defaultDesign(m: MissionDef, difficulty: Difficulty): Design {
  return {
    missionId: m.id,
    difficulty,
    trajectoryKind: 'direct',
    transfer: null,
    powerId: m.defaults.powerId,
    batteryId: 'bat-s',
    antennaId: m.defaults.antennaId,
    txId: m.defaults.txId,
    avionicsId: 'single',
    shieldId: m.defaults.shieldId ?? 'none',
    landingId: m.defaults.landingId,
    orbitId: m.defaults.orbitId,
    instruments: [...m.defaults.instruments],
    propellantKg: m.defaults.propellantKg,
    rocketId: m.defaults.rocketId,
    dsnDish: m.defaults.dsnDish ?? 34,
    dsnHours: m.defaults.dsnHours ?? 8,
  };
}

export const missionOf = (d: Design) => missionById(d.missionId);
