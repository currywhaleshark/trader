import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { economyDataFor } from '../sim/modes';
import { createGame } from '../sim/economy/start';
import { createEconomy } from '../sim/economy/setup';
import { applySettings, type GameSettings } from '../sim/classroom/settings';
import { saveGame, worldRef, type SaveWorldRef, type SlotId } from './save';
import { applyCommand, PLAYER_ID, type CommandResult } from '../sim/economy/player';
import { stepMonth } from '../sim/economy/step';
import type { Command, EconomyContext, EconomyState, SimEvent } from '../sim/economy/types';
import { cellLatLon } from '../sim/core/grid';
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
  act: (cmd: Command) => CommandResult & { state?: EconomyState };
  /** 플레이어 회사의 최근 기록(도착·거래·알림), 최신이 앞 */
  log: SimEvent[];
  /** 수업 시나리오 소식(사건·목표 달성), 최신이 앞 */
  lessonNews: SimEvent[];
  settings: GameSettings;
  /** 지금 상태를 슬롯에 저장 */
  save: (slot: SlotId) => boolean;
  /** 지금 상태의 저장 내용(파일로 내보낼 때) */
  snapshot: () => { label: string; world: SaveWorldRef; settings: GameSettings; state: EconomyState };
  /** `${cityId}|${goodId}` -> 최근 월별 가격 */
  history: Map<string, number[]>;
  news: SimEvent[];
  /** 지금 시각(월 단위 실수). 선박 위치 보간용. */
  now: () => number;
  /** 선박의 현재 위치 */
  shipPositions: () => ShipPosition[];
}

