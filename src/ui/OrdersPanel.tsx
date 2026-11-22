import { useState } from 'react';
import { REASON_NAMES } from '../sim/classroom/reasons';
import { fixJosa } from '../sim/core/korean';
import { deliverableQuantity, isOpenOrder, orderPurchasePlan, ORDER_RULES, warehouseDeliverableQuantity } from '../sim/economy/orders';
import { PLAYER_ID } from '../sim/economy/player';
import { cityTrust, trustChangeText, trustLevel, TRUST_LEVELS } from '../sim/economy/trust';
import { warehouseOf } from '../sim/economy/warehouse';
import type { Command, Ship, StorageZone, TradeOrder } from '../sim/economy/types';
import { GoodIcon, Icon, ReasonIcon } from './icons';
import { qty, won } from './tradeModel';
import { formatDate, type Simulation } from './useSimulation';

const STATUS: Record<TradeOrder['status'], string> = {
  offered: '검토 중', accepted: '운송 중', completed: '납품 완료', declined: '받지 않음', expired: '기한 종료', cancelled: '취소함',
};

function useOrderAction(sim: Simulation) {
  const [flash, setFlash] = useState<{ text: string; ok: boolean } | null>(null);
  const act = (cmd: Command, successText?: string) => {
    const result = sim.act(cmd);
    const event = result.events.find((e) => e.type === 'order');
    setFlash({ ok: result.ok, text: fixJosa(result.error ?? successText ?? (event?.type === 'order' ? event.text : '처리했어요.')) });
    return result.ok;
  };
  return { act, message: flash && <p role="status" className={flash.ok ? 'flash ok' : 'flash'}>{flash.text}</p> };
}

function DeliveryButton({ sim, ship, order, act }: { sim: Simulation; ship: Ship; order: TradeOrder; act: (cmd: Command) => boolean }) {
  const amount = deliverableQuantity(sim.state, ship, order);
  if (amount <= 1e-9) return null;
  return <button className="btn primary" onClick={() => act({ type: 'deliverOrder', orderId: order.id, shipId: ship.id, quantity: amount })}>
    <Icon name="package-export" size={16} /> 발주품목 납품하기 · {sim.ctx.goodById[order.goodId].name} {qty(amount)}개 · {won(amount * order.unitPrice)}<small> · {ship.name}</small>
  </button>;
}

function WarehouseDeliveryButton({ sim, order, storage, act }: { sim: Simulation; order: TradeOrder; storage: StorageZone; act: (cmd: Command) => boolean }) {
  const amount = warehouseDeliverableQuantity(sim.state, order, storage);
  if (amount <= 1e-9) return null;
  return <button className="btn primary" onClick={() => act({ type: 'deliverWarehouseOrder', orderId: order.id, storage, quantity: amount })}>
    <Icon name="building-warehouse" size={16} /> 발주품목 납품하기 · {sim.ctx.goodById[order.goodId].name} {qty(amount)}개 · {won(amount * order.unitPrice)}<small> · {storage === 'cold' ? '냉장' : '일반'} 창고</small>
  </button>;
}

/** 회사 창고에서도 시장 판매와 계약 납품을 구분한다. */
export function WarehouseOrders({ sim, storage }: { sim: Simulation; storage: StorageZone }) {
  const { act, message } = useOrderAction(sim);
  const home = warehouseOf(sim.ctx, sim.state).cityId;
  const orders = sim.state.player.orders?.items.filter((o) => o.status === 'accepted' && o.cityId === home) ?? [];
  if (!orders.length) return null;
  return <section className="storage-stock" aria-label="창고에서 발주 납품"><h4><Icon name="clipboard-list" size={18} /> 거점에 납품할 발주</h4>
    {orders.map((order) => <div className="order-port-row" key={order.id}><span>{sim.ctx.goodById[order.goodId].name} · 남은 {qty(order.quantity - order.delivered)}개 · {formatDate(sim.ctx.data.startYear, order.deadlineMonth - 1)} 말까지</span><WarehouseDeliveryButton sim={sim} order={order} storage={storage} act={act} />{warehouseDeliverableQuantity(sim.state, order, storage) <= 1e-9 && <small>이 구역에 다른 항구에서 들여온 해당 상품을 보관하면 납품할 수 있어요.</small>}</div>)}{message}
  </section>;
}

