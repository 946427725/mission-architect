// "One change that would have saved it": re-fly the same mission with the same
// luck (same random seed, independent event streams), changing one design
// choice at a time, and rank the changes by how much they improve the score.
import { ADCS, ANTENNAS, AVIONICS, BATTERIES, JUPITER_ORBITS, LANDINGS, POWER, SHIELDS, TRANSMITTERS } from '../data/parts';
import { ROCKETS } from '../data/rockets';
import { autoPropellant, evaluate } from './evaluate';
import { Outcome, SimResult, simulate } from './simulate';
import { Design, Tab, missionOf } from './state';

export interface WhatIf {
  label: string;
  tab: Tab;
  design: Design;
  score: number;
  delta: number;
  outcome: Outcome;
  science: number;
}

export function whatIfs(d: Design, base: SimResult, teamMode: boolean, limit = 3): WhatIf[] {
  const m = missionOf(d);
  const variants: { label: string; tab: Tab; change: Partial<Design> }[] = [];
  const add = (label: string, tab: Tab, change: Partial<Design>) => variants.push({ label, tab, change });

  for (const p of POWER.filter((x) => m.powerIds.includes(x.id) && x.id !== d.powerId)) add(`Power: ${p.name}`, 'spacecraft', { powerId: p.id });
  for (const b of BATTERIES.filter((x) => x.id !== d.batteryId)) add(`Battery: ${b.name}`, 'spacecraft', { batteryId: b.id });
  for (const a of ADCS.filter((x) => x.id !== (d.adcsId ?? m.defaults.adcsId))) add(`Attitude control: ${a.name}`, 'spacecraft', { adcsId: a.id });
  for (const a of AVIONICS.filter((x) => x.id !== d.avionicsId)) add(a.redundant ? 'Add a backup computer' : 'Remove the backup computer', 'spacecraft', { avionicsId: a.id });
  if (m.type === 'orbiter') {
    for (const s of SHIELDS.filter((x) => x.id !== d.shieldId)) add(`Radiation: ${s.name}`, 'spacecraft', { shieldId: s.id });
    for (const o of JUPITER_ORBITS.filter((x) => x.id !== d.orbitId)) add(`Orbit: ${o.name}`, 'spacecraft', { orbitId: o.id });
  }
  if (m.type === 'lander') for (const l of LANDINGS.filter((x) => x.id !== d.landingId)) add(`Landing: ${l.name.split(' (')[0]}`, 'spacecraft', { landingId: l.id });
  for (const a of ANTENNAS.filter((x) => x.id !== d.antennaId)) add(`Antenna: ${a.name}`, 'comms', { antennaId: a.id });
  for (const t of TRANSMITTERS.filter((x) => x.id !== d.txId)) add(`Transmitter: ${t.name}`, 'comms', { txId: t.id });
  if (d.dsnDish !== 70) add('Ground station: 70 m dish', 'comms', { dsnDish: 70 });
  if (d.dsnHours < 24) add('Ground station: listen 24 h/day', 'comms', { dsnHours: 24 });
  for (const i of m.instruments.filter((x) => !d.instruments.includes(x.id))) add(`Add ${i.name}`, 'science', { instruments: [...d.instruments, i.id] });
  for (const r of ROCKETS.filter((x) => x.id !== d.rocketId)) add(`Rocket: ${r.name}`, 'launch', { rocketId: r.id });
  add('Carry 30% spare fuel', 'spacecraft', { propellantKg: -1 });

  const out: WhatIf[] = [];
  for (const v of variants) {
    const d2: Design = { ...d, ...v.change };
    // fuel is always re-sized so a heavier spacecraft can still steer
    d2.propellantKg = v.change.propellantKg === -1 ? autoPropellant(d2, 0.3) : Math.max(d.propellantKg, autoPropellant(d2, 0.12));
    const ev2 = evaluate(d2);
    if (!ev2.launchable) continue;
    const s2 = simulate(d2, ev2, base.seed, teamMode, base.calls);
    out.push({ label: v.label, tab: v.tab, design: d2, score: s2.score.total, delta: s2.score.total - base.score.total, outcome: s2.outcome, science: s2.science });
  }
  return out.filter((w) => w.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, limit);
}
