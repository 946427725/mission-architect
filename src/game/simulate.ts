// Flies the mission: a timeline of events (some random, all explained) and a
// final outcome + score. Random events are seeded so a flight can be replayed.

import { AVIONICS, BATTERIES, JUPITER_ORBITS, LANDINGS, POWER } from '../data/parts';
import { rocketById } from '../data/rockets';
import { formatJD } from '../physics/time';
import { Evaluation } from './evaluate';
import { mulberry32 } from './rng';
import { Design, RoleId, missionOf } from './state';

export type EventTone = 'info' | 'good' | 'bad' | 'critical';
export interface SimEvent {
  jd: number;
  phase: 'launch' | 'cruise' | 'flyby' | 'arrival' | 'science' | 'end';
  title: string;
  text: string;
  tone: EventTone;
  saved?: string; // which design choice saved the day
}

export type Outcome = 'success' | 'partial' | 'failure';

export interface RoleGoal {
  role: RoleId;
  goal: string;
  met: boolean;
}

export interface SimResult {
  events: SimEvent[];
  outcome: Outcome;
  science: number;
  scienceFraction: number;
  lostAt?: string;
  score: { items: [string, number][]; total: number; grade: string; stars: number };
  roleGoals: RoleGoal[];
  seed: number;
}

export const ROLE_INFO: Record<RoleId, { title: string; owns: string; color: string }> = {
  flight: { title: 'Flight Dynamics Officer', owns: 'Trajectory & rocket', color: '#5ad1ff' },
  engineer: { title: 'Spacecraft Systems Engineer', owns: 'Power, propulsion & survival', color: '#ffb84d' },
  science: { title: 'Principal Investigator', owns: 'Science instruments', color: '#8cff8c' },
  ops: { title: 'Ground & Budget Lead', owns: 'Communications & budget', color: '#ff7ad9' },
};

export function roleGoals(ev: Evaluation): RoleGoal[] {
  const m = ev.mission;
  return [
    { role: 'flight', goal: 'Rocket capacity margin ≥ 10%', met: (ev.mass.margin ?? -1) >= 0.1 },
    { role: 'engineer', goal: 'Power margin ≥ 20% and Δv margin ≥ 10%', met: ev.power.margin >= 0.2 && ev.dv.margin >= 0.1 },
    { role: 'science', goal: `Expected science ≥ ${Math.round(m.scienceTarget * 1.2)} points`, met: ev.science.potential >= m.scienceTarget * 1.2 },
    { role: 'ops', goal: 'Return ≥ 95% of data and keep ≥ 10% budget reserve', met: ev.data.fraction >= 0.95 && ev.cost.margin >= 0.1 },
  ];
}