export function LocalTradeTrust({ sim }: { sim: Simulation }) {
  const { ctx, state } = sim, home = warehouseOf(ctx, state).cityId;
  const trust = cityTrust(state, home), level = trustLevel(trust.score);
  const next = TRUST_LEVELS.find((l) => l.score > trust.score);
  const others = Object.entries(state.player.cityTrust ?? {}).filter(([id]) => id !== home);
  return <section className="local-trust" aria-label="지역 거래 신뢰도">
    <div className="local-trust-head"><Icon name="building-community" size={30} /><div><h3>{ctx.cityNames[home]} · 거점 거래 신뢰도</h3><p>{level.name} · 완납 {trust.completed}건</p></div><b>{trust.score}<small> / 100</small></b></div>
    <progress max={100} value={trust.score} aria-label="거점 신뢰도" />
    <div className="trust-benefits"><span>새 발주 단가 <b>+{Math.round(level.bonus * 100)}%</b></span><span>특산품 물량 <b>+{Math.round(level.specialtyBonus * 100)}%</b></span><span>지역 요청 확인 <b>{level.localInterval}개월마다</b></span></div>
    <p className="muted small">{next ? `다음 등급까지 ${next.score - trust.score}점 · ${next.name}: 단가 +${Math.round(next.bonus * 100)}%, 특산품 물량 +${Math.round(next.specialtyBonus * 100)}%, ${next.localInterval}개월 간격` : '최고 등급이에요. 약속을 지키며 신뢰를 이어 가세요.'}<br />거점에서 물건이 부족하고 조달할 수 있을 때 요청해요. 진행 중인 지역 발주는 한 건까지예요.</p>
    {trust.lastChange && <p className="trust-last">최근 변화 · {formatDate(ctx.data.startYear, trust.lastChange.month)} · {trust.lastChange.outcome === 'completed' ? '완납' : trust.lastChange.outcome === 'cancelled' ? '수락 후 취소' : '납품 기한 종료'} · {trustChangeText(trust.lastChange.delta)}</p>}
    <details className="trust-guide"><summary>신뢰도는 어떻게 달라지나요?</summary><p>기한 내 완납 +10 · 수락 후 취소 −5 · 미완납 상태로 기한 종료 −8. 부분 납품은 완료 때 평가해요. 받지 않기·무시에는 불이익이 없어요. 점수는 0~100이고 도시마다 별도로 쌓여요.</p><p>발주 단가 혜택은 앞으로 도착하는 발주에 적용해요. 이미 약속한 단가는 바뀌지 않아요. 특산품 물량 혜택은 구매하는 도시의 현재 신뢰도를 바로 반영하며, 판매 재고와 국가 공통 한도 안에서 적용돼요. 일반 판매만으로 신뢰도가 오르지는 않아요.</p><div className="trust-levels">{TRUST_LEVELS.map((l) => <span key={l.score}>{l.score}점 · {l.name} · 발주 +{Math.round(l.bonus * 100)}% · 특산품 +{Math.round(l.specialtyBonus * 100)}%</span>)}</div></details>
    {!!others.length && <details className="trust-guide"><summary>다른 도시의 거래 신뢰도 · {others.length}곳</summary><div className="trust-levels">{others.sort((a, b) => b[1].score - a[1].score).map(([id, t]) => <span key={id}>{ctx.cityNames[id]} · {t.score}점 · 완납 {t.completed}건 · {trustLevel(t.score).name} · 특산품 물량 +{Math.round(trustLevel(t.score).specialtyBonus * 100)}%</span>)}</div></details>}
  </section>;
}

