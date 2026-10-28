import type { Place } from '../model/types';
import type { ISODate } from '../context/resolve';
import type { Services } from '../services/types';
import { haversine } from '../services/geo';
import type { Expr } from './parser';
import { err, type Value } from './values';

export interface Env {
  hereKey?: string;
  prevKey?: string;
  date?: ISODate;
  today: ISODate;
  /** Async so a formula simply stays pending while a mention is being geocoded. */
  resolvePlace(key: string): Promise<Place | null>;
}

const DAY = 86400;
const FORECAST_DAYS = 16;
const UNIT_SCALE = { h: 3600, min: 60, d: DAY, km: 1000, m: 1 } as const;

const dayNumber = (iso: ISODate) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / (DAY * 1000);
};
const fromDayNumber = (n: number): ISODate => new Date(n * DAY * 1000).toISOString().slice(0, 10);

const num = (value: number): Value => ({ kind: 'number', value });
const dur = (seconds: number): Value => ({ kind: 'duration', seconds });
const dist = (meters: number): Value => ({ kind: 'distance', meters });

async function place(key: string, env: Env): Promise<Value> {
  const p = await env.resolvePlace(key);
  return p ? { kind: 'place', place: p } : err(`unknown place: ${key}`);
}

function arith(op: '+' | '-' | '*' | '/', l: Value, r: Value): Value {
  const k = `${l.kind} ${op} ${r.kind}`;
  const n = (v: Value) => (v as { value: number }).value;
  const s = (v: Value) => (v as { seconds: number }).seconds;
  const m = (v: Value) => (v as { meters: number }).meters;
  switch (k) {
    case 'number + number': return num(n(l) + n(r));
    case 'number - number': return num(n(l) - n(r));
    case 'number * number': return num(n(l) * n(r));
    case 'number / number': return num(n(l) / n(r));
    case 'duration + duration': return dur(s(l) + s(r));
    case 'duration - duration': return dur(s(l) - s(r));
    case 'duration * number': return dur(s(l) * n(r));
    case 'number * duration': return dur(n(l) * s(r));
    case 'duration / number': return dur(s(l) / n(r));
    case 'duration / duration': return num(s(l) / s(r));
    case 'distance + distance': return dist(m(l) + m(r));
    case 'distance - distance': return dist(m(l) - m(r));
    case 'distance * number': return dist(m(l) * n(r));
    case 'number * distance': return dist(n(l) * m(r));
    case 'distance / number': return dist(m(l) / n(r));
    case 'distance / distance': return num(m(l) / m(r));
    case 'distance / duration': return { kind: 'speed', mps: m(l) / s(r) };
    case 'date - date':
      return dur((dayNumber((l as { iso: string }).iso) - dayNumber((r as { iso: string }).iso)) * DAY);
    case 'date + duration':
    case 'date - duration': {
      const days = Math.floor(s(r) / DAY) * (op === '+' ? 1 : -1);
      return { kind: 'date', iso: fromDayNumber(dayNumber((l as { iso: string }).iso) + days) };
    }
    case 'duration + date':
      return arith('+', r, l);
  }
  return err(`can't compute ${l.kind} ${op} ${r.kind}`);
}

function prop(v: Value, name: string): Value {
  if (v.kind === 'route' && name === 'duration') return dur(v.seconds);
  if (v.kind === 'route' && name === 'distance') return dist(v.meters);
  if (v.kind === 'weather' && (name === 'high' || name === 'low')) return num(v[name]);
  if (v.kind === 'weather' && name === 'condition') return { kind: 'string', value: v.condition };
  if (v.kind === 'place' && name === 'name') return { kind: 'string', value: v.place.name };
  if (v.kind === 'place' && (name === 'lat' || name === 'lon')) return num(v.place[name]);
  return err(`${v.kind} has no "${name}"`);
}

function want<K extends Value['kind']>(v: Value, kind: K, what: string): Extract<Value, { kind: K }> | Value {
  if (v.kind === 'error' || v.kind === kind) return v;
  return err(`${what} must be a ${kind}, got ${v.kind}`);
}

