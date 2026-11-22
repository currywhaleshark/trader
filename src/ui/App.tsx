import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAYERS, landMask, renderBaseLayer, type LayerId } from '../render/baseLayer';
import { drawBase, type CityOverlay, type ComposeOptions, type RouteOverlay } from '../render/compose';
import { borderLines, riverLines } from '../render/surfaceLines';
import { GlobeView,type GlobePort, type GlobeShip } from '../render/GlobeView';
import { placeTowns } from '../render/towns';
import { portSite } from '../render/coast';
import { MapView } from '../render/MapView';
import { angularDistance, DEG, type LatLon } from '../sim/core/sphere';
import { makeConfig } from '../sim/world/config';
import { generateWorld } from '../sim/world/generateWorld';
import { navGridOf, findSeaRoute } from '../sim/world/seaRoutes';
import type { World, WorldMode } from '../sim/world/types';
import { economyDataFor, modeOf } from '../sim/modes';
import { Legend } from './Legend';
import { loadWorld } from './loadWorld';
import { CoachMark, TutorialCard, useTutorial } from './Tutorial';
import { CompanyPanel, FleetPanel } from './CompanyPanel';
import { DEFAULT_START, FirstTradeGuide, LessonCard, NewLessonDialog, ReportDialog } from './ClassroomPanels';
import type { GameSettings } from '../sim/classroom/settings';
import { checkSaveCompat, exportSave, type SaveFile } from './save';
import { CityMarket, COMPANY_COLORS, WorldMarket } from './MarketPanel';
import { PLAYER_ID } from '../sim/economy/player';
import { SidePanel, type CityRoute, type Selection } from './SidePanel';
import { Dock } from './Dock';
import { PortWindow } from './PortWindow';
import { OrderGoals } from './OrdersPanel';
import { CityWindow, CompanyWindow, OrdersWindow, WorldWindow } from './Windows';
import { isOpenOrder } from '../sim/economy/orders';
import { GoodIcon, Icon } from './icons';
import { estimateVoyage, isDocked } from '../sim/economy/player';
import { voyageWaypoints } from '../sim/economy/routing';
import { fixJosa } from '../sim/core/korean';
import type { SimEvent } from '../sim/economy/types';
import { canSendShipTo, shippingPortForMarket, won } from './tradeModel';
import { formatDate, useSimulation, type GameStart } from './useSimulation';

type ViewMode = 'globe' | 'map';
type Tab = 'market' | 'fleet' | 'company';
const PLAYER_COLOR = '#ffd166';

/** 이 세계 자료에 그 레이어의 격자가 있는가(없으면 단추를 숨긴다) */
function layerAvailable(world: World, id: LayerId): boolean {
  const a = world.layerAvailability;
  if (id === 'temperature' || id === 'precipitation') return a.monthly;
  if (id === 'crops' || id === 'harvest') return a.crops;
  if (id === 'resources') return a.resources;
  return true;
}

function seasonText(month: number): string {
  const north = ['겨울', '겨울', '봄', '봄', '봄', '여름', '여름', '여름', '가을', '가을', '가을', '겨울'][month];
  const south = ['여름', '여름', '가을', '가을', '가을', '겨울', '겨울', '겨울', '봄', '봄', '봄', '여름'][month];
  return `북반구 ${north} · 남반구 ${south}`;
}

