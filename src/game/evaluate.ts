// The mission "systems engineering" model: turns a design into budgets
// (mass, power, delta-v, data, cost, time) and explains every check.

import {
  ADCS, ANTENNAS, AVIONICS, BATTERIES, JUPITER_ORBITS, LANDINGS, POWER, RADIATION_TOLERANCE_KRAD, SHIELDS, TRANSMITTERS,
} from '../data/parts';
import { Instrument, MissionDef } from '../data/missions';
import { payloadAt, rocketById } from '../data/rockets';
import { AU, BODIES, G0, YEAR_DAYS } from '../physics/constants';
import { orbitalPeriodDays, planetState } from '../physics/ephemeris';
import { formatDuration, formatJD, isoToJD } from '../physics/time';
import { norm, sub } from '../physics/vec';
import { Design, Tab, missionOf } from './state';

export const PROJECT_START_JD = isoToJD('2026-11-14');
const DATA_RATE_K = 20100; // bit/s per (W * m^2 / AU^2) with a 70 m DSN dish - calibrated to New Horizons at Pluto
const MARS_RELAY_MBIT = 500; // Mbit per sol through relay orbiters (Perseverance-class)
const MARS_ENTRY_LIMIT = 7.6; // km/s heat-shield rating (Mars Pathfinder entered at 7.5 km/s)
const DSN_COST: Record<34 | 70, number> = { 34: 1.2, 70: 3.5 }; // $M per (hour/day) per year

export type Status = 'ok' | 'warn' | 'fail';
export interface Check {
  id: string;
  area: Tab;
  label: string;
  status: Status;
  detail: string;
}

export interface Evaluation {
  mission: MissionDef;
  devYears: number;
  readyJD: number;
  mass: { items: [string, number][]; dry: number; propellant: number; launch: number; capacity: number | null; margin: number | null; rover?: number; roverMax?: number };
  dv: { tcm: number; insertion: number; flyby: number; required: number; available: number; margin: number };
  power: { generated: number; avgLoad: number; peakLoad: number; margin: number; batteryNeedWh: number; batteryWh: number; distanceAU: number; kind: string };
  data: { generated: number; capacity: number; fraction: number; rateBps: number; earthDistAU: number; unit: 'Mbit/day' | 'Gbit' };
  cost: { items: [string, number][]; total: number; cap: number; margin: number };
  time: { launchJD: number | null; arriveJD: number | null; tofDays: number | null; endJD: number | null };
  radiation?: { dosePerOrbit: number; maxOrbits: number; plannedOrbits: number; scienceOrbits: number };
  entrySpeed?: number;
  science: { potential: number; target: number; items: [string, number][] };
  checks: Check[];
  launchable: boolean;
}

const find = <T extends { id: string }>(arr: T[], id: string | undefined): T | undefined => arr.find((x) => x.id === id);

export function selectedInstruments(d: Design): Instrument[] {
  const m = missionOf(d);
  return m.instruments.filter((i) => d.instruments.includes(i.id));
}

