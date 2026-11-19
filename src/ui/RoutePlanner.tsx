import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { renderBaseLayer } from '../render/baseLayer';
import { portSite } from '../render/coast';
import { drawBase, type CityOverlay, type RouteOverlay } from '../render/compose';
import { MapView } from '../render/MapView';
import { REASON_NAMES } from '../sim/classroom/reasons';
import { fixJosa } from '../sim/core/korean';
import { angularDistance, DEG, type LatLon } from '../sim/core/sphere';
import { brandStock } from '../sim/economy/origin';
import { portOutlook, type PortOutlook } from '../sim/economy/outlook';
import { canEnter, estimateVoyage, PLAYER_ID } from '../sim/economy/player';
import type { RouteStop } from '../sim/economy/types';
import type { World } from '../sim/world/types';
import { GoodIcon, Icon, ReasonIcon } from './icons';
import { profitableHere, RouteForecast, StopOpportunities } from './RouteForecast';
import type { Simulation } from './useSimulation';

/** 항로 짜기용 지도 바탕(세계마다 한 번만 굽는다) */
const baseCache = new WeakMap<World, HTMLCanvasElement>();
function plannerBase(world: World): HTMLCanvasElement {
  let c = baseCache.get(world);
  if (!c) {
    const img = renderBaseLayer(world, { layer: 'terrain', month: 6, cropId: 'grain', scale: 2 });
    c = drawBase(img, document.createElement('canvas'));
    baseCache.set(world, c);
  }
  return c;
}

const STOP_MARK = ['①', '②', '③', '④'];
const LOOP_COLORS = ['#ffd166', '#ffb347', '#ff9f68', '#ffd166'];

/**
 * 항로 짜기 지도: 항구를 눌러 기항지를 넣고, 넣은 항구를 누르면 그 항구를 고른다.
 * 기항지 사이는 지금 운하 상태로 이 배가 실제로 갈 바닷길로 이어 그린다(돌아오는 길 포함).
 */
function RouteMap(props: {
  sim: Simulation;
  world: World;
  stops: RouteStop[];
  selected: number;
  typeId: string;
  onPort: (cityId: string) => void;
}) {
  const { sim, world, stops, selected, typeId } = props;
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<MapView | null>(null);
  const onPort = useRef(props.onPort);
  onPort.current = props.onPort;
  const ports = useMemo(() => world.cities.filter((c) => c.isPort), [world]);
  const sites = useMemo(() => new Map(ports.map((c) => [c.id, portSite(world, c)])), [world, ports]);

  useEffect(() => {
    if (!host.current) return;
    const v = new MapView(host.current, (lat, lon) => {
      let best: string | null = null;
      let bestD = 3;
      for (const c of ports) {
        const d = angularDistance(lat, lon, c.lat, c.lon) / DEG;
        if (d < bestD) {
          bestD = d;
          best = c.id;
        }
      }
      if (best) onPort.current(best);
    });
    v.setSource(plannerBase(world));
    // 처음에는 첫 기항지(없으면 내 배가 있는 곳)를 가운데에 둔다
    const first = world.cities.find((c) => c.id === (stops[0]?.cityId ?? sim.state.ships.find((s) => s.companyId === PLAYER_ID)?.to));
    if (first) v.lookAt(first.lat * 0.5, first.lon);
    view.current = v;
    return () => {
      v.dispose();
      view.current = null;
    };
  }, [world]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const pos = (id: string): LatLon => {
      const c = world.cities.find((x) => x.id === id)!;
      return [c.lat, c.lon];
    };
    const routes: RouteOverlay[] = [];
    if (stops.length >= 2) {
      for (let k = 0; k < stops.length; k++) {
        const a = stops[k].cityId;
        const b = stops[(k + 1) % stops.length].cityId;
        if (a === b) continue;
        const leg = estimateVoyage(sim.ctx, typeId, a, b, sim.state).leg;
        const back = k === stops.length - 1;
        routes.push({
          points: leg ? [pos(a), ...leg.waypoints, pos(b)] : [pos(a), pos(b)],
          color: back ? 'rgba(255,209,102,0.55)' : LOOP_COLORS[k],
          width: back ? 4.5 : 6,
          dashed: back || !leg,
        });
      }
    }
    const colorOf = new Map(world.countries.map((c) => [c.id, c.color]));
    const inRoute = new Set(stops.map((s) => s.cityId));
    const cities: CityOverlay[] = ports.map((c) => ({
      lat: sites.get(c.id)!.lat,
      lon: sites.get(c.id)!.lon,
      size: c.portSize,
      color: colorOf.get(c.countryId) ?? '#ffffff',
      selected: inRoute.has(c.id),
    }));
    v.setOverlay({ routes, cities, marker: null, graticule: true });
    v.setLabels(
      ports.map((c) => {
        const k = stops.findIndex((s) => s.cityId === c.id);
        const tooSmall = !canEnter(sim.ctx, sim.state, typeId, c.id);
        return {
          lat: c.lat,
          lon: c.lon,
          text: k >= 0 ? `${STOP_MARK[k] ?? k + 1} ${c.name}` : tooSmall ? `${c.name} (작음)` : c.name,
          // 넣은 항구의 이름표는 겹쳐도 먼저 보인다
          emphasis: k >= 0,
        };
      }),
    );
  }, [world, ports, sites, stops, selected, typeId, sim.ctx, sim.state]);

  return <div className="planner-map-host" ref={host} />;
}

