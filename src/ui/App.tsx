import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LAYERS, renderBaseLayer, type LayerId } from '../render/baseLayer';
import { composeMap, type CityOverlay, type RouteOverlay } from '../render/compose';
import { GlobeView, type GlobePort, type GlobeShip } from '../render/GlobeView';
import { cellLatLon } from '../sim/core/grid';
import { placeTowns } from '../render/towns';
import { MapView } from '../render/MapView';
import { angularDistance, DEG, type LatLon } from '../sim/core/sphere';
import { makeConfig } from '../sim/world/config';
import { generateWorld } from '../sim/world/generateWorld';
import { buildNavGrid, findSeaRoute } from '../sim/world/seaRoutes';
import type { World } from '../sim/world/types';
import { Legend } from './Legend';
import { loadWorld } from './loadWorld';
import { CompanyPanel, FleetPanel } from './CompanyPanel';
import { DEFAULT_START, FirstTradeGuide, LessonCard, NewLessonDialog, ReportDialog } from './ClassroomPanels';
import type { GameSettings } from '../sim/classroom/settings';
import type { SaveFile } from './save';
import { CityMarket, COMPANY_COLORS, WorldMarket } from './MarketPanel';
import { PLAYER_ID } from '../sim/economy/player';
import { SidePanel, type CityRoute, type Selection } from './SidePanel';
import { Dock } from './Dock';
import { PortWindow } from './PortWindow';
import { Icon } from './icons';
import { formatDate, useSimulation, type GameStart } from './useSimulation';

