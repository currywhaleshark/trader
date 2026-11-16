import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_ECONOMY } from '../sim/economy/data';
import { createGame } from '../sim/economy/start';
import { applyCommand, PLAYER_ID, type CommandResult } from '../sim/economy/player';
import { stepMonth } from '../sim/economy/step';
import type { Command, EconomyContext, EconomyState, SimEvent } from '../sim/economy/types';
import { angleBetween, latLonToVec3, slerp, vec3ToLatLon, type LatLon } from '../sim/core/sphere';
import type { World } from '../sim/world/types';

/** 기본 속도: 현실 5초 = 게임 1개월 (§11) */
export const MS_PER_MONTH = 5000;
const HISTORY_MONTHS = 60;
const NEWS_LIMIT = 40;
const LOG_LIMIT = 60;

function isPlayerEvent(e: SimEvent): boolean {
  if (e.type === 'trade' || e.type === 'arrival') return e.shipId.startsWith('p');
  if (e.type === 'notice') return true;
  return false;
}

export interface Simulation {
  ctx: EconomyContext;
  state: EconomyState;
  playing: boolean;
  speed: number;
  setPlaying: (v: boolean) => void;
  setSpeed: (v: number) => void;
  stepOnce: () => void;
  queue: (cmd: Command) => void;
  /** 플레이어 명령을 지금 바로 적용한다(멈춰 있어도 된다) */
  act: (cmd: Command) => CommandResult;
  /** 플레이어 회사의 최근 기록(도착·거래·알림), 최신이 앞 */
  log: SimEvent[];
  /** `${cityId}|${goodId}` -> 최근 월별 가격 */
  history: Map<string, number[]>;
  news: SimEvent[];
  /** 지금 시각(월 단위 실수). 선박 위치 보간용. */
  now: () => number;
  /** 선박의 현재 위치 */
  shipPositions: () => { id: string; lat: number; lon: number; companyIndex: number; loaded: boolean; mine: boolean }[];
}

export function formatDate(startYear: number, month: number): string {
  return `${startYear + Math.floor(month / 12)}년 ${(month % 12) + 1}월`;
}

/** 경유점 경로의 t(0~1) 지점 */
function pointAlong(points: LatLon[], t: number): LatLon {
  if (points.length === 1) return points[0];
  const vecs = points.map((p) => latLonToVec3(p[0], p[1]));
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < vecs.length; i++) {
    const d = angleBetween(vecs[i - 1], vecs[i]);
    lens.push(d);
    total += d;
  }
  let remain = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < lens.length; i++) {
    if (remain <= lens[i] || i === lens.length - 1) {
      return vec3ToLatLon(slerp(vecs[i], vecs[i + 1], lens[i] > 0 ? Math.min(1, remain / lens[i]) : 0));
    }
    remain -= lens[i];
  }
  return points[points.length - 1];
}