/** 기항지 한 곳의 값 성향: 싸게 살 수 있는 상품·비싸게 팔 수 있는 상품과 그 까닭. 누르면 살/팔 상품에 넣는다 */
function StopOutlook(props: {
  sim: Simulation;
  name: (id: string) => string;
  stop: RouteStop;
  look: PortOutlook;
  /** 이 항로의 다른 기항지들(짝이 맞는 상품을 찾는다) */
  others: { cityId: string; look: PortOutlook }[];
  onBuy: (goodId: string) => void;
  onSell: (goodId: string) => void;
  /** 이 항로에서 실제로 남는 상품(값만 싼 것과 구분해 보여 준다) */
  profitable?: Set<string>;
}) {
  const { sim, name, stop, look, others } = props;
  const SHOW = 4;
  const column = (side: 'cheap' | 'dear') => {
    const opposite = side === 'cheap' ? 'dear' : 'cheap';
    // 이 항로의 다른 항구와 짝이 맞는 상품(여기서 싸고 저기서 비싼 것)을 먼저 보여 준다
    const items = look[side]
      .map((it) => ({ it, pairs: others.filter((o) => o.look[opposite].some((x) => x.goodId === it.goodId)).map((o) => name(o.cityId)) }))
      .sort((a, b) => Number(b.pairs.length > 0) - Number(a.pairs.length > 0))
      .slice(0, SHOW);
    return (
      <div className="outlook-col">
        <b className={side === 'cheap' ? 'good' : 'high'}>{side === 'cheap' ? '여기서 싸게 살 수 있어요' : '여기서 비싸게 팔 수 있어요'}</b>
        {items.length === 0 && <span className="muted">{side === 'cheap' ? '눈에 띄게 싼 상품이 없어요.' : '눈에 띄게 비싼 상품이 없어요.'}</span>}
        {items.map(({ it, pairs }) => {
          const g = sim.ctx.goodById[it.goodId];
          const added = side === 'cheap' ? stop.buy.some((b) => b.goodId === it.goodId) : stop.sell.includes(it.goodId);
          const pct = Math.round(Math.abs(it.vsWorld - 1) * 100);
          return (
            <div key={it.goodId} className="outlook-item">
              <div className="row">
                <button
                  className="btn small"
                  disabled={added}
                  onClick={() => (side === 'cheap' ? props.onBuy(it.goodId) : props.onSell(it.goodId))}
                  title={side === 'cheap' ? '살 상품에 넣기' : '팔 상품에 넣기'}
                >
                  <GoodIcon id={g.id} size={15} /> {g.name} {added ? '✓' : '+'}
                </button>
                {side === 'cheap' && props.profitable && !props.profitable.has(it.goodId) && (
                  <span className="tag-inline brief" title="세계 평균보다 싸도, 도착 때 값·다른 배·운항비까지 따지면 이 항로에서는 남지 않아요">
                    이 항로에선 안 남아요
                  </span>
                )}
                <span className={`tag-inline ${side}`}>
                  기본 시세가 세계 평균보다 {pct}% {side === 'cheap' ? '싸요' : '비싸요'}
                </span>
                <span className={`tag-inline ${it.steady ? 'steady' : 'brief'}`} title={it.steady ? '기후·자원·공장처럼 잘 바뀌지 않는 까닭이에요' : '수확철·사고처럼 한때의 까닭이라 곧 바뀔 수 있어요'}>
                  {it.steady ? '꾸준히' : '한때'}
                </span>
              </div>
              <span className={`why-line why-${it.reason.category}`}>
                <span className="why-chip">
                  <ReasonIcon category={it.reason.category} size={14} /> {REASON_NAMES[it.reason.category]}
                </span>
                <span>{fixJosa(it.reason.text)}</span>
              </span>
              {pairs.length > 0 && (
                <span className="outlook-pair">
                  ↔ 이 항로의 {pairs.join('·')}에서 {side === 'cheap' ? '비싸게 팔 수 있어요' : '싸게 살 수 있어요'}
                </span>
              )}
            </div>
          );
        })}
      </div>
    );
  };
  return (
    <div className="outlook">
      {column('cheap')}
      {column('dear')}
    </div>
  );
}

