// Station panel content, task list, resource gauges and the live wall screens.
import * as THREE from 'three';
import { ADCS, ANTENNAS, AVIONICS, BATTERIES, JUPITER_ORBITS, LANDINGS, POWER, SHIELDS, TRANSMITTERS } from '../data/parts';
import { ROCKETS, payloadAt, rocketById } from '../data/rockets';
import { MISSIONS } from '../data/missions';
import { stationSources } from '../data/sources';
import { Evaluation, Status, evaluate, fmtM, formatRate } from '../game/evaluate';
import { HISTORY } from '../game/history';
import { ROLE_INFO } from '../game/simulate';
import { Design, RoleId, missionOf } from '../game/state';
import { BODIES, BodyId, MU_SUN } from '../physics/constants';
import { orbitPath, planetState } from '../physics/ephemeris';
import { propagate } from '../physics/kepler';
import { formatDuration, formatJD } from '../physics/time';
import type { App } from '../ui/app';
import { esc, fmtInt } from '../ui/dom';
import { statusColor } from '../ui/settings';
import { tr } from '../i18n/i18n';
import { Gauge, St, Task } from './hud';
import { BuiltStation, LiveScreen, StationId, stationById } from './stations';

export interface PanelCtx {
  app: App;
  carrying: string[];
  team: boolean;
  activeRole: RoleId;
  playerFor: (r: RoleId) => string;
}

const SHORT: Record<string, string> = {
  airbags: 'Airbags', retro: 'Retro-rocket lander', skycrane: 'Sky crane',
  'solar-s': 'Small solar panels', 'solar-m': 'Medium solar panels', 'solar-l': 'Giant solar wings', mmrtg: 'MMRTG nuclear battery', gphs: 'GPHS-RTG nuclear battery', gphs2: '2× GPHS-RTG',
  lga: 'Low-gain antenna', hga15: '1.5 m dish', hga21: '2.1 m dish', hga30: '3.0 m dish',
  light: 'Light radiation vault', heavy: 'Heavy radiation vault', dual: 'Backup computer',
  'bat-s': '1 kWh battery', 'bat-m': '2.5 kWh battery', 'bat-l': '6 kWh battery',
  spin: 'Spin stabilization', thrusters: '3-axis thrusters', wheels: 'Reaction wheels',
};

export function partName(key: string, d?: Design, ev?: Evaluation): string {
  const [f, v] = key.split(':');
  if (f === 'instr') {
    const i = MISSIONS.flatMap((x) => x.instruments).find((x) => x.id === v);
    if (!i) return v;
    return `${i.name} (${i.analog})${ev ? ` · +${i.science} pts · ${i.mass} kg · $${i.costM}M` : ''}`;
  }
  if (f === 'txId') {
    const t = TRANSMITTERS.find((x) => x.id === v);
    return t ? `${t.rfW} W radio transmitter${ev ? ` · uses ${t.dcW} W · ${t.mass} kg` : ''}` : v;
  }
  if (f === 'rocketId') {
    const r = rocketById(v);
    if (!ev || !d?.transfer) return `${r.name} · $${fmtM(r.costM)}`;
    return `${r.name} · lifts ${fmtInt(payloadAt(r, d.transfer.c3))} kg to your C3 · $${fmtM(r.costM)}`;
  }
  const base = SHORT[v] ?? v;
  if (!ev) return base;
  if (f === 'powerId') {
    const p = POWER.find((x) => x.id === v)!;
    return `${base} · ${p.mass} kg · $${p.costM}M`;
  }
  if (f === 'antennaId') {
    const a = ANTENNAS.find((x) => x.id === v)!;
    return `${base} · ${a.mass} kg · $${a.costM}M`;
  }
  if (f === 'landingId') {
    const l = LANDINGS.find((x) => x.id === v)!;
    return `${base} · lands up to ${l.maxRover} kg · $${l.costM}M`;
  }
  if (f === 'shieldId') {
    const s = SHIELDS.find((x) => x.id === v)!;
    return `${base} · ${s.mass} kg`;
  }
  if (f === 'batteryId') {
    const b = BATTERIES.find((x) => x.id === v)!;
    return `${base} · ${b.mass} kg`;
  }
  return base;
}

const worst = (s: Status[]): St => (s.includes('fail') ? 'fail' : s.includes('warn') ? 'warn' : 'ok');
const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const first = (s: string) => {
  const t = strip(s).split(/(?<=[.!])\s/)[0];
  return t.length > 110 ? t.slice(0, 108) + '…' : t;
};

// ------------------------------------------------------------------ gauges
export function gaugesFor(ev: Evaluation, pv: Evaluation | null): Gauge[] {
  const st = (ids: string[]) => worst(ev.checks.filter((c) => ids.includes(c.id)).map((c) => c.status));
  const g: Gauge[] = [
    { id: 'mass', label: 'Mass', icon: 'mass', value: `${fmtInt(ev.mass.launch)}<i>kg</i>`, sub: ev.mass.capacity !== null ? `rocket lifts ${fmtInt(ev.mass.capacity)}` : 'no route yet', fill: ev.mass.capacity ? ev.mass.launch / ev.mass.capacity : null, st: st(['lv', 'rover']) },
    { id: 'power', label: 'Power', icon: 'power', value: `${fmtInt(ev.power.generated)}<i>W</i>`, sub: `need ${fmtInt(ev.power.avgLoad)} W`, fill: ev.power.avgLoad / Math.max(1, ev.power.generated), st: st(['power', 'battery']) },
    { id: 'dv', label: 'Δv', icon: 'dv', value: `${fmtInt(ev.dv.available * 1000)}<i>m/s</i>`, sub: `need ${fmtInt(ev.dv.required * 1000)}`, fill: ev.dv.required / Math.max(1e-6, ev.dv.available), st: st(['dv']) },
    { id: 'budget', label: 'Budget', icon: 'budget', value: `$${fmtM(ev.cost.total)}`, sub: `cap $${fmtM(ev.cost.cap)}`, fill: ev.cost.total / ev.cost.cap, st: st(['budget']) },
    { id: 'data', label: 'Data', icon: 'data', value: `${Math.round(ev.data.fraction * 100)}<i>%</i>`, sub: 'gets home', fill: ev.data.fraction, st: st(['data']) },
    { id: 'science', label: 'Science', icon: 'science', value: `${Math.round(ev.science.potential)}`, sub: `goal ${ev.mission.scienceTarget}`, fill: ev.science.potential / ev.mission.scienceTarget, st: st(['sci', 'hga', 'objective']) },
  ];
  if (pv) {
    const diffs: Record<string, [number, string, boolean]> = {
      mass: [pv.mass.launch - ev.mass.launch, 'kg', false],
      power: [pv.power.generated - ev.power.generated - (pv.power.avgLoad - ev.power.avgLoad), 'W', true],
      dv: [(pv.dv.available - ev.dv.available) * 1000, 'm/s', true],
      budget: [pv.cost.total - ev.cost.total, '$M', false],
      data: [(pv.data.fraction - ev.data.fraction) * 100, '%', true],
      science: [pv.science.potential - ev.science.potential, 'pts', true],
    };
    for (const x of g) {
      const [v, u, upGood] = diffs[x.id];
      if (Math.abs(v) < 0.5) continue;
      x.delta = u === '$M' ? `${v > 0 ? '+' : '−'}$${fmtM(Math.abs(v))}` : `${v > 0 ? '+' : '−'}${fmtInt(Math.abs(v))} ${u}`;
      x.deltaGood = v > 0 === upGood;
    }
  }
  return g;
}