export function App() {
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>('세계를 불러오는 중…');
  const [genMs, setGenMs] = useState<number | null>(null);
  const [view, setView] = useState<ViewMode>('globe');
  const [webgl, setWebgl] = useState(true);
  const [layer, setLayer] = useState<LayerId>('terrain');
  const [month, setMonth] = useState(6);
  const [cropId, setCropId] = useState('grain');
  const [showRoutes, setShowRoutes] = useState(true);
  const [selection, setSelection] = useState<Selection>(null);
  const [routeTarget, setRouteTarget] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<string[]>([]);
  const [, setSeedInput] = useState('');
  const [gameStart, setGameStart] = useState<GameStart>({ settings: DEFAULT_START, nonce: 0 });
  const [showNew, setShowNew] = useState(true);
  const [showReport, setShowReport] = useState(false);
  const [light, setLight] = useState(false);
  // 화면: 지구본 · 평면 세계지도(WebGL, 지구본과 같은 그림) · 캔버스 지도(느린 기기·WebGL 없음)
  const stage = view === 'globe' ? 'globe' : webgl && !light ? 'flat' : 'canvas';
  const [savedNote, setSavedNote] = useState<string | null>(null);
  /** 불러오기·모드 준비에서 생긴 알림(새 수업 창에 보인다) */
  const [loadNote, setLoadNote] = useState<string | null>(null);
  const [bannerSeen, setBannerSeen] = useState(-1);
  const [tab, setTab] = useState<Tab>('fleet');
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  /** 항구 창이 열린 배, 그 배의 목적지, 지도에서 목적지를 고르는 중인지 */
  const [portShipId, setPortShipId] = useState<string | null>(null);
  const [portDest, setPortDest] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  /** 오른쪽 자세한 패널(처음엔 접어 둔다) */
  const [sideOpen, setSideOpen] = useState(false);
  /** 정보 창(항구·회사·세계). 항구 창(내 배)과 동시에 열지 않는다 */
  const [win, setWin] = useState<{ kind: 'city'; id: string } | { kind: 'company'; tab?: string } | { kind: 'world' } | { kind: 'orders' } | null>(null);
  /** 상품 렌즈: 고른 상품의 값을 지구본 이름표에 띄운다 */
  const [lensGood, setLensGood] = useState<string | null>(null);
  const [lensOpen, setLensOpen] = useState(false);
  /** 잠깐 떴다 사라지는 알림(배 도착 등) */
  const [toasts, setToasts] = useState<{ id: number; text: string; shipId?: string }[]>([]);
  const toastId = useRef(0);
  const portRef = useRef<{ shipId: string | null; picking: boolean }>({ shipId: null, picking: false });
  portRef.current = { shipId: portShipId, picking };

  const hostRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeView | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<World | null>(null);
  worldRef.current = world;

  /** 모드별로 한 번 읽은(만든) 세계. 모드를 오가도 다시 받지 않는다. */
  const worldCache = useRef<Partial<Record<WorldMode, World>>>({});

  useEffect(() => {
    loadWorld('virtual')
      .then((w) => {
        worldCache.current.virtual = w;
        setWorld(w);
        setSeedInput(w.seed);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  }, []);

  const resetView = useCallback(() => {
    setSelection(null);
    setRouteTarget(null);
    setBlocked([]);
    setSelectedShipId(null);
    setPortShipId(null);
    setWin(null);
  }, []);

  /** 가상 세계를 시드로 만든다(현실 지구는 시드로 지형을 만들지 않는다) */
  const generateVirtual = useCallback(async (seed: string): Promise<World> => {
    setBusy(`시드 "${seed}"로 세계를 만드는 중…`);
    setError(null);
    try {
      // 화면에 안내를 먼저 그린 뒤 계산한다
      await new Promise((resolve) => setTimeout(resolve, 30));
      const t0 = performance.now();
      const { world: w } = generateWorld(makeConfig({ seed: seed.trim() }));
      setGenMs(Math.round(performance.now() - t0));
      worldCache.current.virtual = w;
      return w;
    } finally {
      setBusy(null);
    }
  }, []);

  const regenerate = useCallback(
    (seed: string) => {
      if (!seed.trim()) return;
      void generateVirtual(seed).then((w) => {
        setWorld(w);
        resetView();
      });
    },
    [generateVirtual, resetView],
  );

  /** 모드·시드에 맞는 세계를 준비한다 */
  const ensureWorld = useCallback(
    async (mode: WorldMode, seed: string): Promise<World> => {
      const cached = worldCache.current[mode];
      if (mode === 'virtual') return cached && cached.seed === seed ? cached : generateVirtual(seed);
      if (cached) return cached;
      setBusy(`${modeOf(mode).name} 자료를 불러오는 중…`);
      try {
        const w = await loadWorld(mode);
        worldCache.current[mode] = w;
        return w;
      } finally {
        setBusy(null);
      }
    },
    [generateVirtual],
  );

  const sim = useSimulation(world, gameStart);

  /** 새 수업·이어 하기: 모드와 시드에 맞는 세계를 먼저 준비하고, 세계·경제·상태를 한 번에 바꾼다 */
  const startLesson = useCallback(
    async (settings: GameSettings, file?: SaveFile) => {
      const mode = settings.mode ?? 'virtual';
      let w: World;
      try {
        w = await ensureWorld(mode, settings.seed);
      } catch (e) {
        setLoadNote((e as Error).message);
        return;
      }
      if (file) {
        const check = checkSaveCompat(file, w, economyDataFor(mode));
        if (!check.ok) {
          setLoadNote(`불러오지 않았어요: ${check.reason}`);
          return;
        }
        setLoadNote(check.warning ?? null);
      } else setLoadNote(null);
      setShowNew(false);
      resetView();
      setWorld(w);
      setGameStart((prev) => ({ settings: { ...settings, mode }, loaded: file?.state, nonce: prev.nonce + 1 }));
    },
    [ensureWorld, resetView],
  );
  const simRef = useRef(sim);
  simRef.current = sim;

  // 선박 위치: 시뮬레이션 틱과 별개로 화면에서 부드럽게 보간한다
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop);
      if (t - last < 80) return;
      last = t;
      const s = simRef.current;
      if (!s) return;
      const all = s.shipPositions().sort((a, b) => Number(a.mine) - Number(b.mine));
      if (globeRef.current) {
        // 지구본: 로우폴리 배(내 배는 선종대로, 남의 배는 한 모양에 회사 색 굴뚝)
        const models: GlobeShip[] = all.map((p) => ({
          id: p.id,
          lat: p.lat,
          lon: p.lon,
          headLat: p.headLat,
          headLon: p.headLon,
          kind: p.mine ? (p.typeId ?? 'medium') : 'npc',
          funnel: p.mine ? PLAYER_COLOR : COMPANY_COLORS[p.companyIndex % COMPANY_COLORS.length],
          pickable: p.mine,
        }));
        globeRef.current.setShips(models);
      }
      if (mapRef.current) {
        // 2D 지도: 점(내 배는 금색으로 맨 위에)
        mapRef.current.setShips(
          all.map((p) => ({
            lat: p.lat,
            lon: p.lon,
            color: p.mine ? PLAYER_COLOR : p.loaded ? COMPANY_COLORS[p.companyIndex % COMPANY_COLORS.length] : '#8d9bb3',
          })),
        );
      }
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const nav = useMemo(
    () => (world ? navGridOf(world) : null),
    [world],
  );

  const selectedCity = useMemo(
    () => (world && selection?.kind === 'city' ? (world.cities.find((c) => c.id === selection.id) ?? null) : null),
    [world, selection],
  );

  /** 선택한 항구에서 다른 모든 항구로 가는 항로. 봉쇄가 있으면 런타임에 다시 탐색한다. */
  // 막힌 운하·해협: 게임 중이면 경제 상태(배·NPC·자동항로가 함께 따른다), 아니면 지도 미리보기
  const passageState = sim?.state.passages;
  const blockedNow = useMemo(
    () => (sim ? Object.entries(passageState ?? {}).filter(([, p]) => p.closed).map(([id]) => id) : blocked),
    [passageState, blocked, !!sim], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const simCtx = sim?.ctx;
  const cityRoutes = useMemo(() => {
    if (!world || !nav || !selectedCity || !selectedCity.isPort) return [];
    const blockedIdx = blockedNow
      .map((id) => world.chokepoints.find((g) => g.id === id)?.index)
      .filter((v): v is number => v !== undefined);
    return world.cities
      .filter((c) => c.id !== selectedCity.id && c.isPort)
      .map((other) => {
        if (simCtx) {
          // 게임 중: 경제와 같은 항로표(기본·대체·다시 찾기)를 쓴다
          const options = simCtx.routeOptions(selectedCity.id, other.id);
          const base = options[0];
          const pick = options.find((o) => o.passages.every((p) => !blockedNow.includes(p))) ?? (blockedNow.length ? simCtx.liveRoute(selectedCity.id, other.id, blockedNow) : null);
          return {
            toId: other.id,
            other,
            waypoints: pick?.waypoints ?? null,
            distanceKm: pick ? pick.distanceKm : null,
            baseDistanceKm: base?.distanceKm ?? 0,
            gates: pick?.passages ?? [],
          };
        }
        const pre = world.seaRoutes.find(
          (r) =>
            (r.from === selectedCity.id && r.to === other.id) || (r.from === other.id && r.to === selectedCity.id),
        );
        const baseDistanceKm = pre?.distanceKm ?? 0;
        let waypoints: LatLon[] | null = pre
          ? pre.from === selectedCity.id
            ? pre.waypoints
            : [...pre.waypoints].reverse()
          : null;
        let distanceKm: number | null = pre ? pre.distanceKm : null;
        let gates = pre?.gates ?? [];
        if (blockedIdx.length > 0) {
          const live = findSeaRoute(nav, selectedCity.seaCell, other.seaCell, blockedIdx);
          waypoints = live?.waypoints ?? null;
          distanceKm = live ? Math.round(live.distanceKm) : null;
          gates = live ? live.gates.map((g) => world.chokepoints[g].id) : [];
        }
        return { toId: other.id, other, waypoints, distanceKm, baseDistanceKm, gates };
      });
  }, [world, nav, selectedCity, blockedNow, simCtx]);

  const panelRoutes: CityRoute[] = useMemo(
    () => cityRoutes.map((r) => ({ toId: r.toId, distanceKm: r.distanceKm, baseDistanceKm: r.baseDistanceKm, gates: r.gates })),
    [cityRoutes],
  );

  const base = useMemo(
    // 지구본은 육지·바다를 따로 구워 셰이더가 해안선을 또렷하게 자른다
    () => (world ? renderBaseLayer(world, { layer, month, cropId, scale: light ? 1 : 4, split: stage !== 'canvas' }) : null),
    [world, layer, month, cropId, light, stage],
  );
  const mask = useMemo(() => (world ? landMask(world) : null), [world]);
  // 지구본 위에 벡터로 그리는 선: 강(지형 그림에서만)과 국경
  const surfaceLines = useMemo(
    () => (world ? [...(layer === 'terrain' ? riverLines(world) : []), ...(layer !== 'sea' ? borderLines(world) : [])] : []),
    [world, layer],
  );

  const handlePick = useCallback((lat: number, lon: number) => {
    const w = worldRef.current;
    if (!w) return;
    let best: string | null = null;
    let bestD = 2.2;
    for (const c of w.cities) {
      const d = angularDistance(lat, lon, c.lat, c.lon) / DEG;
      if (d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    setRouteTarget(null);
    const sim = simRef.current;
    const shipId = portRef.current.shipId;
    if (best && shipId && sim) {
      const ship = sim.state.ships.find((s) => s.id === shipId);
      const dest = shippingPortForMarket(sim.ctx, best);
      const selectable = dest && ship && dest !== ship.to && (dest === best || canSendShipTo(sim, ship, dest));
      if (dest !== best) {
        let message = '이 시장에는 이용 가능한 관문항이 없어요.';
        if (dest) {
          const gateway = sim.ctx.cityNames[dest];
          if (selectable) message = `${sim.ctx.cityNames[best]} 시장의 관문항 ${gateway}을(를) 목적지로 골랐어요.`;
          else if (dest === ship?.to) message = `이미 관문항 ${gateway}에 있어요.`;
          else message = `지금은 이 배를 관문항 ${gateway}(으)로 보낼 수 없어요.`;
        }
        const toast = { id: ++toastId.current, text: fixJosa(message) };
        setToasts((all) => [toast, ...all].slice(0, 3));
      }
      if (selectable) {
        setPortDest(dest);
        setPicking(false);
        setSelection({ kind: 'city', id: dest });
        return;
      }
    } else if (best && !shipId) {
      setWin({ kind: 'city', id: best });
    }
    setSelection(best ? { kind: 'city', id: best } : { kind: 'cell', lat, lon });
  }, []);

  /** 지구본에서 배를 눌렀을 때: 내 배면 고르고 선단 탭을 연다 */
  const handlePickShip = useCallback((id: string) => {
    const s = simRef.current;
    const ship = s?.state.ships.find((x) => x.id === id);
    if (!ship || ship.companyId !== PLAYER_ID) return;
    setSelectedShipId(id);
    setTab('fleet');
    setPortShipId(id);
    setPortDest(null);
    setPicking(false);
    setWin(null);
  }, []);

  /** 아래 독에서 배를 눌렀을 때: 그 배로 지구본을 돌리고 항구 창을 연다 */
  const openShip = useCallback((id: string) => {
    const s = simRef.current;
    const w = worldRef.current;
    const ship = s?.state.ships.find((x) => x.id === id);
    if (!ship || !w) return;
    setSelectedShipId(id);
    setPortShipId((prev) => (prev === id ? null : id));
    setPortDest(null);
    setPicking(false);
    setWin(null);
    const pos = s!.shipPositions().find((p) => p.id === id);
    const c = w.cities.find((x) => x.id === ship.to);
    const at = pos ?? c;
    if (at) {
      globeRef.current?.lookAt(at.lat, at.lon);
      mapRef.current?.lookAt(at.lat, at.lon);
    }
  }, []);

  // 뷰 생성/교체
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !world) return;
    if (stage !== 'canvas') {
      try {
        globeRef.current = new GlobeView(host, handlePick, handlePickShip, stage === 'flat' ? 'flat' : 'globe');
      } catch {
        setWebgl(false);
        setView('map');
        return;
      }
    } else {
      mapRef.current = new MapView(host, handlePick);
      mapRef.current.lookAt(5, 0);
    }
    return () => {
      globeRef.current?.dispose();
      globeRef.current = null;
      mapRef.current?.dispose();
      mapRef.current = null;
    };
  }, [stage, world === null, handlePick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 화면에만 있는 내륙 도시(세계가 바뀔 때만 다시 고른다). 현실 지구는 내륙 경제권(배후국)을 도시로 그린다.
  const towns = useMemo(() => {
    if (!world) return [];
    const inland = world.cities
      .filter((c) => !c.isPort)
      .map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, size: 3 as const, countryId: c.countryId, river: false, headLat: c.lat + 1, headLon: c.lon }));
    return [...inland, ...placeTowns(world)];
  }, [world]);
  // 항구가 설 물가: 그려진 해안선 위의 점과 바다 방향
  const sites = useMemo(() => new Map(world ? world.cities.map((c) => [c.id, portSite(world, c)]) : []), [world]);

  // 지구본의 항구 도시 모델: 항만 규모·나라 색
  const portLevels = sim?.state.portLevel;
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !world) return;
    const colorOf = new Map(world.countries.map((c) => [c.id, c.color]));
    const ports: GlobePort[] = world.cities.filter((c) => c.isPort).map((c) => {
      const site = sites.get(c.id)!;
      const level = Math.min(3, Math.max(1, Math.round(portLevels?.[c.id] ?? c.portSize ?? 1))) as 1 | 2 | 3;
      return { id: c.id, lat: site.lat, lon: site.lon, seaLat: site.seaLat, seaLon: site.seaLon, level, countryColor: colorOf.get(c.countryId) ?? '#ffffff' };
    });
    g.setPorts(ports);
    g.setTowns(towns.map((t) => ({ ...t, countryColor: colorOf.get(t.countryId) ?? '#ffffff' })));
  }, [world, stage, portLevels, towns, sites]);

  useEffect(() => {
    globeRef.current?.selectShip(selectedShipId);
  }, [selectedShipId, stage, world]);

  // 바탕 그림 -> 지구본 표면 / 2D 지도
  useEffect(() => {
    if (!world || !base || !mask) return;
    if (globeRef.current && base.sea) {
      globeRef.current.setSurface({ width: base.width, height: base.height, land: base.data, sea: base.sea, mask, detail: layer === 'terrain' });
      globeRef.current.setSurfaceLines(surfaceLines);
    }
    if (mapRef.current && !base.sea) {
      const canvas = canvasRef.current ?? (canvasRef.current = document.createElement('canvas'));
      mapRef.current.setSource(drawBase(base, canvas));
    }
  }, [world, base, mask, stage, surfaceLines]); // eslint-disable-line react-hooks/exhaustive-deps

  // 항로·항구 표식(벡터) -> 지구본 / 2D 지도
  useEffect(() => {
    if (!world) return;
    const routes: RouteOverlay[] = [];
    const pos = new Map(world.cities.map((c) => [c.id, [c.lat, c.lon] as LatLon]));
    const pathBetween = (a: string, b: string): LatLon[] | null => {
      const r = world.seaRoutes.find((x) => (x.from === a && x.to === b) || (x.from === b && x.to === a));
      if (!r) return null;
      const wp = r.from === a ? r.waypoints : [...r.waypoints].reverse();
      return [pos.get(a)!, ...wp, pos.get(b)!];
    };
    if (tab !== 'market' && sim) {
      // 내 배들의 항해 길(금색)과, 고른 배에서 고른 항구까지의 예정 길(점선)
      for (const s of sim.state.ships) {
        if (s.companyId !== PLAYER_ID || s.from === s.to) continue;
        // 실제로 고른 길(우회·항해 중 변경 포함)
        const v = s.voyage;
        const wp = v && (v.path || v.avoid.length > 0) ? voyageWaypoints(sim.ctx, s) : null;
        const pts = wp ? (v!.path ? [...wp, pos.get(s.to)!] : [pos.get(s.from)!, ...wp, pos.get(s.to)!]) : pathBetween(s.from, s.to);
        if (pts) routes.push({ points: pts, color: PLAYER_COLOR, width: 3.5 });
      }
      const mine = sim.state.ships.find((s) => s.id === selectedShipId) ?? sim.state.ships.find((s) => s.companyId === PLAYER_ID);
      if (mine && selectedCity && selectedCity.isPort && mine.from === mine.to && mine.to !== selectedCity.id) {
        // 예정 길: 이 배가 지금 운하 상태로 실제 갈 길(견적과 같은 길)
        const leg = mine.typeId ? estimateVoyage(sim.ctx, mine.typeId, mine.to, selectedCity.id, sim.state).leg : null;
        const pts = leg ? [pos.get(mine.to)!, ...leg.waypoints, pos.get(selectedCity.id)!] : pathBetween(mine.to, selectedCity.id);
        if (pts) routes.push({ points: pts, color: 'rgba(255,255,255,0.9)', width: 3, dashed: true });
      }
    } else if (selectedCity) {
      for (const r of cityRoutes) {
        if (!r.waypoints) continue;
        const on = routeTarget === r.toId;
        if (routeTarget && !on) continue;
        routes.push({
          points: [[selectedCity.lat, selectedCity.lon], ...r.waypoints, [r.other.lat, r.other.lon]],
          color: on ? '#ffe066' : 'rgba(255,240,170,0.85)',
          width: on ? 5 : 2.4,
        });
      }
    } else if (showRoutes) {
      for (const r of world.seaRoutes) {
        routes.push({
          points: [pos.get(r.from)!, ...r.waypoints, pos.get(r.to)!],
          color: 'rgba(255,255,255,0.32)',
          width: 1.6,
        });
      }
    }
    // 배후 연결(내륙 경제권 ↔ 관문항): 갈색 점선
    for (const l of world.inlandLinks) {
      routes.push({ points: l.path, color: 'rgba(214,160,92,0.95)', width: 2.6, dashed: true });
    }
    const colorOf = new Map(world.countries.map((c) => [c.id, c.color]));
    const cities: CityOverlay[] = world.cities.filter((c) => c.isPort).map((c) => ({
      lat: sites.get(c.id)!.lat,
      lon: sites.get(c.id)!.lon,
      size: c.portSize,
      color: colorOf.get(c.countryId) ?? '#ffffff',
      selected: c.id === selectedCity?.id || c.id === routeTarget,
    }));
    // 내륙 도시: 작은 표식
    for (const t of towns) {
      cities.push({ lat: t.lat, lon: t.lon, size: 0, color: colorOf.get(t.countryId) ?? '#ffffff', selected: false });
    }
    const overlay: ComposeOptions = {
      routes,
      cities,
      marker: selection?.kind === 'cell' ? [selection.lat, selection.lon] : null,
      graticule: true,
    };
    globeRef.current?.setOverlay(overlay);
    if (mapRef.current) {
      mapRef.current.setOverlay(overlay);
      mapRef.current.setLabels(
        world.cities.map((c) => ({
          lat: c.lat,
          lon: c.lon,
          text: c.name,
          emphasis: c.id === selectedCity?.id || c.id === routeTarget,
        })),
      );
    }
  }, [world, towns, sites, stage, showRoutes, selection, selectedCity, cityRoutes, routeTarget, tab, selectedShipId, sim?.state.ships]); // eslint-disable-line react-hooks/exhaustive-deps

  const selectCity = useCallback((id: string) => {
    const w = worldRef.current;
    const c = w?.cities.find((x) => x.id === id);
    if (!c) return;
    setSelection({ kind: 'city', id });
    setRouteTarget(null);
    globeRef.current?.lookAt(c.lat, c.lon);
    mapRef.current?.lookAt(c.lat, c.lon);
  }, []);

  const pickDestination = useCallback((id: string | null) => {
    if (id) setSelection((prev) => (prev?.kind === 'city' && prev.id === id ? prev : { kind: 'city', id }));
  }, []);

  const openOrderCity = (id: string) => {
    sim?.setPlaying(false);
    selectCity(id);
    const ship = sim?.state.ships.find((s) => s.companyId === PLAYER_ID && isDocked(s) && !s.routeId && s.to === id);
    setPortShipId(ship?.id ?? null);
    setPortDest(null);
    setWin(ship ? null : { kind: 'city', id });
  };
  const openOrderWarehouse = () => {
    sim?.setPlaying(false);
    setPortShipId(null);
    setWin({ kind: 'company', tab: 'warehouse' });
  };

  // 지구본 이름표: 항구 이름 + (렌즈를 켰으면) 그 상품 값
  const lensState = sim?.state;
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !world) return;
    let avg = 0;
    if (lensGood && lensState) {
      const ps = world.cities.map((c) => lensState.cities[c.id]).filter((c) => c.target[lensGood] > 0).map((c) => c.price[lensGood]);
      avg = ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : 0;
    }
    g.setLabels(
      world.cities.map((c) => {
        let badge: string | undefined;
        let tone: 'cheap' | 'dear' | 'plain' | undefined;
        if (lensGood && lensState) {
          const ce = lensState.cities[c.id];
          if (ce.target[lensGood] > 0 && avg > 0) {
            const r = ce.price[lensGood] / avg;
            badge = won(ce.price[lensGood]);
            tone = r < 0.8 ? 'cheap' : r > 1.25 ? 'dear' : 'plain';
          } else {
            badge = '시장 없음';
            tone = 'plain';
          }
        }
        // 큰 항구·내 배가 있는 항구를 먼저 보이고, 내륙 경제권은 나중에(겹치면 숨긴다)
        const hasMine = sim?.state.ships.some((s) => s.companyId === PLAYER_ID && s.to === c.id) ?? false;
        const priority = (c.isPort ? c.portSize * 10 : 5) + (hasMine ? 100 : 0);
        return { id: c.id, lat: c.lat, lon: c.lon, text: c.name, badge, tone, priority, emphasis: c.id === selectedCity?.id || c.id === portDest };
      }),
    );
  }, [world, stage, lensGood, lensState, selectedCity, portDest]);

  // 내 배가 항구에 도착하면 알리고, 명령을 기다리는 배가 있으면 시계를 멈춘다
  const seenLog = useRef<SimEvent | null | undefined>(undefined);
  const simLog = sim?.log;
  useEffect(() => {
    const s = simRef.current;
    if (!s || !simLog) return;
    if (seenLog.current === undefined) {
      seenLog.current = simLog[0] ?? null;
      return;
    }
    const fresh: SimEvent[] = [];
    for (const e of simLog) {
      if (e === seenLog.current) break;
      fresh.push(e);
    }
    seenLog.current = simLog[0] ?? null;
    let waiting = false;
    const add: { id: number; text: string; shipId?: string }[] = [];
    for (const e of fresh) {
      if (e.type === 'order' && (e.kind === 'offered' || e.kind === 'completed' || e.kind === 'expired')) {
        add.push({ id: ++toastId.current, text: e.text });
      }
      if (e.type !== 'arrival') continue;
      const ship = s.state.ships.find((x) => x.id === e.shipId);
      if (!ship) continue;
      const docked = isDocked(ship);
      waiting ||= docked;
      const city = s.ctx.cityNames[e.cityId] ?? e.cityId;
      const lost = e.spoiled.length ? ' (상한 짐이 있어요)' : '';
      add.push({ id: ++toastId.current, text: `${ship.name}이(가) ${city}에 도착했어요${lost}`, shipId: docked ? ship.id : undefined });
    }
    if (add.length) setToasts((all) => [...add.map((t) => ({ ...t, text: fixJosa(t.text) })), ...all].slice(0, 3));
    if (waiting && s.playing) s.setPlaying(false);
  }, [simLog]);
  useEffect(() => {
    if (!toasts.length) return;
    const t = setTimeout(() => setToasts((all) => all.slice(0, -1)), 7000);
    return () => clearTimeout(t);
  }, [toasts]);

  // 펼친 메뉴(지도·메뉴)는 바깥을 누르면 닫는다
  useEffect(() => {
    const close = (e: PointerEvent) => {
      document.querySelectorAll('details.pop[open]').forEach((d) => {
        if (!d.contains(e.target as Node)) d.removeAttribute('open');
      });
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);

  const layerDef = LAYERS.find((l) => l.id === layer)!;
  const tut = useTutorial(sim, { portOpen: !!portShipId && !picking, dest: portDest, companyOpen: win?.kind === 'company' });
  /** 누를 곳 반짝이기: 튜토리얼을 켰으면 튜토리얼이 정하고, 예전 저장(설정 없음)은 첫 거래 전까지만 */
  const legacyCoach = !!sim && sim.settings.tutorial === undefined && sim.state.player.tradeCount === 0;

  if (error && !world) {
    return (
      <div className="splash">
        <h1>세계 데이터를 찾지 못했습니다</h1>
        <p>{error}</p>
        <button onClick={() => regenerate('trade-world-1')}>브라우저에서 바로 생성하기</button>
      </div>
    );
  }
  if (!world) return <div className="splash">{busy ?? '준비 중…'}</div>;

  return (
    <div className={sideOpen ? 'app' : 'app side-closed'}>
      <header className="topbar hud">
        <div className="brand">
          <b>국제무역 시뮬레이터</b>
          <span>{sim?.state.scenario ? '수업 중' : '자유 놀이'}</span>
        </div>
        {sim && (
          <div className="clock">
            <span className="hud-date">
              <Icon name="calendar" size={18} />
              <b>{formatDate(sim.ctx.data.startYear, sim.state.month)}</b>
            </span>
            <button data-tut="play" className={[sim.playing ? 'play on' : 'play', tut.target === 'play' && !sim.playing ? 'coach' : ''].join(' ')} onClick={() => sim.setPlaying(!sim.playing)}>
              <Icon name={sim.playing ? 'player-pause' : 'player-play'} size={16} /> {sim.playing ? '멈춤' : '시작'}
            </button>
            <button
              className="play speed"
              onClick={() => sim.setSpeed(sim.speed === 1 ? 2 : sim.speed === 2 ? 5 : 1)}
              title="누를 때마다 빠르기가 바뀌어요"
            >
              <Icon name={sim.speed === 1 ? 'chevron-right' : sim.speed === 2 ? 'chevrons-right' : 'player-track-next'} size={16} />
              {sim.speed === 1 ? '보통' : sim.speed === 2 ? '빠름' : '아주 빠름'}
            </button>
            <button className="play" disabled={sim.playing} onClick={sim.stepOnce} title="한 달만 진행">
              +1달
            </button>
          </div>
        )}
        <div className="hud-spacer" />
        <details className="pop">
          <summary className="play">
            <Icon name="map-2" size={16} /> <span className="hud-label">지도 · {layerDef.name}</span>
          </summary>
          <div className="pop-body">
            <div className="seg" role="tablist" aria-label="보기 방식">
              <button className={view === 'globe' ? 'on' : ''} disabled={!webgl || light} onClick={() => setView('globe')}>
                지구본
              </button>
              <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
                세계지도
              </button>
            </div>
            <div className="layer-grid" role="tablist" aria-label="지도 레이어">
              {LAYERS.filter((l) => layerAvailable(world, l.id)).map((l) => (
                <button key={l.id} className={l.id === layer ? 'on' : ''} title={l.hint} onClick={() => setLayer(l.id)}>
                  {l.name}
                </button>
              ))}
            </div>
            <label className="check">
              <input type="checkbox" checked={showRoutes} onChange={(e) => setShowRoutes(e.target.checked)} />
              모든 항로 보기
            </label>
          </div>
        </details>
        <button
          className={win?.kind === 'world' ? 'play toggled' : 'play'}
          disabled={!sim}
          onClick={() => {
            setPortShipId(null);
            setWin((w) => (w?.kind === 'world' ? null : { kind: 'world' }));
          }}
          title="어디가 싸고 비싼지, 나라들, 세계 소식"
        >
          <Icon name="world" size={16} /> <span className="hud-label">세계</span>
        </button>
        <button
          className={win?.kind === 'orders' ? 'play toggled' : 'play'}
          disabled={!sim}
          aria-label="도시 발주함"
          onClick={() => {
            if (win?.kind !== 'orders') sim?.setPlaying(false);
            setPicking(false);
            setPortShipId(null);
            setWin((w) => w?.kind === 'orders' ? null : { kind: 'orders' });
          }}
          title="도시의 물건 요청을 보고 받을지 선택하기"
        >
          <Icon name="clipboard-list" size={16} /> <span>발주</span>
          {!!sim?.state.player.orders?.items.some(isOpenOrder) && <b className="order-badge">{sim.state.player.orders.items.filter(isOpenOrder).length}</b>}
        </button>
        <button className={sideOpen ? 'play toggled' : 'play'} onClick={() => setSideOpen((v) => !v)} title="시장·회사·항로를 표로 자세히 보기">
          <Icon name={sideOpen ? 'layout-sidebar-right-collapse' : 'layout-sidebar-right-expand'} size={16} /> <span className="hud-label">자세히</span>
        </button>
        <details className="pop">
          <summary className="play" aria-label="메뉴">
            <Icon name="menu-2" size={16} /> <span className="hud-label">{savedNote ?? '메뉴'}</span>
          </summary>
          <div className="pop-body menu">
            <button className="play" onClick={() => setShowNew(true)}>
              <Icon name="school" size={16} /> 새 수업
            </button>
            <button
              className="play"
              disabled={!sim}
              onClick={() => {
                const ok = sim?.save('slot1');
                setSavedNote(ok ? '저장했어요' : '저장하지 못했어요');
                setTimeout(() => setSavedNote(null), 2500);
              }}
            >
              <Icon name="device-floppy" size={16} /> 저장
            </button>
            <button
              className="play"
              disabled={!sim}
              title="지금 게임 상태를 파일(JSON)로 내려받아요. 저장 칸은 바꾸지 않아요."
              onClick={() => {
                const ok = !!sim && exportSave(sim.snapshot());
                setSavedNote(ok ? '파일로 내보냈어요' : '내보내지 못했어요');
                setTimeout(() => setSavedNote(null), 2500);
              }}
            >
              <Icon name="download" size={16} /> 저장 파일로 내보내기
            </button>
            <button className="play" disabled={!sim} onClick={() => setShowReport(true)}>
              <Icon name="report" size={16} /> 수업 리포트
            </button>
            <label className="check" title="태블릿이 느릴 때: 2D 지도와 작은 그림을 써요">
              <input
                type="checkbox"
                checked={light}
                onChange={(e) => {
                  setLight(e.target.checked);
                  if (e.target.checked) setView('map');
                }}
              />
              가벼운 화면
            </label>
          </div>
        </details>
      </header>

      <main className="stage">
        <div className="view" ref={hostRef} />
        {layer !== 'terrain' && <div className="overlay">
          <div className="overlay-title">
            <b>{layerDef.name}</b>
            <span>{layerDef.hint}</span>
          </div>
          {layer === 'crops' && (
            <div className="seg small">
              {world.catalog.crops.map((c) => (
                <button key={c.id} className={c.id === cropId ? 'on' : ''} onClick={() => setCropId(c.id)}>
                  {c.name}
                </button>
              ))}
            </div>
          )}
          {layerDef.monthly && (
            <label className="month">
              <span>
                <b>{month + 1}월</b> {seasonText(month)}
              </span>
              <input type="range" min={0} max={11} value={month} onChange={(e) => setMonth(Number(e.target.value))} />
            </label>
          )}
          <Legend world={world} layer={layer} />
        </div>}
        {sim && !sideOpen && !picking && (
          <details className="float-lesson" open>
            <summary>
              <Icon name="flag" size={16} /> 목표
            </summary>
            <div className="goal-content">
              <OrderGoals sim={sim} onCity={openOrderCity} onWarehouse={openOrderWarehouse} />
              <LessonCard sim={sim} />
              {sim.settings.tutorial === undefined && <FirstTradeGuide sim={sim} />}
            </div>
          </details>
        )}
        {sim && (
          <div className="lens">
            {lensOpen && (
              <div className="lens-grid" role="listbox" aria-label="상품 고르기">
                {sim.ctx.goods.map((g) => (
                  <button
                    key={g.id}
                    className={`lens-good cat-${g.category}${lensGood === g.id ? ' on' : ''}`}
                    onClick={() => {
                      setLensGood(g.id);
                      setLensOpen(false);
                    }}
                    title={g.name}
                  >
                    <GoodIcon id={g.id} size={22} />
                    <span>{g.name}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="lens-bar">
              <button className={lensGood ? 'play toggled' : 'play'} onClick={() => setLensOpen((v) => !v)}>
                <Icon name="zoom-money" size={18} /> 상품 렌즈
              </button>
              {lensGood && (
                <span className="lens-chip">
                  <GoodIcon id={lensGood} size={18} /> {sim.ctx.goodById[lensGood].name}
                  <span className="tag-inline cheap">싸요</span>
                  <span className="tag-inline dear">비싸요</span>
                  <button className="x" onClick={() => setLensGood(null)} aria-label="렌즈 끄기">
                    ×
                  </button>
                </span>
              )}
            </div>
          </div>
        )}
        {sim && !showNew && <TutorialCard t={tut} compact={(!!portShipId && !picking) || (!portShipId && !picking && win !== null)} />}
        {toasts.length > 0 && (
          <div className="toasts" role="status">
            {toasts.map((t) => (
              <div key={t.id} className="toast">
                <Icon name="anchor" size={20} />
                <span>{t.text}</span>
                {t.shipId && (
                  <button
                    className="btn small"
                    onClick={() => {
                      openShip(t.shipId!);
                      setToasts((all) => all.filter((x) => x.id !== t.id));
                    }}
                  >
                    항구 열기
                  </button>
                )}
                <button className="x" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))} aria-label="닫기">
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {sim && (
          <Dock sim={sim} world={world} selectedShipId={portShipId ?? selectedShipId} coach={!portShipId && (tut.target === 'dock' || legacyCoach)} coachCompany={tut.target === 'company'} onOpen={openShip} onCompany={() => {
            setPortShipId(null);
            setWin((w) => (w?.kind === 'company' ? null : { kind: 'company' }));
          }} />
        )}
        {sim && picking && (
          <div className="pick-banner" role="status">
            <Icon name="hand-click" size={20} /> 갈 항구를 눌러 주세요{sim.ctx.inlandLinks.length > 0 && ' · 내륙 시장을 누르면 관문항을 선택해요'}
            <button className="btn small" onClick={() => setPicking(false)}>
              취소
            </button>
          </div>
        )}
        {sim &&
          !picking &&
          portShipId &&
          (() => {
            const ship = sim.state.ships.find((s) => s.id === portShipId);
            if (!ship) return null;
            return (
              <PortWindow
                sim={sim}
                coaching={sim.settings.tutorial !== false}
                world={world}
                ship={ship}
                dest={portDest && portDest !== ship.to ? portDest : null}
                onDest={(id) => {
                  setPortDest(id);
                  if (id) pickDestination(id);
                  else setSelection(null);
                }}
                onPickOnMap={() => setPicking(true)}
                onLens={setLensGood}
                onWarehouse={() => { sim.setPlaying(false); setPortShipId(null); setWin({ kind: 'company', tab: 'warehouse' }); }}
                onClose={() => {
                  setPortShipId(null);
                  setPicking(false);
                }}
              />
            );
          })()}
        {sim && !picking && !portShipId && win?.kind === 'city' && (
          <CityWindow
            sim={sim}
            world={world}
            cityId={win.id}
            onClose={() => setWin(null)}
            onLens={setLensGood}
            onSendShip={(shipId, cityId) => {
              setWin(null);
              setSelectedShipId(shipId);
              setPortShipId(shipId);
              setPortDest(cityId);
              pickDestination(cityId);
            }}
          />
        )}
        {sim && !picking && !portShipId && win?.kind === 'company' && (
          <CompanyWindow
            onCity={(id) => { setWin({ kind: 'city', id }); selectCity(id); }}
            sim={sim}
            world={world}
            initialTab={win.tab}
            onClose={() => setWin(null)}
          />
        )}
        {sim && !picking && !portShipId && win?.kind === 'orders' && (
          <OrdersWindow sim={sim} onClose={() => setWin(null)} onCity={(id) => { setWin({ kind: 'city', id }); selectCity(id); }} />
        )}
        {sim && !picking && !portShipId && win?.kind === 'world' && (
          <WorldWindow
            sim={sim}
            world={world}
            onClose={() => setWin(null)}
            onLens={setLensGood}
            onCity={(id) => {
              setWin({ kind: 'city', id });
              selectCity(id);
            }}
          />
        )}
        {!webgl && <div className="notice">이 기기에서는 3D 지구본을 쓸 수 없어 세계지도로 보여 드립니다.</div>}
        {busy && <div className="busy">{busy}</div>}
        {(() => {
          // 수업 사건이 일어나면 화면 위에 잠시 띄운다
          const e = picking ? undefined : sim?.lessonNews[0];
          if (!e || e.type !== 'scenario' || e.kind === 'goal' || e.month <= bannerSeen) return null;
          return (
            <div className="lesson-banner" role="status">
              <div>
                <b>{e.text}</b>
                {e.question && <span>생각해 보기: {e.question}</span>}
              </div>
              <button className="btn small" onClick={() => setBannerSeen(e.month)}>
                알겠어요
              </button>
            </div>
          );
        })()}
      </main>

      <div className="side">
        <nav className="tabs" role="tablist" aria-label="할 일">
          <button className={tab === 'market' ? 'on' : ''} onClick={() => setTab('market')}>
            시장 보기
          </button>
          <button className={tab === 'fleet' ? 'on' : ''} onClick={() => setTab('fleet')}>
            사고팔고 배 보내기
          </button>
          <button className={tab === 'company' ? 'on' : ''} onClick={() => setTab('company')}>
            결과·회사
          </button>
        </nav>
        {tab === 'fleet' && sim && (
          <aside className="panel">
            <OrderGoals sim={sim} onCity={openOrderCity} onWarehouse={openOrderWarehouse} />
            <LessonCard sim={sim} />
            {sim.settings.tutorial === undefined && <FirstTradeGuide sim={sim} />}
            <FleetPanel
              sim={sim}
              world={world}
              pickedCityId={selectedCity?.id ?? null}
              selectedShipId={selectedShipId}
              onSelectShip={setSelectedShipId}
              onDestination={pickDestination}
              onFocus={(id) => {
                const c = world.cities.find((x) => x.id === id);
                if (c) {
                  globeRef.current?.lookAt(c.lat, c.lon);
                  mapRef.current?.lookAt(c.lat, c.lon);
                }
              }}
            />
          </aside>
        )}
        {tab === 'company' && sim && (
          <aside className="panel">
            <CompanyPanel sim={sim} world={world} />
          </aside>
        )}
        {tab === 'market' && (
      <SidePanel
        world={world}
        selection={selection}
        month={month}
        routes={panelRoutes}
        routeTarget={routeTarget}
        onRouteTarget={setRouteTarget}
        blocked={blockedNow}
        onToggleBlock={(id) => {
          if (sim) {
            // 게임 중에는 경제에 실제로 반영한다(항해 중인 배는 지금 위치에서 다시 길을 찾는다)
            const closed = !blockedNow.includes(id);
            sim.act({ type: 'setPassage', passageId: id, closed, maxShipSize: closed ? undefined : null, reason: '교사가 지도에서 막음(게임 속 사건)' });
          } else setBlocked((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]));
        }}
        onSelectCity={selectCity}
        onClear={() => {
          setSelection(null);
          setRouteTarget(null);
        }}
        genMs={genMs}
        cityExtra={sim && selectedCity ? <CityMarket sim={sim} cityId={selectedCity.id} /> : null}
        worldExtra={sim ? <WorldMarket sim={sim} world={world} onSelectCity={selectCity} /> : null}
      />
        )}
      </div>
      {showNew && (
        <NewLessonDialog
          current={gameStart.settings}
          prepareWorld={ensureWorld}
          onStart={(s) => void startLesson(s)}
          onLoad={(f) => void startLesson(f.settings, f)}
          onClose={gameStart.nonce > 0 ? () => setShowNew(false) : undefined}
          note={loadNote}
        />
      )}
      {sim && !showNew && <CoachMark t={tut} />}
      {showReport && sim && <ReportDialog sim={sim} world={world} onClose={() => setShowReport(false)} />}
    </div>
  );
}
