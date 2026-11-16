import { useEffect, useMemo, useState } from 'react';
import { fixJosa } from '../sim/core/korean';
import { suggestTrips } from '../sim/economy/advice';
import { forecastPrice, quoteBuy, quoteSell } from '../sim/economy/market';
import { originShares } from '../sim/economy/origin';
import { expectedSaleFactor, tariffRate } from '../sim/economy/policy';
import { incomingCargo } from '../sim/economy/npc';
import {
  canCarry,
  canEnter,
  cargoOf,
  cargoVolume,
  estimateVoyage,
  isDocked,
  netProfit,
  PLAYER_ID,
  playerBuyLimit,
  shipType,
} from '../sim/economy/player';
import type { Command, LedgerMonth, RouteStop, Ship, SimEvent } from '../sim/economy/types';
import type { World } from '../sim/world/types';
import { formatDate, type Simulation } from './useSimulation';

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

function shipStatus(sim: Simulation, world: World, ship: Ship): string {
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  if (isDocked(ship)) return `${name(ship.to)}에 멈춰 있어요`;
  if (ship.from === ship.to) return `${name(ship.to)}에서 일하는 중`;
  const left = Math.max(0, ship.arrivesAt - sim.now());
  return `${name(ship.to)}로 가는 중 · ${left < 0.05 ? '곧 도착' : `${(left * 30).toFixed(0)}일 남음`}`;
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
              <span className="muted small">{shipStatus(sim, world, s)}</span>
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

  const voyage = dest ? estimateVoyage(ctx, type.id, here, dest) : null;
  const run = (cmd: Command, okText?: string) => {
    const r = sim.act(cmd);
    setFlash(r.ok ? (okText ?? null) : (r.error ?? '할 수 없어요.'), r.ok);
  };

  const rows = useMemo(() => {
    if (!docked) return [];
    return ctx.goods
      .filter((g) => city.target[g.id] > 0 || cargoOf(ship, g.id) > 0)
      .map((g) => {
        const buyable = playerBuyLimit(ctx, state, ship, g.id);
        const buyUnit = quoteBuy(ctx, city, g.id, 1).unitPrice;
        const sellUnit = city.target[g.id] > 0 ? quoteSell(ctx, city, g.id, 1).unitPrice : 0;
        let destUnit: number | null = null;
        let perUnit: number | null = null;
        let duty = 0;
        if (voyage && dest && state.cities[dest].target[g.id] > 0 && canCarry(ctx, type.id, g.id)) {
          const plan = Math.max(1, Math.min(buyable, Number(amounts[g.id]) || buyable || 1));
          const keep = type.refrigerated || g.cargoClass !== 'perishable' ? 1 : Math.pow(1 - ctx.data.player.spoilagePerMonth, voyage.months);
          // 관세(원산지 기준)·문화 웃돈(상표 기준)까지 따진 "손에 쥐는" 값
          const factor = expectedSaleFactor(ctx, state, here, g.id, dest);
          const origins = originShares(city, g.id);
          duty = Object.entries(origins).reduce((s, [o, w]) => s + w * tariffRate(ctx, state, ctx.countryOfCity[dest], g.id, o), 0);
          destUnit = forecastPrice(ctx, state.cities[dest], g.id, incomingCargo(state, dest, g.id, ship) + plan * keep, voyage.months) * (1 - ctx.data.market.spread) * keep * factor;
          perUnit = destUnit - buyUnit - 2 * ctx.data.shipping.portFeePerUnit * g.volume;
        }
        return { g, buyable, buyUnit, sellUnit, have: cargoOf(ship, g.id), destUnit, perUnit, duty, carry: canCarry(ctx, type.id, g.id) };
      });
  }, [ctx, state, ship, city, docked, dest, voyage, amounts, type]);

  const route = state.player.routes.find((r) => r.id === ship.routeId);
  const freeVolume = ship.capacity - cargoVolume(ctx, ship);

  return (
    <div className="ship-detail">
      <h3>
        {ship.name} <span className="muted small">({type.name})</span>
      </h3>
      <p className="muted small">
        싣는 양 {type.capacity} · 한 달에 {won(type.speedKmPerMonth)}km · 연료 1000km당 {won(type.fuelPer1000Km)} · 유지비 달마다{' '}
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
              return `${ctx.goodById[l.goodId].name} ${qty(l.quantity)}(${origin}산${brand}, ${name(l.originCityId)}에서 실음)`;
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
          <TripHints sim={sim} ship={ship} onPick={(to, goodId) => {
            setDest(to);
            setAmounts({});
            setHighlight(goodId);
          }} />
          <div className="row">
            <select value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value="">— 어디로 갈까요? (지도에서 눌러도 돼요) —</option>
              {world.cities
                .filter((c) => c.id !== here)
                .map((c) => (
                  <option key={c.id} value={c.id} disabled={!canEnter(ctx, state, type.id, c.id)}>
                    {c.name}
                    {canEnter(ctx, state, type.id, c.id) ? ` · ${won(ctx.distanceKm(here, c.id))}km` : ' · 항구가 작아 못 가요'}
                  </option>
                ))}
            </select>
          </div>
          {voyage && (
            <p className="small">
              {won(voyage.distanceKm)}km · 약 {Math.max(1, Math.round(voyage.months * 30))}일 · 연료비 <b>{won(voyage.fuel)}</b>
              {state.player.cash < voyage.fuel && <span className="bad"> — 연료비가 모자라요!</span>}
            </p>
          )}

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
                <tr key={r.g.id} className={highlight === r.g.id ? 'hint-row' : ''}>
                  <td>
                    <b>{r.g.name}</b>
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
                      value={amounts[r.g.id] ?? ''}
                      onChange={(e) => setAmounts((a) => ({ ...a, [r.g.id]: e.target.value }))}
                    />
                  </td>
                  <td className="actions">
                    <button
                      className="btn small"
                      disabled={!r.carry || r.buyable < 0.05}
                      onClick={() => {
                        const n = Number(amounts[r.g.id]) || r.buyable;
                        run({ type: 'trade', shipId: ship.id, goodId: r.g.id, side: 'buy', quantity: n }, `${r.g.name}을(를) 샀어요.`);
                        setAmounts((a) => ({ ...a, [r.g.id]: '' }));
                      }}
                    >
                      사기
                    </button>
                    <button
                      className="btn small"
                      disabled={r.have <= 0 || r.sellUnit <= 0}
                      onClick={() => {
                        const n = Number(amounts[r.g.id]) || r.have;
                        run({ type: 'trade', shipId: ship.id, goodId: r.g.id, side: 'sell', quantity: n }, `${r.g.name}을(를) 팔았어요.`);
                        setAmounts((a) => ({ ...a, [r.g.id]: '' }));
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
            disabled={!dest}
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
function TripHints({ sim, ship, onPick }: { sim: Simulation; ship: Ship; onPick: (to: string, goodId: string) => void }) {
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
        <button key={i.to + i.goodId} className="hint" onClick={() => onPick(i.to, i.goodId)}>
          <b>
            {ctx.goodById[i.goodId].name} → {ctx.cityNames[i.to]}
          </b>
          <span className="money"> 약 +{won(i.profit)}</span>
          <span className="why">
            {fixJosa(i.reason)} · {Math.max(1, Math.round(i.months * 30))}일
          </span>
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ 회사

function ProfitChart({ ledger }: { ledger: LedgerMonth[] }) {
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

function logText(world: World, sim: Simulation, e: SimEvent): string {
  return fixJosa(logTextRaw(world, sim, e));
}

function logTextRaw(world: World, sim: Simulation, e: SimEvent): string {
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const ship = (id: string) => sim.state.ships.find((s) => s.id === id)?.name ?? '팔린 배';
  const when = formatDate(sim.ctx.data.startYear, e.month);
  if (e.type === 'trade') {
    const g = sim.ctx.goodById[e.goodId].name;
    return `${when} · ${ship(e.shipId)}: ${name(e.cityId)}에서 ${g} ${qty(e.quantity)}개를 ${e.side === 'buy' ? '샀어요' : '팔았어요'} (${won(e.total)})`;
  }
  if (e.type === 'arrival') {
    const lost = e.spoiled.map((s) => `${sim.ctx.goodById[s.goodId].name} ${qty(s.quantity)}개가 상해 버렸어요`).join(', ');
    return `${when} · ${ship(e.shipId)}이(가) ${name(e.cityId)}에 도착했어요${lost ? ` — ${lost}` : ''}`;
  }
  if (e.type === 'notice') return `${when} · ${e.text}`;
  return when;
}

export function CompanyPanel(props: { sim: Simulation; world: World; pickedCityId: string | null }) {
  const { sim, world } = props;
  const { ctx, state } = sim;
  const p = state.player;
  const [flash, flashOk, setFlash] = useFlash();
  const [buyAt, setBuyAt] = useState<string>(props.pickedCityId ?? ctx.data.player.startCityId);
  useEffect(() => {
    if (props.pickedCityId) setBuyAt(props.pickedCityId);
  }, [props.pickedCityId]);
  const last12 = p.ledger.slice(-12);
  const year = last12.reduce((s, l) => s + netProfit(l), 0);
  const fleet = state.ships.filter((s) => s.companyId === PLAYER_ID);
  const assets = fleet.reduce((s, x) => s + shipType(ctx, x.typeId).price * shipType(ctx, x.typeId).resaleShare, 0);
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;

  return (
    <>
      <header className="sel-head">
        <div>
          <h2>{p.name}</h2>
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
            <th>유지비</th>
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
                <td className="num">{won(l.upkeep)}</td>
                <td className={net >= 0 ? 'num good' : 'num high'}>{won(net)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="muted small">
        처음부터 합계: 판매 {won(p.lifetime.sales)} · 구매 {won(p.lifetime.purchases)} · 연료 {won(p.lifetime.fuel)} · 항만비{' '}
        {won(p.lifetime.portFees)} · 관세 {won(p.lifetime.tariffs ?? 0)} · 유지비 {won(p.lifetime.upkeep)}
        {p.lifetime.spoiledCost > 0 && ` · 상해 버린 짐 ${won(p.lifetime.spoiledCost)}`}
      </p>

      <h3>배 사기</h3>
      <div className="row">
        <label className="small">
          받을 항구{' '}
          <select value={buyAt} onChange={(e) => setBuyAt(e.target.value)}>
            {world.cities.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({['', '작은', '중간', '큰'][c.portSize]} 항구)
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="shop">
        {ctx.data.shipTypes.map((t) => {
          const fits = canEnter(ctx, state, t.id, buyAt);
          return (
            <div key={t.id} className="shop-item">
              <div>
                <b>{t.name}</b> <span className="money">{won(t.price)}</span>
                <span className="why">{t.blurb}</span>
                <span className="why">
                  싣는 양 {t.capacity} · 한 달 {won(t.speedKmPerMonth)}km · 연료 1000km당 {won(t.fuelPer1000Km)} · 유지비 {won(t.upkeepPerMonth)}/달 ·{' '}
                  {['', '모든', '중간 이상', '큰'][t.size]} 항구
                </span>
              </div>
              <button
                className="btn small"
                disabled={!fits || p.cash < t.price}
                title={!fits ? `${name(buyAt)} 항구는 너무 작아요` : p.cash < t.price ? '돈이 모자라요' : ''}
                onClick={() => {
                  const r = sim.act({ type: 'buyShip', typeId: t.id, cityId: buyAt });
                  setFlash(r.ok ? `${name(buyAt)}에서 ${t.name}을(를) 샀어요.` : (r.error ?? '살 수 없어요.'), r.ok);
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

function RouteEditor({ sim, world, setFlash }: { sim: Simulation; world: World; setFlash: (m: string | null, ok?: boolean) => void }) {
  const { ctx, state } = sim;
  const name = (id: string) => world.cities.find((c) => c.id === id)?.name ?? id;
  const emptyStop = (cityId: string): RouteStop => ({ cityId, buy: [], sell: [] });
  const [editing, setEditing] = useState<string | null>(null);
  const [routeName, setRouteName] = useState('');
  const [stops, setStops] = useState<RouteStop[]>([]);
  const [minMargin, setMinMargin] = useState(10);
  const [reserve, setReserve] = useState(5000);

  const startNew = () => {
    setEditing('new');
    setRouteName('');
    setStops([emptyStop(ctx.cityIds[0]), emptyStop(ctx.cityIds[1])]);
    setMinMargin(10);
    setReserve(5000);
  };
  const startEdit = (id: string) => {
    const r = state.player.routes.find((x) => x.id === id)!;
    setEditing(id);
    setRouteName(r.name);
    setStops(structuredClone(r.stops));
    setMinMargin(Math.round(r.minMargin * 100));
    setReserve(r.cashReserve);
  };
  const updateStop = (k: number, f: (s: RouteStop) => RouteStop) => setStops((all) => all.map((s, i) => (i === k ? f(structuredClone(s)) : s)));

  return (
    <>
      <h3>정기 항로</h3>
      <p className="muted small">여러 항구를 차례로 돌며 정해 둔 상품을 자동으로 사고팔아요. 남는 게 없으면 사지 않고 알려 줘요.</p>
      {state.player.routes.map((r) => {
        const ships = state.ships.filter((s) => s.routeId === r.id);
        return (
          <div key={r.id} className="route-card">
            <b>{r.name}</b>
            <span className="small">{r.stops.map((s) => name(s.cityId)).join(' → ')}</span>
            <span className="muted small">
              배 {ships.length}척{ships.length ? `(${ships.map((s) => s.name).join(', ')})` : ''} · 이익률 {Math.round(r.minMargin * 100)}% 이상일 때만 사기 · 현금{' '}
              {won(r.cashReserve)}은 남기기
            </span>
            <div className="row">
              <button className="btn small" onClick={() => startEdit(r.id)}>
                고치기
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
      {editing === null ? (
        <button className="btn" onClick={startNew}>
          + 새 정기 항로 만들기
        </button>
      ) : (
        <div className="route-editor">
          <label className="small">
            이름 <input value={routeName} onChange={(e) => setRouteName(e.target.value)} placeholder="예: 곡물 남북 항로" />
          </label>
          {stops.map((st, k) => (
            <div key={k} className="stop">
              <div className="row">
                <b>{k + 1}번째 항구</b>
                <select value={st.cityId} onChange={(e) => updateStop(k, (s) => ({ ...s, cityId: e.target.value }))}>
                  {world.cities.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {stops.length > 2 && (
                  <button className="btn small" onClick={() => setStops((all) => all.filter((_, i) => i !== k))}>
                    빼기
                  </button>
                )}
              </div>
              <div className="row small">
                살 상품:
                {st.buy.map((b, i) => (
                  <span key={i} className="chip-edit">
                    {ctx.goodById[b.goodId].name}
                    <input
                      className="qty"
                      value={b.maxQuantity}
                      onChange={(e) => updateStop(k, (s) => { s.buy[i].maxQuantity = Number(e.target.value) || 0; return s; })}
                    />
                    개까지
                    <button className="x" onClick={() => updateStop(k, (s) => { s.buy.splice(i, 1); return s; })} aria-label="빼기">
                      ×
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) updateStop(k, (s) => { s.buy.push({ goodId: id, maxQuantity: 50 }); return s; });
                  }}
                >
                  <option value="">+ 추가</option>
                  {ctx.goods.filter((g) => !st.buy.some((b) => b.goodId === g.id)).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="row small">
                팔 상품:
                {st.sell.map((id, i) => (
                  <span key={id} className="chip-edit">
                    {ctx.goodById[id].name}
                    <button className="x" onClick={() => updateStop(k, (s) => { s.sell.splice(i, 1); return s; })} aria-label="빼기">
                      ×
                    </button>
                  </span>
                ))}
                <select
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id) updateStop(k, (s) => { s.sell.push(id); return s; });
                  }}
                >
                  <option value="">+ 추가</option>
                  {ctx.goods.filter((g) => !st.sell.includes(g.id)).map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ))}
          {stops.length < 4 && (
            <button className="btn small" onClick={() => setStops((all) => [...all, emptyStop(ctx.cityIds[0])])}>
              + 항구 더하기
            </button>
          )}
          <div className="row small">
            <label>
              기대 이익률이 <input className="qty" value={minMargin} onChange={(e) => setMinMargin(Number(e.target.value) || 0)} />% 이상일 때만 사기
            </label>
          </div>
          <div className="row small">
            <label>
              현금 <input className="qty wide" value={reserve} onChange={(e) => setReserve(Number(e.target.value) || 0)} />은 항상 남기기
            </label>
          </div>
          <div className="row">
            <button
              className="btn primary"
              onClick={() => {
                const res = sim.act({
                  type: 'saveRoute',
                  route: { id: editing === 'new' ? undefined : editing, name: routeName, stops, minMargin: minMargin / 100, cashReserve: reserve },
                });
                setFlash(res.ok ? '항로를 저장했어요. 내 배 탭에서 배를 맡겨 보세요.' : (res.error ?? ''), res.ok);
                if (res.ok) setEditing(null);
              }}
            >
              저장
            </button>
            <button className="btn" onClick={() => setEditing(null)}>
              취소
            </button>
          </div>
        </div>
      )}
    </>
  );
}
