import { useEffect, useMemo, useState } from 'react';
import { fixJosa } from '../sim/core/korean';
import { suggestTrips } from '../sim/economy/advice';
import { canEnter, cargoVolume, estimateVoyage, isDocked, netProfit, PLAYER_ID, shipType } from '../sim/economy/player';
import { specialtyById } from '../sim/economy/specialties';
import { tradeRows } from './tradeModel';
import type { Command, LedgerMonth, RouteStop, Ship, SimEvent, TradeRoute } from '../sim/economy/types';
import type { World } from '../sim/world/types';
import { GoodIcon } from './icons';
import { RouteForecast, routeShipType } from './RouteForecast';
import { RoutePlanner } from './RoutePlanner';
import { ShipPic } from './ShipPic';
import { CompanyLogo } from './CompanyLogo';
import { formatDate, type Simulation } from './useSimulation';
import { shipStatus } from './shipStatus';

const won = (v: number) => Math.round(v).toLocaleString('ko-KR');
const qty = (v: number) => (v >= 10 ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(1));

function useFlash(): [string | null, boolean, (msg: string | null, ok?: boolean) => void] {
  const [msg, setMsg] = useState<string | null>(null);
  const [good, setGood] = useState(true);
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 4000);
    return () => clearTimeout(t);
  }, [msg]);
  return [msg, good, (m, ok = false) => { setMsg(m === null ? null : fixJosa(m)); setGood(ok); }];
}

function statusText(sim: Simulation, world: World, ship: Ship): string {
  return fixJosa(shipStatus(sim, ship, (id) => world.cities.find((c) => c.id === id)?.name ?? id).text);
}

// ------------------------------------------------------------------ 내 배

export function FleetPanel(props: {
  sim: Simulation;
  world: World;
  pickedCityId: string | null;
  selectedShipId: string | null;
  onSelectShip: (id: string) => void;
  onFocus: (cityId: string) => void;
  onDestination: (cityId: string | null) => void;
}) {
  const { sim, world } = props;
  const { ctx, state } = sim;
  const ships = state.ships.filter((s) => s.companyId === PLAYER_ID);
  const ship = ships.find((s) => s.id === props.selectedShipId) ?? ships[0];
  const [flash, flashOk, setFlash] = useFlash();

  return (
    <>
      <header className="sel-head">
        <div>
          <h2>내 배</h2>
          <p>
            현금 <b className="money">{won(state.player.cash)}</b>
            {state.player.arrears > 0 && <span className="bad"> · 밀린 유지비 {won(state.player.arrears)}</span>}
          </p>
        </div>
      </header>
      <div className="ship-list">
        {ships.map((s) => {
          const fill = cargoVolume(ctx, s) / s.capacity;
          const route = state.player.routes.find((r) => r.id === s.routeId);
          return (
            <button
              key={s.id}
              className={s === ship ? 'ship-card on' : 'ship-card'}
              onClick={() => {
                props.onSelectShip(s.id);
                props.onFocus(s.to);
              }}
            >
              <b>{s.name}</b>
              <span className="muted small">{statusText(sim, world, s)}</span>
              <span className="fill">
                <i style={{ width: `${Math.round(fill * 100)}%` }} />
              </span>
              <span className="muted small">
                짐 {Math.round(fill * 100)}%{route && ` · 정기 항로 「${route.name}」`}
              </span>
            </button>
          );
        })}
        {ships.length === 0 && <p className="muted">배가 없어요. 회사 탭에서 배를 사 주세요.</p>}
      </div>
      {flash && <p className={flashOk ? 'flash ok' : 'flash'}>{flash}</p>}
      {ship && <ShipDetail {...props} ship={ship} setFlash={setFlash} />}
    </>
  );
}