/** 고른 기항지에서 살 상품·팔 상품: 추천(실제로 남는 것, 값 성향)과 직접 고르기 */
function StopGoods(props: {
  sim: Simulation;
  stops: RouteStop[];
  k: number;
  typeId: string;
  name: (id: string) => string;
  setStops: (f: (all: RouteStop[]) => RouteStop[]) => void;
}) {
  const { sim, stops, k, typeId, name, setStops } = props;
  const { ctx, state } = sim;
  const st = stops[k];
  const looks = useMemo(() => stops.map((s) => portOutlook(ctx, state, s.cityId)), [ctx, state, stops]);
  const updateStop = (f: (s: RouteStop) => RouteStop) => setStops((all) => all.map((s, i) => (i === k ? f(structuredClone(s)) : s)));
  const addBuy = (id: string) => updateStop((s) => { if (!s.buy.some((b) => b.goodId === id)) s.buy.push({ goodId: id, maxQuantity: 50 }); return s; });
  const addSell = (id: string) => updateStop((s) => { if (!s.sell.includes(id)) s.sell.push(id); return s; });
  return (
    <div className="stop">
      {stops.length >= 2 ? (
        <StopOpportunities
          sim={sim}
          stops={stops}
          k={k}
          typeId={typeId}
          name={name}
          onAdd={(id, j) =>
            setStops((all) =>
              all.map((s, i) => {
                const c = structuredClone(s);
                if (i === k && !c.buy.some((b) => b.goodId === id)) c.buy.push({ goodId: id, maxQuantity: 50 });
                if (i === j && !c.sell.includes(id)) c.sell.push(id);
                return c;
              }),
            )
          }
        />
      ) : (
        <p className="muted small">항구를 하나 더 넣으면, 여기서 사서 그 항구에 팔 때 실제로 남는 상품을 알려 줘요.</p>
      )}
      <StopOutlook
        profitable={stops.length >= 2 ? profitableHere(sim, stops, k, typeId) : undefined}
        sim={sim}
        name={name}
        stop={st}
        look={looks[k]}
        others={stops.map((s, i) => ({ cityId: s.cityId, look: looks[i] })).filter((_, i) => i !== k && stops[i].cityId !== st.cityId)}
        onBuy={addBuy}
        onSell={addSell}
      />
      <div className="planner-goods">
        <b className="small">여기서 살 상품</b>
        <div className="row small">
          {st.buy.length === 0 && <span className="muted">아직 없어요.</span>}
          {st.buy.map((b, i) => (
            <span key={b.goodId} className="chip-edit">
              <GoodIcon id={b.goodId} size={15} /> {ctx.goodById[b.goodId].name}
              <input
                className="qty"
                value={b.maxQuantity}
                aria-label={`${ctx.goodById[b.goodId].name} 최대 수량`}
                onChange={(e) => updateStop((s) => { s.buy[i].maxQuantity = Number(e.target.value) || 0; return s; })}
              />
              개까지
              <select aria-label={ctx.goodById[b.goodId].name + ' 매입 브랜드'} value={b.brandCountryId ?? ''}
                onChange={(e) => updateStop((s) => { s.buy[i].brandCountryId = e.target.value || undefined; return s; })}>
                <option value="">자동 선택</option>
                {[...new Set([...Object.keys(brandStock(state.cities[st.cityId], b.goodId)), ...(b.brandCountryId ? [b.brandCountryId] : [])])].sort().map((id) =>
                  <option key={id} value={id}>{ctx.countryNames[id]} 브랜드</option>)}
              </select>
              <button className="x" onClick={() => updateStop((s) => { s.buy.splice(i, 1); return s; })} aria-label="빼기">
                ×
              </button>
            </span>
          ))}
        </div>
        <b className="small">여기서 팔 상품</b>
        <div className="row small">
          {st.sell.length === 0 && <span className="muted">아직 없어요.</span>}
          {st.sell.map((id, i) => (
            <span key={id} className="chip-edit">
              <GoodIcon id={id} size={15} /> {ctx.goodById[id].name}
              <button className="x" onClick={() => updateStop((s) => { s.sell.splice(i, 1); return s; })} aria-label="빼기">
                ×
              </button>
            </span>
          ))}
        </div>
        <details className="planner-all-goods">
          <summary className="small">모든 상품에서 고르기</summary>
          <div className="planner-good-grid">
            {ctx.goods.map((g) => {
              const buying = st.buy.some((b) => b.goodId === g.id);
              const selling = st.sell.includes(g.id);
              return (
                <div key={g.id} className="planner-good">
                  <span>
                    <GoodIcon id={g.id} size={16} /> {g.name}
                  </span>
                  <button className={buying ? 'btn small on' : 'btn small'} onClick={() => (buying ? updateStop((s) => ({ ...s, buy: s.buy.filter((b) => b.goodId !== g.id) })) : addBuy(g.id))}>
                    {buying ? '사기 ✓' : '사기'}
                  </button>
                  <button className={selling ? 'btn small on' : 'btn small'} onClick={() => (selling ? updateStop((s) => ({ ...s, sell: s.sell.filter((x) => x !== g.id) })) : addSell(g.id))}>
                    {selling ? '팔기 ✓' : '팔기'}
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      </div>
    </div>
  );
}

/**
 * 정기 항로 짜기 화면: 왼쪽 지도에서 항구를 눌러 차례로 넣고, 오른쪽에서 기항지마다 사고팔 상품을 고른다.
 * 가상 세계처럼 항구 위치를 외우기 어려운 곳에서도 지도를 보며 짤 수 있다.
 */
export function RoutePlanner(props: {
  sim: Simulation;
  world: World;
  title: string;
  routeName: string;
  setRouteName: (v: string) => void;
  stops: RouteStop[];
  setStops: (f: (all: RouteStop[]) => RouteStop[]) => void;
  minMargin: number;
  setMinMargin: (v: number) => void;
  reserve: number;
  setReserve: (v: number) => void;
  typeId: string;
  message: { text: string; ok: boolean } | null;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { sim, world, stops, setStops, typeId } = props;
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const [sel, setSel] = useState(0);
  const [note, setNote] = useState<string | null>(null);
  const k = Math.min(sel, stops.length - 1);
  const MAX = 4;

  const onPort = (cityId: string) => {
    const at = stops.findIndex((s) => s.cityId === cityId);
    if (at >= 0) {
      setSel(at);
      setNote(null);
      return;
    }
    if (stops.length >= MAX) {
      setNote(`항구는 ${MAX}곳까지 넣을 수 있어요. 오른쪽 목록에서 하나를 빼고 다시 눌러 주세요.`);
      return;
    }
    if (!canEnter(sim.ctx, sim.state, typeId, cityId)) setNote(fixJosa(`${name(cityId)}은(는) 작은 항구라 이 항로의 배가 들어가지 못할 수 있어요.`));
    else setNote(null);
    setStops((all) => [...all, { cityId, buy: [], sell: [] }]);
    setSel(stops.length);
  };
  const remove = (i: number) => {
    setStops((all) => all.filter((_, j) => j !== i));
    setSel((s) => (s > i ? s - 1 : s === i ? Math.max(0, i - 1) : s));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= stops.length) return;
    setStops((all) => {
      const next = [...all];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
    setSel(j);
  };
  const ports = world.cities.filter((c) => c.isPort && !stops.some((s) => s.cityId === c.id));

  // Esc로 닫기
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') props.onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props.onCancel]); // eslint-disable-line react-hooks/exhaustive-deps

  return createPortal(
    <div className="planner" role="dialog" aria-label={props.title}>
      <div className="planner-map">
        <RouteMap sim={sim} world={world} stops={stops} selected={k} typeId={typeId} onPort={onPort} />
        <div className="planner-hint" role="status">
          <Icon name="hand-click" size={18} />
          {stops.length < 2 ? '지도에서 항구를 눌러 차례로 넣어 주세요' : stops.length < MAX ? '항구를 더 누르면 뒤에 붙어요 · 넣은 항구를 누르면 그 항구를 골라요' : '넣은 항구를 누르면 그 항구의 상품을 고를 수 있어요'}
        </div>
        {note && <div className="planner-note">{note}</div>}
      </div>
      <aside className="planner-side">
        <header className="planner-head">
          <h2>{props.title}</h2>
          <button className="icon-btn" onClick={props.onCancel} aria-label="닫기">
            <Icon name="x" size={20} />
          </button>
        </header>
        <label className="small">
          이름 <input value={props.routeName} onChange={(e) => props.setRouteName(e.target.value)} placeholder="예: 곡물 남북 항로" />
        </label>
        <div className="planner-stops">
          <b className="small">들르는 차례 (마지막 항구 다음엔 처음으로 돌아가요)</b>
          {stops.length === 0 && <span className="muted small">아직 넣은 항구가 없어요.</span>}
          {stops.map((s, i) => (
            <div key={`${s.cityId}-${i}`} className={i === k ? 'planner-stop on' : 'planner-stop'}>
              <button className="planner-stop-main" onClick={() => setSel(i)} aria-pressed={i === k}>
                <span className="planner-num">{i + 1}</span>
                <b>{name(s.cityId)}</b>
                <span className="muted small">
                  {s.buy.length ? `사기 ${s.buy.map((b) => sim.ctx.goodById[b.goodId].name).join('·')}` : '사기 없음'} ·{' '}
                  {s.sell.length ? `팔기 ${s.sell.map((id) => sim.ctx.goodById[id].name).join('·')}` : '팔기 없음'}
                </span>
              </button>
              <button className="icon-btn" disabled={i === 0} onClick={() => move(i, -1)} aria-label="앞으로">
                ↑
              </button>
              <button className="icon-btn" disabled={i === stops.length - 1} onClick={() => move(i, 1)} aria-label="뒤로">
                ↓
              </button>
              <button className="icon-btn" onClick={() => remove(i)} aria-label={`${name(s.cityId)} 빼기`}>
                <Icon name="x" size={16} />
              </button>
            </div>
          ))}
          {stops.length < MAX && (
            <select
              className="small"
              value=""
              onChange={(e) => {
                if (e.target.value) onPort(e.target.value);
              }}
            >
              <option value="">+ 목록에서 항구 넣기</option>
              {ports.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {stops.length > 0 && (
          <>
            <h3>
              {k + 1}번째 항구 · {name(stops[k].cityId)}에서 사고팔 상품
            </h3>
            <StopGoods sim={sim} stops={stops} k={k} typeId={typeId} name={name} setStops={setStops} />
          </>
        )}

        <div className="row small">
          <label>
            기대 이익률이 <input className="qty" value={props.minMargin} onChange={(e) => props.setMinMargin(Number(e.target.value) || 0)} />% 이상일 때만 사기
          </label>
        </div>
        <div className="row small">
          <label>
            현금 <input className="qty wide" value={props.reserve} onChange={(e) => props.setReserve(Number(e.target.value) || 0)} />은 항상 남기기
          </label>
        </div>
        <p className="muted small">
          이익률은 도착할 때의 값으로 판 돈에서 산 값·항만비·관세·상함과, 그 짐이 차지하는 몫의 연료비·유지비를 뺀 뒤 산 값으로 나눈 거예요.
        </p>
        {stops.length >= 2 && <RouteForecast sim={sim} route={{ stops, minMargin: props.minMargin / 100, cashReserve: props.reserve }} typeId={typeId} name={name} />}
        {props.message && <p className={props.message.ok ? 'flash ok' : 'flash'}>{props.message.text}</p>}
        <div className="row planner-actions">
          <button className="btn primary" disabled={stops.length < 2} title={stops.length < 2 ? '항구를 두 곳 이상 넣어 주세요' : ''} onClick={props.onSave}>
            저장
          </button>
          <button className="btn" onClick={props.onCancel}>
            취소
          </button>
        </div>
      </aside>
    </div>,
    document.body,
  );
}
