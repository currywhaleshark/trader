import { useState } from 'react';
import { fixJosa } from '../sim/core/korean';
import { isDocked, PLAYER_ID, quoteCargoSale } from '../sim/economy/player';
import { lotQuantity, lotVolume, storageCapacity, storedLots, warehouseMonthlyFee, warehouseOf, warehouseTransferLimit, WAREHOUSE_RULES } from '../sim/economy/warehouse';
import type { Command, StorageZone } from '../sim/economy/types';
import { GoodIcon, Icon } from './icons';
import { WarehouseOrders } from './OrdersPanel';
import { cargoProducts, matchesProduct } from '../sim/economy/products';
import { won } from './tradeModel';
import { formatDate, type Simulation } from './useSimulation';

// 부패 후 52.8개 같은 실제 잔량을 정수로 반올림해 감추지 않는다.
const qty = (n: number) => n.toLocaleString('ko-KR', { maximumFractionDigits: 2 });

export function WarehousePanel({ sim }: { sim: Simulation }) {
  const { ctx, state } = sim;
  const warehouse = warehouseOf(ctx, state);
  const [zone, setZone] = useState<StorageZone>('ambient');
  const [chosenShip, setChosenShip] = useState('');
  const [chosenGood, setChosenGood] = useState('');
  const [amount, setAmount] = useState(1);
  const [flash, setFlash] = useState<{ ok: boolean; text: string } | null>(null);
  const fleet = state.ships.filter((s) => s.companyId === PLAYER_ID && isDocked(s) && !s.routeId && s.to === warehouse.cityId);
  const ship = fleet.find((s) => s.id === chosenShip) ?? fleet[0];
  const products = cargoProducts(ctx, [...warehouse.cargo, ...warehouse.coldCargo, ...(ship?.cargo ?? [])]);
  const product = products.find((p) => p.id === chosenGood) ?? products[0];
  const good = product ? ctx.goodById[product.goodId] : undefined;
  const cargo = storedLots(warehouse, zone);
  const stored = good ? lotQuantity(cargo, good.id, product.specialtyId) : 0;
  const onShip = good && ship ? lotQuantity(ship.cargo, good.id, product.specialtyId) : 0;
  const selectedLots = cargo.filter((l) => good && matchesProduct(l, good.id, product.specialtyId));
  const avgCost = stored ? selectedLots.reduce((v, l) => v + l.unitCost * l.quantity, 0) / stored : 0;
  const buyMonth = selectedLots.reduce((m, l) => Math.min(m, l.bought?.month ?? state.month), state.month);
  const saleQty = Math.min(amount, stored);
  const sale = good && saleQty > 0 ? quoteCargoSale(ctx, state, { to: warehouse.cityId, cargo }, good.id, saleQty, product.specialtyId) : null;
  const canSell = !!good && state.cities[warehouse.cityId].target[good.id] > 0;
  const storeQty = good && ship ? Math.min(amount, warehouseTransferLimit(ctx, state, ship, good.id, 'store', zone, product.specialtyId)) : 0;
  const loadQty = good && ship ? Math.min(amount, warehouseTransferLimit(ctx, state, ship, good.id, 'load', zone, product.specialtyId)) : 0;
  const other: StorageZone = zone === 'ambient' ? 'cold' : 'ambient';
  const moveQty = good ? Math.max(0, Math.min(amount, stored, (storageCapacity(warehouse, other) - lotVolume(ctx, storedLots(warehouse, other))) / good.volume)) : 0;
  const act = (cmd: Command) => {
    const result = sim.act(cmd);
    const notice = result.events.find((e) => e.type === 'notice');
    setFlash({ ok: result.ok, text: fixJosa(result.error ?? (notice?.type === 'notice' ? notice.text : '처리했어요.')) });
  };
  const valid = amount > 0 && Number.isFinite(amount);

  return <div className="company-warehouse">
    <div className="warehouse-intro"><Icon name="building-warehouse" size={30} /><div><h3>{ctx.cityNames[warehouse.cityId]} 회사 창고</h3><p>값이 낮으면 보관하고, 때를 봐서 팔거나 다른 배로 실어 보내세요.</p></div></div>
    <div className="storage-zones" role="group" aria-label="창고 구역">
      {(['ambient', 'cold'] as const).map((z) => {
        const capacity = storageCapacity(warehouse, z), volume = lotVolume(ctx, storedLots(warehouse, z));
        return <button key={z} className={zone === z ? 'storage-zone on' : 'storage-zone'} aria-pressed={zone === z} onClick={() => setZone(z)}>
          <span><Icon name={z === 'cold' ? 'snowflake' : 'box'} size={20} /> {z === 'cold' ? '냉장 구역' : '일반 구역'}</span>
          <b>{capacity ? `${qty(volume)} / ${capacity}` : '미증설'}</b>
          <small>{z === 'cold' ? '보관 중 부패 없음' : `부패성 식료품 매달 ${Math.round(ctx.data.player.spoilagePerMonth * 100)}% 부패`}</small>
        </button>;
      })}
    </div>
    <p className="storage-cost">현재 재고 기준 월 보관료 <b>{won(warehouseMonthlyFee(ctx, warehouse))}</b> · 사용 부피당 일반 {WAREHOUSE_RULES.feePerVolume} / 냉장 {WAREHOUSE_RULES.coldFeePerVolume}<br /><small>빈 창고는 무료예요. 보관료는 월 갱신 때 내며 현금이 모자라면 미납금으로 남아요.</small></p>
    {flash && <p role="status" className={flash.ok ? 'flash ok' : 'flash'}>{flash.text}</p>}
    <WarehouseOrders sim={sim} storage={zone} />
    {zone === 'cold' && !warehouse.coldCapacity ? <div className="storage-upgrade"><Icon name="snowflake" size={34} /><h3>식료품을 오래 보관하려면</h3><p>냉장 구역 {WAREHOUSE_RULES.coldCapacity}칸을 추가합니다. 일반 창고의 물건은 증설 후 직접 옮겨 주세요.</p><button className="btn primary" disabled={state.player.cash < WAREHOUSE_RULES.coldBuildCost} onClick={() => act({ type: 'upgradeWarehouse' })}>냉장창고 증설 · {won(WAREHOUSE_RULES.coldBuildCost)}</button></div> : <>
      <div className="storage-stock">
        <h4>{zone === 'cold' ? '냉장' : '일반'} 구역 재고</h4>
        {!cargo.length && <p className="muted">비어 있어요. 거점에 정박한 배에서 물건을 옮길 수 있어요.</p>}
        <div className="storage-items">{cargoProducts(ctx, cargo).map((p) => <button className={p.id === product?.id ? 'on' : ''} key={p.id} onClick={() => { setChosenGood(p.id); setAmount(lotQuantity(cargo, p.goodId, p.specialtyId)); }}><GoodIcon id={p.goodId} size={22} /><b>{p.name}</b><span>{qty(lotQuantity(cargo, p.goodId, p.specialtyId))}개</span></button>)}</div>
      </div>
      <div className="storage-controls">
        <label>거점에 정박한 배<select aria-label="창고 이용 선박" value={ship?.id ?? ''} onChange={(e) => setChosenShip(e.target.value)}>{!fleet.length && <option value="">정박한 수동 운항 배 없음</option>}{fleet.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {!fleet.length && <p className="muted small">배가 없어도 창고의 물건을 거점 시장에 팔거나 구역 사이에 옮길 수 있어요.</p>}
        {!!products.length && <>
          <div className="storage-pickers"><label>상품<select aria-label="창고 상품" value={product?.id ?? ''} onChange={(e) => { setChosenGood(e.target.value); setAmount(1); }}>{products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>희망 수량<input aria-label="창고 작업 수량" type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(Number(e.target.value))} /></label><button className="btn small" onClick={() => setAmount(Math.max(stored, onShip))}>전량</button></div>
          <p className="muted small">이 구역 {qty(stored)}개 · 선택한 배 {qty(onShip)}개. 빈자리와 배에 맞는 만큼 옮겨요.</p>
          {!!good && <div className="storage-actions">
            <button data-tut="warehouse-store" className="btn" disabled={!valid || storeQty <= 1e-9} onClick={() => act({ type: 'warehouseTransfer', shipId: ship!.id, goodId: good.id, specialtyId: product.specialtyId, quantity: amount, direction: 'store', storage: zone })}>배 → 창고 · {qty(storeQty)}개 보관</button>
            <button className="btn" disabled={!valid || loadQty <= 1e-9} onClick={() => act({ type: 'warehouseTransfer', shipId: ship!.id, goodId: good.id, specialtyId: product.specialtyId, quantity: amount, direction: 'load', storage: zone })}>창고 → 배 · {qty(loadQty)}개 싣기</button>
            <button className="btn" disabled={!valid || moveQty <= 1e-9} onClick={() => act({ type: 'warehouseMove', goodId: good.id, specialtyId: product.specialtyId, quantity: amount, to: other })}>{other === 'cold' ? '냉장' : '일반'} 구역으로 · {qty(moveQty)}개</button>
          </div>}
        </>}
      </div>
      {good && stored > 0 && <div className="storage-sale">
        <h4><GoodIcon id={good.id} size={20} /> {product.name} · 지금 팔면?</h4>
        <p>평균 매입원가 <b>{won(avgCost)}</b> /개 · 가장 이른 매입 {formatDate(ctx.data.startYear, buyMonth)}</p>
        <p className="muted small">원산지 {Array.from(new Set(selectedLots.map((l) => ctx.countryNames[l.originCountryId]))).join(', ')} · 원가와 상표는 보관·이동 후에도 유지돼요.</p>
        {canSell && sale ? <><div className="storage-sale-values"><span>{qty(sale.quantity)}개 판매 시 실수령액 <b>{won(sale.total)}</b></span><span className={sale.total >= sale.cost ? 'good' : 'bad'}>매입원가 대비 <b>{sale.total >= sale.cost ? '+' : ''}{won(sale.total - sale.cost)}</b></span></div><p className="muted small">관세·판매 수수료를 뺀 현재 견적이에요. 이미 낸 보관료·운항비는 별도이며, 기다려도 시세가 오르지 않을 수 있어요.</p><button className="btn primary" disabled={!valid} onClick={() => act({ type: 'warehouseSell', goodId: good.id, specialtyId: product.specialtyId, quantity: amount, storage: zone })}>거점 시장에 {qty(sale.quantity)}개 팔기 · {won(sale.total)}</button></> : <p className="muted">{canSell ? '판매할 수량을 입력하세요.' : '이 시장에서는 사는 사람이 없어요. 배에 실어 다른 항구로 보내세요.'}</p>}
      </div>}
    </>}
    <p className="storage-footnote">보관·다시 싣기는 매매가 아니에요. 회사 재고는 시장에서 소비되지 않고 내가 팔 때만 시장에 풀려요. 일반 구역의 과일은 상하며, 곡물·가공식품은 기존처럼 부패하지 않아요.</p>
  </div>;
}