/** 수락한 발주는 수업 목표와 함께 따라간다. */
export function OrderGoals({ sim, onCity, onWarehouse }: { sim: Simulation; onCity: (id: string) => void; onWarehouse: () => void }) {
  const { ctx, state } = sim;
  const orders = state.player.orders?.items.filter((o) => o.status === 'accepted') ?? [];
  if (!orders.length) return null;
  return <section className="order-goals" aria-label="진행 중인 발주 목표">
    <h3><Icon name="clipboard-list" size={16} /> 받은 발주 · {orders.length}건</h3>
    {orders.map((o) => {
      const cargoShip = o.sourceKind === 'cargo' ? state.ships.find((s) => s.companyId === PLAYER_ID && s.cargo.some((l) => l.goodId === o.goodId && l.originCityId !== o.cityId && l.quantity > 0)) : undefined;
      return <article className="order-goal" key={o.id}>
      <b><GoodIcon id={o.goodId} size={18} /> {ctx.goodById[o.goodId].name} {qty(o.quantity)}개 납품</b>
      <span>남은 {qty(o.quantity - o.delivered)}개 · {formatDate(ctx.data.startYear, o.deadlineMonth - 1)} 말까지</span>
      <progress value={o.delivered} max={o.quantity} aria-label={`${ctx.goodById[o.goodId].name} 납품 진행`} />
      <div className="order-goal-route">
        <button onClick={() => o.sourceKind === 'warehouse' ? onWarehouse() : onCity(cargoShip?.to ?? o.sourceCityId)}><small>조달처</small>{o.sourceKind === 'warehouse' ? '회사 창고' : cargoShip ? `${cargoShip.name} 보유 화물 · ${ctx.cityNames[cargoShip.to]}` : ctx.cityNames[o.sourceCityId]}</button>
        <span aria-hidden="true">→</span>
        <button onClick={() => onCity(o.cityId)}><small>납품처</small>{ctx.cityNames[o.cityId]}</button>
      </div>
      <details><summary>발주 사유 · 남은 대금 {won((o.quantity - o.delivered) * o.unitPrice)}</summary><p>{fixJosa(o.reason.text)}</p></details>
    </article>;
    })}
  </section>;
}

/** 항구에 맞춰 조달과 납품을 안내하며 일반 시장 거래와 구분한다. */
export function PortOrders({ sim, ship, onDestination, onWarehouse }: { sim: Simulation; ship: Ship; onDestination: (id: string) => void; onWarehouse?: () => void }) {
  const { act, message } = useOrderAction(sim);
  const { ctx, state } = sim;
  const orders = state.player.orders?.items.filter((o) => o.status === 'accepted') ?? [];
  // 완납 직후에도 처리 결과를 읽을 수 있게 남긴다.
  if (!orders.length) return message;
  return <section className="port-orders" aria-label="발주 조달과 납품">
    <h3><Icon name="clipboard-list" size={18} /> 이 항구에서 할 발주 작업</h3>
    {orders.map((o) => {
      const delivery = o.cityId === ship.to, plan = delivery ? null : orderPurchasePlan(ctx, state, ship, o);
      const stored = warehouseDeliverableQuantity(state, o, 'ambient') + warehouseDeliverableQuantity(state, o, 'cold');
      return <div key={o.id} className="order-port-row">
        <b><GoodIcon id={o.goodId} size={18} /> {delivery ? '납품' : '조달'} · {ctx.goodById[o.goodId].name} · 남은 {qty(o.quantity - o.delivered)}개</b>
        <small>추천 조달처 {o.sourceKind === 'warehouse' ? '회사 창고' : o.sourceKind === 'cargo' ? '보유 화물' : ctx.cityNames[o.sourceCityId]} → 납품처 {ctx.cityNames[o.cityId]} · {formatDate(ctx.data.startYear, o.deadlineMonth - 1)} 말까지</small>
        {delivery ? <>
          <DeliveryButton sim={sim} ship={ship} order={o} act={act} />
          {deliverableQuantity(state, ship, o) <= 1e-9 && <small>이 배에 납품할 물건이 없어요. 다른 항구에서 실어 오세요. 정기 항로 배는 항로에서 빼 주세요.</small>}
          {stored > 1e-9 && onWarehouse && <button className="btn small" onClick={onWarehouse}>회사 창고에서 납품하기 · {qty(Math.min(stored, o.quantity - o.delivered))}개 보관 중</button>}
        </> : plan && <>
          <span>이 배에 {qty(plan.aboard)}개 · 추가로 {plan.needed}개 필요{plan.keep < 1 && ' (항해 중 부패 반영)'}</span>
          <div className="order-actions">
            <button className="btn primary" disabled={plan.quantity <= 0} onClick={() => act({ type: 'fillOrder', orderId: o.id, shipId: ship.id }, `${ctx.goodById[o.goodId].name} ${qty(plan.quantity)}개를 실었어요. ${ctx.cityNames[o.cityId]}에서 발주품목 납품하기를 누르세요.`)}>
              <Icon name="package-import" size={16} /> 발주품목 채우기{plan.quantity > 0 && ` · ${qty(plan.quantity)}개 · ${won(plan.total)}`}
            </button>
            <button className="btn small" onClick={() => onDestination(o.cityId)}>납품처로 목적지 설정</button>
          </div>
          {plan.reason && <small>{plan.reason}</small>}
          {stored > 1e-9 && <small>납품처의 회사 창고에도 {qty(Math.min(stored, plan.remaining))}개 있어요. 창고에서 먼저 납품하면 추가 구매량이 줄어요.</small>}
        </>}
      </div>;
    })}
    {message}
  </section>;
}