export function evaluate(d: Design): Evaluation {
  const m = missionOf(d);
  const checks: Check[] = [];
  const add = (c: Check) => checks.push(c);
  const tr = d.transfer;

  const power = find(POWER, d.powerId)!;
  const battery = find(BATTERIES, d.batteryId);
  const antenna = find(ANTENNAS, d.antennaId)!;
  const tx = find(TRANSMITTERS, d.txId)!;
  const avionics = find(AVIONICS, d.avionicsId)!;
  const shield = find(SHIELDS, d.shieldId)!;
  const adcs = adcsOf(d);
  const landing = find(LANDINGS, d.landingId);
  const orbit = find(JUPITER_ORBITS, d.orbitId);
  const rocket = rocketById(d.rocketId);
  const instr = selectedInstruments(d);
  const hasHGA = antenna.id !== 'lga';
  const easy = d.difficulty === 'easy';

  // ---------- development time ----------
  const devYears =
    m.devBaseYears + 0.1 * instr.length + power.devYears + avionics.devYears + adcs.devYears + (landing?.devYears ?? 0) +
    (instr.reduce((s, i) => s + i.mass, 0) > 60 ? 0.3 : 0);
  const readyJD = PROJECT_START_JD + devYears * YEAR_DAYS;

  // ---------- mass ----------
  const instrMass = instr.reduce((s, i) => s + i.mass, 0);
  const commsMass = antenna.mass + tx.mass + (m.type === 'lander' ? 3 : 0);
  const subsystems = power.mass + (battery?.mass ?? 0) + commsMass + avionics.mass + shield.mass;
  const items: [string, number][] = [];
  let dry: number;
  let rover: number | undefined;
  if (m.type === 'lander' && landing) {
    rover = landing.chassis + instrMass + subsystems;
    // the cruise stage carries the attitude control on the way to Mars
    items.push(['Rover', rover], ['Entry, descent & landing system', landing.edlMass], ['Cruise stage', m.busMass + adcs.mass]);
    dry = rover + landing.edlMass + m.busMass + adcs.mass;
  } else {
    const structure = 0.1 * (instrMass + subsystems);
    items.push(
      ['Spacecraft bus', m.busMass],
      ['Instruments', instrMass],
      ['Power', power.mass + (battery?.mass ?? 0)],
      ['Communications', commsMass],
    );
    if (avionics.mass) items.push(['Redundant avionics', avionics.mass]);
    if (shield.mass) items.push(['Radiation vault', shield.mass]);
    items.push(['Attitude control', adcs.mass]);
    items.push(['Structure & cabling', structure]);
    dry = m.busMass + instrMass + subsystems + structure + adcs.mass;
  }
  const propellant = d.propellantKg;
  items.push(['Propellant', propellant]);
  const launchMass = dry + propellant;
  const capacity = tr ? payloadAt(rocket, tr.c3) : null;
  const massMargin = capacity !== null && capacity > 0 ? (capacity - launchMass) / capacity : capacity === 0 ? -1 : null;

  // ---------- delta-v ----------
  let insertion = 0;
  if (m.type === 'orbiter' && tr && orbit) {
    const body = BODIES[m.target];
    const rp = orbit.rpRadii * body.radius;
    const T = orbit.periodDays * 86400;
    const a = Math.cbrt((body.mu * T * T) / (4 * Math.PI * Math.PI));
    insertion = Math.sqrt(tr.vinfArr ** 2 + (2 * body.mu) / rp) - Math.sqrt(body.mu * (2 / rp - 1 / a));
  }
  const flybyDv = tr?.flyby?.dv ?? 0;
  const dvRequired = m.tcmDv + insertion + flybyDv + adcs.fuelDv;
  const dvAvailable = ((m.isp * G0) / 1000) * Math.log(launchMass / dry);
  const dvMargin = dvRequired > 0 ? (dvAvailable - dvRequired) / dvRequired : 1;

  // ---------- power ----------
  const arriveJD = tr?.arriveJD ?? null;
  const targetR = arriveJD ? norm(planetState(m.target, arriveJD).r) / AU : orbitalPeriodDays(m.target, PROJECT_START_JD) ** (2 / 3) / YEAR_DAYS ** (2 / 3);
  const years = ((tr?.tofDays ?? 0) + (m.type === 'flyby' ? 0 : m.primaryDays / 2)) / YEAR_DAYS;
  let generated: number;
  if (power.kind === 'solar') {
    generated = (power.watts / (targetR * targetR)) * Math.pow(1 - power.decayPerYear, years);
    if (m.type === 'lander') generated *= 0.25; // dust, night, low sun angle
  } else {
    generated = power.watts * Math.pow(1 - power.decayPerYear, years);
  }
  const duty = m.type === 'lander' ? 0.12 : m.type === 'orbiter' ? 0.7 : 1.0;
  const instrPeak = instr.reduce((s, i) => s + i.power, 0);
  const instrAvg = instr.reduce((s, i) => s + (i.id === 'moxie' ? i.power * 0.04 : i.power * duty), 0);
  const base = m.busPowerW + (avionics.redundant ? 10 : 0) + (m.type === 'lander' ? 0 : adcs.power);
  const txAvg = m.type === 'lander' ? 15 * (2 / 24) + (hasHGA ? tx.dcW * (1 / 24) : 0) : tx.dcW * (d.dsnHours / 24);
  const avgLoad = base + instrAvg + txAvg;
  const peakLoad = base + instrPeak + tx.dcW;
  const powerMargin = generated / avgLoad - 1;
  let batteryNeedWh = Math.max(0, peakLoad - generated) * 2;
  if (m.type === 'lander' && power.kind === 'solar') batteryNeedWh += 0.6 * base * 12; // survive the night
  const batteryWh = (battery?.wh ?? 0) * 0.8;

  // ---------- data ----------
  let earthDist: number;
  if (m.type === 'flyby' && arriveJD) earthDist = norm(sub(planetState(m.target, arriveJD).r, planetState('earth', arriveJD).r)) / AU;
  else earthDist = Math.max(0.5, targetR);
  const dishFactor = (d.dsnDish / 70) ** 2;
  const rateBps = Math.min(6e6, (DATA_RATE_K * tx.rfW * antenna.diameter ** 2 * dishFactor) / (earthDist * earthDist));
  let generatedData: number;
  let capacityData: number;
  let unit: 'Mbit/day' | 'Gbit';
  if (m.type === 'flyby') {
    unit = 'Gbit';
    generatedData = instr.reduce((s, i) => s + i.data, 0);
    capacityData = (rateBps * d.dsnHours * 3600 * m.primaryDays) / 1e9;
  } else {
    unit = 'Mbit/day';
    generatedData = instr.reduce((s, i) => s + i.data, 0);
    capacityData = (rateBps * d.dsnHours * 3600) / 1e6 + (m.type === 'lander' ? MARS_RELAY_MBIT : 0);
  }
  const dataFraction = generatedData > 0 ? Math.min(1, capacityData / generatedData) : 1;

  // ---------- radiation (Jupiter) ----------
  let radiation: Evaluation['radiation'];
  if (m.type === 'orbiter' && orbit) {
    const dose = orbit.dosePerOrbit * shield.factor;
    const tol = RADIATION_TOLERANCE_KRAD * (avionics.redundant ? 1.3 : 1);
    const maxOrbits = tol / dose;
    const plannedOrbits = m.primaryDays / orbit.periodDays;
    radiation = { dosePerOrbit: dose, maxOrbits, plannedOrbits, scienceOrbits: Math.min(maxOrbits, plannedOrbits) };
  }

  // ---------- science ----------
  const sciItems: [string, number][] = [];
  let speedFactor = 1;
  if (m.type === 'flyby' && tr) speedFactor = Math.min(1.2, Math.max(0.6, 1 + (13.8 - tr.vinfArr) * 0.04));
  const orbitFactor = radiation ? Math.min(1.4, Math.sqrt(radiation.scienceOrbits / 30)) : 1;
  const objective = m.objectives.find((o) => o.id === d.objectiveId) ?? m.objectives[0];
  for (const i of instr) {
    let s = i.science * (objective.weights[i.id] ?? 1) * dataFraction * orbitFactor * speedFactor;
    if (i.needsHGA && !hasHGA) s = 0;
    sciItems.push([i.name, s]);
  }
  if (orbit && orbit.moonBonus > 0) {
    const remote = instr.filter((i) => ['cam', 'jiram', 'uvs'].includes(i.id)).length;
    if (remote) sciItems.push(['Moon flybys (Io, Europa, Ganymede)', orbit.moonBonus * (objective.id === 'moons' ? 2 : 1) * Math.min(1, remote / 2) * dataFraction]);
  }
  if (tr?.kind === 'jga' && instr.some((i) => i.id === 'lorri' || i.id === 'ralph')) sciItems.push(['Bonus: Jupiter flyby science', 8]);
  const outreach = instr.filter((i) => i.outreach).length;
  if (outreach) sciItems.push(['Public engagement (images & student science)', 3 * outreach]);
  const pointing = adcs.science[m.type];
  if (pointing !== 1) {
    const raw = sciItems.reduce((s, [, v]) => s + v, 0);
    sciItems.push([`Pointing: ${adcs.short.toLowerCase()} (${pointing > 1 ? '+' : ''}${Math.round((pointing - 1) * 100)}%)`, raw * (pointing - 1)]);
  }
  const potential = sciItems.reduce((s, [, v]) => s + v, 0);

  // ---------- cost ----------
  const tofYears = (tr?.tofDays ?? 0) / YEAR_DAYS;
  const sciYears = m.primaryDays / YEAR_DAYS;
  const costItems: [string, number][] = [
    [m.type === 'lander' ? 'Rover & cruise stage' : 'Spacecraft bus', m.busCostM],
    ['Instruments', instr.reduce((s, i) => s + i.costM, 0)],
    ['Power system', power.costM + (battery?.costM ?? 0)],
    ['Communications', antenna.costM + tx.costM + (m.type === 'lander' ? 5 : 0)],
  ];
  if (avionics.costM) costItems.push(['Redundant avionics', avionics.costM]);
  costItems.push(['Attitude control', adcs.costM]);
  if (shield.costM) costItems.push(['Radiation vault', shield.costM]);
  if (landing) costItems.push(['Landing system', landing.costM]);
  costItems.push(['Launch: ' + rocket.name, rocket.costM]);
  costItems.push(['Cruise operations', m.cruiseOpsM * tofYears]);
  costItems.push(['Science operations', m.scienceOpsM * sciYears]);
  costItems.push([`Deep Space Network (${d.dsnDish} m, ${d.dsnHours} h/day)`, DSN_COST[d.dsnDish] * d.dsnHours * sciYears]);
  if (d.programEvent?.costDeltaM) costItems.push([d.programEvent.title, d.programEvent.costDeltaM]);
  const total = costItems.reduce((s, [, v]) => s + v, 0);
  const cap = m.budgetCapM * (easy ? 1.2 : d.difficulty === 'sandbox' ? 10 : 1) + (d.programEvent?.budgetDeltaM ?? 0);

  // ---------- checks ----------
  // trajectory
  if (!tr) {
    add({ id: 'traj', area: 'trajectory', label: 'Launch window', status: 'fail', detail: 'Pick a launch date and flight time on the porkchop plot.' });
  } else {
    if (tr.launchJD < readyJD)
      add({ id: 'ready', area: 'trajectory', label: 'Spacecraft ready in time', status: 'fail', detail: `Building this spacecraft takes ${devYears.toFixed(1)} years, so it can't launch before ${formatJD(readyJD)}. Pick a later window or simplify the design.` });
    else
      add({ id: 'ready', area: 'trajectory', label: 'Spacecraft ready in time', status: 'ok', detail: `Ready ${formatJD(readyJD)} (${devYears.toFixed(1)} years of development).` });
    if (tr.tofDays > m.maxTofDays)
      add({ id: 'tof', area: 'trajectory', label: 'Trip length', status: 'fail', detail: `${formatDuration(tr.tofDays)} is longer than the ${formatDuration(m.maxTofDays)} limit - the team would retire before arrival!` });
    else
      add({ id: 'tof', area: 'trajectory', label: 'Trip length', status: 'ok', detail: `${formatDuration(tr.tofDays)} cruise.` });
    if (m.type === 'lander') {
      const body = BODIES[m.target];
      const v = Math.sqrt(tr.vinfArr ** 2 + (2 * body.mu) / (body.radius + 125));
      (checks as Check[]).push({
        id: 'entry', area: 'trajectory', label: 'Atmospheric entry speed',
        status: v > MARS_ENTRY_LIMIT ? 'fail' : v > MARS_ENTRY_LIMIT - 0.5 ? 'warn' : 'ok',
        detail: v > MARS_ENTRY_LIMIT
          ? `You hit the atmosphere at ${v.toFixed(2)} km/s - faster than the heat shield's ${MARS_ENTRY_LIMIT} km/s rating. Fast trips mean hot arrivals: pick a longer flight time.`
          : `Entry at ${v.toFixed(2)} km/s (heat shield rated to ${MARS_ENTRY_LIMIT} km/s). Perseverance entered at 5.4 km/s.`,
      });
    }
  }

  // spacecraft
  if (rover !== undefined && landing) {
    add({
      id: 'rover', area: 'spacecraft', label: 'Rover vs landing system',
      status: rover > landing.maxRover ? 'fail' : rover > landing.maxRover * 0.9 ? 'warn' : 'ok',
      detail: rover > landing.maxRover
        ? `Your rover weighs ${Math.round(rover)} kg but ${landing.name.split(' (')[0]} can only land ${landing.maxRover} kg. Choose a bigger landing system or drop instruments.`
        : `Rover ${Math.round(rover)} kg of ${landing.maxRover} kg allowed.`,
    });
  }
  add({
    id: 'power', area: 'spacecraft', label: 'Power at destination',
    status: powerMargin < 0 ? 'fail' : powerMargin < 0.15 ? 'warn' : 'ok',
    detail:
      (power.kind === 'solar'
        ? `At ${targetR.toFixed(1)} AU sunlight is ${(100 / (targetR * targetR)).toFixed(targetR > 6 ? 2 : 0)}% of Earth's. `
        : `RTG output decays ${(power.decayPerYear * 100).toFixed(1)}% per year. `) +
      `You make ${Math.round(generated)} W but need ${Math.round(avgLoad)} W on average` +
      (powerMargin < 0 ? ' - the spacecraft would freeze and shut down.' : ` (${Math.round(powerMargin * 100)}% margin).`),
  });
  add({
    id: 'battery', area: 'spacecraft', label: 'Battery for peaks' + (m.type === 'lander' && power.kind === 'solar' ? ' & nights' : ''),
    status: batteryNeedWh > batteryWh ? 'fail' : batteryNeedWh > batteryWh * 0.8 ? 'warn' : 'ok',
    detail: batteryNeedWh > batteryWh
      ? `Peak demand of ${Math.round(peakLoad)} W${m.type === 'lander' && power.kind === 'solar' ? ' plus cold nights' : ''} needs ${Math.round(batteryNeedWh)} Wh of battery - you have ${Math.round(batteryWh)} Wh usable. Brown-outs would reset the computer.`
      : `Needs ${Math.round(batteryNeedWh)} Wh, has ${Math.round(batteryWh)} Wh usable.`,
  });
  add({
    id: 'dv', area: 'spacecraft', label: 'Propellant (Δv budget)',
    status: dvAvailable < dvRequired ? 'fail' : dvMargin < 0.1 ? 'warn' : 'ok',
    detail:
      `Needs ${(dvRequired * 1000).toFixed(0)} m/s` +
      (insertion ? ` (incl. ${(insertion * 1000).toFixed(0)} m/s orbit insertion burn)` : '') +
      (flybyDv ? ` (incl. ${(flybyDv * 1000).toFixed(0)} m/s at the Jupiter flyby)` : '') +
      `; your ${Math.round(propellant)} kg of propellant gives ${(dvAvailable * 1000).toFixed(0)} m/s.` +
      (dvAvailable < dvRequired ? (insertion ? ' You would fly straight past Jupiter!' : ' You cannot steer to the target.') : ''),
  });
  if (m.type === 'flyby' && adcs.id === 'spin')
    add({ id: 'adcs', area: 'spacecraft', label: 'Pointing for the flyby', status: 'warn', detail: 'A spinning spacecraft cannot hold a steady stare during a fast flyby: images blur (-20% science). New Horizons switched to 3-axis thruster control for the encounter.' });
  else
    add({ id: 'adcs', area: 'spacecraft', label: 'Pointing', status: 'ok', detail: `${adcs.name} (${adcs.analog}).${m.type === 'lander' ? ' On the cruise stage: the rover itself does not need it.' : ''}` });
  if (radiation) {
    add({
      id: 'rad', area: 'spacecraft', label: 'Radiation survival',
      status: radiation.maxOrbits < 1 ? 'fail' : radiation.maxOrbits < radiation.plannedOrbits ? 'warn' : 'ok',
      detail: radiation.maxOrbits < radiation.plannedOrbits
        ? `Electronics survive ~${radiation.maxOrbits.toFixed(1)} orbits, but the plan has ${radiation.plannedOrbits.toFixed(0)}. Add a radiation vault or the mission ends early.`
        : `Electronics survive ${radiation.maxOrbits.toFixed(0)} orbits - enough for all ${radiation.plannedOrbits.toFixed(0)} planned.`,
    });
  }

  // science
  add({
    id: 'sci', area: 'science', label: 'Science objective',
    status: potential >= m.scienceTarget ? 'ok' : 'warn',
    detail: potential >= m.scienceTarget
      ? `Expected ${Math.round(potential)} science points (goal ${m.scienceTarget}).`
      : `Expected ${Math.round(potential)} of ${m.scienceTarget} points. Add instruments, return more data${radiation ? ' or survive more orbits' : ''}.`,
  });
  if (objective.needsOrbit && orbit && orbit.id !== objective.needsOrbit)
    add({ id: 'objective', area: 'science', label: 'Orbit fits the objective', status: 'warn', detail: `"${objective.name}" needs the ${JUPITER_ORBITS.find((o) => o.id === objective.needsOrbit)!.name.toLowerCase()} to fly past the moons. Change the orbit at Orbit Planning.` });
  const orphan = instr.filter((i) => i.needsHGA && !hasHGA);
  if (orphan.length)
    add({ id: 'hga', area: 'science', label: 'Instrument needs a dish', status: 'warn', detail: `${orphan.map((i) => i.name).join(', ')} needs a high-gain antenna to work.` });

  // comms
  add({
    id: 'data', area: 'comms', label: 'Data return',
    status: dataFraction >= 0.95 ? 'ok' : 'warn',
    detail: m.type === 'flyby'
      ? `At ${earthDist.toFixed(1)} AU your link runs at ${formatRate(rateBps)}. In ${Math.round(m.primaryDays / 30)} months you can send ${capacityData.toFixed(1)} of ${generatedData.toFixed(1)} Gbit (${Math.round(dataFraction * 100)}%).`
      : `Instruments make ${Math.round(generatedData)} Mbit/day; you can send ${Math.round(capacityData)} Mbit/day (${Math.round(dataFraction * 100)}%).` + (dataFraction < 0.95 ? ' Data that never reaches Earth is science lost.' : ''),
  });

  // launch
  if (tr && capacity !== null) {
    add({
      id: 'lv', area: 'launch', label: 'Rocket can lift it',
      status: capacity < launchMass ? 'fail' : (massMargin ?? 0) < 0.05 ? 'warn' : 'ok',
      detail: capacity < launchMass
        ? `${rocket.name} can send ${Math.round(capacity)} kg at C3 ${tr.c3.toFixed(1)} km²/s², but your spacecraft is ${Math.round(launchMass)} kg.`
        : `${rocket.name}: ${Math.round(capacity)} kg capacity at C3 ${tr.c3.toFixed(1)} - ${Math.round((massMargin ?? 0) * 100)}% margin.`,
    });
  }
  add({
    id: 'budget', area: 'launch', label: 'Within budget',
    status: total > cap ? 'fail' : total > cap * 0.95 ? 'warn' : 'ok',
    detail: total > cap
      ? `Total $${fmtM(total)} is over the $${fmtM(cap)} cap. NASA would cancel the mission.`
      : `$${fmtM(total)} of $${fmtM(cap)} (${Math.round(((cap - total) / cap) * 100)}% reserve).`,
  });

  let entrySpeed: number | undefined;
  if (m.type === 'lander' && tr) {
    const body = BODIES[m.target];
    entrySpeed = Math.sqrt(tr.vinfArr ** 2 + (2 * body.mu) / (body.radius + 125));
  }

  return {
    mission: m,
    devYears,
    readyJD,
    mass: { items, dry, propellant, launch: launchMass, capacity, margin: massMargin, rover, roverMax: landing?.maxRover },
    dv: { tcm: m.tcmDv, insertion, flyby: flybyDv, required: dvRequired, available: dvAvailable, margin: dvMargin },
    power: { generated, avgLoad, peakLoad, margin: powerMargin, batteryNeedWh, batteryWh, distanceAU: targetR, kind: power.kind },
    data: { generated: generatedData, capacity: capacityData, fraction: dataFraction, rateBps, earthDistAU: earthDist, unit },
    cost: { items: costItems, total, cap, margin: (cap - total) / cap },
    time: { launchJD: tr?.launchJD ?? null, arriveJD, tofDays: tr?.tofDays ?? null, endJD: arriveJD ? arriveJD + m.primaryDays : null },
    radiation,
    entrySpeed,
    science: { potential, target: m.scienceTarget, items: sciItems },
    checks,
    launchable: !checks.some((c) => c.status === 'fail'),
  };
}

/** The attitude control option of a design (old share links fall back to the mission default). */
export function adcsOf(d: Design) {
  const m = missionOf(d);
  return find(ADCS, d.adcsId) ?? find(ADCS, m.defaults.adcsId) ?? ADCS[0];
}

export const fmtM = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(2)}B` : `${Math.round(v)}M`);
export function formatRate(bps: number): string {
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} Mbit/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(1)} kbit/s`;
  return `${Math.round(bps)} bit/s`;
}

/** Propellant (kg) that gives the required delta-v plus a safety margin. */
export function autoPropellant(d: Design, margin = 0.15): number {
  const ev = evaluate({ ...d, propellantKg: 0 });
  const m = ev.mission;
  const ratio = Math.exp((ev.dv.required * (1 + margin) * 1000) / (m.isp * G0));
  return Math.ceil((ev.mass.dry * (ratio - 1)) / 5) * 5;
}