// ------------------------------------------------------------------ tasks
type RawTask = Omit<Task, 'color'>;
export function tasksFor(d: Design, ev: Evaluation, ctx: PanelCtx): RawTask[] {
  const m = missionOf(d);
  const defs: { id: string; label: string; station: StationId; checks: string[] }[] = [
    { id: 'route', label: 'Pick a launch date', station: 'flight', checks: ['traj', 'ready', 'tof', 'entry'] },
  ];
  if (m.type === 'lander') defs.push({ id: 'landing', label: 'Landing system', station: 'landing', checks: ['rover'] });
  if (m.type === 'orbiter') defs.push({ id: 'orbit', label: 'Science orbit', station: 'orbit', checks: ['objective'] });
  defs.push({ id: 'power', label: 'Power source', station: 'power', checks: ['power'] });
  defs.push({ id: 'systems', label: m.type === 'orbiter' ? 'Battery & radiation vault' : 'Battery & backup', station: 'systems', checks: ['battery', 'rad'] });
  defs.push({ id: 'fuel', label: 'Fuel for the trip', station: 'fuel', checks: ['dv'] });
  defs.push({ id: 'science', label: 'Instruments for the goal', station: 'science', checks: ['sci', 'hga'] });
  defs.push({ id: 'data', label: 'Get the data home', station: 'comms', checks: ['data'] });
  defs.push({ id: 'budget', label: 'Stay on budget', station: 'ops', checks: ['budget'] });
  defs.push({ id: 'rocket', label: 'Rocket strong enough', station: 'rockets', checks: ['lv'] });
  const out: RawTask[] = defs.map((t) => {
    const cs = ev.checks.filter((c) => t.checks.includes(c.id));
    const bad = cs.find((c) => c.status === 'fail') ?? cs.find((c) => c.status === 'warn');
    return { id: t.id, label: t.label, station: t.station, st: cs.length ? worst(cs.map((c) => c.status)) : 'ok', detail: bad ? first(bad.detail) : cs[0] ? first(cs[0].detail) : '', current: false };
  });
  const allSigned = !ctx.team || Object.values(ctx.app.team.signoffs).every(Boolean);
  out.push({ id: 'launch', label: 'Launch!', station: 'gate', st: ev.launchable && allSigned ? 'warn' : 'fail', detail: ev.launchable ? (allSigned ? 'Everything is GO. Walk to the launch gate.' : 'Every player must sign off at the gate.') : 'Fix the red tasks first.', current: false });
  const cur = out.find((t) => t.st === 'fail' && t.id !== 'launch') ?? out.find((t) => t.id === 'launch');
  if (cur) cur.current = true;
  return out;
}

// ------------------------------------------------------------------ panels
const card = (o: { act?: string; key?: string; field?: string; val?: string; num?: boolean; name: string; sub?: string; big: string; unit?: string; small?: string; tag?: string; tagTone?: 'on' | 'hand' | 'bad' | 'key'; sel?: boolean; bad?: boolean; tip?: string }) =>
  `<button class="gc ${o.sel ? 'sel' : ''} ${o.bad ? 'bad' : ''}" ${o.act ? `data-act="${o.act}"` : 'disabled'} ${o.key ? `data-key="${o.key}"` : ''} ${o.field ? `data-field="${o.field}" data-val="${o.val}"` : ''} ${o.num ? 'data-num="1"' : ''} ${o.tip ? `title="${esc(o.tip)}"` : ''}>
    <span class="gc-n">${esc(o.name)}</span>${o.sub ? `<span class="gc-s">${esc(o.sub)}</span>` : ''}
    <span class="gc-big">${o.big}${o.unit ? `<small>${o.unit}</small>` : ''}</span>
    ${o.small ? `<span class="gc-m">${o.small}</span>` : ''}
    ${o.tag ? `<span class="gc-tag ${o.tagTone ?? ''}">${o.tag}</span>` : ''}
  </button>`;

function partCard(d: Design, ctx: PanelCtx, key: string, o: Parameters<typeof card>[0], removable = false) {
  const [f, v] = key.split(':');
  const installed = f === 'instr' ? d.instruments.includes(v) : (d as unknown as Record<string, string>)[f] === v;
  const carrying = ctx.carrying.includes(key);
  if (installed) return card({ ...o, act: removable ? 'h-remove' : undefined, key, sel: true, tag: removable ? 'On the spacecraft · click to remove' : 'On the spacecraft', tagTone: 'on' });
  if (carrying) return card({ ...o, act: undefined, tag: 'In your hands', tagTone: 'hand' });
  return card({ ...o, act: 'h-pick', key });
}

function head(id: StationId, ctx: PanelCtx, goal: string, st: St) {
  const def = stationById(id);
  const role = ROLE_INFO[def.role];
  return `<header class="gp-head">
      <div class="gp-kicker"><i class="gp-dot"></i>${esc(role.title)}${ctx.team ? ` · ${esc(ctx.playerFor(def.role))}` : ''}</div>
      <h2>${esc(def.name)}</h2>
      <p class="gp-goal ${st}"><b>${st === 'ok' ? '✓' : st === 'warn' ? '!' : '✕'}</b><span>${goal}</span></p>
      <p class="gp-src"><span>Data</span>${stationSources(id, ctx.app.design?.missionId ?? 'mars').map((s) => `<a href="${s.url}" target="_blank" rel="noopener">${esc(s.label)} ↗</a>`).join('')}</p>
      <button class="gp-x" data-act="h-close" aria-label="Close">×</button>
    </header>`;
}

const chk = (ev: Evaluation, ids: string[]) => ev.checks.filter((c) => ids.includes(c.id));
const stOf = (ev: Evaluation, ids: string[]): St => worst(chk(ev, ids).map((c) => c.status));
const goalOf = (ev: Evaluation, ids: string[], fallback: string) => {
  const bad = chk(ev, ids).find((c) => c.status !== 'ok');
  return esc(bad ? first(bad.detail) : fallback);
};