export function OrdersPanel({ sim, onCity, localOnly = false }: { sim: Simulation; onCity: (id: string) => void; localOnly?: boolean }) {
  const { ctx, state } = sim;
  const orders = state.player.orders?.items ?? [];
  const [tab, setTab] = useState<'open' | 'history'>('open');
  const [regionOnly, setRegionOnly] = useState(localOnly);
  const { act, message } = useOrderAction(sim);
  const accepted = orders.filter((o) => o.status === 'accepted').length;
  const filtered = orders.filter((o) => !(localOnly || regionOnly) || o.kind === 'local');
  const visible = filtered.filter((o) => tab === 'open' ? isOpenOrder(o) : !isOpenOrder(o)).slice().reverse();
  const myShips = state.ships.filter((s) => s.companyId === PLAYER_ID);
  const date = (month: number) => formatDate(ctx.data.startYear, month - 1);
  return <div className="orders-panel">
    {localOnly && <LocalTradeTrust sim={sim} />}
    <div className="order-intro">
      <Icon name="mail-opened" size={28} />
      <div><b>{localOnly ? '거점에서 기다리는 물건' : '필요한 곳으로, 필요한 때에'}</b><p>{localOnly ? '주변 항구에서 실어 오거나 회사 창고 재고로 납품하세요. 거점의 약속을 지키면 다음 거래 조건이 좋아져요.' : '도시의 사정을 읽고 맡을 발주를 고르세요. 받지 않아도 괜찮아요.'}</p></div>
    </div>
    <nav className="win-tabs" aria-label="발주 목록">
      <button className={tab === 'open' ? 'on' : ''} onClick={() => setTab('open')}>새 요청 · 진행 중 {filtered.filter(isOpenOrder).length}</button>
      <button className={tab === 'history' ? 'on' : ''} onClick={() => setTab('history')}>지난 발주</button>
      <span className="muted">받은 발주 {accepted}/{ORDER_RULES.maxAccepted}</span>
    </nav>
    {!localOnly && <label className="order-filter"><input type="checkbox" checked={regionOnly} onChange={(e) => setRegionOnly(e.target.checked)} /> 거점 지역 발주만 보기</label>}
    {message}
    {!visible.length && <div className="order-empty"><Icon name="mail" size={36} /><b>{tab === 'open' ? '지금은 새 요청을 기다리고 있어요' : '아직 지난 발주가 없어요'}</b><p>시간이 흐르면 물건이 필요한 도시에서 간간이 연락해요.<br />내 배로 조달할 수 있는 요청이 있을 때 발주가 도착해요.</p></div>}
    {visible.map((order) => {
      const city = ctx.cityNames[order.cityId], good = ctx.goodById[order.goodId];
      const premium = Math.round((order.unitPrice / order.referencePrice - 1) * 100);
      const eligible = myShips.some((s) => deliverableQuantity(state, s, order) > 1e-9) || (['ambient', 'cold'] as const).some((z) => warehouseDeliverableQuantity(state, order, z) > 1e-9);
      const trust = cityTrust(state, order.cityId);
      return <article className={`order-card order-${order.status}`} key={order.id}>
        <header className="order-title"><GoodIcon id={good.id} size={32} /><div><small>{order.kind === 'local' && <b className="local-order-badge">거점 지역 발주</b>} {ctx.countryNames[ctx.countryOfCity[order.cityId]]} · {city} 발주처</small><h3>{good.name} {order.quantity}개가 필요해요</h3></div><span className="order-status">{STATUS[order.status]}</span></header>
        <div className="order-reason"><span><ReasonIcon category={order.reason.category} size={18} /> {REASON_NAMES[order.reason.category]}</span><p>{fixJosa(order.reason.text)}</p></div>
        <dl className="order-terms">
          <div><dt>납품 기한</dt><dd>{date(order.deadlineMonth)} 말까지</dd></div>
          <div><dt>약속한 단가</dt><dd>{won(order.unitPrice)} <small>발주 당시 시세 +{premium}%</small></dd></div>
          <div><dt>전량 납품 대금</dt><dd className="order-payment">{won(order.unitPrice * order.quantity)}</dd></div>
        </dl>
        <p className="order-fine">단가는 고정 · 관세·하역비는 발주처 부담 · 매입·연료·유지비는 내 부담</p>
        <p className="order-trust">{city} 신뢰도 {trust.score}점 · {trustLevel(trust.score).name}{!!order.trustBonus && ` · 계약 단가에 신뢰 보너스 +${Math.round(order.trustBonus * 100)}% 포함`}{order.trustChange !== undefined ? ` · 이 계약 ${trustChangeText(order.trustChange)}` : isOpenOrder(order) ? ' · 기한 내 완납 +10점' : ''}</p>
        {isOpenOrder(order) && <details className="order-source" open={order.status === 'accepted'}><summary>어디서 구할 수 있을까? · {order.sourceKind === 'warehouse' ? '회사 창고 재고' : order.sourceKind === 'cargo' ? '이미 실어 둔 화물' : ctx.cityNames[order.sourceCityId]}</summary><p>{fixJosa(order.sourceReason.text)}</p><p>발주 당시 예시: {order.suggestedBuyQuantity > 0 ? `${order.suggestedBuyQuantity}개 매입 → ` : '보유 화물에서 '}{order.quantity}개 납품. {order.suggestedBuyQuantity > 0 ? '매입·운항 예상 비용' : '기존 매입원가·추가 운항비'} {won(order.estimatedCost)}. {order.suggestedBuyQuantity > order.quantity && '항해 중 상할 양을 고려해 넉넉히 실어요.'}</p><small>상품을 예약하지는 않아요. 출항 전에 현재 재고·가격·배의 항속거리를 확인하세요. 보관료와 기다리는 동안의 부패도 고려하세요.</small><div className="order-actions"><button className="btn small" onClick={() => onCity(order.sourceCityId)}>조달 항구 보기</button><button className="btn small" onClick={() => onCity(order.cityId)}>납품 항구 보기</button></div></details>}
        {order.status === 'offered' && <><p className="order-fine">받은 뒤 취소 −5점 · 미완납으로 기한 종료 −8점 · 받지 않으면 영향 없음</p><footer className="order-actions"><span className="muted">{date(order.offerExpiresMonth)} 말까지 결정</span><button className="btn" onClick={() => act({ type: 'declineOrder', orderId: order.id })}>받지 않기</button><button className="btn primary" disabled={accepted >= ORDER_RULES.maxAccepted} onClick={() => act({ type: 'acceptOrder', orderId: order.id })}>발주 받기</button></footer></>}
        {order.status !== 'offered' && order.status !== 'declined' && <div className="order-progress"><progress value={order.delivered} max={order.quantity} aria-label="납품 진행" /><span>{qty(order.delivered)} / {order.quantity}개 납품 · 받은 대금 {won(order.delivered * order.unitPrice)}</span></div>}
        {order.status === 'accepted' && <div className="order-actions">{myShips.map((ship) => <DeliveryButton key={ship.id} sim={sim} ship={ship} order={order} act={act} />)}{(['ambient', 'cold'] as const).map((storage) => <WarehouseDeliveryButton key={storage} sim={sim} order={order} storage={storage} act={act} />)}{!eligible && <span className="muted">다른 항구에서 물건을 싣고 {city}에 도착하면 납품할 수 있어요. 거점에서는 회사 창고에서도 납품해요.</span>}<button className="btn small" onClick={() => act({ type: 'cancelOrder', orderId: order.id })}>발주 취소 · 신뢰도 −5</button></div>}
      </article>;
    })}
    <p className="order-fine">부분 납품도 즉시 대금을 받아요. 받지 않기·무시는 신뢰도에 영향이 없어요. 수락 후 취소는 −5점, 미완납 상태로 기한이 끝나면 −8점(최저 0점)이며 위약금은 없어요. 받은 대금과 남은 화물은 유지돼요. 일반 ‘팔기’ 대신 ‘납품’을 선택하세요.</p>
  </div>;
}