function ShipDetail(props: {
  sim: Simulation;
  world: World;
  ship: Ship;
  pickedCityId: string | null;
  onDestination: (cityId: string | null) => void;
  setFlash: (msg: string | null, ok?: boolean) => void;
}) {
  const { sim, world, ship, setFlash } = props;
  const { ctx, state } = sim;
  const type = shipType(ctx, ship.typeId);
  const here = ship.to;
  const city = state.cities[here];
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const docked = isDocked(ship);
  const [dest, setDest] = useState<string>('');
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [highlight, setHighlight] = useState<string | null>(null);

  // 지도에서 고른 항구를 목적지로
  useEffect(() => {
    if (props.pickedCityId && props.pickedCityId !== here && canEnter(ctx, state, ship.typeId, props.pickedCityId)) setDest(props.pickedCityId);
  }, [props.pickedCityId, here, ship.typeId, ctx]);
  useEffect(() => {
    setAmounts({});
    setHighlight(null);
  }, [ship.id, here]);
  // 고른 목적지를 지도에 점선으로 보여 준다
  const { onDestination } = props;
  useEffect(() => {
    if (dest) onDestination(dest);
  }, [dest, onDestination]);

  const voyage = dest ? estimateVoyage(ctx, type.id, here, dest, state) : null;
  const run = (cmd: Command, okText?: string) => {
    const r = sim.act(cmd);
    setFlash(r.ok ? (okText ?? null) : (r.error ?? '할 수 없어요.'), r.ok);
  };

  const rows = useMemo(() => {
    const plan: Record<string, number> = {};
    for (const [k, v] of Object.entries(amounts)) plan[k] = Number(v) || 0;
    return tradeRows(sim, ship, dest || null, plan);
  }, [sim, ship, dest, amounts]);

  const route = state.player.routes.find((r) => r.id === ship.routeId);
  const freeVolume = ship.capacity - cargoVolume(ctx, ship);

  return (
    <div className="ship-detail">
      <h3>
        {ship.name} <span className="muted small">({type.name})</span>
      </h3>
      <p className="muted small">
        싣는 양 {type.capacity} · 한 번에 {won(type.rangeKm)}km · 한 달에 {won(type.speedKmPerMonth)}km · 연료 1000km당 {won(type.fuelPer1000Km)} · 유지비 달마다{' '}
        {won(type.upkeepPerMonth)}
        {type.refrigerated ? ' · 냉장' : ''}
      </p>
      {ship.cargo.length > 0 && (
        <p className="small">
          실은 짐:{' '}
          {ship.cargo
            .map((l) => {
              const origin = ctx.countryNames[l.originCountryId] ?? l.originCountryId;
              const brand = l.brandCountryId !== l.originCountryId ? `, ${ctx.countryNames[l.brandCountryId] ?? l.brandCountryId} 상표` : '';
              return `${specialtyById(ctx, l.specialtyId)?.name ?? ctx.goodById[l.goodId].name} ${qty(l.quantity)}(${origin}산${brand}, ${name(l.originCityId)}에서 실음)`;
            })
            .join(', ')}
        </p>
      )}

      {route ? (
        <>
          <p>
            정기 항로 「{route.name}」를 돌고 있어요: {route.stops.map((s) => name(s.cityId)).join(' → ')} → 처음으로
          </p>
          <button className="btn" onClick={() => run({ type: 'assignRoute', shipId: ship.id, routeId: null }, '이번 항해가 끝나면 항구에서 기다립니다.')}>
            정기 항로에서 빼기
          </button>
        </>
      ) : !docked ? (
        <p className="muted">항해 중이에요. 도착하면 사고팔 수 있어요.</p>
      ) : (
        <>
          <h3 className="step">① 목적지 고르기</h3>
          {sim.settings.showHints && <TripHints sim={sim} ship={ship} onPick={(to, goodId, quantity) => {
            setDest(to);
            setAmounts({ [goodId]: String(quantity) });
            setHighlight(goodId);
          }} />}
          <div className="row">
            <select value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">— 어디로 갈까요? (지도에서 눌러도 돼요) —</option>
              {world.cities.filter((c) => c.isPort && c.id !== here).map((c) => {
                const v = estimateVoyage(ctx, type.id, here, c.id, state);
                const fits = canEnter(ctx, state, type.id, c.id);
                return <option key={c.id} value={c.id} disabled={!fits || !v.leg}>
                  {c.name}{!fits ? ' · 항구가 작아요' : v.leg ? ` · ${won(v.distanceKm)}km` : v.blockedReason === 'range' ? ' · 항속거리 초과' : ' · 항로 막힘'}
                </option>;
              })}
            </select>
          </div>
          {voyage?.leg && (
            <p className="small">
              {won(voyage.distanceKm)}km · 약 {Math.max(1, Math.round(voyage.months * 30))}일 · 연료비 <b>{won(voyage.fuel)}</b>
              {voyage.fees > 0 && (
                <>
                  {' '}
                  · 통과료 <b>{won(voyage.fees)}</b>({voyage.passages.map((p) => ctx.passages[p]?.name ?? p).join('·')})
                </>
              )}
              {voyage.reasons.length > 0 && <span className="bad"> — {voyage.reasons.join(' ')}</span>}
              {state.player.cash < voyage.fuel + voyage.fees && <span className="bad"> — 연료비·통과료가 모자라요!</span>}
            </p>
          )}

          {voyage && !voyage.leg && <p className="small bad">{voyage.reasons.join(' ')}</p>}

          <h3 className="step">② {name(here)}에서 사고팔기</h3>
          <p className="muted small">
            남은 자리 {qty(freeVolume)} / {ship.capacity}
            {voyage && ' · 「1개당 남는 돈」은 다른 배가 실어 오는 양까지 따진 예상이에요. 연료비는 따로 들어요.'}
          </p>
          <table className="market trade">
            <thead>
              <tr>
                <th>상품</th>
                <th>살 값</th>
                <th>팔 값</th>
                {voyage && <th>{name(dest)} 예상</th>}
                <th>수량</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className={highlight === r.g.id ? 'hint-row' : ''}>
                  <td>
                    <b className={`good-name cat-${r.g.category}`}>
                      <GoodIcon id={r.g.id} size={16} /> {r.name}
                    </b>
                    <span className="why">
                      {r.have > 0 ? `배에 ${qty(r.have)} · ` : ''}
                      {!r.carry ? '못 실어요' : r.buyable >= 0.5 ? `최대 ${qty(r.buyable)}` : '물량 없음'}
                      {r.g.cargoClass === 'perishable' && !type.refrigerated ? ' · 상할 수 있음' : ''}
                      {r.duty > 0.005 ? ` · 관세 ${Math.round(r.duty * 100)}%` : ''}
                    </span>
                  </td>
                  <td className="num">{city.target[r.g.id] > 0 || r.buyable > 0 ? won(r.buyUnit) : '–'}</td>
                  <td className="num">{r.sellUnit > 0 ? won(r.sellUnit) : '–'}</td>
                  {voyage && (
                    <td className={r.perUnit === null ? 'num' : r.perUnit > 0 ? 'num good' : 'num high'}>
                      {r.destUnit === null ? '–' : won(r.destUnit)}
                      {r.perUnit !== null && <span className="why">1개당 {r.perUnit > 0 ? '+' : ''}{won(r.perUnit)}</span>}
                    </td>
                  )}
                  <td>
                    <input
                      className="qty"
                      inputMode="decimal"
                      placeholder={r.have > 0 ? qty(r.have) : r.buyable >= 0.5 ? qty(r.buyable) : '0'}
                      value={amounts[r.id] ?? ''}
                      onChange={(e) => setAmounts((a) => ({ ...a, [r.id]: e.target.value }))}
                    />
                  </td>
                  <td className="actions">
                    <button
                      className="btn small"
                      disabled={!r.carry || r.buyable < 0.05}
                      onClick={() => {
                        const n = Number(amounts[r.id]) || r.buyable;
                        run({ type: 'trade', shipId: ship.id, goodId: r.g.id, specialtyId: r.specialtyId, side: 'buy', quantity: n }, `${r.name}을(를) 샀어요.`);
                        setAmounts((a) => ({ ...a, [r.id]: '' }));
                      }}
                    >
                      사기
                    </button>
                    <button
                      className="btn small"
                      disabled={r.have <= 0 || r.sellUnit <= 0}
                      onClick={() => {
                        const n = Number(amounts[r.id]) || r.have;
                        run({ type: 'trade', shipId: ship.id, goodId: r.g.id, specialtyId: r.specialtyId, side: 'sell', quantity: n }, `${r.name}을(를) 팔았어요.`);
                        setAmounts((a) => ({ ...a, [r.id]: '' }));
                      }}
                    >
                      팔기
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <h3 className="step">③ 배 보내기</h3>
          <button
            className="btn primary"
            disabled={!dest || !voyage?.leg || !canEnter(ctx, state, type.id, dest) || state.player.cash < voyage.fuel + voyage.fees}
            onClick={() => run({ type: 'sail', shipId: ship.id, to: dest }, `${name(dest)}(으)로 출발했어요. 시간을 흐르게 해 주세요(▶ 시작).`)}
          >
            {dest ? fixJosa(`${name(dest)}(으)로 배 보내기`) : '목적지를 먼저 골라 주세요'}
          </button>

          <details className="more">
            <summary>정기 항로·배 팔기</summary>
            {state.player.routes.length === 0 ? (
              <p className="muted small">회사 탭에서 정기 항로를 만들면 이 배를 맡길 수 있어요.</p>
            ) : (
              <div className="row">
                {state.player.routes.map((r) => (
                  <button key={r.id} className="btn small" onClick={() => run({ type: 'assignRoute', shipId: ship.id, routeId: r.id }, `「${r.name}」에 배정했어요.`)}>
                    「{r.name}」 맡기기
                  </button>
                ))}
              </div>
            )}
            <button
              className="btn small danger"
              onClick={() => {
                if (window.confirm(fixJosa(`${ship.name}을(를) ${won(type.price * type.resaleShare)}에 팔까요?`))) run({ type: 'sellShip', shipId: ship.id }, '배를 팔았어요.');
              }}
            >
              이 배 팔기({won(type.price * type.resaleShare)})
            </button>
          </details>
        </>
      )}
    </div>
  );
}