function foot(ctx: PanelCtx, extra = '') {
  const n = ctx.carrying.length;
  return `<footer class="gp-foot">${n ? `<span class="gp-hands"><b>${n}</b> in your hands → walk to the <i class="ring"></i> blue ring and press <kbd>E</kbd></span><button class="gp-link" data-act="h-drop">Put back</button>` : extra || '<span class="gp-tip">Click an item here or on the shelf to pick it up.</span>'}</footer>`;
}

export function panelHTML(id: StationId, d: Design, ev: Evaluation, ctx: PanelCtx): string {
  const m = missionOf(d);
  const planet = BODIES[m.target].name;
  switch (id) {
    case 'power': {
      const opts = POWER.filter((p) => m.powerIds.includes(p.id));
      return (
        head(id, ctx, goalOf(ev, ['power'], `You make ${fmtInt(ev.power.generated)} W at ${planet} and need ${fmtInt(ev.power.avgLoad)} W.`), stOf(ev, ['power'])) +
        `<div class="gp-body"><div class="gc-grid">${opts
          .map((p) => {
            const e = evaluate({ ...d, powerId: p.id });
            return partCard(d, ctx, 'powerId:' + p.id, { name: SHORT[p.id], sub: p.kind === 'rtg' ? 'nuclear · works anywhere' : 'solar · weaker with distance', big: fmtInt(e.power.generated), unit: `W at ${planet}`, small: `${p.mass} kg · $${p.costM}M`, bad: e.power.margin < 0, tip: p.desc, tag: e.power.margin < 0 ? `✕ not enough (need ${fmtInt(e.power.avgLoad)} W)` : undefined, tagTone: 'bad' });
          })
          .join('')}</div>
          <p class="gp-note">Sunlight falls with distance squared: at ${planet} (${ev.power.distanceAU.toFixed(1)} AU) a solar panel makes ${(100 / ev.power.distanceAU ** 2).toFixed(ev.power.distanceAU > 10 ? 2 : 0)}% of what it makes at Earth.</p></div>` +
        foot(ctx)
      );
    }
    case 'systems': {
      const batCur = BATTERIES.find((b) => b.id === d.batteryId);
      let html = `<div class="gp-sec">Battery · stores energy for peaks${m.type === 'lander' ? ' and nights' : ''}</div><div class="gc-grid">`;
      html += card({ name: 'No battery', big: '0', unit: 'kWh', small: '0 kg', sel: d.batteryId === 'none', act: d.batteryId !== 'none' && batCur ? 'h-remove' : undefined, key: batCur ? 'batteryId:' + batCur.id : undefined, tag: d.batteryId === 'none' ? 'Current' : undefined, tagTone: 'on' });
      html += BATTERIES.map((b) => partCard(d, ctx, 'batteryId:' + b.id, { name: SHORT[b.id], big: String(b.wh / 1000), unit: 'kWh', small: `${b.mass} kg · $${b.costM}M` })).join('');
      html += `</div><div class="gp-sec">Backup computer · survives a failure</div><div class="gc-grid">`;
      const dual = AVIONICS.find((a) => a.id === 'dual')!;
      html += card({ name: 'Single string', sub: 'no backup', big: '+0', unit: 'kg', small: '$0', sel: d.avionicsId === 'single', act: d.avionicsId === 'dual' ? 'h-remove' : undefined, key: 'avionicsId:dual', tag: d.avionicsId === 'single' ? 'Current' : undefined, tagTone: 'on', tip: AVIONICS[0].desc });
      html += partCard(d, ctx, 'avionicsId:dual', { name: 'Dual string', sub: 'flagship standard', big: `+${dual.mass}`, unit: 'kg', small: `$${dual.costM}M · +${dual.devYears} yr`, tip: dual.desc });
      html += '</div>';
      html += `<div class="gp-sec">Attitude control · points cameras and antenna${m.type === 'lander' ? ' (on the cruise stage)' : ''}</div><div class="gc-grid">`;
      html += ADCS.map((a) => {
        const sci = a.science[m.type];
        return partCard(d, ctx, 'adcsId:' + a.id, { name: SHORT[a.id], sub: `like ${a.analog}`, big: String(a.mass), unit: 'kg', small: `${m.type === 'lander' ? 0 : a.power} W · $${a.costM}M${a.fuelDv ? ' · +20 m/s fuel' : ''}`, tip: a.desc, tag: sci !== 1 ? `${sci > 1 ? '+' : ''}${Math.round((sci - 1) * 100)}% science` : undefined, tagTone: sci > 1 ? 'on' : 'bad' });
      }).join('');
      html += '</div>';
      if (m.type === 'orbiter') {
        html += `<div class="gp-sec">Radiation vault · Jupiter's belts fry electronics</div><div class="gc-grid">`;
        const curS = SHIELDS.find((s) => s.id === d.shieldId);
        html += SHIELDS.map((s) => {
          const e = evaluate({ ...d, shieldId: s.id });
          const orbits = Math.round(Math.min(999, e.radiation!.maxOrbits));
          if (s.id === 'none') return card({ name: 'No vault', big: String(orbits), unit: 'orbits', small: '0 kg', sel: d.shieldId === 'none', act: d.shieldId !== 'none' && curS ? 'h-remove' : undefined, key: curS && curS.id !== 'none' ? 'shieldId:' + curS.id : undefined, tag: d.shieldId === 'none' ? 'Current' : undefined, tagTone: 'on' });
          return partCard(d, ctx, 'shieldId:' + s.id, { name: SHORT[s.id], big: String(orbits), unit: 'orbits survive', small: `${s.mass} kg · $${s.costM}M · crane`, tip: s.desc });
        }).join('');
        html += '</div>';
      }
      return head(id, ctx, goalOf(ev, ['battery', 'rad', 'adcs'], 'Batteries, backups and pointing are sized well.'), stOf(ev, ['battery', 'rad', 'adcs'])) + `<div class="gp-body">${html}</div>` + foot(ctx);
    }
    case 'landing': {
      const rover = ev.mass.rover ?? 0;
      return (
        head(id, ctx, goalOf(ev, ['rover'], `Your rover weighs ${fmtInt(rover)} kg. This system can land it.`), stOf(ev, ['rover'])) +
        `<div class="gp-body"><div class="gc-grid one">${LANDINGS.map((l) =>
          partCard(d, ctx, 'landingId:' + l.id, { name: SHORT[l.id], sub: l.id === 'airbags' ? 'like Spirit & Opportunity' : l.id === 'retro' ? 'like Phoenix' : 'like Curiosity & Perseverance', big: fmtInt(l.maxRover), unit: 'kg max rover', small: `$${l.costM}M · landing risk ${(l.risk * 100).toFixed(0)}% · moved by crane`, bad: rover > l.maxRover, tag: rover > l.maxRover ? `✕ your rover is ${fmtInt(rover)} kg` : undefined, tagTone: 'bad', tip: l.desc }),
        ).join('')}</div><p class="gp-note">Instruments and power make the rover heavier. A heavier rover needs a bigger, pricier landing system, and the rocket must lift it all.</p></div>` +
        foot(ctx, '<span class="gp-tip">Landing systems are moved by the overhead crane.</span>')
      );
    }
    case 'orbit': {
      return (
        head(id, ctx, goalOf(ev, ['objective', 'rad'], 'Orbit planned.'), stOf(ev, ['objective'])) +
        `<div class="gp-body"><div class="gc-grid one">${JUPITER_ORBITS.map((o) => {
          const e = evaluate({ ...d, orbitId: o.id });
          return card({ act: 'h-set', field: 'orbitId', val: o.id, name: o.name, big: d.transfer ? fmtInt(e.dv.insertion * 1000) : '–', unit: 'm/s braking burn', small: `${Math.round(e.radiation!.plannedOrbits)} close passes · ${o.dosePerOrbit} krad per orbit${o.moonBonus ? ' · moon flybys' : ''}`, sel: d.orbitId === o.id, tag: d.orbitId === o.id ? 'Planned' : undefined, tagTone: 'on', tip: o.desc });
        }).join('')}</div></div>` +
        foot(ctx, '<span class="gp-tip">Orbits are a plan, not hardware: no carrying needed.</span>')
      );
    }
    case 'fuel': {
      const need = ev.dv.required * 1000;
      const have = ev.dv.available * 1000;
      const scale = Math.max(need * 1.5, have * 1.05, 1);
      return (
        head(id, ctx, goalOf(ev, ['dv'], `${fmtInt(have)} m/s of Δv for ${fmtInt(need)} m/s of manoeuvres.`), stOf(ev, ['dv'])) +
        `<div class="gp-body">
          <div class="gp-fuel"><div class="gf-num"><b>${fmtInt(d.propellantKg)}</b><span>kg hydrazine loaded</span></div>
            <div class="gf-bar ${have >= need ? 'ok' : 'bad'}"><i style="width:${(have / scale) * 100}%"></i><span class="gf-need" style="left:${(need / scale) * 100}%"><em>need ${fmtInt(need)} m/s</em></span></div>
            <div class="gf-legend"><span>Δv you have: <b>${fmtInt(have)} m/s</b></span><span>${ev.dv.insertion > 0 ? `braking ${fmtInt(ev.dv.insertion * 1000)} · ` : ''}${ev.dv.flyby > 0 ? `flyby ${fmtInt(ev.dv.flyby * 1000)} · ` : ''}corrections ${fmtInt(ev.dv.tcm * 1000)}</span></div></div>
          <div class="gp-row"><button class="gp-btn hold" data-hold="fuel"><i></i>Hold to pump</button><button class="gp-btn ghost" data-hold="drain">Drain</button></div>
          <button class="gp-btn wide" data-act="h-fuel-auto">Auto: exactly enough + 15% spare</button>
          <p class="gp-note">The rocket equation: each extra kilogram of fuel adds less Δv than the last, because it must also push the fuel itself.</p></div>` +
        foot(ctx, '<span class="gp-tip">Tip: hold <kbd>E</kbd> to pump.</span>')
      );
    }
    case 'science': {
      const obj = m.objectives.find((o) => o.id === d.objectiveId) ?? m.objectives[0];
      const pts = ev.science.potential;
      const pct = Math.min(1.5, pts / m.scienceTarget);
      const unit = m.type === 'flyby' ? 'Gbit' : 'Mbit/day';
      return (
        head(id, ctx, goalOf(ev, ['sci', 'hga'], `${Math.round(pts)} of ${m.scienceTarget} science points: goal met.`), stOf(ev, ['sci', 'hga'])) +
        `<div class="gp-body">
          <div class="gp-meter ${pts >= m.scienceTarget ? 'ok' : ''}"><div><b>${Math.round(pts)}</b><span>/ ${m.scienceTarget} science points</span></div><div class="gm-bar"><i style="width:${(pct / 1.5) * 100}%"></i><span style="left:${100 / 1.5}%"></span></div></div>
          <div class="gp-sec">Science goal</div>
          <div class="gp-chips">${m.objectives.map((o) => `<button class="gp-chip ${o.id === obj.id ? 'on' : ''}" data-act="h-set" data-field="objectiveId" data-val="${o.id}" title="${esc(o.desc)}">${esc(o.name)}</button>`).join('')}</div>
          <div class="gp-sec">Instruments · ★ = key for "${esc(obj.name)}"</div>
          <div class="gc-grid">${m.instruments
            .map((i) => {
              const w = obj.weights[i.id] ?? 1;
              return partCard(
                d,
                ctx,
                'instr:' + i.id,
                { name: `${w >= 1.3 ? '★ ' : ''}${i.name}`, sub: `like ${i.analog}`, big: `+${Math.round(i.science * w)}`, unit: 'pts', small: `${i.mass} kg · ${i.power} W · $${i.costM}M`, tip: `${i.desc} Sends ${i.data} ${unit}.${i.needsHGA ? ' Needs a high-gain dish.' : ''}`, tag: w >= 1.3 ? 'Key for your goal' : i.needsHGA && d.antennaId === 'lga' ? 'Needs a dish' : undefined, tagTone: 'key' },
                true,
              );
            })
            .join('')}</div></div>` +
        foot(ctx, '<span class="gp-tip">You can carry up to three instruments at once.</span>')
      );
    }
    case 'comms': {
      return (
        head(id, ctx, goalOf(ev, ['data', 'hga'], `${Math.round(ev.data.fraction * 100)}% of the science data gets home.`), stOf(ev, ['data'])) +
        `<div class="gp-body">
          <div class="gp-meter ${ev.data.fraction >= 0.95 ? 'ok' : ''}"><div><b>${Math.round(ev.data.fraction * 100)}%</b><span>of science data gets home · ${formatRate(ev.data.rateBps)}</span></div><div class="gm-bar"><i style="width:${Math.min(1, ev.data.fraction) * 100}%"></i></div></div>
          <div class="gp-sec">Antenna · data rate grows with dish area</div>
          <div class="gc-grid">${ANTENNAS.map((a) => {
            const e = evaluate({ ...d, antennaId: a.id });
            return partCard(d, ctx, 'antennaId:' + a.id, { name: SHORT[a.id], big: `${Math.round(e.data.fraction * 100)}%`, unit: 'data home', small: `${a.mass} kg · $${a.costM}M${a.id === 'hga30' ? ' · crane' : ''}`, bad: e.data.fraction < 0.6, tip: a.desc });
          }).join('')}</div>
          <div class="gp-sec">Radio transmitter · more watts, more data, more power used</div>
          <div class="gc-grid four">${TRANSMITTERS.map((t) => {
            const e = evaluate({ ...d, txId: t.id });
            return partCard(d, ctx, 'txId:' + t.id, { name: `${t.rfW} W`, big: `${Math.round(e.data.fraction * 100)}%`, unit: 'home', small: `uses ${t.dcW} W` });
          }).join('')}</div></div>` +
        foot(ctx)
      );
    }
    case 'ops': {
      const total = ev.cost.total;
      const scale = Math.max(total, ev.cost.cap);
      const items = ev.cost.items.filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
      const segs = items.map(([k, v], i) => `<i class="s${i % 5}" style="width:${(v / scale) * 100}%" title="${esc(k)}: $${fmtM(v)}"></i>`).join('');
      const pe = d.programEvent && d.programEvent.id !== 'none' ? `<div class="gp-alert"><b>${esc(d.programEvent.title)}</b>${esc(d.programEvent.text)}</div>` : '';
      return (
        head(id, ctx, goalOf(ev, ['budget', 'data'], `$${fmtM(total)} of a $${fmtM(ev.cost.cap)} budget.`), stOf(ev, ['budget'])) +
        `<div class="gp-body">${pe}
          <div class="gp-sec">Deep Space Network ground dish</div>
          <div class="gp-seg">${[34, 70].map((x) => `<button class="${d.dsnDish === x ? 'on' : ''}" data-act="h-set" data-field="dsnDish" data-val="${x}" data-num="1">${x} m dish<small>${x === 70 ? '~4× the data · pricier' : 'standard'}</small></button>`).join('')}</div>
          <div class="gp-sec">Tracking time per day</div>
          <div class="gp-range"><input class="h-range" type="range" min="1" max="24" step="1" value="${d.dsnHours}" data-field="dsnHours" aria-label="DSN hours per day"><output>${d.dsnHours} h</output></div>
          <div class="gp-meter ${ev.data.fraction >= 0.95 ? 'ok' : ''}"><div><b>${Math.round(ev.data.fraction * 100)}%</b><span>of the data gets home</span></div><div class="gm-bar"><i style="width:${Math.min(1, ev.data.fraction) * 100}%"></i></div></div>
          <div class="gp-sec">Budget</div>
          <div class="gp-stack ${total > ev.cost.cap ? 'over' : ''}">${segs}<span class="cap" style="left:${(ev.cost.cap / scale) * 100}%"></span></div>
          <p class="gp-money"><b>$${fmtM(total)}</b> of $${fmtM(ev.cost.cap)}</p>
          <ul class="gp-costs">${items.slice(0, 7).map(([k, v]) => `<li><span>${esc(k)}</span><b>$${fmtM(v)}</b></li>`).join('')}</ul></div>` +
        foot(ctx, '<span class="gp-tip">Every part you install has a price. Cheaper rockets and fewer instruments save money.</span>')
      );
    }
    case 'flight': {
      const tr = d.transfer;
      const hist = HISTORY[m.id];
      const route = m.grids.jga
        ? `<div class="gp-sec">Route</div><div class="gp-seg">${[['direct', 'Direct'], ['jga', 'Jupiter flyby']].map(([k, l]) => `<button class="${d.trajectoryKind === k ? 'on' : ''}" data-act="h-routekind" data-val="${k}">${l}<small>${k === 'jga' ? 'like New Horizons' : 'straight there'}</small></button>`).join('')}</div>`
        : '';
      return (
        head(id, ctx, goalOf(ev, ['traj', 'ready', 'tof', 'entry'], 'Launch date locked in.'), stOf(ev, ['traj', 'ready', 'tof', 'entry'])) +
        `<div class="gp-body">${route}
          ${tr
            ? `<div class="gp-stats"><div><i>Launch</i><b>${formatJD(tr.launchJD)}</b></div><div><i>Trip</i><b>${formatDuration(tr.tofDays)}</b></div><div><i>Arrive</i><b>${formatJD(tr.arriveJD)}</b></div><div><i>Energy C3</i><b>${tr.c3.toFixed(1)}</b></div></div>`
            : `<div class="gp-empty">No launch date yet. Planets must line up, so you can only launch in certain windows.</div>`}
          <p class="gp-note">Spacecraft ready to launch: <b>${formatJD(ev.readyJD)}</b> (${ev.devYears.toFixed(1)} years to build).</p>
          <button class="gp-btn wide primary" data-act="h-route">Open the launch-window chart</button>
          <button class="gp-btn wide" data-act="h-best">Auto-pick the cheapest launch</button>
          ${hist ? `<button class="gp-btn wide ghost" data-act="h-history">Check the physics: the real ${esc(hist.mission)} launch</button>` : ''}</div>` +
        foot(ctx, '<span class="gp-tip">Every pixel of the chart is a real trajectory computed from NASA/JPL planet positions.</span>')
      );
    }
    case 'rockets': {
      const tr = d.transfer;
      return (
        head(id, ctx, goalOf(ev, ['lv'], `The ${rocketById(d.rocketId).name} can lift your ${fmtInt(ev.mass.launch)} kg.`), stOf(ev, ['lv'])) +
        `<div class="gp-body"><div class="gr-list">${ROCKETS.map((r) => {
          const cap = tr ? payloadAt(r, tr.c3) : null;
          const ok = cap !== null && cap >= ev.mass.launch;
          const fill = cap ? Math.min(1, ev.mass.launch / Math.max(1, cap)) : 0;
          const nm = r.id === 'atlasv551s48' ? 'Atlas V + Star 48B' : r.id === 'falconheavy' ? 'Falcon Heavy' : r.name;
          return `<button class="grk ${d.rocketId === r.id ? 'sel' : ''} ${cap !== null && !ok ? 'cant' : ''}" data-act="h-pick" data-key="rocketId:${r.id}" title="${esc(r.desc + ' Flew: ' + r.flew + '.')}">
            <span class="grk-n">${esc(nm)}${r.agency ? ` <em class="grk-ag">${esc(r.agency)}</em>` : ''}</span><span class="grk-p">$${fmtM(r.costM)}</span>
            <span class="grk-bar"><i style="width:${fill * 100}%"></i></span>
            <span class="grk-c">${cap === null ? 'pick a launch date first' : `lifts ${fmtInt(cap)} kg · you need ${fmtInt(ev.mass.launch)} kg`}</span></button>`;
        }).join('')}</div>
        <p class="gp-note">Faster trips need more launch energy (C3), and the more energy, the less mass a rocket can carry.</p></div>` +
        foot(ctx, '<span class="gp-tip">Click a model on the table or a row here to choose it.</span>')
      );
    }
    case 'gate': {
      const areas: [string, string[], StationId][] = [
        ['Route', ['traj', 'ready', 'tof', 'entry'], 'flight'],
        ['Craft', ['rover', 'power', 'battery', 'dv', 'rad'], 'power'],
        ['Science', ['sci', 'objective', 'hga'], 'science'],
        ['Comms', ['data'], 'comms'],
        ['Budget', ['budget'], 'ops'],
        ['Rocket', ['lv'], 'rockets'],
      ];
      const poll = areas
        .map(([n, ids, st]) => {
          const s = stOf(ev, ids);
          const bad = chk(ev, ids).find((c) => c.status === 'fail');
          return `<button class="gpoll ${s}" data-act="h-goto" data-station="${bad ? stationFor(bad.id) : st}"><span>${n}</span><b>${s === 'fail' ? 'NO-GO' : s === 'warn' ? 'CHECK' : 'GO'}</b></button>`;
        })
        .join('');
      const sign = ctx.team
        ? `<div class="gp-sec">Team sign-off · everyone must agree</div><div class="gp-sign">${(['flight', 'engineer', 'science', 'ops'] as RoleId[])
            .map((r) => `<label style="--rc:${ROLE_INFO[r].color}"><input type="checkbox" data-act="sign" data-role="${r}" ${ctx.app.team.signoffs[r] ? 'checked' : ''}><span><b>${esc(ctx.playerFor(r))}</b><small>${ROLE_INFO[r].title}</small></span></label>`)
            .join('')}</div>`
        : '';
      const allSigned = !ctx.team || Object.values(ctx.app.team.signoffs).every(Boolean);
      const can = ev.launchable && allSigned;
      const warn = ev.science.potential < m.scienceTarget ? `Science ${Math.round(ev.science.potential)}/${m.scienceTarget}: expect partial success` : ev.checks.some((c) => c.status === 'warn') ? 'Some checks are tight' : `${rocketById(d.rocketId).name} · ${d.transfer ? formatJD(d.transfer.launchJD) : ''}`;
      return (
        head(id, ctx, ev.launchable ? 'All systems GO. Press and hold to roll out to the pad.' : 'Fix every NO-GO before launch.', ev.launchable ? 'ok' : 'fail') +
        `<div class="gp-body"><div class="gp-sec">Mission control poll</div><div class="gp-poll">${poll}</div>${sign}
          <button class="btn launch gp-launch" data-hold="launch" data-act="launch-hint" ${can ? '' : 'disabled'}><i class="hold-fill"></i><span>${ev.launchable ? (allSigned ? 'Launch' : 'Waiting for sign-offs') : 'No-go'}<small>${can ? `Press and hold · ${esc(warn)}` : 'Fix the red items first'}</small></span></button></div>` +
        `<footer class="gp-foot"><span class="gp-tip">Real launch teams poll every station. One NO-GO stops the countdown.</span></footer>`
      );
    }
  }
  return '';
}