async function call(name: string, args: Expr[], env: Env, services: Services): Promise<Value> {
  const vals = await Promise.all(args.map((a) => evaluate(a, env, services)));
  const failed = vals.find((v) => v.kind === 'error');
  if (failed) return failed;
  const arg = (i: number, fallback: () => Promise<Value> | Value) => (i < vals.length ? vals[i] : fallback());

  switch (name) {
    case 'weather': {
      const p = want(await arg(0, () => ident('here', env)), 'place', 'weather place');
      const d = want(await arg(1, () => ident('date', env)), 'date', 'weather date');
      if (p.kind !== 'place') return p;
      if (d.kind !== 'date') return d;
      const ahead = dayNumber(d.iso) - dayNumber(env.today);
      if (ahead >= FORECAST_DAYS) return err('no forecast yet');
      return { kind: 'weather', ...(await services.weather(p.place, d.iso)) };
    }
    case 'route':
    case 'distance': {
      if (vals.length !== 2) return err(`${name}(from, to) needs two places`);
      const [a, b] = [want(vals[0], 'place', 'from'), want(vals[1], 'place', 'to')];
      if (a.kind !== 'place') return a;
      if (b.kind !== 'place') return b;
      if (name === 'distance') return dist(haversine(a.place, b.place));
      return { kind: 'route', ...(await services.route(a.place, b.place)) };
    }
    case 'days': {
      const [a, b] = [want(vals[0] ?? err('days(a, b) needs two dates'), 'date', 'a'), want(vals[1] ?? err('days(a, b) needs two dates'), 'date', 'b')];
      if (a.kind !== 'date') return a;
      if (b.kind !== 'date') return b;
      return num(dayNumber(b.iso) - dayNumber(a.iso));
    }
    case 'hours':
    case 'minutes': {
      const v = want(vals[0] ?? err(`${name}() needs a duration`), 'duration', name);
      return v.kind === 'duration' ? num(v.seconds / (name === 'hours' ? 3600 : 60)) : v;
    }
    case 'km': {
      const v = want(vals[0] ?? err('km() needs a distance'), 'distance', 'km');
      return v.kind === 'distance' ? num(v.meters / 1000) : v;
    }
  }
  return err(`unknown function "${name}"`);
}

async function ident(name: string, env: Env): Promise<Value> {
  switch (name) {
    case 'here':
    case 'place':
      return env.hereKey ? place(env.hereKey, env) : err('no place here');
    case 'prev':
      return env.prevKey ? place(env.prevKey, env) : err('no previous place');
    case 'date':
      return env.date ? { kind: 'date', iso: env.date } : err('no date here');
    case 'today':
      return { kind: 'date', iso: env.today };
  }
  return err(`unknown name "${name}"`);
}

/** Never throws: every failure, including a rejected service call, becomes an error value. */
export async function evaluate(expr: Expr, env: Env, services: Services): Promise<Value> {
  try {
    switch (expr.t) {
      case 'num':
        return expr.unit === 'h' || expr.unit === 'min' || expr.unit === 'd'
          ? dur(expr.value * UNIT_SCALE[expr.unit])
          : expr.unit
            ? dist(expr.value * UNIT_SCALE[expr.unit])
            : num(expr.value);
      case 'str':
        return { kind: 'string', value: expr.value };
      case 'date':
        return { kind: 'date', iso: expr.iso };
      case 'place':
        return place(expr.key, env);
      case 'ident':
        return ident(expr.name, env);
      case 'call':
        return await call(expr.name, expr.args, env, services);
      case 'prop': {
        const v = await evaluate(expr.e, env, services);
        return v.kind === 'error' ? v : prop(v, expr.name);
      }
      case 'neg': {
        const v = await evaluate(expr.e, env, services);
        return v.kind === 'error' ? v : arith('*', v, num(-1));
      }
      case 'bin': {
        const [l, r] = await Promise.all([evaluate(expr.l, env, services), evaluate(expr.r, env, services)]);
        if (l.kind === 'error') return l;
        if (r.kind === 'error') return r;
        return arith(expr.op, l, r);
      }
    }
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
}