type ViewMode = 'globe' | 'map';
type Tab = 'market' | 'fleet' | 'company';
const PLAYER_COLOR = '#ffd166';
const TEXTURE_WIDTH = 2880;

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
  const [savedNote, setSavedNote] = useState<string | null>(null);
  const [bannerSeen, setBannerSeen] = useState(-1);
  const [tab, setTab] = useState<Tab>('fleet');
  const [selectedShipId, setSelectedShipId] = useState<string | null>(null);
  /** 항구 창이 열린 배, 그 배의 목적지, 지도에서 목적지를 고르는 중인지 */
  const [portShipId, setPortShipId] = useState<string | null>(null);
  const [portDest, setPortDest] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  /** 오른쪽 자세한 패널(처음엔 접어 둔다) */
  const [sideOpen, setSideOpen] = useState(false);
  const portRef = useRef<{ shipId: string | null; picking: boolean }>({ shipId: null, picking: false });
  portRef.current = { shipId: portShipId, picking };

  const hostRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeView | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const worldRef = useRef<World | null>(null);
  worldRef.current = world;

  useEffect(() => {
    loadWorld()
      .then((w) => {
        setWorld(w);
        setSeedInput(w.seed);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(null));
  }, []);

  const regenerate = useCallback((seed: string) => {
    if (!seed.trim()) return;
    setBusy(`시드 "${seed}"로 세계를 만드는 중…`);
    setError(null);
    // 화면에 안내를 먼저 그린 뒤 계산한다
    setTimeout(() => {
      const t0 = performance.now();
      const { world: w } = generateWorld(makeConfig({ seed: seed.trim() }));
      setGenMs(Math.round(performance.now() - t0));
      setWorld(w);
      setSelection(null);
      setRouteTarget(null);
      setBlocked([]);
      setBusy(null);
    }, 30);
  }, []);

  const sim = useSimulation(world, gameStart);

  /** 새 수업: 시드가 다르면 세계부터 다시 만든다 */
  const startLesson = useCallback(
    (settings: GameSettings, loaded?: SaveFile['state']) => {
      setShowNew(false);
      setSelection(null);
      setSelectedShipId(null);
      if (world && world.seed !== settings.seed) regenerate(settings.seed);
      setGameStart((prev) => ({ settings, loaded, nonce: prev.nonce + 1 }));
    },
    [world, regenerate],
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
    () => (world ? buildNavGrid(world.grid, world.planetRadiusKm, world.layers.seaZone) : null),
    [world],
  );

  const selectedCity = useMemo(
    () => (world && selection?.kind === 'city' ? (world.cities.find((c) => c.id === selection.id) ?? null) : null),
    [world, selection],
  );

  /** 선택한 항구에서 다른 모든 항구로 가는 항로. 봉쇄가 있으면 런타임에 다시 탐색한다. */
  const cityRoutes = useMemo(() => {
    if (!world || !nav || !selectedCity) return [];
    const blockedIdx = blocked
      .map((id) => world.chokepoints.find((g) => g.id === id)?.index)
      .filter((v): v is number => v !== undefined);
    return world.cities
      .filter((c) => c.id !== selectedCity.id)
      .map((other) => {
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
  }, [world, nav, selectedCity, blocked]);

  const panelRoutes: CityRoute[] = useMemo(
    () => cityRoutes.map((r) => ({ toId: r.toId, distanceKm: r.distanceKm, baseDistanceKm: r.baseDistanceKm, gates: r.gates })),
    [cityRoutes],
  );

  const base = useMemo(
    () => (world ? renderBaseLayer(world, { layer, month, cropId, scale: light ? 1 : 2 }) : null),
    [world, layer, month, cropId, light],
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
    setSelection(best ? { kind: 'city', id: best } : { kind: 'cell', lat, lon });
    // 항구 창이 열려 있으면 누른 항구가 목적지가 된다
    const port = portRef.current;
    if (port.shipId) {
      const ship = simRef.current?.state.ships.find((s) => s.id === port.shipId);
      if (best && ship && best !== ship.to) {
        setPortDest(best);
        setPicking(false);
      }
    }
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
    if (view === 'globe') {
      try {
        globeRef.current = new GlobeView(host, handlePick, handlePickShip);
      } catch {
        setWebgl(false);
        setView('map');
        return;
      }
      if (canvasRef.current) globeRef.current.setTexture(canvasRef.current);
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
  }, [view, world === null, handlePick]); // eslint-disable-line react-hooks/exhaustive-deps

  // 화면에만 있는 내륙 도시(세계가 바뀔 때만 다시 고른다)
  const towns = useMemo(() => (world ? placeTowns(world) : []), [world]);

  // 지구본의 항구 도시 모델: 항만 규모·나라 색
  const portLevels = sim?.state.portLevel;
  useEffect(() => {
    const g = globeRef.current;
    if (!g || !world) return;
    const colorOf = new Map(world.countries.map((c) => [c.id, c.color]));
    const ports: GlobePort[] = world.cities.map((c) => {
      const [seaLat, seaLon] = c.seaCell >= 0 ? cellLatLon(world.grid, c.seaCell) : [c.lat, c.lon + 1];
      const level = Math.min(3, Math.max(1, Math.round(portLevels?.[c.id] ?? c.portSize ?? 1))) as 1 | 2 | 3;
      return { id: c.id, lat: c.lat, lon: c.lon, seaLat, seaLon, level, countryColor: colorOf.get(c.countryId) ?? '#ffffff' };
    });
    g.setPorts(ports);
    g.setTowns(towns.map((t) => ({ id: t.id, lat: t.lat, lon: t.lon, size: t.size, countryColor: colorOf.get(t.countryId) ?? '#ffffff' })));
  }, [world, view, portLevels, towns]);

  useEffect(() => {
    globeRef.current?.selectShip(selectedShipId);
  }, [selectedShipId, view, world]);

  // 그림 합성 -> 지구본 텍스처 / 2D 지도
  useEffect(() => {
    if (!world || !base) return;
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
        const pts = pathBetween(s.from, s.to);
        if (pts) routes.push({ points: pts, color: PLAYER_COLOR, width: 3.5 });
      }
      const mine = sim.state.ships.find((s) => s.id === selectedShipId) ?? sim.state.ships.find((s) => s.companyId === PLAYER_ID);
      if (mine && selectedCity && mine.from === mine.to && mine.to !== selectedCity.id) {
        const pts = pathBetween(mine.to, selectedCity.id);
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
    const colorOf = new Map(world.countries.map((c) => [c.id, c.color]));
    const cities: CityOverlay[] = world.cities.map((c) => ({
      lat: c.lat,
      lon: c.lon,
      size: c.portSize,
      color: colorOf.get(c.countryId) ?? '#ffffff',
      selected: c.id === selectedCity?.id || c.id === routeTarget,
    }));
    // 내륙 도시: 작은 표식
    for (const t of towns) {
      cities.push({ lat: t.lat, lon: t.lon, size: 0, color: colorOf.get(t.countryId) ?? '#ffffff', selected: false });
    }
    const canvas = canvasRef.current ?? (canvasRef.current = document.createElement('canvas'));
    composeMap(base, canvas, light ? TEXTURE_WIDTH / 2 : TEXTURE_WIDTH, {
      mode: view === 'globe' ? 'globe' : 'flat',
      routes,
      cities,
      marker: selection?.kind === 'cell' ? [selection.lat, selection.lon] : null,
      graticule: true,
      cityStyle: view === 'globe' ? 'ring' : 'disc',
    });
    globeRef.current?.setTexture(canvas);
    if (mapRef.current) {
      mapRef.current.setSource(canvas);
      mapRef.current.setLabels(
        world.cities.map((c) => ({
          lat: c.lat,
          lon: c.lon,
          text: c.name,
          emphasis: c.id === selectedCity?.id || c.id === routeTarget,
        })),
      );
    }
  }, [world, towns, base, view, showRoutes, selection, selectedCity, cityRoutes, routeTarget, tab, selectedShipId, sim?.state.ships]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const layerDef = LAYERS.find((l) => l.id === layer)!;

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
      <header className="topbar">
        <div className="brand">
          <b>국제무역 시뮬레이터</b>
          <span>{sim?.state.scenario ? '수업 중' : '자유 놀이'}</span>
        </div>
        {sim && (
          <div className="clock">
            <b>{formatDate(sim.ctx.data.startYear, sim.state.month)}</b>
            <button className={sim.playing ? 'play on' : 'play'} onClick={() => sim.setPlaying(!sim.playing)}>
              {sim.playing ? '⏸ 멈춤' : '▶ 시작'}
            </button>
            <div className="seg small">
              {[1, 2, 5].map((v) => (
                <button key={v} className={sim.speed === v ? 'on' : ''} onClick={() => sim.setSpeed(v)}>
                  {v === 1 ? '보통' : v === 2 ? '빠름' : '아주 빠름'}
                </button>
              ))}
            </div>
            <button className="play" disabled={sim.playing} onClick={sim.stepOnce} title="한 달만 진행">
              +1달
            </button>
          </div>
        )}
        <div className="seg" role="tablist" aria-label="보기 방식">
          <button className={view === 'globe' ? 'on' : ''} disabled={!webgl || light} onClick={() => setView('globe')}>
            지구본
          </button>
          <button className={view === 'map' ? 'on' : ''} onClick={() => setView('map')}>
            세계지도
          </button>
        </div>
        <div className="layers" role="tablist" aria-label="지도 레이어">
          {LAYERS.map((l) => (
            <button key={l.id} className={l.id === layer ? 'on' : ''} title={l.hint} onClick={() => setLayer(l.id)}>
              {l.name}
            </button>
          ))}
        </div>
        <div className="lesson-tools">
          <button className="play" onClick={() => setShowNew(true)}>
            새 수업
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
            {savedNote ?? '저장'}
          </button>
          <button className="play" disabled={!sim} onClick={() => setShowReport(true)}>
            수업 리포트
          </button>
          <button className={sideOpen ? 'play toggled' : 'play'} onClick={() => setSideOpen((v) => !v)} title="시장·회사·항로를 표로 자세히 보기">
            <Icon name={sideOpen ? 'layout-sidebar-right-collapse' : 'layout-sidebar-right-expand'} size={16} /> 자세히
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
      </header>

      <main className="stage">
        <div className="view" ref={hostRef} />
        <div className="overlay">
          <div className="overlay-title">
            <b>{layerDef.name}</b>
            <span>{layerDef.hint}</span>
          </div>
          {layer === 'crops' && (
            <div className="seg small">
              {world.config.crops.map((c) => (
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
          <label className="check">
            <input type="checkbox" checked={showRoutes} onChange={(e) => setShowRoutes(e.target.checked)} />
            모든 항로 보기
          </label>
        </div>
        {sim && !sideOpen && !picking && (
          <details className="float-lesson" open>
            <summary>
              <Icon name="flag" size={16} /> 목표
            </summary>
            <LessonCard sim={sim} />
            <FirstTradeGuide sim={sim} />
          </details>
        )}
        {sim && (
          <Dock sim={sim} world={world} selectedShipId={portShipId ?? selectedShipId} onOpen={openShip} />
        )}
        {sim && picking && (
          <div className="pick-banner" role="status">
            <Icon name="hand-click" size={20} /> 지도에서 갈 항구를 눌러 주세요
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
                world={world}
                ship={ship}
                dest={portDest && portDest !== ship.to ? portDest : null}
                onDest={(id) => {
                  setPortDest(id);
                  if (id) pickDestination(id);
                  else setSelection(null);
                }}
                onPickOnMap={() => setPicking(true)}
                onClose={() => {
                  setPortShipId(null);
                  setPicking(false);
                }}
              />
            );
          })()}
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
            <LessonCard sim={sim} />
            <FirstTradeGuide sim={sim} />
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
            <CompanyPanel sim={sim} world={world} pickedCityId={selectedCity?.id ?? null} />
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
        blocked={blocked}
        onToggleBlock={(id) => setBlocked((b) => (b.includes(id) ? b.filter((x) => x !== id) : [...b, id]))}
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
          onStart={(s) => startLesson(s)}
          onLoad={(f) => startLesson(f.settings, f.state)}
          onClose={gameStart.nonce > 0 ? () => setShowNew(false) : undefined}
        />
      )}
      {showReport && sim && <ReportDialog sim={sim} world={world} onClose={() => setShowReport(false)} />}
    </div>
  );
}