function stationFor(checkId: string): StationId {
  const map: Record<string, StationId> = { traj: 'flight', ready: 'flight', tof: 'flight', entry: 'flight', rover: 'landing', power: 'power', battery: 'systems', dv: 'fuel', rad: 'systems', sci: 'science', objective: 'orbit', hga: 'comms', data: 'comms', lv: 'rockets', budget: 'ops' };
  return map[checkId] ?? 'gate';
}

// ------------------------------------------------------------------ wall screens
const FONT = '"IBM Plex Mono", ui-monospace, monospace';
const DISP = '"Archivo", "Helvetica Neue", Arial, sans-serif';
const BG = '#07111c';
const CY = '#4cc9ff';
// status colours follow the colour-blind setting (read at draw time)
const GRN_ = () => statusColor('ok');
const AMB_ = () => statusColor('warn');
const RED_ = () => statusColor('fail');

function frame(s: LiveScreen, title: string) {
  const { ctx, canvas } = s;
  const W = canvas.width;
  const H = canvas.height;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(76,201,255,0.07)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 40) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
  for (let y = 0; y < H; y += 40) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(76,201,255,0.14)';
  ctx.fillRect(0, 0, W, H * 0.085);
  ctx.fillStyle = CY;
  ctx.font = `700 ${Math.round(H * 0.045)}px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(tr(title), W * 0.025, H * 0.044);
}

function txt(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, size: number, color = '#e8f1f8', weight = 600, font = FONT, align: CanvasTextAlign = 'left') {
  ctx.font = `${weight} ${size}px ${font}`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  // translated wall-screen text keeps the English layout (squeezed a little if longer)
  const t = tr(s);
  ctx.fillText(t, x, y, t === s ? undefined : ctx.measureText(s).width * 1.2 + size);
  ctx.textAlign = 'left';
}

const stColor = (s: St) => (s === 'ok' ? GRN_() : s === 'warn' ? AMB_() : RED_());

function drawStatus(mesh: THREE.Mesh, d: Design, ev: Evaluation) {
  let s = mesh.userData.screen as LiveScreen | undefined;
  if (!s) {
    const canvas = document.createElement('canvas');
    canvas.width = 1440;
    canvas.height = 450;
    const ctx = canvas.getContext('2d')!;
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    s = { canvas, ctx, tex };
    mesh.userData.screen = s;
    (mesh.material as THREE.MeshBasicMaterial).map = tex;
    (mesh.material as THREE.MeshBasicMaterial).needsUpdate = true;
  }
  const { ctx } = s;
  const m = missionOf(d);
  ctx.fillStyle = '#05090f';
  ctx.fillRect(0, 0, 1440, 450);
  txt(ctx, `MISSION STATUS · ${m.name.toUpperCase()}`, 40, 72, 44, '#ffffff', 700, DISP);
  const now = new Date();
  txt(ctx, `UTC ${now.toISOString().slice(11, 19)}`, 1400, 72, 38, CY, 600, FONT, 'right');
  const areas: [string, string[]][] = [
    ['ROUTE', ['traj', 'ready', 'tof', 'entry']],
    ['CRAFT', ['rover', 'power', 'battery', 'dv', 'rad']],
    ['SCIENCE', ['sci', 'objective', 'hga']],
    ['COMMS', ['data']],
    ['BUDGET', ['budget']],
    ['ROCKET', ['lv']],
  ];
  const w = (1440 - 80 - 5 * 20) / 6;
  areas.forEach(([n, ids], i) => {
    const st = stOf(ev, ids);
    const x = 40 + i * (w + 20);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    ctx.fillRect(x, 120, w, 190);
    ctx.fillStyle = stColor(st);
    ctx.fillRect(x, 120, w, 10);
    txt(ctx, n, x + w / 2, 190, 34, '#b7c6d4', 600, FONT, 'center');
    txt(ctx, st === 'fail' ? 'NO-GO' : st === 'warn' ? 'CHECK' : 'GO', x + w / 2, 270, 58, stColor(st), 800, DISP, 'center');
  });
  const tr = d.transfer;
  txt(ctx, ev.launchable ? '● GO FOR LAUNCH' : '● HOLD', 40, 395, 40, ev.launchable ? GRN_() : AMB_(), 700, FONT);
  txt(ctx, `${rocketById(d.rocketId).name}${tr ? ` · ${formatJD(tr.launchJD)} · C3 ${tr.c3.toFixed(1)}` : ' · no launch date'}`, 1400, 395, 34, '#b7c6d4', 500, FONT, 'right');
  s.tex.needsUpdate = true;
}

function drawFlight(s: LiveScreen, d: Design, ev: Evaluation) {
  const { ctx, canvas } = s;
  const W = canvas.width;
  const H = canvas.height;
  const m = missionOf(d);
  frame(s, `LAUNCH WINDOW · EARTH → ${BODIES[m.target].name.toUpperCase()}`);
  const tr = d.transfer;
  const jd = tr?.launchJD ?? ev.readyJD;
  const bodies: BodyId[] = d.trajectoryKind === 'jga' ? ['earth', 'jupiter', m.target] : ['earth', m.target];
  const maxR = Math.max(...bodies.map((b) => Math.hypot(...(planetState(b, jd).r as [number, number, number]))));
  const cx = W * 0.33;
  const cy = H * 0.55;
  const R = H * 0.42;
  const k = R / (maxR * 1.05);
  const P = (r: number[]) => [cx + r[0] * k, cy - r[1] * k];
  ctx.fillStyle = '#ffd36a';
  ctx.beginPath();
  ctx.arc(cx, cy, 12, 0, Math.PI * 2);
  ctx.fill();
  for (const b of bodies) {
    const path = orbitPath(b, jd, 180);
    ctx.strokeStyle = b === 'earth' ? 'rgba(120,180,255,0.6)' : 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    path.forEach((r, i) => {
      const [x, y] = P(r as unknown as number[]);
      if (i) ctx.lineTo(x, y);
      else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.stroke();
  }
  if (tr) {
    ctx.strokeStyle = AMB_();
    ctx.lineWidth = 4;
    ctx.beginPath();
    let firstPt = true;
    for (const leg of tr.legs) {
      const dur = (leg.arriveJD - leg.departJD) * 86400;
      for (let i = 0; i <= 120; i++) {
        const st = propagate(leg.r1, leg.v1, (dur * i) / 120, MU_SUN);
        const [x, y] = P(st.r as unknown as number[]);
        if (firstPt) {
          ctx.moveTo(x, y);
          firstPt = false;
        } else ctx.lineTo(x, y);
      }
    }
    ctx.stroke();
    const dot = (b: BodyId, j: number, c: string, lab: string) => {
      const [x, y] = P(planetState(b, j).r as unknown as number[]);
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.fill();
      txt(ctx, lab, x + 14, y - 10, 26, c, 600);
    };
    dot('earth', tr.launchJD, '#7fb6ff', 'Earth · launch');
    if (tr.flyby) dot('jupiter', tr.flyby.jd, '#e3c08f', 'Jupiter flyby');
    dot(m.target, tr.arriveJD, '#ff9a6a', `${BODIES[m.target].name} · arrival`);
  }
  const x0 = W * 0.66;
  if (tr) {
    const rows: [string, string][] = [
      ['LAUNCH', formatJD(tr.launchJD)],
      ['TRIP', formatDuration(tr.tofDays)],
      ['ARRIVE', formatJD(tr.arriveJD)],
      ['ENERGY C3', `${tr.c3.toFixed(1)} km²/s²`],
    ];
    rows.forEach(([a, b], i) => {
      txt(ctx, a, x0, 200 + i * 150, 30, '#8fa6ba', 600);
      txt(ctx, b, x0, 258 + i * 150, 54, '#ffffff', 700, DISP);
    });
  } else {
    txt(ctx, 'NO TRAJECTORY', x0, 300, 60, AMB_(), 800, DISP);
    txt(ctx, 'Open the launch-window chart', x0, 370, 32, '#b7c6d4', 500);
    txt(ctx, 'at this desk to pick a date.', x0, 412, 32, '#b7c6d4', 500);
  }
}

function drawOps(s: LiveScreen, d: Design, ev: Evaluation) {
  const { ctx, canvas } = s;
  const W = canvas.width;
  frame(s, 'GROUND SYSTEMS & BUDGET');
  const total = ev.cost.total;
  const cap = ev.cost.cap;
  const scale = Math.max(total, cap) * 1.05;
  txt(ctx, `$${fmtM(total)}`, 60, 210, 96, total > cap ? RED_() : '#ffffff', 800, DISP);
  txt(ctx, `of $${fmtM(cap)} budget`, 60, 262, 34, '#8fa6ba', 500);
  const items = ev.cost.items.filter(([, v]) => v > 0.5).sort((a, b) => b[1] - a[1]);
  const cols = ['#4cc9ff', '#f2b43a', '#58e08a', '#c58cff', '#ff8a5c', '#7fd7d0'];
  let x = 60;
  const bw = W - 120;
  items.forEach(([, v], i) => {
    const w = (v / scale) * bw;
    ctx.fillStyle = cols[i % cols.length];
    ctx.fillRect(x, 300, Math.max(0, w - 3), 70);
    x += w;
  });
  ctx.fillStyle = RED_();
  ctx.fillRect(60 + (cap / scale) * bw - 3, 285, 6, 100);
  items.slice(0, 6).forEach(([k, v], i) => {
    const yy = 450 + (i % 3) * 64;
    const xx = 60 + Math.floor(i / 3) * (W / 2 - 30);
    ctx.fillStyle = cols[i % cols.length];
    ctx.fillRect(xx, yy - 26, 22, 22);
    txt(ctx, k.length > 26 ? k.slice(0, 25) + '…' : k, xx + 36, yy - 6, 30, '#d7e3ee', 500);
    txt(ctx, `$${fmtM(v)}`, xx + W / 2 - 110, yy - 6, 30, '#ffffff', 700, FONT, 'right');
  });
  txt(ctx, `DATA HOME ${Math.round(ev.data.fraction * 100)}%`, 60, 840, 40, ev.data.fraction >= 0.95 ? GRN_() : AMB_(), 700);
  txt(ctx, `DSN ${d.dsnDish} m · ${d.dsnHours} h/day · ${formatRate(ev.data.rateBps)}`, W - 60, 840, 34, '#b7c6d4', 500, FONT, 'right');
}

function drawScience(s: LiveScreen, d: Design, ev: Evaluation) {
  const { ctx, canvas } = s;
  const W = canvas.width;
  const m = missionOf(d);
  const obj = m.objectives.find((o) => o.id === d.objectiveId) ?? m.objectives[0];
  frame(s, 'SCIENCE OBJECTIVE');
  txt(ctx, obj.name, 50, 140, 64, '#ffffff', 800, DISP);
  txt(ctx, obj.desc.length > 70 ? obj.desc.slice(0, 68) + '…' : obj.desc, 50, 196, 30, '#b7c6d4', 500);
  const pts = ev.science.potential;
  const f = Math.min(1.5, pts / m.scienceTarget) / 1.5;
  ctx.fillStyle = 'rgba(255,255,255,0.08)';
  ctx.fillRect(50, 250, W - 100, 60);
  ctx.fillStyle = pts >= m.scienceTarget ? GRN_() : AMB_();
  ctx.fillRect(50, 250, (W - 100) * f, 60);
  ctx.fillStyle = '#fff';
  ctx.fillRect(50 + (W - 100) / 1.5 - 2, 236, 4, 88);
  txt(ctx, `${Math.round(pts)} / ${m.scienceTarget} POINTS`, 50, 380, 46, '#ffffff', 700);
  const names = m.instruments.filter((i) => d.instruments.includes(i.id)).map((i) => i.analog);
  let x = 50;
  let y = 460;
  ctx.font = `600 30px ${FONT}`;
  for (const n of names) {
    const w = ctx.measureText(n).width + 36;
    if (x + w > W - 50) {
      x = 50;
      y += 64;
    }
    ctx.fillStyle = 'rgba(76,201,255,0.16)';
    ctx.fillRect(x, y - 38, w, 50);
    txt(ctx, n, x + 18, y - 3, 30, CY, 600);
    x += w + 14;
  }
  if (!names.length) txt(ctx, 'No instruments installed', 50, 460, 32, AMB_(), 600);
}

function drawOrbit(s: LiveScreen, d: Design, ev: Evaluation) {
  const { ctx, canvas } = s;
  const W = canvas.width;
  const H = canvas.height;
  frame(s, 'JUPITER ORBIT PLAN');
  const cx = W * 0.36;
  const cy = H * 0.56;
  const g = ctx.createRadialGradient(cx - 20, cy - 20, 10, cx, cy, 80);
  g.addColorStop(0, '#f0d9b5');
  g.addColorStop(1, '#a57a52');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(cx, cy, 80, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,70,40,0.5)';
  ctx.lineWidth = 6;
  for (const yy of [-35, -10, 20, 45]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + yy, Math.sqrt(80 * 80 - yy * yy), 3, 0, 0, Math.PI * 2);
    ctx.stroke();
  }
  JUPITER_ORBITS.forEach((o, i) => {
    const on = d.orbitId === o.id;
    ctx.strokeStyle = on ? AMB_() : 'rgba(255,255,255,0.28)';
    ctx.lineWidth = on ? 6 : 3;
    ctx.beginPath();
    if (o.id === 'tour') ctx.ellipse(cx + 40, cy, 300, 120, 0, 0, Math.PI * 2);
    else {
      const a = o.id === 'polar53' ? 330 : 200;
      ctx.ellipse(cx, cy - a + 85, 60 + i * 8, a, 0, 0, Math.PI * 2);
    }
    ctx.stroke();
  });
  const cur = JUPITER_ORBITS.find((o) => o.id === d.orbitId);
  if (cur) {
    txt(ctx, cur.name, W * 0.64, 220, 46, '#ffffff', 800, DISP);
    txt(ctx, `${cur.periodDays} days per orbit`, W * 0.64, 290, 34, '#b7c6d4', 500);
    txt(ctx, `${cur.dosePerOrbit} krad per orbit`, W * 0.64, 340, 34, '#b7c6d4', 500);
    if (ev.radiation) {
      txt(ctx, `${Math.round(ev.radiation.plannedOrbits)} close passes planned`, W * 0.64, 420, 38, CY, 600);
      txt(ctx, `electronics survive ${Math.round(Math.min(999, ev.radiation.maxOrbits))}`, W * 0.64, 470, 38, ev.radiation.maxOrbits >= ev.radiation.plannedOrbits ? GRN_() : RED_(), 600);
    }
    if (d.transfer) txt(ctx, `braking burn ${fmtInt(ev.dv.insertion * 1000)} m/s`, W * 0.64, 550, 38, AMB_(), 600);
  }
}

function drawFuel(s: LiveScreen, d: Design, ev: Evaluation) {
  const { ctx, canvas } = s;
  const W = canvas.width;
  ctx.fillStyle = BG;
  ctx.fillRect(0, 0, W, canvas.height);
  txt(ctx, 'PROPELLANT LOAD', 24, 46, 28, CY, 700);
  txt(ctx, `${fmtInt(d.propellantKg)} kg`, 24, 120, 64, '#fff', 800, DISP);
  const need = ev.dv.required;
  const have = ev.dv.available;
  const sc = Math.max(need * 1.5, have * 1.05, 1e-6);
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(24, 160, W - 48, 40);
  ctx.fillStyle = have >= need ? GRN_() : RED_();
  ctx.fillRect(24, 160, ((W - 48) * have) / sc, 40);
  ctx.fillStyle = '#fff';
  ctx.fillRect(24 + ((W - 48) * need) / sc - 2, 150, 4, 60);
  txt(ctx, `Δv ${fmtInt(have * 1000)} / ${fmtInt(need * 1000)} m/s`, 24, 240, 28, '#d7e3ee', 600);
}

/** Redraw the live screens around the high bay. */
export function drawScreens(stations: BuiltStation[], statusBoard: THREE.Mesh, d: Design, ev: Evaluation, _ctx: PanelCtx, tickOnly = false) {
  drawStatus(statusBoard, d, ev);
  if (tickOnly) return;
  for (const st of stations) {
    if (!st.screen) continue;
    switch (st.def.id) {
      case 'flight': drawFlight(st.screen, d, ev); break;
      case 'ops': drawOps(st.screen, d, ev); break;
      case 'science': drawScience(st.screen, d, ev); break;
      case 'orbit': drawOrbit(st.screen, d, ev); break;
      case 'fuel': drawFuel(st.screen, d, ev); break;
    }
    st.screen.tex.needsUpdate = true;
  }
}