export function useSimulation(world: World | null): Simulation | null {
  const eco = useMemo(() => (world ? createGame(world, DEFAULT_ECONOMY, world.seed) : null), [world]);
  const [state, setState] = useState<EconomyState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [news, setNews] = useState<SimEvent[]>([]);
  const [log, setLog] = useState<SimEvent[]>([]);
  const stateRef = useRef<EconomyState | null>(null);
  const historyRef = useRef(new Map<string, number[]>());
  const pendingRef = useRef<Command[]>([]);
  const tickStartRef = useRef(performance.now());
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const playingRef = useRef(playing);
  playingRef.current = playing;

  const record = useCallback((ctx: EconomyContext, s: EconomyState) => {
    const h = historyRef.current;
    for (const cityId of ctx.cityIds) {
      for (const g of ctx.goods) {
        const key = `${cityId}|${g.id}`;
        let arr = h.get(key);
        if (!arr) h.set(key, (arr = []));
        arr.push(s.cities[cityId].price[g.id]);
        if (arr.length > HISTORY_MONTHS) arr.shift();
      }
    }
  }, []);

  useEffect(() => {
    historyRef.current = new Map();
    setNews([]);
    setLog([]);
    setPlaying(false);
    stateRef.current = eco?.state ?? null;
    setState(eco?.state ?? null);
    if (eco) record(eco.ctx, eco.state);
  }, [eco, record]);

  const stepOnce = useCallback(() => {
    if (!eco || !stateRef.current) return;
    const r = stepMonth(eco.ctx, stateRef.current, pendingRef.current);
    pendingRef.current = [];
    stateRef.current = r.state;
    tickStartRef.current = performance.now();
    record(eco.ctx, r.state);
    // 증설은 자주 일어나 소식에서 뺀다(도시 화면의 '공사 중'에서 볼 수 있다)
    const notable = r.events.filter(
      (e) =>
        e.type === 'shortage' ||
        e.type === 'modifier' ||
        e.type === 'policy' ||
        (e.type === 'growth' && e.kind !== 'expand_start' && e.kind !== 'expand_done'),
    );
    if (notable.length) setNews((prev) => [...notable.reverse(), ...prev].slice(0, NEWS_LIMIT));
    const mine = r.events.filter(isPlayerEvent);
    if (mine.length) setLog((prev) => [...mine.reverse(), ...prev].slice(0, LOG_LIMIT));
    setState(r.state);
  }, [eco, record]);

  useEffect(() => {
    if (!playing || !eco) return;
    tickStartRef.current = performance.now();
    const id = setInterval(stepOnce, MS_PER_MONTH / speed);
    return () => clearInterval(id);
  }, [playing, speed, eco, stepOnce]);

  const routeCache = useMemo(() => {
    const map = new Map<string, LatLon[]>();
    if (!world) return map;
    const pos = new Map(world.cities.map((c) => [c.id, [c.lat, c.lon] as LatLon]));
    for (const r of world.seaRoutes) {
      const full: LatLon[] = [pos.get(r.from)!, ...r.waypoints, pos.get(r.to)!];
      map.set(`${r.from}|${r.to}`, full);
      map.set(`${r.to}|${r.from}`, [...full].reverse());
    }
    for (const c of world.cities) map.set(`${c.id}|${c.id}`, [[c.lat, c.lon]]);
    return map;
  }, [world]);

  const now = useCallback(() => {
    const s = stateRef.current;
    if (!s) return 0;
    if (!playingRef.current) return s.month;
    const frac = (performance.now() - tickStartRef.current) / (MS_PER_MONTH / speedRef.current);
    return s.month + Math.min(1, frac);
  }, []);

  const shipPositions = useCallback(() => {
    const s = stateRef.current;
    if (!s || !eco) return [];
    const t = now();
    const companyIndex = new Map(s.companies.map((c, k) => [c.id, k]));
    return s.ships.map((ship) => {
      const path = routeCache.get(`${ship.from}|${ship.to}`) ?? [[0, 0] as LatLon];
      const span = ship.arrivesAt - ship.departedAt;
      const p = ship.from === ship.to || span <= 0 ? 1 : (t - ship.departedAt) / span;
      const [lat, lon] = pointAlong(path, p);
      return {
        id: ship.id,
        lat,
        lon,
        companyIndex: companyIndex.get(ship.companyId) ?? 0,
        loaded: ship.cargo.length > 0,
        mine: ship.companyId === PLAYER_ID,
      };
    });
  }, [eco, now, routeCache]);

  const queue = useCallback((cmd: Command) => {
    pendingRef.current.push(cmd);
  }, []);

  const act = useCallback(
    (cmd: Command): CommandResult => {
      const cur = stateRef.current;
      if (!eco || !cur) return { ok: false, error: '준비 중이에요.', events: [] };
      const next = structuredClone(cur);
      const timed = cmd.type === 'sail' || cmd.type === 'assignRoute' ? { ...cmd, at: now() } : cmd;
      const r = applyCommand(eco.ctx, next, timed);
      if (r.ok) {
        stateRef.current = next;
        setState(next);
        const mine = r.events.filter(isPlayerEvent);
        if (mine.length) setLog((prev) => [...mine.reverse(), ...prev].slice(0, LOG_LIMIT));
      }
      return r;
    },
    [eco, now],
  );

  if (!eco || !state) return null;
  return {
    ctx: eco.ctx,
    state,
    playing,
    speed,
    setPlaying,
    setSpeed,
    stepOnce,
    queue,
    act,
    log,
    history: historyRef.current,
    news,
    now,
    shipPositions,
  };
}