export function simulate(d: Design, ev: Evaluation, seed: number, teamMode: boolean): SimResult {
  const m = missionOf(d);
  const tr = d.transfer!;
  const rand = mulberry32(seed);
  const pScale = d.difficulty === 'easy' ? 0.5 : d.difficulty === 'hard' ? 1.3 : 1;
  const roll = (p: number) => rand() < p * pScale;
  const events: SimEvent[] = [];
  const push = (e: SimEvent) => events.push(e);
  const rocket = rocketById(d.rocketId);
  const power = POWER.find((p) => p.id === d.powerId)!;
  const redundant = AVIONICS.find((a) => a.id === d.avionicsId)!.redundant;
  const battery = BATTERIES.find((b) => b.id === d.batteryId);
  const hasHGA = d.antennaId !== 'lga';

  let sciMult = 1;
  let lost = false;
  let lostAt: string | undefined;
  let lostScienceFraction = 1; // fraction of the science phase completed before loss

  const L = tr.launchJD;
  const A = tr.arriveJD;

  // ---- launch ----
  if (d.difficulty === 'hard' && rand() > rocket.reliability) {
    push({ jd: L, phase: 'launch', title: 'Launch failure', tone: 'critical', text: `${rocket.name} suffered an upper-stage failure. Even a ${(rocket.reliability * 100).toFixed(1)}% reliable rocket sometimes fails - that's why reliability is worth paying for.` });
    lost = true;
    lostAt = 'launch';
    lostScienceFraction = 0;
  } else {
    push({ jd: L, phase: 'launch', title: 'Liftoff!', tone: 'good', text: `${rocket.name} lifts off on ${formatJD(L)} carrying ${Math.round(ev.mass.launch)} kg, leaving Earth at ${tr.vinfDep.toFixed(2)} km/s (C3 ${tr.c3.toFixed(1)} km²/s²).` });
    push({ jd: L + 12, phase: 'cruise', title: 'Trajectory correction 1', tone: 'info', text: 'Small engine burn to fix tiny launch errors. Navigators use Doppler shifts of the radio signal to measure speed to mm/s.' });
  }

  // ---- cruise ----
  const cruiseYears = tr.tofDays / 365.25;
  if (!lost) {
    if (roll(Math.min(0.6, 0.12 * cruiseYears))) {
      const jd = L + tr.tofDays * (0.2 + 0.5 * rand());
      if (redundant) push({ jd, phase: 'cruise', title: 'Computer reset in deep space', tone: 'good', text: 'A cosmic ray flipped a bit in the main computer. The backup computer took over within seconds.', saved: 'Dual-string avionics' });
      else {
        sciMult *= 0.92;
        push({ jd, phase: 'cruise', title: 'Safe mode', tone: 'bad', text: 'A cosmic ray crashed the only computer. Engineers spent 3 weeks recovering it remotely - some instrument calibration time was lost (-8% science).' });
      }
    }
    if (roll(Math.min(0.4, 0.05 * cruiseYears))) {
      const jd = L + tr.tofDays * (0.3 + 0.5 * rand());
      if (redundant) push({ jd, phase: 'cruise', title: 'Reaction wheel failure', tone: 'good', text: 'A spinning wheel used for pointing seized. The spare wheel spun up.', saved: 'Dual-string avionics' });
      else {
        sciMult *= 0.85;
        push({ jd, phase: 'cruise', title: 'Reaction wheel failure', tone: 'bad', text: 'A pointing wheel seized and there is no spare (Kepler and Dawn lost wheels too). Pointing is now done with thrusters, which is less precise (-15% science).' });
      }
    }
    if (tr.flyby) {
      push({ jd: tr.flyby.jd, phase: 'flyby', title: 'Jupiter gravity assist', tone: 'good', text: `Swung past Jupiter at ${tr.flyby.rpRadii.toFixed(1)} Jupiter radii, stealing orbital energy from the giant planet. Burn needed: ${(tr.flyby.dv * 1000).toFixed(0)} m/s.` });
    }
  }

  // ---- arrival ----
  if (!lost) {
    if (m.type === 'lander') {
      const landing = LANDINGS.find((l) => l.id === d.landingId)!;
      push({ jd: A - 0.01, phase: 'arrival', title: 'Seven minutes of terror', tone: 'info', text: `Entering the atmosphere at ${ev.entrySpeed!.toFixed(2)} km/s. The heat shield glows at 1,300 °C, the parachute opens at supersonic speed...` });
      if (roll(landing.risk * 1.5)) {
        lost = true;
        lostAt = 'landing';
        lostScienceFraction = 0;
        push({ jd: A, phase: 'arrival', title: 'Landing failure', tone: 'critical', text: `The ${landing.name.split(' (')[0]} landing system failed in the final seconds. About 1 in ${Math.round(1 / landing.risk)} Mars landings like this fail - Mars is hard.` });
      } else {
        push({ jd: A, phase: 'arrival', title: 'Touchdown confirmed!', tone: 'good', text: `${landing.name.split(' (')[0]} delivered a ${Math.round(ev.mass.rover!)} kg rover safely to the surface.` });
      }
    } else if (m.type === 'orbiter') {
      const orbit = JUPITER_ORBITS.find((o) => o.id === d.orbitId)!;
      if (orbit.id !== 'polar53' && roll(0.15)) {
        if (ev.dv.margin >= 0.25) {
          push({ jd: A + 30, phase: 'arrival', title: 'Main engine valve anomaly', tone: 'good', text: 'Two engine valves opened slowly - exactly what happened to Juno in 2016. Your extra propellant margin let the team use a gentler, longer burn plan.', saved: 'Propellant margin ≥ 25%' });
        } else {
          sciMult *= 0.75;
          push({ jd: A + 30, phase: 'arrival', title: 'Main engine valve anomaly', tone: 'bad', text: "Two engine valves opened slowly (just like Juno in 2016). Without propellant margin to spare, the team stays in the long 53-day orbit: fewer close passes (-25% science)." });
        }
      }
      push({ jd: A, phase: 'arrival', title: 'Orbit insertion burn', tone: 'good', text: `The main engine fired for ${(ev.dv.insertion * 1000).toFixed(0)} m/s worth of braking. Captured into a ${orbit.name.toLowerCase()}.` });
    } else {
      if (roll(0.2)) {
        const jd = A - 10;
        if (redundant) push({ jd, phase: 'arrival', title: 'Safe mode 10 days before flyby!', tone: 'good', text: 'The main computer overloaded - just like New Horizons on 4 July 2015. The backup took over and the team re-uploaded the flyby plan in time.', saved: 'Dual-string avionics' });
        else {
          sciMult *= 0.7;
          push({ jd, phase: 'arrival', title: 'Safe mode 10 days before flyby!', tone: 'bad', text: 'The only computer crashed. The team recovered it, but lost part of the flyby observation sequence (-30% science).' });
        }
      }
      push({ jd: A, phase: 'arrival', title: 'Closest approach', tone: 'good', text: `Flew past ${m.target === 'pluto' ? 'Pluto' : m.target} at ${tr.vinfArr.toFixed(1)} km/s. All instruments collected data in a few hours of frantic activity.` });
    }
  }

  // ---- science phase ----
  if (!lost && m.type === 'lander') {
    if (roll(0.35)) {
      const frac = 0.3 + 0.5 * rand();
      const jd = A + m.primaryDays * frac;
      if (power.kind === 'rtg') push({ jd, phase: 'science', title: 'Global dust storm', tone: 'good', text: 'A planet-wide dust storm blocked out the Sun for weeks. Your nuclear power source did not care.', saved: 'RTG power' });
      else if (battery && battery.wh >= 6000) {
        sciMult *= 0.85;
        push({ jd, phase: 'science', title: 'Global dust storm', tone: 'bad', text: 'Sunlight dropped by 95%. Your large battery kept the heaters running while the rover hibernated (-15% science).' , saved: 'Large battery' });
      } else {
        lost = true;
        lostAt = 'dust storm';
        lostScienceFraction = frac;
        push({ jd, phase: 'science', title: 'Global dust storm', tone: 'critical', text: 'A planet-wide dust storm blocked the Sun. The solar panels could not keep the heaters on and the rover froze - the same way Opportunity died in 2018.' });
      }
    }
    if (!lost && roll(0.15)) {
      const jd = A + m.primaryDays * (0.2 + 0.6 * rand());
      if (hasHGA) push({ jd, phase: 'science', title: 'Relay orbiter failure', tone: 'good', text: 'One of the aging relay orbiters went silent. Your high-gain dish talks directly to Earth as backup.', saved: 'High-gain antenna' });
      else {
        sciMult *= 0.7;
        push({ jd, phase: 'science', title: 'Relay orbiter failure', tone: 'bad', text: 'A relay orbiter went silent and you have no direct-to-Earth dish. Data volume collapsed (-30% science).' });
      }
    }
  }
  if (!lost && m.type === 'orbiter' && roll(0.35)) {
    const jd = A + m.primaryDays * (0.15 + 0.5 * rand());
    if (redundant) push({ jd, phase: 'science', title: 'Safe mode at closest approach', tone: 'good', text: 'A radiation spike near Jupiter reset the computer during a close pass - Juno had several of these. The backup computer kept the science sequence running.', saved: 'Dual-string avionics' });
    else {
      sciMult *= 0.9;
      push({ jd, phase: 'science', title: 'Safe mode at closest approach', tone: 'bad', text: 'A radiation spike reset the only computer during a close pass. Science from that orbit was lost (-10% science).' });
    }
  }
  if (!lost && m.type === 'flyby' && roll(0.25)) {
    const jd = L + tr.tofDays * (0.55 + 0.3 * rand());
    if (ev.power.margin >= 0.1) push({ jd, phase: 'cruise', title: 'Wake-up from hibernation', tone: 'good', text: 'After years asleep, the team woke the spacecraft to test every instrument. Your power margin let them run all instruments at once.', saved: 'Power margin ≥ 10%' });
    else {
      sciMult *= 0.92;
      push({ jd, phase: 'cruise', title: 'Wake-up from hibernation', tone: 'bad', text: 'Instrument checkout found the decayed RTG cannot power everything at once. Observations must be taken in turns, so some flyby time is lost (-8% science).' });
    }
  }
  if (!lost && m.type === 'orbiter' && ev.radiation && ev.radiation.maxOrbits < ev.radiation.plannedOrbits) {
    const frac = ev.radiation.maxOrbits / ev.radiation.plannedOrbits;
    push({ jd: A + m.primaryDays * frac, phase: 'science', title: 'Radiation damage', tone: 'critical', text: `After ${ev.radiation.maxOrbits.toFixed(1)} orbits the electronics absorbed ${(ev.radiation.dosePerOrbit * ev.radiation.maxOrbits).toFixed(0)} krad and failed. More shielding would have kept it alive.` });
    lost = true;
    lostAt = 'radiation';
    lostScienceFraction = 1; // already accounted for in the orbit factor
  }
  if (!lost && ev.data.fraction >= 0.9 && roll(0.3)) {
    sciMult *= 1.1;
    push({ jd: A + m.primaryDays * (0.3 + 0.4 * rand()), phase: 'science', title: 'Surprise discovery!', tone: 'good', text: m.type === 'flyby' ? 'Images reveal giant nitrogen-ice glaciers flowing like on Earth. Because you planned enough downlink, the whole data set made it home (+10% science).' : 'An unexpected signal in the data - new science! Spare data capacity let the team follow it up (+10% science).', saved: 'Downlink margin' });
  }

  // power / budget hard failures already blocked launch; still report outcome
  const science = lost && lostAt !== 'radiation' ? ev.science.potential * sciMult * lostScienceFraction : ev.science.potential * sciMult;
  const fraction = science / m.scienceTarget;
  let outcome: Outcome;
  if (lost && lostScienceFraction === 0) outcome = 'failure';
  else if (fraction >= 1) outcome = 'success';
  else if (fraction >= 0.25) outcome = 'partial';
  else outcome = 'failure';

  const endJD = lost && lostAt !== 'radiation' ? events[events.length - 1].jd : A + m.primaryDays;
  push({
    jd: endJD + 1,
    phase: 'end',
    title: outcome === 'success' ? 'Mission accomplished' : outcome === 'partial' ? 'Mission partially successful' : 'Mission lost',
    text: `Science returned: ${Math.round(science)} of ${m.scienceTarget} points.`,
    tone: outcome === 'success' ? 'good' : outcome === 'partial' ? 'info' : 'critical',
  });

  // ---- score ----
  const goals = roleGoals(ev);
  const items: [string, number][] = [];
  items.push(['Science', Math.round(Math.min(1.6, fraction) * 1000)]);
  if (outcome !== 'failure') {
    items.push(['Budget reserve', Math.max(0, Math.round(ev.cost.margin * 600))]);
    const mm = ev.mass.margin ?? 0;
    items.push(['Engineering margins', (mm >= 0.05 ? 75 : 0) + (ev.power.margin >= 0.15 ? 75 : 0) + (ev.dv.margin >= 0.1 ? 50 : 0)]);
    items.push(['Fast arrival', Math.max(0, Math.round(((m.maxTofDays - tr.tofDays) / m.maxTofDays) * 300))]);
  }
  if (teamMode) items.push(['Team role goals', goals.filter((g) => g.met).length * 100]);
  let total = items.reduce((s, [, v]) => s + v, 0);
  const outcomeMult = outcome === 'success' ? 1 : outcome === 'partial' ? 0.7 : 0.25;
  const diffMult = d.difficulty === 'easy' ? 0.8 : d.difficulty === 'hard' ? 1.25 : 1;
  if (outcomeMult !== 1) items.push([`${outcome === 'partial' ? 'Partial success' : 'Mission lost'} × ${outcomeMult}`, Math.round(total * outcomeMult) - total]);
  total = Math.round(total * outcomeMult);
  if (diffMult !== 1) items.push([`${d.difficulty === 'easy' ? 'Easy' : 'Hard'} mode × ${diffMult}`, Math.round(total * diffMult) - total]);
  total = Math.round(total * diffMult);
  const grade = total >= 2000 ? 'S' : total >= 1600 ? 'A' : total >= 1200 ? 'B' : total >= 800 ? 'C' : total >= 400 ? 'D' : 'F';
  const stars = outcome === 'failure' ? 0 : total >= 1800 ? 3 : total >= 1200 ? 2 : 1;

  events.sort((a, b) => a.jd - b.jd);
  return { events, outcome, science, scienceFraction: fraction, lostAt, score: { items, total, grade, stars }, roleGoals: goals, seed };
}
