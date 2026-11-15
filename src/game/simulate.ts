// Flies the mission: a timeline of events (some random, all explained) and a
// final outcome + score. Random events are seeded so a flight can be replayed.

import { AVIONICS, BATTERIES, JUPITER_ORBITS, LANDINGS, POWER } from '../data/parts';
import { rocketById } from '../data/rockets';
import { formatJD } from '../physics/time';
import { Evaluation, adcsOf } from './evaluate';
import { hashString, mulberry32 } from './rng';
import { Design, RoleId, missionOf } from './state';

export type EventTone = 'info' | 'good' | 'bad' | 'critical';
export interface SimEvent {
  jd: number;
  phase: 'launch' | 'cruise' | 'flyby' | 'arrival' | 'science' | 'end';
  title: string;
  text: string;
  tone: EventTone;
  saved?: string; // which design choice saved the day
  survived?: string; // a choice that prevented the worst, though science was still lost
  fix?: string; // the design choice that would have prevented this
  call?: CallPoint; // a Mission Control decision the player makes during the flight
}

// ---------------------------------------------------------------- Mission Control decisions
export type CallId = 'tcm' | 'site' | 'storm' | 'valve' | 'endgame' | 'hazard';
export type Calls = Partial<Record<CallId, string>>;
export interface CallOption {
  id: string;
  label: string;
  detail: string;
}
export interface CallPoint {
  id: CallId;
  role: RoleId;
  title: string;
  prompt: string;
  options: CallOption[];
  auto: string; // what the autopilot / flight rules do if nobody answers
  chosen: string;
  decided: boolean; // false = the player has not answered (yet)
  result: string;
  tone: EventTone;
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
  calls: Calls;
  /** calls the autopilot made because nobody answered in time */
  autopilot?: CallId[];
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

export function simulate(d: Design, ev: Evaluation, seed: number, teamMode: boolean, calls: Calls = {}): SimResult {
  const m = missionOf(d);
  const tr = d.transfer!;
  // Every event draws from its own random stream, so changing one part of the
  // design never reshuffles the luck of unrelated events (needed for what-if).
  const stream = (key: string) => mulberry32((seed ^ hashString(key)) >>> 0);
  const pScale = d.difficulty === 'easy' ? 0.5 : d.difficulty === 'hard' ? 1.3 : d.difficulty === 'sandbox' ? 0 : 1;
  const chance = (key: string, p: number) => {
    const r = stream(key);
    return { hit: r() < p * pScale, at: r() };
  };
  const events: SimEvent[] = [];
  const push = (e: SimEvent) => events.push(e);
  const rocket = rocketById(d.rocketId);
  const power = POWER.find((p) => p.id === d.powerId)!;
  const redundant = AVIONICS.find((a) => a.id === d.avionicsId)!.redundant;
  const battery = BATTERIES.find((b) => b.id === d.batteryId);
  const hasHGA = d.antennaId !== 'lga';
  const adcs = adcsOf(d);
  const landing = LANDINGS.find((l) => l.id === d.landingId);

  // Mission Control calls: each one is an event the flight pauses on. Until the
  // player answers, the flight rules' default ("auto") is simulated.
  const ask = (jd: number, phase: SimEvent['phase'], c: Omit<CallPoint, 'chosen' | 'decided' | 'result' | 'tone'>): { call: CallPoint; chosen: string } => {
    const chosen = calls[c.id] && c.options.some((o) => o.id === calls[c.id]) ? calls[c.id]! : c.auto;
    const call: CallPoint = { ...c, chosen, decided: calls[c.id] !== undefined, result: '', tone: 'info' };
    push({ jd, phase, title: c.title, text: c.prompt, tone: 'info', call });
    return { call, chosen };
  };
  const done = (c: CallPoint, tone: EventTone, result: string) => {
    c.tone = tone;
    c.result = result;
  };
  let dvMargin = ev.dv.margin;
  let landingRiskMult = 1;
  let bonus: [string, number][] = [];

  let sciMult = 1;
  let lost = false;
  let lostAt: string | undefined;
  let lostScienceFraction = 1; // fraction of the science phase completed before loss

  const L = tr.launchJD;
  const A = tr.arriveJD;

  // ---- launch ----
  if (d.difficulty === 'hard' && stream('launch')() > rocket.reliability) {
    push({ jd: L, phase: 'launch', title: 'Launch failure', tone: 'critical', text: `${rocket.name} suffered an upper-stage failure. Even a ${(rocket.reliability * 100).toFixed(1)}% reliable rocket sometimes fails - that's why reliability is worth paying for.` });
    lost = true;
    lostAt = 'launch';
    lostScienceFraction = 0;
  } else {
    push({ jd: L, phase: 'launch', title: 'Liftoff!', tone: 'good', text: `${rocket.name} lifts off on ${formatJD(L)} carrying ${Math.round(ev.mass.launch)} kg, leaving Earth at ${tr.vinfDep.toFixed(2)} km/s (C3 ${tr.c3.toFixed(1)} km²/s²).` });
    push({ jd: L + 12, phase: 'cruise', title: 'Trajectory correction 1', tone: 'info', text: 'Small engine burn to fix tiny launch errors. Navigators use Doppler shifts of the radio signal to measure speed to mm/s.' });
    const tcm = ask(L + Math.min(70, tr.tofDays * 0.12), 'cruise', {
      id: 'tcm', role: 'flight', title: 'Course correction',
      prompt: `Radio tracking shows you will miss the aim point at ${m.target === 'mars' ? 'Mars' : m.target === 'jupiter' ? 'Jupiter' : 'Pluto'} by about 5,000 km. Fixing it early is cheap; every month you wait makes the burn bigger.`,
      options: [
        { id: 'now', label: 'Burn now', detail: 'Small burn, back on course. Costs almost no fuel.' },
        { id: 'later', label: 'Wait for better tracking', detail: 'More precise aim later, but a 3× bigger burn eats ~4% of your fuel margin.' },
        { id: 'skip', label: 'Skip it, save the fuel', detail: m.type === 'lander' ? 'Arrive off target: the entry corridor gets tighter (landing risk ×1.6).' : m.type === 'orbiter' ? 'Arrive off target: the first close passes are lost (-10% science).' : 'Arrive off target: cameras point where Pluto should be (-15% science).' },
      ],
      auto: 'now',
    });
    if (tcm.chosen === 'now') {
      dvMargin -= 0.005;
      done(tcm.call, 'good', 'Burn complete. The spacecraft is back on the planned path.');
    } else if (tcm.chosen === 'later') {
      dvMargin -= 0.04;
      if (m.type === 'lander') landingRiskMult *= 0.9;
      else if (m.type === 'flyby') sciMult *= 1.03;
      done(tcm.call, dvMargin >= 0 ? 'good' : 'bad', dvMargin >= 0 ? `Patience paid off: a more precise aim${m.type === 'lander' ? ' and a smaller landing ellipse' : m.type === 'flyby' ? ' and sharper flyby timing (+3% science)' : ''}, for ${Math.round(0.04 * 100)}% of the fuel margin.` : 'The bigger burn used fuel you did not have spare. The tanks now run below the plan.');
    } else {
      dvMargin += 0.01;
      if (m.type === 'lander') landingRiskMult *= 1.6;
      else if (m.type === 'orbiter') sciMult *= 0.9;
      else sciMult *= 0.85;
      done(tcm.call, 'bad', m.type === 'lander' ? 'Fuel saved, but you arrive 5,000 km off target: the entry corridor is tighter (landing risk ×1.6).' : m.type === 'orbiter' ? 'Fuel saved, but the arrival is off: the first close passes are lost (-10% science).' : 'Fuel saved, but the flyby is off target: part of the observation plan misses Pluto (-15% science).');
    }
  }

  // ---- cruise ----
  const cruiseYears = tr.tofDays / 365.25;
  if (!lost) {
    const reset = chance('cruise-reset', Math.min(0.6, 0.12 * cruiseYears));
    if (reset.hit) {
      const jd = L + tr.tofDays * (0.2 + 0.5 * reset.at);
      if (redundant) push({ jd, phase: 'cruise', title: 'Computer reset in deep space', tone: 'good', text: 'A cosmic ray flipped a bit in the main computer. The backup computer took over within seconds.', saved: 'Backup computer' });
      else {
        sciMult *= 0.92;
        push({ jd, phase: 'cruise', title: 'Safe mode', tone: 'bad', text: 'A cosmic ray crashed the only computer. Engineers spent 3 weeks recovering it remotely - some instrument calibration time was lost (-8% science).', fix: 'Backup computer' });
      }
    }
    const wheel = chance('cruise-wheel', Math.min(0.4, 0.05 * cruiseYears));
    if (wheel.hit && adcs.wheels) {
      const jd = L + tr.tofDays * (0.3 + 0.5 * wheel.at);
      if (redundant) push({ jd, phase: 'cruise', title: 'Reaction wheel failure', tone: 'good', text: 'A spinning wheel used for pointing seized. The spare wheel spun up.', saved: 'Backup computer & spare wheel' });
      else {
        sciMult *= 0.85;
        push({ jd, phase: 'cruise', title: 'Reaction wheel failure', tone: 'bad', text: 'A pointing wheel seized and there is no spare (Kepler and Dawn lost wheels too). Pointing is now done with thrusters, which is less precise (-15% science).', fix: 'Backup computer' });
      }
    }
    if (tr.flyby) {
      push({ jd: tr.flyby.jd, phase: 'flyby', title: 'Jupiter gravity assist', tone: 'good', text: `Swung past Jupiter at ${tr.flyby.rpRadii.toFixed(1)} Jupiter radii, stealing orbital energy from the giant planet. Burn needed: ${(tr.flyby.dv * 1000).toFixed(0)} m/s.` });
    }
  }

  // ---- arrival ----
  if (!lost) {
    if (m.type === 'lander' && landing) {
      const precise = landing.id === 'skycrane';
      const site = ask(A - 45, 'cruise', {
        id: 'site', role: 'science', title: 'Choose the landing site',
        prompt: 'The science team wants an ancient river delta full of clay and boulders, where signs of past life would be preserved. The engineers want a flat, empty lava plain.',
        options: [
          { id: 'plain', label: 'Flat lava plain', detail: 'Landing risk ×0.6, but duller rocks (-15% science).' },
          { id: 'delta', label: 'Ancient river delta', detail: precise ? 'Jezero-style: +20% science. Your sky crane has terrain-relative navigation, so the risk stays normal.' : '+20% science, but boulders and cliffs: landing risk ×1.8 without the sky crane\'s precision navigation.' },
        ],
        auto: 'plain',
      });
      if (site.chosen === 'plain') {
        landingRiskMult *= 0.6;
        sciMult *= 0.85;
        done(site.call, 'info', 'Safe choice: a flat plain with few hazards (landing risk ×0.6), but less exciting geology (-15% science).');
      } else {
        landingRiskMult *= precise ? 1 : 1.8;
        sciMult *= 1.2;
        done(site.call, precise ? 'good' : 'bad', precise ? 'Jezero-style delta selected (+20% science). Terrain-relative navigation will steer around the boulders, just like Perseverance.' : 'River delta selected (+20% science), but without precision navigation the boulder fields make landing riskier (×1.8).');
      }
      push({ jd: A - 0.01, phase: 'arrival', title: 'Seven minutes of terror', tone: 'info', text: `Entering the atmosphere at ${ev.entrySpeed!.toFixed(2)} km/s. The heat shield glows at 1,300 °C, the parachute opens at supersonic speed...` });
      if (chance('landing', landing.risk * 1.5 * landingRiskMult).hit) {
        lost = true;
        lostAt = 'landing';
        lostScienceFraction = 0;
        push({ jd: A, phase: 'arrival', title: 'Landing failure', tone: 'critical', text: `The ${landing.name.split(' (')[0]} landing system failed in the final seconds. About 1 in ${Math.round(1 / landing.risk)} Mars landings like this fail - Mars is hard.`, fix: 'A lower-risk landing system' });
      } else {
        push({ jd: A, phase: 'arrival', title: 'Touchdown confirmed!', tone: 'good', text: `${landing.name.split(' (')[0]} delivered a ${Math.round(ev.mass.rover!)} kg rover safely to the surface.` });
      }
    } else if (m.type === 'orbiter') {
      const orbit = JUPITER_ORBITS.find((o) => o.id === d.orbitId)!;
      if (dvMargin < 0) {
        lost = true;
        lostAt = 'orbit insertion';
        lostScienceFraction = 0;
        push({ jd: A, phase: 'arrival', title: 'Spacecraft lost', tone: 'critical', text: 'The tanks ran dry during the orbit insertion burn. Too slow to be captured, the spacecraft sailed past Jupiter for ever.', fix: 'More fuel (and burn course corrections early)' });
      } else if (orbit.id !== 'polar53' && chance('valve', 0.15).hit) {
        const valve = ask(A + 30, 'arrival', {
          id: 'valve', role: 'engineer', title: 'Main engine valve anomaly',
          prompt: 'Two helium valves opened too slowly before the burn that shortens your orbit - exactly what happened to Juno in October 2016. Fire the engine anyway?',
          options: [
            { id: 'stay', label: 'Stay in the 53-day orbit', detail: 'What Juno did: zero risk, but far fewer close passes (-25% science).' },
            { id: 'burn', label: 'Fire the engine anyway', detail: dvMargin >= 0.25 ? 'You have 25%+ spare fuel, so a gentler, longer burn plan is possible.' : 'Without spare fuel the burn must be hard and fast: about a 1-in-3 chance of losing the spacecraft.' },
          ],
          auto: 'stay',
        });
        if (valve.chosen === 'stay') {
          sciMult *= 0.75;
          done(valve.call, 'bad', 'The team keeps the long 53-day orbit, like Juno: safe, but fewer close passes (-25% science).');
        } else if (dvMargin >= 0.25) {
          done(valve.call, 'good', 'Your spare fuel allowed a gentle, longer burn. The orbit is shortened and all the close passes are kept.');
        } else if (stream('valve-burn')() < 0.33) {
          lost = true;
          lostAt = 'engine burn';
          lostScienceFraction = 0;
          done(valve.call, 'critical', 'The engine shut down mid-burn and the spacecraft tumbled. Contact was lost.');
          push({ jd: A + 31, phase: 'arrival', title: 'Spacecraft lost', tone: 'critical', text: 'The risky burn failed. Juno\'s team chose the safe orbit for exactly this reason.', fix: 'More fuel (25% spare) or the safe choice' });
        } else {
          done(valve.call, 'good', 'Risky, but it worked: the orbit is shortened and every close pass is kept.');
        }
      }
      if (!(lost && lostAt === 'orbit insertion')) push({ jd: A, phase: 'arrival', title: 'Orbit insertion burn', tone: 'good', text: `The main engine fired for ${(ev.dv.insertion * 1000).toFixed(0)} m/s worth of braking. Captured into a ${orbit.name.toLowerCase()}.` });
    } else {
      const hazard = ask(A - 20, 'arrival', {
        id: 'hazard', role: 'flight', title: 'Hazard search',
        prompt: 'Telescope images show a faint ring of dust that might cross your planned path. At 14 km/s, a grain the size of rice could destroy the spacecraft. New Horizons faced the same choice in 2015.',
        options: [
          { id: 'safe', label: 'Switch to the safe-haven path', detail: 'Fly 3× farther from Pluto: no risk, but fuzzier images (-15% science).' },
          { id: 'close', label: 'Keep the planned close path', detail: 'Full science. Small chance (about 1 in 16) of a fatal dust hit.' },
        ],
        auto: 'safe',
      });
      if (hazard.chosen === 'safe') {
        sciMult *= 0.85;
        done(hazard.call, 'info', 'Safe-haven path uploaded: no dust risk, but the closest approach is farther away (-15% science).');
      } else if (stream('debris')() < 0.06) {
        lost = true;
        lostAt = 'dust impact';
        lostScienceFraction = 0;
        done(hazard.call, 'critical', 'The team kept the close path...');
        push({ jd: A - 0.5, phase: 'arrival', title: 'Spacecraft lost', tone: 'critical', text: 'Hours before closest approach the signal stopped: a dust grain hit the spacecraft at 14 km/s.', fix: 'The safe-haven path' });
      } else {
        done(hazard.call, 'good', 'The team kept the close path, like New Horizons. No dust hit: full science.');
      }
      if (!lost && chance('flyby-safemode', 0.2).hit) {
        const jd = A - 10;
        if (redundant) push({ jd, phase: 'arrival', title: 'Safe mode 10 days before flyby!', tone: 'good', text: 'The main computer overloaded - just like New Horizons on 4 July 2015. The backup took over and the team re-uploaded the flyby plan in time.', saved: 'Backup computer' });
        else {
          sciMult *= 0.7;
          push({ jd, phase: 'arrival', title: 'Safe mode 10 days before flyby!', tone: 'bad', text: 'The only computer crashed. The team recovered it, but lost part of the flyby observation sequence (-30% science).', fix: 'Backup computer' });
        }
      }
      if (!lost) push({ jd: A, phase: 'arrival', title: 'Closest approach', tone: 'good', text: `Flew past ${m.target === 'pluto' ? 'Pluto' : m.target} at ${tr.vinfArr.toFixed(1)} km/s. All instruments collected data in a few hours of frantic activity.` });
    }
  }

  // ---- science phase ----
  if (!lost && m.type === 'lander') {
    const storm = chance('dust-storm', 0.35);
    if (storm.hit) {
      const frac = 0.3 + 0.5 * storm.at;
      const jd = A + m.primaryDays * frac;
      const wh = battery?.wh ?? 0;
      if (power.kind === 'rtg') push({ jd, phase: 'science', title: 'Global dust storm', tone: 'good', text: 'A planet-wide dust storm blocked out the Sun for weeks. Your nuclear power source did not care.', saved: 'Nuclear power (RTG)' });
      else {
        const st = ask(jd - 2, 'science', {
          id: 'storm', role: 'engineer', title: 'Dust storm warning',
          prompt: 'Orbiters see a dust storm growing to cover the whole planet. Sunlight on your solar panels will drop by 95% for weeks. Batteries must keep the heaters on through freezing nights.',
          options: [
            { id: 'hibernate', label: 'Hibernate: heaters only', detail: `Switch off every instrument and wait. A 6 kWh battery is safe; 2.5 kWh is a coin flip; less will freeze (you have ${wh ? wh / 1000 + ' kWh' : 'none'}). -20% science.` },
            { id: 'work', label: 'Keep working through it', detail: `More science, but only a 6 kWh battery can feed instruments and heaters (you have ${wh ? wh / 1000 + ' kWh' : 'none'}).` },
          ],
          auto: 'hibernate',
        });
        const survives = st.chosen === 'hibernate' ? wh >= 6000 || (wh >= 2500 && stream('storm-hibernate')() < 0.5) : wh >= 6000;
        if (survives) {
          sciMult *= st.chosen === 'hibernate' ? (wh >= 6000 ? 0.8 : 0.72) : 0.9;
          done(st.call, 'good', st.chosen === 'hibernate' ? wh >= 6000 ? 'The rover sleeps through the storm with its heaters on (-20% science), and wakes up when the sky clears.' : 'The battery barely lasted: the rover woke up weak when the sky cleared, with weeks of science lost (-28%).' : 'Your big battery kept instruments and heaters running through the storm (-10% science).');
          push({ jd, phase: 'science', title: 'Global dust storm', tone: 'bad', text: 'Sunlight dropped by 95% for weeks. The rover survived thanks to the plan and its battery.', survived: wh >= 6000 ? 'Large battery' : 'Hibernation + battery', fix: 'Nuclear power (RTG)' });
        } else {
          lost = true;
          lostAt = 'dust storm';
          lostScienceFraction = frac;
          done(st.call, 'critical', 'The battery could not keep the heaters on through the storm.');
          push({ jd, phase: 'science', title: 'Global dust storm', tone: 'critical', text: 'The batteries ran flat, the heaters stopped and the rover froze - the same way Opportunity died in 2018.', fix: 'Nuclear power (RTG) or a bigger battery' });
        }
      }
    }
    const relay = chance('relay', 0.15);
    if (!lost && relay.hit) {
      const jd = A + m.primaryDays * (0.2 + 0.6 * relay.at);
      if (hasHGA) push({ jd, phase: 'science', title: 'Relay orbiter failure', tone: 'good', text: 'One of the aging relay orbiters went silent. Your high-gain dish talks directly to Earth as backup.', saved: 'High-gain dish' });
      else {
        sciMult *= 0.7;
        push({ jd, phase: 'science', title: 'Relay orbiter failure', tone: 'bad', text: 'A relay orbiter went silent and you have no direct-to-Earth dish. Data volume collapsed (-30% science).', fix: 'A high-gain dish' });
      }
    }
  }
  const perijove = chance('perijove-safemode', 0.35);
  if (!lost && m.type === 'orbiter' && perijove.hit) {
    const jd = A + m.primaryDays * (0.15 + 0.5 * perijove.at);
    if (redundant) push({ jd, phase: 'science', title: 'Safe mode at closest approach', tone: 'good', text: 'A radiation spike near Jupiter reset the computer during a close pass - Juno had several of these. The backup computer kept the science sequence running.', saved: 'Backup computer' });
    else {
      sciMult *= 0.9;
      push({ jd, phase: 'science', title: 'Safe mode at closest approach', tone: 'bad', text: 'A radiation spike reset the only computer during a close pass. Science from that orbit was lost (-10% science).', fix: 'Backup computer' });
    }
  }
  const wake = chance('wake-up', 0.25);
  if (!lost && m.type === 'flyby' && wake.hit) {
    const jd = L + tr.tofDays * (0.55 + 0.3 * wake.at);
    if (ev.power.margin >= 0.1) push({ jd, phase: 'cruise', title: 'Wake-up from hibernation', tone: 'good', text: 'After years asleep, the team woke the spacecraft to test every instrument. Your power margin let them run all instruments at once.', saved: 'Power margin ≥ 10%' });
    else {
      sciMult *= 0.92;
      push({ jd, phase: 'cruise', title: 'Wake-up from hibernation', tone: 'bad', text: 'Instrument checkout found the decayed RTG cannot power everything at once. Observations must be taken in turns, so some flyby time is lost (-8% science).', fix: 'More power (10% spare)' });
    }
  }
  let radiationEnded = false;
  if (!lost && m.type === 'orbiter' && ev.radiation && ev.radiation.maxOrbits < ev.radiation.plannedOrbits) {
    const frac = ev.radiation.maxOrbits / ev.radiation.plannedOrbits;
    radiationEnded = true;
    push({ jd: A + m.primaryDays * frac, phase: 'science', title: 'Radiation ends the mission early', tone: 'bad', text: `After ${ev.radiation.maxOrbits.toFixed(1)} of ${ev.radiation.plannedOrbits.toFixed(0)} planned orbits the electronics had absorbed ${(ev.radiation.dosePerOrbit * ev.radiation.maxOrbits).toFixed(0)} krad and stopped working. The science collected until then is safe; a thicker vault would have kept it going.`, fix: 'A heavier radiation vault' });
  }
  if (!lost && !radiationEnded && m.type === 'orbiter' && ev.radiation) {
    const extendOk = ev.radiation.maxOrbits >= ev.radiation.plannedOrbits * 1.35;
    const end = ask(A + m.primaryDays - 2, 'science', {
      id: 'endgame', role: 'science', title: 'End of the primary mission',
      prompt: 'Europa may hide an ocean under its ice. A dead spacecraft drifting around Jupiter could one day crash there and bring Earth microbes with it. What now?',
      options: [
        { id: 'deorbit', label: 'Dive into Jupiter', detail: 'Planetary protection, like Galileo (2003) and Juno: the spacecraft burns up safely (+150 points).' },
        { id: 'extend', label: 'Extend the mission 2 years', detail: extendOk ? 'Your radiation vault can take it: +15% science, then the dive.' : 'More science, but the radiation dose may kill the electronics before the final dive.' },
      ],
      auto: 'deorbit',
    });
    if (end.chosen === 'deorbit') {
      bonus.push(['Planetary protection (Europa kept clean)', 150]);
      done(end.call, 'good', 'Final dive into Jupiter: the spacecraft sends data until it burns up. Europa stays clean (+150 points).');
    } else if (extendOk) {
      sciMult *= 1.15;
      bonus.push(['Planetary protection (Europa kept clean)', 150]);
      done(end.call, 'good', 'Two bonus years of close passes (+15% science), then a controlled dive into Jupiter.');
    } else {
      sciMult *= 1.05;
      bonus.push(['Planetary protection risk', -100]);
      done(end.call, 'bad', 'Radiation killed the electronics during the extension: a little more science (+5%), but a dead spacecraft now drifts near Europa (-100 points).');
    }
  }
  const discovery = chance('discovery', 0.3);
  if (!lost && !radiationEnded && ev.data.fraction >= 0.9 && discovery.hit) {
    sciMult *= 1.1;
    push({ jd: A + m.primaryDays * (0.3 + 0.4 * discovery.at), phase: 'science', title: 'Surprise discovery!', tone: 'good', text: m.type === 'flyby' ? 'Images reveal giant nitrogen-ice glaciers flowing like on Earth. Because you planned enough downlink, the whole data set made it home (+10% science).' : 'An unexpected signal in the data - new science! Spare data capacity let the team follow it up (+10% science).', saved: 'Data margin' });
  }

  // power / budget hard failures already blocked launch; still report outcome
  const science = lost ? ev.science.potential * sciMult * lostScienceFraction : ev.science.potential * sciMult;
  const fraction = science / m.scienceTarget;
  let outcome: Outcome;
  if (lost && lostScienceFraction === 0) outcome = 'failure';
  else if (fraction >= 1) outcome = 'success';
  else if (fraction >= 0.25) outcome = 'partial';
  else outcome = 'failure';

  const endJD = lost ? events[events.length - 1].jd : radiationEnded ? Math.max(...events.map((e) => e.jd)) : A + m.primaryDays;
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
  for (const b of bonus) if (outcome !== 'failure') items.push(b);
  if (teamMode) {
    items.push(['Team role goals', goals.filter((g) => g.met).length * 100]);
    if (goals.every((g) => g.met)) items.push(['Whole team hit its goals', 150]);
  }
  let total = items.reduce((s, [, v]) => s + v, 0);
  const outcomeMult = outcome === 'success' ? 1 : outcome === 'partial' ? 0.7 : 0.25;
  const diffMult = d.difficulty === 'easy' ? 0.8 : d.difficulty === 'hard' ? 1.25 : d.difficulty === 'sandbox' ? 0.5 : 1;
  if (outcomeMult !== 1) items.push([`${outcome === 'partial' ? 'Partial success' : 'Mission lost'} × ${outcomeMult}`, Math.round(total * outcomeMult) - total]);
  total = Math.round(total * outcomeMult);
  if (diffMult !== 1) items.push([`${d.difficulty === 'easy' ? 'Easy' : d.difficulty === 'hard' ? 'Hard' : 'Sandbox'} mode × ${diffMult}`, Math.round(total * diffMult) - total]);
  total = Math.round(total * diffMult);
  const grade = total >= 2000 ? 'S' : total >= 1600 ? 'A' : total >= 1200 ? 'B' : total >= 800 ? 'C' : total >= 400 ? 'D' : 'F';
  const stars = outcome === 'failure' ? 0 : total >= 1800 ? 3 : total >= 1200 ? 2 : 1;

  events.sort((a, b) => a.jd - b.jd);
  return { events, outcome, science, scienceFraction: fraction, lostAt, score: { items, total, grade, stars }, roleGoals: goals, seed, calls: { ...calls } };
}