/** 그리기용 선박 위치: 지금 자리, 뱃머리가 향하는 점, 선종·소속 */
export interface ShipPosition {
  id: string;
  lat: number;
  lon: number;
  headLat: number;
  headLon: number;
  typeId?: string;
  companyId: string;
  companyIndex: number;
  loaded: boolean;
  mine: boolean;
  docked: boolean;
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

/** 어떤 게임을 시작할지: 설정과(이어하기라면) 불러온 상태 */
export interface GameStart {
  settings: GameSettings;
  loaded?: EconomyState;
  /** 같은 설정으로 다시 시작할 때 바꿔 주는 번호 */
  nonce: number;
}

export function useSimulation(world: World | null, start: GameStart): Simulation | null {
  const eco = useMemo(() => {
    // 세계와 게임 설정의 모드가 같을 때만 만든다(모드를 바꾸는 중에 섞이지 않게)
    if (!world || world.mode !== (start.settings.mode ?? 'virtual')) return null;
    const data = economyDataFor(world.mode);
    if (start.loaded) {
      // 불러온 상태: 같은 설정으로 경제 규칙(ctx)만 다시 만들고 상태는 그대로 쓴다
      const { ctx } = createEconomy(world, applySettings(data, start.settings), start.settings.seed);
      return { ctx, state: start.loaded, ref: worldRef(world, ctx.data) };
    }
    const g = createGame(world, data, start.settings.seed, start.settings);
    return { ...g, ref: worldRef(world, g.ctx.data) };
  }, [world, start]);
  const [state, setState] = useState<EconomyState | null>(null);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(start.settings.speed);
  useEffect(() => setSpeed(start.settings.speed), [start]);
  const [news, setNews] = useState<SimEvent[]>([]);
  const [log, setLog] = useState<SimEvent[]>([]);
  const [lessonNews, setLessonNews] = useState<SimEvent[]>([]);
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
    setLessonNews([]);
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
        e.type === 'scenario' ||
        (e.type === 'growth' && e.kind !== 'expand_start' && e.kind !== 'expand_done'),
    );
    if (notable.length) setNews((prev) => [...notable.reverse(), ...prev].slice(0, NEWS_LIMIT));
    const mine = r.events.filter(isPlayerEvent);
    if (mine.length) setLog((prev) => [...mine.reverse(), ...prev].slice(0, LOG_LIMIT));
    const lesson = r.events.filter((e) => e.type === 'scenario');
    if (lesson.length) setLessonNews((prev) => [...lesson.reverse(), ...prev].slice(0, 20));
    // 해가 바뀔 때마다 자동 저장
    if (r.state.month % 12 === 0) {
      saveGame('auto', {
        label: `${r.state.player.name} · ${formatDate(eco.ctx.data.startYear, r.state.month)}`,
        world: eco.ref,
        settings: start.settings,
        state: r.state,
      });
    }
    setState(r.state);
  }, [eco, record, start]);

  useEffect(() => {
    if (!playing || !eco) return;
    tickStartRef.current = performance.now();
    const id = setInterval(stepOnce, MS_PER_MONTH / speed);
    return () => clearInterval(id);
  }, [playing, speed, eco, stepOnce]);

  /** 항구 앞바다(배가 서는 자리)와 도시 위치 */
  const anchors = useMemo(() => {
    const m = new Map<string, { sea: LatLon; city: LatLon }>();
    if (!world) return m;
    for (const c of world.cities) {
      const sea = c.seaCell >= 0 ? cellLatLon(world.grid, c.seaCell) : ([c.lat, c.lon] as LatLon);
      m.set(c.id, { sea: [sea[0], sea[1]], city: [c.lat, c.lon] });
    }
    return m;
  }, [world]);

  const routeCache = useMemo(() => {
    const map = new Map<string, LatLon[]>();
    if (!world) return map;
    for (const r of world.seaRoutes) {
      // 배는 항구 앞바다에서 떠나 앞바다에 닿는다(육지 위로 그리지 않는다)
      const full: LatLon[] = [anchors.get(r.from)!.sea, ...r.waypoints, anchors.get(r.to)!.sea];
      map.set(`${r.from}|${r.to}`, full);
      map.set(`${r.to}|${r.from}`, [...full].reverse());
    }
    return map;
  }, [world, anchors]);

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
    const dockedCount = new Map<string, number>();
    return s.ships.map((ship): ShipPosition => {
      const base = {
        id: ship.id,
        typeId: ship.typeId,
        companyId: ship.companyId,
        companyIndex: companyIndex.get(ship.companyId) ?? 0,
        loaded: ship.cargo.length > 0,
        mine: ship.companyId === PLAYER_ID,
      };
      const span = ship.arrivesAt - ship.departedAt;
      const sailing = ship.from !== ship.to && span > 0 && t < ship.arrivesAt;
      if (!sailing) {
        // 항구에 서 있는 배: 앞바다에 나란히, 뱃머리는 부두 쪽
        const a = anchors.get(ship.to);
        const k = dockedCount.get(ship.to) ?? 0;
        dockedCount.set(ship.to, k + 1);
        if (!a) return { ...base, lat: 0, lon: 0, headLat: 0, headLon: 1, docked: true };
        const off = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * 0.35;
        const dLat = a.sea[0] - a.city[0];
        const dLon = a.sea[1] - a.city[1];
        const lat = a.sea[0] - dLon * off;
        const lon = a.sea[1] + dLat * off;
        return { ...base, lat, lon, headLat: a.city[0], headLon: a.city[1], docked: true };
      }
      const path = routeCache.get(`${ship.from}|${ship.to}`) ?? [[0, 0] as LatLon];
      const p = Math.max(0, Math.min(1, (t - ship.departedAt) / span));
      const [lat, lon] = pointAlong(path, p);
      const [headLat, headLon] = pointAlong(path, Math.min(1, p + 0.01));
      const ahead = p >= 0.99 ? pointAlong(path, 1) : [headLat, headLon];
      return { ...base, lat, lon, headLat: ahead[0], headLon: ahead[1], docked: false };
    });
  }, [eco, now, routeCache, anchors]);

  const queue = useCallback((cmd: Command) => {
    pendingRef.current.push(cmd);
  }, []);

  const act = useCallback(
    (cmd: Command): CommandResult & { state?: EconomyState } => {
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
        return { ...r, state: next };
      }
      return r;
    },
    [eco, now],
  );

  if (!eco || !state) return null;
  /** 지금(가장 최근) 상태로 저장할 내용: 제목의 날짜도 같은 상태에서 */
  const snapshotOf = (cur: EconomyState) => ({
    label: `${cur.player.name} · ${formatDate(eco.ctx.data.startYear, cur.month)}`,
    world: eco.ref,
    settings: start.settings,
    state: cur,
  });
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
    lessonNews,
    settings: start.settings,
    save: (slot: SlotId) => saveGame(slot, snapshotOf(stateRef.current ?? state)),
    snapshot: () => snapshotOf(stateRef.current ?? state),
    history: historyRef.current,
    news,
    now,
    shipPositions,
  };
}