/** 지금 항구에서 남는 거래 추천(이유와 함께) */
function TripHints({ sim, ship, onPick }: { sim: Simulation; ship: Ship; onPick: (to: string, goodId: string, quantity: number) => void }) {
  const { ctx, state } = sim;
  const ideas = useMemo(() => suggestTrips(ctx, state, ship), [ctx, state, ship]);
  if (ideas.length === 0) {
    return (
      <p className="muted small">
        지금 이 항구에서 사서 남길 만한 거래가 보이지 않아요. 시간을 조금 흘려 보내거나, 빈 배로 다른 항구에 가 보세요.
      </p>
    );
  }
  return (
    <div className="hints">
      <span className="muted small">힌트 — 이렇게 하면 남을 것 같아요:</span>
      {ideas.map((i) => (
        <button key={i.to + i.goodId} className="hint" onClick={() => onPick(i.to, i.goodId, i.quantity)}>
          <b>
            {ctx.goodById[i.goodId].name} → {ctx.cityNames[i.to]}
          </b>
          <span className="money">{qty(i.quantity)}개 · 약 +{won(i.profit)}</span>
          <span className="why">
            {fixJosa(i.reason)} · {Math.max(1, Math.round(i.months * 30))}일
          </span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ 회사

export function ProfitChart({ ledger }: { ledger: LedgerMonth[] }) {
  const months = ledger.slice(-12);
  const vals = months.map(netProfit);
  const max = Math.max(1000, ...vals.map(Math.abs));
  const W = 300;
  const H = 90;
  const bw = W / 12;
  const mid = H / 2;
  return (
    <svg viewBox={`0 0 ${W} ${H + 12}`} className="chart" role="img" aria-label="최근 12달 순이익">
      <line x1={0} x2={W} y1={mid} y2={mid} className="zero" />
      {vals.map((v, i) => {
        const h = (Math.abs(v) / max) * (mid - 4);
        return <rect key={i} x={i * bw + 2} width={bw - 4} y={v >= 0 ? mid - h : mid} height={Math.max(1, h)} rx={2} className={v >= 0 ? 'bar-pos' : 'bar-neg'} />;
      })}
      {months.map((l, i) => (
        <text key={i} x={i * bw + bw / 2} y={H + 10} className="tick">
          {(l.month % 12) + 1}
        </text>
      ))}
    </svg>
  );
}

export function logText(world: World, sim: Simulation, e: SimEvent): string {
  return fixJosa(logTextRaw(world, sim, e));
}

function logTextRaw(world: World, sim: Simulation, e: SimEvent): string {
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const ship = (id: string) => sim.state.ships.find((s) => s.id === id)?.name ?? '팔린 배';
  const when = formatDate(sim.ctx.data.startYear, e.month);
  if (e.type === 'trade') {
    const g = specialtyById(sim.ctx, e.specialtyId)?.name ?? sim.ctx.goodById[e.goodId].name;
    return `${when} · ${ship(e.shipId)}: ${name(e.cityId)}에서 ${g} ${qty(e.quantity)}개를 ${e.side === 'buy' ? '샀어요' : '팔았어요'} (${won(e.total)})`;
  }
  if (e.type === 'arrival') {
    const lost = e.spoiled.map((s) => `${sim.ctx.goodById[s.goodId].name} ${qty(s.quantity)}개가 상해 버렸어요`).join(', ');
    return `${when} · ${ship(e.shipId)}이(가) ${name(e.cityId)}에 도착했어요${lost ? ` — ${lost}` : ''}`;
  }
  if (e.type === 'notice' || e.type === 'order') return `${when} · ${e.text}`;
  return when;
}

export function CompanyPanel(props: { sim: Simulation; world: World }) {
  const { sim, world } = props;
  const { ctx, state } = sim;
  const p = state.player;
  const [flash, flashOk, setFlash] = useFlash();
  const home = ctx.data.player.startCityId;
  const last12 = p.ledger.slice(-12);
  const year = last12.reduce((s, l) => s + netProfit(l), 0);
  const fleet = state.ships.filter((s) => s.companyId === PLAYER_ID);
  const assets = fleet.reduce((s, x) => s + shipType(ctx, x.typeId).price * shipType(ctx, x.typeId).resaleShare, 0);
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;

  return (
    <>
      <header className="sel-head">
        <div>
          <h2><CompanyLogo id={sim.settings.companyLogo} /> {p.name}</h2>
          <p>
            배 {fleet.length}척 · 현금 <b className="money">{won(p.cash)}</b> · 배 값어치 {won(assets)}
          </p>
        </div>
      </header>
      {flash && <p className={flashOk ? 'flash ok' : 'flash'}>{flash}</p>}

      <h3>결과 확인하기 — 최근 12달 순이익 {year >= 0 ? '+' : ''}{won(year)}</h3>
      <ProfitChart ledger={p.ledger} />
      <table className="market ledger">
        <thead>
          <tr>
            <th>달</th>
            <th>판매</th>
            <th>구매</th>
            <th>연료·항만·관세</th>
            <th>유지·보관료</th>
            <th>순이익</th>
          </tr>
        </thead>
        <tbody>
          {[...p.ledger].slice(-6).reverse().map((l) => {
            const net = netProfit(l);
            return (
              <tr key={l.month}>
                <td>{formatDate(ctx.data.startYear, l.month)}</td>
                <td className="num">{won(l.sales)}</td>
                <td className="num">{won(l.purchases)}</td>
                <td className="num">{won(l.fuel + l.portFees + (l.tariffs ?? 0))}</td>
                <td className="num">{won(l.upkeep + (l.storageFees ?? 0))}</td>
                <td className={net >= 0 ? 'num good' : 'num high'}>{won(net)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        처음부터 합계: 판매 {won(p.lifetime.sales)} · 구매 {won(p.lifetime.purchases)} · 연료 {won(p.lifetime.fuel)} · 항만비{' '}
        {won(p.lifetime.portFees)} · 관세 {won(p.lifetime.tariffs ?? 0)} · 유지비 {won(p.lifetime.upkeep)}
        {` · 보관료 ${won(p.lifetime.storageFees ?? 0)}`}
        {!!p.lifetime.warehouseInvestment && ` · 창고 투자 ${won(p.lifetime.warehouseInvestment)}`}
        {p.lifetime.spoiledCost > 0 && ` · 상해 버린 짐 ${won(p.lifetime.spoiledCost)}`}
      </p>

      <h3>배 사기</h3>
      <div className="row">
        <span className="small">새 배를 받을 근거지 · <b>{name(home)}</b></span>
      </div>
      <div className="shop">
        {ctx.data.shipTypes.map((t) => {
          const fits = canEnter(ctx, state, t.id, home);
          return (
            <div key={t.id} className="shop-item">
              <ShipPic typeId={t.id} width={88} title={t.name} />
              <div>
                <b>{t.name}</b> <span className="money">{won(t.price)}</span>
                <span className="why">{t.blurb}</span>
                <span className="why">
                  싣는 양 {t.capacity} · 한 번에 {won(t.rangeKm)}km · 한 달 {won(t.speedKmPerMonth)}km · 연료 1000km당 {won(t.fuelPer1000Km)} · 유지비 {won(t.upkeepPerMonth)}/달 ·{' '}
                  {['', '모든', '중간 이상', '큰'][t.size]} 항구
                </span>
              </div>
              <button
                className="btn small"
                disabled={!fits || p.cash < t.price}
                title={!fits ? `${name(home)} 항구는 너무 작아요` : p.cash < t.price ? '돈이 모자라요' : ''}
                onClick={() => {
                  const r = sim.act({ type: 'buyShip', typeId: t.id });
                  setFlash(r.ok ? `${name(home)}에서 ${t.name}을(를) 샀어요.` : (r.error ?? '살 수 없어요.'), r.ok);
                }}
              >
                {!fits ? '항구가 작아요' : '사기'}
              </button>
            </div>
          );
        })}
      </div>

      <RouteEditor sim={sim} world={world} setFlash={setFlash} />

      <h3>최근 기록</h3>
      {sim.log.length === 0 ? (
        <p className="muted small">아직 기록이 없어요. 내 배 탭에서 첫 거래를 해 보세요.</p>
      ) : (
        <ul className="news">
          {sim.log.slice(0, 12).map((e, k) => (
            <li key={k}>{logText(world, sim, e)}</li>
          ))}
        </ul>
      )}
    </>
  );
}

// ------------------------------------------------------------------ 정기 항로

/** 항로 카드 안: 이 항로의 배와 상태, 그리고 다른 배를 바로 맡기거나 빼기 */
function RouteShips(props: { sim: Simulation; world: World; route: TradeRoute; setFlash: (m: string | null, ok?: boolean) => void }) {
  const { sim, world, route, setFlash } = props;
  const { ctx, state } = sim;
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const mine = state.ships.filter((s) => s.companyId === PLAYER_ID);
  const on = mine.filter((s) => s.routeId === route.id);
  const others = mine.filter((s) => s.routeId !== route.id);
  const run = (cmd: Command, okText: string) => {
    const r = sim.act(cmd);
    setFlash(r.ok ? okText : (r.error ?? '할 수 없어요.'), r.ok);
  };
  return (
    <div className="route-ships">
      {on.length === 0 && <span className="muted small">아직 이 항로를 도는 배가 없어요. 아래에서 맡겨 보세요.</span>}
      {on.map((s) => {
        const st = shipStatus(sim, s, name);
        return (
          <div key={s.id} className={`route-ship ${st.kind}`}>
            <div className="row">
              <ShipPic typeId={s.typeId} width={56} title={shipType(ctx, s.typeId).name} />
              <b>{s.name}</b>
              <span className={`ship-state ${st.kind}`}>{fixJosa(st.text)}</span>
              <button className="btn small" onClick={() => run({ type: 'assignRoute', shipId: s.id, routeId: null }, fixJosa(`${s.name}을(를) 항로에서 뺐어요. 이번 항해가 끝나면 항구에서 기다려요.`))}>
                빼기
              </button>
            </div>
            {st.detail && <span className="muted small">{st.detail}</span>}
          </div>
        );
      })}
      {others.length > 0 && (
        <div className="row small">
          배 맡기기:
          {others.map((s) => {
            const bad = route.stops.find((st) => !canEnter(ctx, state, s.typeId, st.cityId));
            const from = s.routeId ? state.player.routes.find((r) => r.id === s.routeId) : undefined;
            return (
              <button
                key={s.id}
                data-tut="route-assign"
                className="btn small"
                disabled={!!bad}
                title={bad ? `${name(bad.cityId)} 항구가 작아 이 배는 들어갈 수 없어요` : from ? `「${from.name}」에서 옮겨 와요` : !isDocked(s) ? '지금 항해를 마치면 이 항로로 가요' : ''}
                onClick={() => run({ type: 'assignRoute', shipId: s.id, routeId: route.id }, fixJosa(`${s.name}을(를) 「${route.name}」에 맡겼어요.`))}
              >
                + <ShipPic typeId={s.typeId} width={40} /> {s.name}
                {from ? ` (「${from.name}」에서)` : ''}
                {bad ? ' · 항구가 작아요' : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function RouteEditor({ sim, world, setFlash }: { sim: Simulation; world: World; setFlash: (m: string | null, ok?: boolean) => void }) {
  const { ctx, state } = sim;
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const [editing, setEditing] = useState<string | null>(null);
  const [routeName, setRouteName] = useState('');
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [minMargin, setMinMargin] = useState(10);
  const [reserve, setReserve] = useState(5000);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  const startNew = () => {
    // 첫 기항지는 내 배가 있는 항구로 둔다(지도에서 바로 다음 항구를 누르면 된다)
    const here = state.ships.find((s) => s.companyId === PLAYER_ID)?.to;
    setEditing('new');
    setRouteName('');
    setStops(here && ctx.portIds.includes(here) ? [{ cityId: here, buy: [], sell: [] }] : []);
    setMinMargin(10);
    setReserve(5000);
    setMessage(null);
  };
  const startEdit = (id: string) => {
    const r = state.player.routes.find((x) => x.id === id)!;
    setEditing(id);
    setRouteName(r.name);
    setStops(structuredClone(r.stops));
    setMinMargin(Math.round(r.minMargin * 100));
    setReserve(r.cashReserve);
    setMessage(null);
  };
  const editType = routeShipType(sim, editing && editing !== 'new' ? editing : undefined);

  return (
    <>
      <h3>정기 항로</h3>
      <p className="muted small">여러 항구를 차례로 돌며 정해 둔 상품을 자동으로 사고팔아요. 남는 게 없으면 사지 않고 알려 줘요.</p>
      {state.player.routes.map((r) => {
        return (
          <div key={r.id} className="route-card">
            <b>{r.name}</b>
            <span className="small">{r.stops.map((s) => name(s.cityId)).join(' → ')}</span>
            <span className="muted small">
              이익률 {Math.round(r.minMargin * 100)}% 이상일 때만 사기 · 현금 {won(r.cashReserve)}은 남기기
            </span>
            <RouteShips sim={sim} world={world} route={r} setFlash={setFlash} />

            <RouteForecast sim={sim} route={r} typeId={routeShipType(sim, r.id)} name={name} compact />
            <div className="row">
              <button className="btn small" onClick={() => startEdit(r.id)}>
                지도에서 고치기
              </button>
              <button
                className="btn small danger"
                onClick={() => {
                  const res = sim.act({ type: 'deleteRoute', routeId: r.id });
                  setFlash(res.ok ? '항로를 지웠어요. 배들은 이번 항해 뒤 멈춥니다.' : (res.error ?? ''), res.ok);
                }}
              >
                지우기
              </button>
            </div>
          </div>
        );
      })}
      <button className="btn route-new" onClick={startNew}>
        + 지도에서 새 정기 항로 짜기
      </button>
      {editing !== null && (
        <RoutePlanner
          sim={sim}
          world={world}
          title={editing === 'new' ? '새 정기 항로 짜기' : `「${routeName}」 고치기`}
          routeName={routeName}
          setRouteName={setRouteName}
          stops={stops}
          setStops={setStops}
          minMargin={minMargin}
          setMinMargin={setMinMargin}
          reserve={reserve}
          setReserve={setReserve}
          typeId={editType}
          message={message}
          onCancel={() => setEditing(null)}
          onSave={() => {
            const res = sim.act({
              type: 'saveRoute',
              route: { id: editing === 'new' ? undefined : editing, name: routeName, stops, minMargin: minMargin / 100, cashReserve: reserve },
            });
            if (res.ok) {
              setEditing(null);
              setFlash('항로를 저장했어요. 항로 카드의 「배 맡기기」에서 바로 배를 맡길 수 있어요.', true);
            } else setMessage({ text: res.error ?? '저장하지 못했어요.', ok: false });
          }}
        />
      )}
    </>
  );
}
