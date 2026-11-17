import { evaluateRoute, routeOpportunities } from '../sim/economy/routePlan';
import { PLAYER_ID, shipType } from '../sim/economy/player';
import type { RouteStop, TradeRoute } from '../sim/economy/types';
import { GoodIcon, Icon } from './icons';
import type { Simulation } from './useSimulation';

const won = (v: number) => Math.round(v).toLocaleString('ko-KR');
const signed = (v: number) => `${v >= 0 ? '+' : '−'}${won(Math.abs(v))}`;

/** 이 항로를 돌 배의 선종: 맡긴 배가 있으면 그 배, 없으면 내 첫 배, 그것도 없으면 소형 */
export function routeShipType(sim: Simulation, routeId?: string): string {
  const mine = sim.state.ships.filter((s) => s.companyId === PLAYER_ID);
  return (routeId && mine.find((s) => s.routeId === routeId)?.typeId) || mine[0]?.typeId || 'small';
}

/**
 * 항로 한 바퀴의 예상(지금 시세·재고·다른 배의 짐 기준): 매매 차익 − 연료비 − 유지비 = 순이익, 한 달 평균.
 * 자동항로가 실제로 쓰는 계산과 같다(남지 않으면 배는 기항지에서 기다린다).
 */
export function RouteForecast(props: {
  sim: Simulation;
  route: Pick<TradeRoute, 'stops' | 'minMargin' | 'cashReserve'>;
  typeId: string;
  name: (id: string) => string;
  compact?: boolean;
}) {
  const { sim, route, typeId, name } = props;
  const ev = evaluateRoute(sim.ctx, sim.state, route, typeId, { cash: sim.state.player.cash });
  const t = shipType(sim.ctx, typeId);
  if (ev.blocked) return <p className="small bad">{t.name}이 들어가지 못하는 작은 항구가 있어요.</p>;
  if (route.stops.length < 2) return null;
  const ok = ev.contribution > 0;
  return (
    <div className={ok ? (ev.net > 0 ? 'route-forecast up' : 'route-forecast mid') : 'route-forecast down'}>
      <div className="rf-head">
        <Icon name={ok ? 'trending-up' : 'player-pause'} size={18} />
        <b>
          한 바퀴(약 {ev.loopMonths.toFixed(1)}달) 예상 순이익 {signed(ev.net)}
        </b>
        <span className="muted small">한 달 평균 {signed(ev.perMonth)} · {t.name} 기준</span>
      </div>
      <div className="rf-flow small">
        <span className="good">매매 차익 {signed(ev.tradeGain)}</span>
        <span>− 연료 {won(ev.fuel)}</span>
        <span>− 유지비 {won(ev.upkeep)}</span>
        {ev.spoilage > 0.5 && <span className="muted">(상함 {won(ev.spoilage)} 반영)</span>}
        {ev.emptyLegs > 0 && <span className="muted">· 빈 배 구간 {ev.emptyLegs}곳</span>}
      </div>
      {!props.compact && ev.trades.length > 0 && (
        <ul className="rf-trades">
          {ev.trades.map((x, i) => (
            <li key={i}>
              <GoodIcon id={x.goodId} size={15} /> {sim.ctx.goodById[x.goodId].name} {Math.round(x.quantity)}개: {name(route.stops[x.buyStop].cityId)} →{' '}
              {name(route.stops[x.sellStop].cityId)} <b className={x.gain >= 0 ? 'good' : 'bad'}>{signed(x.gain)}</b>
              <span className="muted"> (도착 때 1개 약 {won(x.arrivalPrice)}, 지금 {won(x.priceNow)})</span>
            </li>
          ))}
        </ul>
      )}
      {!ok && (
        <p className="small">
          지금은 이 항로를 돌면 연료비만큼도 벌지 못해요. 배를 맡기면 기항지에서 기다렸다가, 다달이 다시 따져 남을 때 출발해요.
        </p>
      )}
    </div>
  );
}

/** 기항지 k에서 사서 이 항로의 다른 기항지에 팔면 실제로 남는 상품(도착 때 값·다른 배·운항비 반영) */
export function StopOpportunities(props: {
  sim: Simulation;
  stops: RouteStop[];
  k: number;
  typeId: string;
  name: (id: string) => string;
  onAdd: (goodId: string, sellStop: number) => void;
}) {
  const { sim, stops, k, typeId, name } = props;
  const list = routeOpportunities(sim.ctx, sim.state, { stops }, typeId, k).slice(0, 4);
  return (
    <div className="opps">
      <b className="good">
        <Icon name="coin" size={15} /> 이 항로에서 실제로 남는 상품
      </b>
      <span className="muted small">도착할 때의 값, 같은 곳으로 가는 다른 배, 연료·유지·항만비까지 따진 예상이에요(배 한 척 가득).</span>
      {list.length === 0 && <span className="muted small">여기서 사서 이 항로로 날라 남는 상품이 지금은 없어요.</span>}
      {list.map((o) => {
        const g = sim.ctx.goodById[o.goodId];
        const added = stops[k].buy.some((b) => b.goodId === o.goodId) && stops[o.sellStop].sell.includes(o.goodId);
        return (
          <button key={o.goodId} className="opp" disabled={added} onClick={() => props.onAdd(o.goodId, o.sellStop)} title="살 상품·팔 상품에 함께 넣기">
            <GoodIcon id={g.id} size={16} /> {g.name} → {name(stops[o.sellStop].cityId)}
            <b className="good"> +{won(o.estimate.gain)}</b>
            <span className="muted"> ({Math.round(o.estimate.quantity)}개, 1개당 +{won(o.estimate.gain / Math.max(1, o.estimate.quantity))})</span>
            {added ? ' ✓' : ' +'}
          </button>
        );
      })}
    </div>
  );
}

/** 추천 계산에 쓰는 "이 항로에서 남는 상품" 집합 */
export function profitableHere(sim: Simulation, stops: RouteStop[], k: number, typeId: string): Set<string> {
  return new Set(routeOpportunities(sim.ctx, sim.state, { stops }, typeId, k).map((o) => o.goodId));
}
