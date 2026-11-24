import type { ShipTypeDef } from './data';
import { retainedFraction, executeBuy, executeSell, shipBuyable, quoteBuy, quoteSell } from './market';
import { explainDestination, explainExemption, explainPolicy, explainSource } from '../classroom/reasons';
import { expectedSaleFactor, ftaExemption, lotTerms, scenarioPolicy, scenarioWave } from './policy';
import { evaluateRoute, legInfo, planStopBuy } from './routePlan';
import { invalidateLegTables } from './npc';
import { explainSurprise, makeExpectation } from './surprise';
import { deliverableQuantity, offerScriptedOrder, orderPurchasePlan, ORDER_RULES, warehouseDeliverableQuantity } from './orders';
import { settleOrderTrust, trustChangeText } from './trust';
import { consumeSpecialtySupply, quoteSpecialtyBuy, specialtyAvailable, specialtyById, specialtySaleUnit, SPECIALTY_RULES } from './specialties';
import { matchesProduct } from './products';
import { createWarehouse, lotQuantity, lotVolume, moveLots, storageCapacity, storedLots, warehouseMonthlyFee, warehouseOf, warehouseTransferLimit, WAREHOUSE_RULES } from './warehouse';
import { blockedPassages, chooseLeg, npcProfile, voyageWaypoints, type LegChoice } from './routing';
import { angleBetween, latLonToVec3, slerp, vec3ToLatLon, type LatLon } from '../core/sphere';
import type {
  CargoLot,
  ChronicleEntry,
  Command,
  EconomyContext,
  EconomyState,
  LedgerMonth,
  PlayerState,
  Ship,
  ShipRecord,
  SimEvent,
  TradeRoute,
} from './types';

export const PLAYER_ID = 'player';

export interface CommandResult {
  ok: boolean;
  /** 실패 이유(학생이 읽을 문장) */
  error?: string;
  events: SimEvent[];
}

// ---------------------------------------------------------------- 기본 도구

export function shipType(ctx: EconomyContext, typeId: string | undefined): ShipTypeDef {
  const t = ctx.data.shipTypes.find((s) => s.id === typeId);
  if (!t) throw new Error(`알 수 없는 선종: ${typeId}`);
  return t;
}

export function emptyLedger(month: number): LedgerMonth {
  return { month, sales: 0, purchases: 0, fuel: 0, portFees: 0, upkeep: 0, shipTrade: 0, spoiledCost: 0, tariffs: 0 };
}

export function createPlayer(ctx: EconomyContext): { player: PlayerState; ship: Ship } {
  const cfg = ctx.data.player;
  const type = shipType(ctx, cfg.startShipType);
  const { month: _m, ...zero } = emptyLedger(0);
  const player: PlayerState = {
    cityTrust: {},
    warehouse: createWarehouse(cfg.startCityId),
    name: cfg.companyName,
    cash: cfg.startingCash,
    arrears: 0,
    nextShipNo: 2,
    nextRouteNo: 1,
    routes: [],
    ledger: [emptyLedger(0)],
    lifetime: zero,
    startMonth: 0,
    chronicle: [],
    tradeCount: 0,
    reasonStats: {},
  };
  const ship: Ship = {
    id: 'p1',
    companyId: PLAYER_ID,
    typeId: type.id,
    name: `${type.name} 1호`,
    capacity: type.capacity,
    from: cfg.startCityId,
    to: cfg.startCityId,
    departedAt: 0,
    arrivesAt: 0,
    holding: true,
    cargo: [],
    record: { since: 0, distanceKm: 0, voyages: 0, sales: 0, purchases: 0, fuel: 0, fees: 0, upkeep: 0 },
  };
  return { player, ship };
}

/** 이번 달 장부(없으면 만든다) */
function ledgerNow(state: EconomyState): LedgerMonth {
  const ledger = state.player.ledger;
  let last = ledger[ledger.length - 1];
  if (!last || last.month !== state.month) {
    last = emptyLedger(state.month);
    ledger.push(last);
  }
  return last;
}

type LedgerKey = Exclude<keyof LedgerMonth, 'month'>;

/** 배 이력(없으면 만든다: 예전 저장의 배는 산 달을 알 수 없어 플레이어가 시작한 달로 둔다) */
export function shipRecord(ship: Ship, since = 0): ShipRecord {
  return (ship.record ??= { since, distanceKm: 0, voyages: 0, sales: 0, purchases: 0, fuel: 0, fees: 0, upkeep: 0 });
}

/** 배 이름 길이 한도 */
export const SHIP_NAME_MAX = 20;

function book(state: EconomyState, key: LedgerKey, amount: number): void {
  // 예전 저장의 장부에는 없는 항목(통과료)이 있어 없으면 0에서 시작한다
  const l = ledgerNow(state);
  l[key] = (l[key] ?? 0) + amount;
  state.player.lifetime[key] = (state.player.lifetime[key] ?? 0) + amount;
}

/** 돈이 들어오면 밀린 유지비부터 갚는다 */
function credit(state: EconomyState, amount: number): void {
  const p = state.player;
  const repay = Math.min(p.arrears, amount);
  p.arrears -= repay;
  state.sink += repay;
  p.cash += amount - repay;
}

/** 현금으로 낼 수 있을 때만 낸다(현금은 음수가 되지 않는다) */
function canPay(state: EconomyState, amount: number): boolean {
  return state.player.cash + 1e-6 >= amount;
}

export function cargoVolume(ctx: EconomyContext, ship: Ship): number {
  let v = 0;
  for (const lot of ship.cargo) v += lot.quantity * ctx.goodById[lot.goodId].volume;
  return v;
}

export function cargoOf(ship: Ship, goodId: string): number {
  let q = 0;
  for (const lot of ship.cargo) if (lot.goodId === goodId) q += lot.quantity;
  return q;
}

export function canEnter(ctx: EconomyContext, state: EconomyState, typeId: string | undefined, cityId: string): boolean {
  const initialLevel = ctx.portSize[cityId];
  if (!initialLevel) return false;
  return !typeId || shipType(ctx, typeId).size <= (state.portLevel[cityId] ?? initialLevel);
}

export function canCarry(ctx: EconomyContext, typeId: string | undefined, goodId: string): boolean {
  if (!typeId) return true;
  return shipType(ctx, typeId).cargoClasses.includes(ctx.goodById[goodId].cargoClass);
}

/** 항구에 서 있는(명령을 받을 수 있는) 플레이어 선박인가 */
export function isDocked(ship: Ship): boolean {
  return ship.from === ship.to && ship.holding === true;
}

export interface VoyageEstimate {
  distanceKm: number;
  months: number;
  fuel: number;
  /** 항해 기간 몫의 유지비 */
  upkeep: number;
  /** 운하·해협 통과료 합 */
  fees: number;
  /** 지나는 통과 지점 */
  passages: string[];
  /** 기본 항로가 아닌 길로 가는 까닭(우회·대기) */
  reasons: string[];
  /** 기본 항로의 거리(비교용) */
  baseDistanceKm: number;
  /** 실제로 고른 길 */
  leg: LegChoice | null;
  blockedReason?: 'range' | 'passage';
}

/**
 * 이 배가 from→to를 갈 때의 견적. state가 있으면 지금의 운하·해협 상태(봉쇄·통행 제한)를 따른다.
 * 출항(실제 비용 차감)·화면 견적·자동항로 평가가 모두 이 값을 쓴다.
 */
export function estimateVoyage(ctx: EconomyContext, typeId: string, from: string, to: string, state?: EconomyState): VoyageEstimate {
  const t = shipType(ctx, typeId);
  const leg = chooseLeg(ctx, state, from, to, t);
  if (!leg) {
    const unrestricted = chooseLeg(ctx, state, from, to, { ...t, rangeKm: undefined });
    const blockedReason = unrestricted ? 'range' : 'passage';
    const reason = unrestricted
      ? `${t.name}의 한 번 항해 한도는 ${t.rangeKm.toLocaleString('ko-KR')}km예요. 중간 항구를 거치거나 항속거리가 긴 배를 이용해요.`
      : '지금은 바닷길이 막혀 갈 수 없어요.';
    return { distanceKm: Infinity, months: Infinity, fuel: Infinity, upkeep: Infinity, fees: 0, passages: [], reasons: [reason], blockedReason, baseDistanceKm: ctx.distanceKm(from, to), leg: null };
  }
  return {
    distanceKm: leg.distanceKm,
    months: leg.months,
    fuel: leg.fuel,
    upkeep: leg.months * t.upkeepPerMonth,
    fees: leg.fees,
    passages: leg.passages,
    reasons: leg.reasons,
    baseDistanceKm: leg.baseDistanceKm,
    leg,
  };
}

/** 마지막 항구에서 첫 항구로 돌아오는 구간까지, 기항할 때마다 보급해서 검사한다. */
export function routeBlockReason(ctx: EconomyContext, state: EconomyState, typeId: string, route: Pick<TradeRoute, 'stops'>): string | undefined {
  for (const [k, stop] of route.stops.entries()) {
    if (!canEnter(ctx, state, typeId, stop.cityId)) return `${cityName(ctx, stop.cityId)} 항구는 이 배가 들어가기에 너무 작아요.`;
    if (route.stops.length < 2) continue;
    const next = route.stops[(k + 1) % route.stops.length].cityId;
    const v = estimateVoyage(ctx, typeId, stop.cityId, next, state);
    if (!v.leg) return `${cityName(ctx, stop.cityId)} → ${cityName(ctx, next)}: ${v.reasons.join(' ')}`;
  }
}

/** 고른 길로 항해 정보를 만든다(통과 지점마다 지날 시각과 통과료) */
export function voyageOf(leg: LegChoice, departedAt: number, arrivesAt: number, feeOf: (id: string) => number): NonNullable<Ship['voyage']> {
  return {
    distanceKm: leg.distanceKm,
    passages: [...leg.passages],
    avoid: [...leg.avoid],
    transits: leg.passages.map((id) => ({ id, at: departedAt + (leg.passageAt[id] ?? 0.5) * (arrivesAt - departedAt), fee: feeOf(id), paid: false })),
    note: leg.reasons.length ? leg.reasons.join(' ') : undefined,
  };
}

/** 사는 쪽에서 본 한 단위의 견적: 살 수 있는 최대량과 단가 */
export function playerBuyLimit(ctx: EconomyContext, state: EconomyState, ship: Ship, goodId: string, brand?: string, specialtyId?: string): number {
  const city = state.cities[ship.to];
  const g = ctx.goodById[goodId];
  if (!canCarry(ctx, ship.typeId, goodId)) return 0;
  const specialty = specialtyById(ctx, specialtyId);
  if (specialtyId && (!specialty || specialty.goodId !== goodId)) return 0;
  const room = (ship.capacity - cargoVolume(ctx, ship)) / g.volume;
  let q = Math.max(0, Math.min(room, specialty ? specialtyAvailable(ctx, state, city.id, specialty) : shipBuyable(ctx, state, city, goodId, brand)));
  // 현금 한도(항만비 포함)
  const fee = ctx.data.shipping.portFeePerUnit * g.volume;
  for (let k = 0; k < 30 && q > 1e-6; k++) {
    const cost = (specialty ? quoteSpecialtyBuy(ctx, state, city.id, specialty, q) : quoteBuy(ctx, city, goodId, q, state, brand)).total + fee * q;
    if (cost <= state.player.cash) break;
    q *= Math.max(0.5, (state.player.cash / cost) * 0.995);
  }
  return q < 1e-6 ? 0 : q;
}

function addLot(ship: Ship, lot: CargoLot): void {
  const same = ship.cargo.find(
    (l) => l.goodId === lot.goodId && l.specialtyId === lot.specialtyId && l.originCityId === lot.originCityId && l.originCountryId === lot.originCountryId && l.brandCountryId === lot.brandCountryId,
  );
  if (same) {
    const q = same.quantity + lot.quantity;
    same.unitCost = (same.unitCost * same.quantity + lot.unitCost * lot.quantity) / q;
    same.quantity = q;
  } else ship.cargo.push(lot);
}

/**
 * 이보다 적게 남은 짐은 "부스러기"로 본다: 팔 때 함께 내리고, 상하면 버린다.
 * (소수로 상한 짐을 일부만 팔면 0.01개 같은 부스러기가 남아, 짐칸이 빈 줄 모르는 일이 생겼다)
 */
export const CARGO_DUST = 0.05;

/** 화물에서 꺼낸다(먼저 실은 것부터). 꺼낸 묶음(원산지·상표별)을 돌려준다. 부스러기는 함께 꺼낸다. */
function cargoSelection(ship: Pick<Ship, 'cargo'>, goodId: string, quantity: number, specialtyId?: string | null): CargoLot[] {
  let left = quantity;
  const out: CargoLot[] = [];
  for (const lot of ship.cargo) {
    if (!matchesProduct(lot, goodId, specialtyId) || left <= 0) continue;
    let take = Math.min(lot.quantity, left);
    if (lot.quantity - take < CARGO_DUST) take = lot.quantity;
    left -= take;
    out.push({ ...lot, quantity: take });
  }
  return out;
}

// ---------------------------------------------------------------- 거래·항해

function doBuy(ctx: EconomyContext, state: EconomyState, ship: Ship, goodId: string, quantity: number, events: SimEvent[], brand?: string, specialtyId?: string): number {
  const cityId = ship.to;
  const specialty = specialtyById(ctx, specialtyId);
  const q = Math.min(quantity, playerBuyLimit(ctx, state, ship, goodId, brand, specialtyId));
  if (q <= 1e-6) return 0;
  const g = ctx.goodById[goodId];
  const buy = executeBuy(ctx, state.cities[cityId], goodId, q, state, specialty?.countryId ?? brand, specialty?.countryId);
  if (specialty) consumeSpecialtySupply(ctx, state, cityId, specialty, buy.quantity);
  const fee = ctx.data.shipping.portFeePerUnit * g.volume * buy.quantity;
  state.player.cash -= buy.total + fee;
  state.sink += fee;
  book(state, 'purchases', buy.total);
  book(state, 'portFees', fee);
  const rec = shipRecord(ship, state.player.startMonth);
  rec.purchases += buy.total;
  rec.fees += fee;
  // 창고 구성 비율대로 원산지·상표가 다른 묶음으로 실린다. 여기가 왜 쌌는지도 함께 적어 둔다
  const reason = specialty ? { category: 'industry' as const, text: `${ctx.countryNames[specialty.countryId]}의 대표 산업에서 선별한 특산품 ${specialty.name}입니다. ${g.name} 재고 중 일부만 특산품으로 공급하고, 해외에서는 품질을 인정해 웃돈과 최저 매입가를 보장해요.` } : explainSource(ctx, state, cityId, goodId);
  for (const part of buy.parts) {
    addLot(ship, {
      goodId,
      ...(specialty ? { specialtyId: specialty.id } : {}),
      quantity: part.quantity,
      originCityId: cityId,
      originCountryId: part.origin,
      brandCountryId: part.brand,
      unitCost: part.unitPrice + fee / buy.quantity,
      bought: { month: state.month, reason },
    });
  }
  events.push({ type: 'trade', specialtyId, month: state.month, shipId: ship.id, cityId, goodId, side: 'buy', quantity: buy.quantity, total: buy.total, cashAfter: state.player.cash });
  return buy.quantity;
}

/** 같은 품목은 한 주문의 물량 충격을 공유하고, FIFO 묶음별로 평판·관세·장부 원가를 나눈다. */
export function quoteCargoSale(ctx: EconomyContext, state: EconomyState, ship: Pick<Ship, 'to' | 'cargo'>, goodId: string, quantity: number, specialtyId?: string | null) {
  const city = state.cities[ship.to];
  const lots = cargoSelection(ship, goodId, quantity, specialtyId);
  const q = lots.reduce((sum, l) => sum + l.quantity, 0);
  const baseUnit = quoteSell(ctx, city, goodId, q).unitPrice;
  let total = 0, cost = 0, tariffTotal = 0, fees = 0;
  const parts = lots.map((lot) => {
    const terms = lotTerms(ctx, state, city.id, goodId, lot.originCountryId, lot.brandCountryId);
    const specialty = specialtySaleUnit(ctx, lot, city.countryId, baseUnit * (1 + terms.premium), terms.tariff, ctx.data.shipping.portFeePerUnit * ctx.goodById[goodId].volume);
    const gross = specialty.grossUnit * lot.quantity;
    const tariff = gross * terms.tariff;
    const paidFee = Math.min(ctx.data.shipping.portFeePerUnit * ctx.goodById[goodId].volume * lot.quantity, gross - tariff);
    total += gross - tariff - paidFee;
    cost += lot.unitCost * lot.quantity;
    tariffTotal += tariff;
    fees += paidFee;
    return { lot, terms, tariff, paidFee, ...specialty };
  });
  return { quantity: q, total, cost, fees, tariffTotal, baseUnit, unitPrice: q > 0 ? total / q : 0, parts };
}

function doSell(ctx: EconomyContext, state: EconomyState, ship: Ship, goodId: string, quantity: number, events: SimEvent[], specialtyId?: string | null): number {
  return sellInventory(ctx, state, ship, goodId, quantity, events, ship, undefined, specialtyId);
}

function sellInventory(ctx: EconomyContext, state: EconomyState, inventory: Pick<Ship, 'to' | 'cargo'>, goodId: string, quantity: number, events: SimEvent[], ship?: Ship, storage?: 'ambient' | 'cold', specialtyId?: string | null): number {
  const cityId = inventory.to;
  const order = quoteCargoSale(ctx, state, inventory, goodId, quantity, specialtyId);
  const q = order.quantity;
  if (q <= 1e-6 || state.cities[cityId].target[goodId] <= 0) return 0;
  const g = ctx.goodById[goodId];
  const city = state.cities[cityId];
  let total = 0;
  let cost = 0;
  let tariffs = 0;
  // 관세가 가장 높았던 묶음(연대기에 실제 관세율과 원산지를 적기 위해)
  let dutyRate = 0;
  let dutyOrigin = '';
  // 한꺼번에 팔아 값이 밀리는 비율(팔기 전 시장으로 잰다, 예상과 다를 때 까닭 설명용)
  const push = quoteSell(ctx, city, goodId, q).unitPrice / Math.max(1e-9, quoteSell(ctx, city, goodId, 1).unitPrice) - 1;
  const lots = order.parts.map((p) => p.lot);
  const held = inventory.cargo.filter((l) => matchesProduct(l, goodId, specialtyId));
  order.parts.forEach(({ lot }, i) => { held[i].quantity -= lot.quantity; });
  for (let i = inventory.cargo.length - 1; i >= 0; i--) if (inventory.cargo[i].quantity <= 1e-9) inventory.cargo.splice(i, 1);
  for (const { lot, terms, tariff, paidFee, grossUnit } of order.parts) {
    // 판매한 특산품은 일반 상품 수요·재고로 들어간다. 재매입으로 수출 보증을 복제하지 않는다.
    const sale = executeSell(ctx, city, goodId, lot.quantity, lot.originCountryId, lot.brandCountryId, state, order.baseUnit, grossUnit);
    city.treasury += tariff;
    city.annual.tariffs += tariff;
    credit(state, sale.total - tariff - paidFee);
    state.sink += paidFee;
    book(state, 'sales', sale.total);
    book(state, 'tariffs', tariff);
    book(state, 'portFees', paidFee);
    if (ship) {
      const rec = shipRecord(ship, state.player.startMonth);
      rec.sales += sale.total;
      rec.fees += tariff + paidFee;
    }
    total += sale.total;
    tariffs += tariff;
    cost += lot.unitCost * lot.quantity + paidFee;
    if (terms.tariff > dutyRate) {
      dutyRate = terms.tariff;
      dutyOrigin = lot.originCountryId;
    }
  }
  // 거래 연대기: 산 곳이 왜 쌌고 판 곳이 왜 비쌌는지
  const main = lots.reduce((a, b) => (b.quantity > a.quantity ? b : a), lots[0]);
  const destCountry = ctx.countryOfCity[cityId];
  const entry: ChronicleEntry = {
    specialtyId: lots.every((l) => l.specialtyId === main.specialtyId) ? main.specialtyId : undefined,
    month: state.month,
    ...(ship ? { shipId: ship.id } : { storage }),
    goodId,
    quantity: q,
    fromCityId: main.originCityId,
    toCityId: cityId,
    origins: [...new Set(lots.map((l) => l.originCountryId))],
    cost,
    revenue: total,
    tariff: tariffs,
    profit: total - tariffs - cost,
    sourceReason: main.bought?.reason ?? { category: 'market', text: `${cityName(ctx, main.originCityId)}에서 실은 짐이에요.` },
    destReason: order.parts.some((p) => p.minimumNet > 0) ? { category: 'industry', text: `${cityName(ctx, cityId)}에서 해외 특산품의 품질을 인정해 웃돈을 줘요. 시세가 낮아도 판매한 물량의 관세·하역비를 뺀 대금은 매입원가보다 최소 ${Math.round(SPECIALTY_RULES.minimumMargin * 100)}% 높아요. 운항·보관비와 부패 손실은 별도예요.` } : explainDestination(ctx, state, cityId, goodId, main.brandCountryId),
    policyReason:
      explainPolicy(ctx, dutyRate, destCountry, dutyOrigin) ??
      explainExemption(ctx, ftaExemption(ctx, state, destCountry, goodId, main.originCountryId), destCountry, main.originCountryId) ??
      undefined,
  };
  // 출발 때 예상과 크게 다르면 그 차이와 까닭
  const surprise = ship && explainSurprise(ctx, state, ship, cityId, goodId, q, (total - tariffs) / q, { lot: main, push });
  if (surprise) entry.surprise = surprise;
  recordTrade(ctx, state, entry);
  if (ship) events.push({ type: 'trade', specialtyId: entry.specialtyId, month: state.month, shipId: ship.id, cityId, goodId, side: 'sell', quantity: q, total, cashAfter: state.player.cash });
  else events.push({ type: 'notice', month: state.month, cityId, text: `회사 창고의 ${specialtyById(ctx, entry.specialtyId)?.name ?? g.name} ${Math.round(q * 100) / 100}개를 ${cityName(ctx, cityId)} 시장에 팔았어요.` });
  return q;
}

function recordTrade(ctx: EconomyContext, state: EconomyState, entry: ChronicleEntry): void {
  // 이유별 누적(리포트용, 연대기가 잘려도 남는다)
  const gname = specialtyById(ctx, entry.specialtyId)?.name ?? ctx.goodById[entry.goodId].name;
  const stat = (cat: string, text: string) => {
    const r = (state.player.reasonStats[cat] ??= { count: 0, examples: [] });
    r.count++;
    if (r.examples.length < 2 && !r.examples.includes(text)) r.examples.push(text);
  };
  stat(entry.sourceReason.category, `${gname}을(를) ${cityName(ctx, entry.fromCityId)}에서 샀어요 — ${entry.sourceReason.text}`);
  stat(entry.destReason.category, `${gname}을(를) ${cityName(ctx, entry.toCityId)}에 팔았어요 — ${entry.destReason.text}`);
  if (entry.policyReason) stat('policy', entry.policyReason.text);
  const chron = state.player.chronicle;
  chron.push(entry);
  if (chron.length > ctx.data.player.chronicleMax) chron.splice(0, chron.length - ctx.data.player.chronicleMax);
  state.player.tradeCount++;
}

/**
 * 출발시킨다. 연료비와 지날 운하·해협의 통과료를 낼 수 없으면 false(출항 자금, §9.2).
 * 연료비는 지금 내고, 통과료는 실제로 지날 때 한 번 낸다.
 */
function depart(ctx: EconomyContext, state: EconomyState, ship: Ship, to: string, at: number): boolean {
  const v = estimateVoyage(ctx, ship.typeId!, ship.to, to, state);
  if (!v.leg || !Number.isFinite(v.distanceKm) || !canPay(state, v.fuel + v.fees)) return false;
  state.player.cash -= v.fuel;
  state.sink += v.fuel;
  book(state, 'fuel', v.fuel);
  const rec = shipRecord(ship, state.player.startMonth);
  rec.fuel += v.fuel;
  rec.distanceKm += v.distanceKm;
  rec.voyages++;
  ship.from = ship.to;
  ship.to = to;
  ship.departedAt = at;
  ship.arrivesAt = at + v.months;
  ship.holding = false;
  const size = shipType(ctx, ship.typeId).size;
  ship.voyage = voyageOf(v.leg, at, ship.arrivesAt, (id) => ctx.passages[id]?.fee[size - 1] ?? 0);
  // 목적지에서 받을 것으로 보이는 값을 적어 둔다(도착해서 크게 다르면 까닭을 알려 준다)
  ship.expect = makeExpectation(ctx, state, ship, to, v.months, at);
  return true;
}

/** 통과 지점을 지난 배가 통과료를 낸다(한 번만). 현금이 모자라면 밀린 돈이 된다. */
export function payTransits(ctx: EconomyContext, state: EconomyState, until: number): void {
  for (const ship of state.ships) {
    const v = ship.voyage;
    if (!v) continue;
    for (const t of v.transits) {
      if (t.paid || t.at >= until) continue;
      t.paid = true;
      if (t.fee <= 0) continue;
      if (ship.companyId === PLAYER_ID) {
        const paid = Math.min(t.fee, state.player.cash);
        state.player.cash -= paid;
        state.player.arrears += t.fee - paid;
        state.sink += paid;
        book(state, 'passageFees', t.fee);
        shipRecord(ship, state.player.startMonth).fees += t.fee;
      } else {
        const c = state.companies.find((x) => x.id === ship.companyId);
        if (!c) continue;
        const paid = Math.min(t.fee, c.cash);
        c.cash -= paid;
        state.sink += paid;
      }
    }
  }
}

/** 지금 시각 배의 위치(항해 경로 위)와, 그 위치까지 지나온 경로 */
function positionNow(ctx: EconomyContext, ship: Ship, now: number): { pos: LatLon; done: LatLon[] } | null {
  const pts = voyageWaypoints(ctx, ship);
  if (!pts || pts.length === 0) return null;
  const span = ship.arrivesAt - ship.departedAt;
  const t = span > 0 ? Math.max(0, Math.min(1, (now - ship.departedAt) / span)) : 1;
  if (pts.length === 1) return { pos: pts[0], done: [pts[0]] };
  const vecs = pts.map((p) => latLonToVec3(p[0], p[1]));
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < vecs.length; i++) {
    lens.push(angleBetween(vecs[i - 1], vecs[i]));
    total += lens[i - 1];
  }
  let remain = t * total;
  for (let i = 0; i < lens.length; i++) {
    if (remain <= lens[i] || i === lens.length - 1) {
      const pos = vec3ToLatLon(slerp(vecs[i], vecs[i + 1], lens[i] > 0 ? Math.min(1, remain / lens[i]) : 0));
      return { pos, done: [...pts.slice(0, i + 1), pos] };
    }
    remain -= lens[i];
  }
  return { pos: pts[pts.length - 1], done: pts };
}

/**
 * 항해 중에 지날 운하·해협이 막히면(§8.3): 아직 그곳을 지나지 않은 배는 지금 위치에서 길을 다시 찾는다.
 *  - 순간이동하지 않는다: 새 길은 지금 위치에서 시작한다.
 *  - 이미 간 거리와 낸 비용은 그대로 두고, 늘어난 거리만큼 연료비를 더 낸다(줄면 돌려받지 않는다).
 *  - 막힌 곳의 통과료는 지나지 않았으니 내지 않는다. 새 길의 통과료는 지날 때 낸다.
 *  - 갈 길이 없으면 떠난 항구로 지나온 길을 되짚어 돌아간다.
 */
export function rerouteShips(ctx: EconomyContext, state: EconomyState, now: number, events: SimEvent[]): void {
  for (const ship of state.ships) {
    if (ship.from === ship.to || ship.holding || now >= ship.arrivesAt) continue;
    const v = ship.voyage;
    const passages = v?.passages ?? ctx.routeOptions(ship.from, ship.to)[0]?.passages ?? [];
    const size = ship.typeId ? shipType(ctx, ship.typeId).size : npcProfile(ctx).size;
    const blocked = blockedPassages(ctx, state, size);
    const ahead = passages.filter((id) => {
      const tr = v?.transits.find((t) => t.id === id);
      return blocked.includes(id) && !(tr && tr.at <= now);
    });
    if (ahead.length === 0) continue;
    const here = positionNow(ctx, ship, now);
    if (!here) continue;
    const pos = here.pos;
    const profile = ship.typeId ? shipType(ctx, ship.typeId) : null;
    const speed = profile?.speedKmPerMonth ?? ctx.data.npc.speedKmPerMonth;
    const fuelRate = profile?.fuelPer1000Km ?? npcProfile(ctx).fuelPer1000Km;
    const span = ship.arrivesAt - ship.departedAt;
    const total = v?.distanceKm ?? ctx.distanceKm(ship.from, ship.to);
    const travelled = span > 0 ? total * Math.max(0, Math.min(1, (now - ship.departedAt) / span)) : 0;
    const name = ship.name ?? ship.id;
    const pname = ahead.map((id) => ctx.passages[id]?.name ?? id).join('·');
    const next = ctx.routeFromPoint(pos[0], pos[1], ship.to, blocked);
    let path: LatLon[];
    let distanceKm: number;
    let newPassages: string[];
    let passageAt: Record<string, number> = {};
    let note: string;
    if (next) {
      path = [pos, ...next.waypoints];
      distanceKm = next.distanceKm;
      newPassages = next.passages;
      passageAt = next.passageAt;
      note = `${pname}이(가) 막혀 지금 자리에서 다른 길로 돌아가요.`;
    } else {
      // 지나온 길을 되짚어 떠난 항구로
      path = [...here.done].reverse();
      distanceKm = travelled;
      newPassages = [];
      note = `${pname}이(가) 막혀 갈 길이 없어 떠난 항구로 돌아가요.`;
      ship.to = ship.from;
    }
    const extra = Math.max(0, travelled + distanceKm - total);
    const extraFuel = (extra / 1000) * fuelRate;
    if (ship.companyId === PLAYER_ID) {
      const paid = Math.min(extraFuel, state.player.cash);
      state.player.cash -= paid;
      state.player.arrears += extraFuel - paid;
      state.sink += paid;
      if (extraFuel > 0) book(state, 'fuel', extraFuel);
      const rec = shipRecord(ship, state.player.startMonth);
      rec.fuel += extraFuel;
      rec.distanceKm += extra;
    } else {
      const c = state.companies.find((x) => x.id === ship.companyId);
      if (c) {
        const paid = Math.min(extraFuel, c.cash);
        c.cash -= paid;
        state.sink += paid;
      }
    }
    const months = distanceKm / speed + newPassages.reduce((s, id) => s + (ctx.passages[id]?.delayMonths ?? 0), 0);
    const kept = (v?.transits ?? []).filter((t) => t.at <= now);
    ship.departedAt = now;
    ship.arrivesAt = now + Math.max(0.01, months);
    ship.voyage = {
      distanceKm,
      passages: newPassages,
      avoid: [...blocked].sort(),
      transits: [
        ...kept,
        ...newPassages.map((id) => ({ id, at: now + (passageAt[id] ?? 0.5) * (ship.arrivesAt - now), fee: ctx.passages[id]?.fee[size - 1] ?? 0, paid: false })),
      ],
      path,
      note,
    };
    // 지도에서 지금 위치부터 그리도록 출발지를 "바다 위"로 두지 않고, 경로(path)가 위치를 정한다
    if (ship.companyId === PLAYER_ID) {
      events.push({ type: 'passage', month: state.month, passageId: ahead[0], kind: 'reroute', shipId: ship.id, text: `${name}: ${note}` });
    }
  }
}

function clampTime(state: EconomyState, at: number | undefined): number {
  const t = at ?? state.month;
  return Math.min(state.month + 0.999, Math.max(state.month, t));
}

function cityName(ctx: EconomyContext, id: string): string {
  return ctx.cityNames[id] ?? id;
}

// ---------------------------------------------------------------- 명령

/**
 * 명령 하나를 처리한다. state를 그 자리에서 바꾸므로, 실패해도 안전하도록 검사를 먼저 끝낸 뒤 바꾼다.
 * (UI는 복제본에 적용하고, stepMonth는 자기 복제본에 적용한다.)
 */
export function applyCommand(ctx: EconomyContext, state: EconomyState, cmd: Command): CommandResult {
  const events: SimEvent[] = [];
  const fail = (error: string): CommandResult => ({ ok: false, error, events });
  const ok = (): CommandResult => ({ ok: true, events });
  const p = state.player;
  const findShip = (id: string) => state.ships.find((s) => s.id === id && s.companyId === PLAYER_ID);

  switch (cmd.type) {
    case 'upgradeWarehouse': {
      const warehouse = warehouseOf(ctx, state);
      if (warehouse.coldCapacity > 0) return fail('이미 냉장창고가 있어요.');
      if (!canPay(state, WAREHOUSE_RULES.coldBuildCost)) return fail('냉장창고 증설 비용이 모자라요.');
      p.warehouse = warehouse;
      warehouse.coldCapacity = WAREHOUSE_RULES.coldCapacity;
      p.cash -= WAREHOUSE_RULES.coldBuildCost;
      state.sink += WAREHOUSE_RULES.coldBuildCost;
      book(state, 'warehouseInvestment', WAREHOUSE_RULES.coldBuildCost);
      events.push({ type: 'notice', month: state.month, cityId: warehouse.cityId, text: '냉장창고를 증설했어요. 일반 창고의 물건은 냉장 구역으로 옮겨야 부패를 막을 수 있어요.' });
      return ok();
    }

    case 'warehouseTransfer': {
      const ship = findShip(cmd.shipId);
      if (!ship) return fail('그런 배가 없어요.');
      if (!ctx.goodById[cmd.goodId]) return fail('그런 상품이 없어요.');
      if (!(cmd.quantity > 0) || !Number.isFinite(cmd.quantity)) return fail('옮길 수량을 확인해 주세요.');
      const warehouse = warehouseOf(ctx, state);
      if (!isDocked(ship) || ship.to !== warehouse.cityId) return fail('배가 거점 항구에 정박해야 창고와 짐을 옮길 수 있어요.');
      if (ship.routeId) return fail('정기 항로에서 배를 뺀 뒤 창고를 이용해 주세요.');
      const q = Math.min(cmd.quantity, warehouseTransferLimit(ctx, state, ship, cmd.goodId, cmd.direction, cmd.storage, cmd.specialtyId));
      if (q <= 1e-9) return fail('옮길 물건·빈자리·배의 화물 종류를 확인해 주세요. 냉장 구역은 증설 후 이용할 수 있어요.');
      p.warehouse = warehouse;
      const stored = storedLots(warehouse, cmd.storage);
      moveLots(cmd.direction === 'store' ? ship.cargo : stored, cmd.direction === 'store' ? stored : ship.cargo, cmd.goodId, q, cmd.specialtyId);
      events.push({ type: 'notice', month: state.month, shipId: ship.id, cityId: warehouse.cityId, text: `${specialtyById(ctx, cmd.specialtyId)?.name ?? ctx.goodById[cmd.goodId].name} ${Math.round(q * 100) / 100}개를 ${cmd.direction === 'store' ? '회사 창고에 보관했어요' : `${ship.name}에 다시 실었어요`}. 사고판 거래가 아니므로 원가는 그대로예요.` });
      return ok();
    }

    case 'warehouseMove': {
      const warehouse = warehouseOf(ctx, state), g = ctx.goodById[cmd.goodId];
      if (!g || !(cmd.quantity > 0) || !Number.isFinite(cmd.quantity)) return fail('옮길 상품과 수량을 확인해 주세요.');
      const to = storedLots(warehouse, cmd.to), from = storedLots(warehouse, cmd.to === 'cold' ? 'ambient' : 'cold');
      const q = Math.max(0, Math.min(cmd.quantity, lotQuantity(from, g.id, cmd.specialtyId), (storageCapacity(warehouse, cmd.to) - lotVolume(ctx, to)) / g.volume));
      if (q <= 1e-9) return fail('옮길 물건이나 창고의 빈자리가 없어요.');
      p.warehouse = warehouse;
      moveLots(from, to, g.id, q, cmd.specialtyId);
      events.push({ type: 'notice', month: state.month, cityId: warehouse.cityId, text: `${specialtyById(ctx, cmd.specialtyId)?.name ?? g.name} ${Math.round(q * 100) / 100}개를 ${cmd.to === 'cold' ? '냉장' : '일반'} 구역으로 옮겼어요.` });
      return ok();
    }

    case 'warehouseSell': {
      const warehouse = warehouseOf(ctx, state), g = ctx.goodById[cmd.goodId];
      if (!g || !(cmd.quantity > 0) || !Number.isFinite(cmd.quantity)) return fail('팔 상품과 수량을 확인해 주세요.');
      const cargo = storedLots(warehouse, cmd.storage);
      if (lotQuantity(cargo, g.id, cmd.specialtyId) <= 1e-9) return fail('이 구역에 그 상품이 없어요.');
      if (state.cities[warehouse.cityId].target[g.id] <= 0) return fail('거점 시장에서 이 상품을 사는 사람이 없어요.');
      p.warehouse = warehouse;
      sellInventory(ctx, state, { to: warehouse.cityId, cargo }, g.id, cmd.quantity, events, undefined, cmd.storage, cmd.specialtyId);
      return ok();
    }

    case 'acceptOrder':
    case 'declineOrder':
    case 'cancelOrder': {
      const order = p.orders?.items.find((o) => o.id === cmd.orderId);
      if (!order) return fail('그런 발주가 없어요.');
      if (cmd.type === 'cancelOrder') {
        if (order.status !== 'accepted' || state.month >= order.deadlineMonth) return fail('진행 중인 발주만 취소할 수 있어요.');
        order.status = 'cancelled';
        order.closedMonth = state.month;
        settleOrderTrust(state, order);
      } else {
        if (order.status !== 'offered' || state.month >= order.offerExpiresMonth || state.month >= order.deadlineMonth) return fail('이 발주는 더 이상 받을 수 없어요.');
        if (cmd.type === 'acceptOrder') {
          if (p.orders!.items.filter((o) => o.status === 'accepted').length >= ORDER_RULES.maxAccepted) return fail(`발주는 한 번에 ${ORDER_RULES.maxAccepted}개까지 받을 수 있어요.`);
          order.status = 'accepted';
          order.acceptedMonth = state.month;
        } else {
          order.status = 'declined';
          order.closedMonth = state.month;
        }
      }
      events.push({ type: 'order', month: state.month, orderId: order.id, kind: order.status, text: `${cityName(ctx, order.cityId)}의 ${ctx.goodById[order.goodId].name} 발주를 ${order.status === 'accepted' ? '받았어요. 기한 안에 다른 항구에서 들여온 물건을 납품하세요.' : order.status === 'declined' ? '받지 않았어요. 신뢰도는 그대로예요.' : `취소했어요. 위약금은 없어요. ${trustChangeText(order.trustChange ?? 0)}.`}` });
      return ok();
    }

    case 'deliverOrder':
    case 'deliverWarehouseOrder': {
      const order = p.orders?.items.find((o) => o.id === cmd.orderId);
      if (!order || order.status !== 'accepted') return fail('먼저 진행할 발주를 받아 주세요.');
      if (state.month >= order.deadlineMonth) return fail('납품 기한이 지났어요.');
      if (!(cmd.quantity > 0) || !Number.isFinite(cmd.quantity)) return fail('납품 수량을 확인해 주세요.');
      const ship = cmd.type === 'deliverOrder' ? findShip(cmd.shipId) : undefined;
      if (cmd.type === 'deliverOrder' && !ship) return fail('그런 배가 없어요.');
      const storage = cmd.type === 'deliverWarehouseOrder' ? cmd.storage : undefined;
      const q = Math.min(cmd.quantity, cmd.type === 'deliverWarehouseOrder' ? warehouseDeliverableQuantity(state, order, cmd.storage) : deliverableQuantity(state, ship!, order));
      if (q <= 1e-9) return fail('발주 항구의 수동 운항 배나 회사 창고에, 다른 항구에서 들여온 해당 상품이 있어야 해요.');
      const cargo = ship ? ship.cargo : storedLots(p.warehouse!, storage!);
      const city = state.cities[order.cityId];
      let left = q, cost = 0;
      const lots: CargoLot[] = [];
      for (const lot of cargo) {
        if (left <= 0 || lot.goodId !== order.goodId || lot.originCityId === order.cityId) continue;
        const take = Math.min(left, lot.quantity);
        lots.push({ ...lot, quantity: take });
        executeSell(ctx, city, order.goodId, take, lot.originCountryId, lot.brandCountryId, state, order.unitPrice, order.unitPrice);
        cost += take * lot.unitCost;
        lot.quantity -= take;
        left -= take;
      }
      for (let i = cargo.length - 1; i >= 0; i--) if (cargo[i].quantity <= 1e-9) cargo.splice(i, 1);
      const total = q * order.unitPrice;
      credit(state, total);
      book(state, 'sales', total);
      if (ship) shipRecord(ship, p.startMonth).sales += total;
      order.delivered = Math.min(order.quantity, order.delivered + q);
      if (order.quantity - order.delivered <= 1e-9) {
        order.status = 'completed';
        order.closedMonth = state.month;
        settleOrderTrust(state, order);
      }
      const main = lots.reduce((a, b) => a.quantity >= b.quantity ? a : b);
      recordTrade(ctx, state, {
        orderId: order.id, month: state.month, shipId: ship?.id, storage, goodId: order.goodId,
        quantity: q, fromCityId: main.originCityId, toCityId: city.id,
        origins: [...new Set(lots.map((l) => l.originCountryId))], cost, revenue: total, tariff: 0, profit: total - cost,
        sourceReason: main.bought?.reason ?? { category: 'market', text: `${cityName(ctx, main.originCityId)}에서 실어 왔어요.` },
        destReason: order.reason,
      });
      events.push({ type: 'order', month: state.month, orderId: order.id, kind: order.status === 'completed' ? 'completed' : 'delivered', text: `${cityName(ctx, city.id)}에 ${ctx.goodById[order.goodId].name} ${Math.round(q * 10) / 10}개를 납품하고 ${Math.round(total).toLocaleString('ko-KR')}을(를) 받았어요.${order.status === 'completed' ? ` 발주 완료! ${trustChangeText(order.trustChange ?? 0)}.` : ''}` });
      return ok();
    }

    case 'addModifier': {
      state.modifiers.push({ ...cmd.modifier });
      events.push({
        type: 'modifier', month: state.month, cityId: cmd.modifier.cityId, goodId: cmd.modifier.goodId,
        factor: cmd.modifier.factor, reason: cmd.modifier.reason,
      });
      return ok();
    }

    case 'tutorialOrder': {
      offerScriptedOrder(ctx, state, events);
      return ok();
    }

    case 'fillOrder': {
      const ship = findShip(cmd.shipId);
      const order = state.player.orders?.items.find((o) => o.id === cmd.orderId);
      if (!ship || !order) return fail('배와 발주를 확인해 주세요.');
      const plan = orderPurchasePlan(ctx, state, ship, order);
      if (plan.quantity <= 0) return fail(plan.reason);
      const got = doBuy(ctx, state, ship, order.goodId, plan.quantity, events);
      return got > 0 ? ok() : fail('지금은 발주 품목을 살 수 없어요.');
    }

    case 'trade': {
      const ship = findShip(cmd.shipId);
      if (!ship) return fail('그런 배가 없어요.');
      if (!isDocked(ship)) return fail('배가 항구에 멈춰 있을 때만 사고팔 수 있어요.');
      if (ship.routeId) return fail('정기 항로를 도는 배는 자동으로 거래해요. 직접 거래하려면 항로에서 빼 주세요.');
      const g = ctx.goodById[cmd.goodId];
      if (!g) return fail('그런 상품이 없어요.');
      if (!(cmd.quantity > 0) || !Number.isFinite(cmd.quantity)) return fail('수량을 확인해 주세요.');
      if (cmd.side === 'buy') {
        if (cmd.specialtyId) {
          const specialty = specialtyById(ctx, cmd.specialtyId);
          if (!specialty || specialty.goodId !== g.id || (cmd.brandCountryId && cmd.brandCountryId !== specialty.countryId)) return fail('상품에 맞는 특산품을 골라 주세요.');
          if (specialtyAvailable(ctx, state, ship.to, specialty) <= 1e-6) return fail('이 항구에서 살 수 있는 특산품 물량이 없어요. 다음 달 생산분을 기다려 주세요.');
        }
        if (!canCarry(ctx, ship.typeId, g.id)) return fail(`${shipType(ctx, ship.typeId).name}에는 ${g.name}을(를) 실을 수 없어요.`);
        if (shipBuyable(ctx, state, state.cities[ship.to], g.id) <= 1e-6) return fail(`${cityName(ctx, ship.to)}에는 팔 수 있는 ${g.name}이(가) 없어요.`);
        if (cargoVolume(ctx, ship) + g.volume * 1e-3 > ship.capacity) return fail('배가 꽉 찼어요.');
        const got = doBuy(ctx, state, ship, g.id, cmd.quantity, events, cmd.brandCountryId, cmd.specialtyId ?? undefined);
        return got > 0 ? ok() : fail('돈이 모자라요.');
      }
      if (lotQuantity(ship.cargo, g.id, cmd.specialtyId) <= 1e-6) return fail(`배에 ${g.name}이(가) 없어요.`);
      if (state.cities[ship.to].target[g.id] <= 0) return fail(`${cityName(ctx, ship.to)}에서는 ${g.name}을(를) 사는 사람이 없어요.`);
      doSell(ctx, state, ship, g.id, cmd.quantity, events, cmd.specialtyId);
      return ok();
    }

    case 'sail': {
      const ship = findShip(cmd.shipId);
      if (!ship) return fail('그런 배가 없어요.');
      if (!isDocked(ship)) return fail('이미 항해 중이에요.');
      if (ship.routeId) return fail('정기 항로를 도는 배예요. 직접 보내려면 항로에서 빼 주세요.');
      if (cmd.to === ship.to) return fail('이미 그 항구에 있어요.');
      if (!ctx.portIds.includes(cmd.to)) {
        return fail(ctx.cityIds.includes(cmd.to) ? `${cityName(ctx, cmd.to)}은(는) 바다가 없는 내륙 경제권이라 배가 갈 수 없어요. 관문 항구를 이용해요.` : '그런 항구가 없어요.');
      }
      if (!canEnter(ctx, state, ship.typeId, cmd.to)) return fail(`${cityName(ctx, cmd.to)} 항구는 이 배가 들어가기에 너무 작아요.`);
      const v = estimateVoyage(ctx, ship.typeId!, ship.to, cmd.to, state);
      if (!v.leg) return fail(v.reasons.join(' '));
      if (!canPay(state, v.fuel + v.fees)) {
        return fail(
          v.fees > 0
            ? `연료비 ${Math.round(v.fuel).toLocaleString('ko-KR')}와 통과료 ${Math.round(v.fees).toLocaleString('ko-KR')}을(를) 낼 돈이 모자라요.`
            : `연료비 ${Math.round(v.fuel).toLocaleString('ko-KR')}이(가) 모자라요.`,
        );
      }
      depart(ctx, state, ship, cmd.to, clampTime(state, cmd.at));
      return ok();
    }

    case 'buyShip': {
      const type = ctx.data.shipTypes.find((t) => t.id === cmd.typeId);
      if (!type) return fail('그런 배는 팔지 않아요.');
      const home = ctx.data.player.startCityId;
      if (!canEnter(ctx, state, type.id, home)) return fail(`근거지 ${cityName(ctx, home)} 항구는 ${type.name}이(가) 들어오기에 너무 작아요.`);
      if (!canPay(state, type.price)) return fail(`${type.name}은(는) ${type.price.toLocaleString('ko-KR')}이에요. 돈이 모자라요.`);
      p.cash -= type.price;
      state.sink += type.price;
      book(state, 'shipTrade', -type.price);
      const no = p.nextShipNo++;
      state.ships.push({
        id: `p${no}`,
        companyId: PLAYER_ID,
        typeId: type.id,
        name: `${type.name} ${no}호`,
        capacity: type.capacity,
        from: home,
        to: home,
        departedAt: state.month,
        arrivesAt: state.month,
        holding: true,
        cargo: [],
        record: { since: state.month, distanceKm: 0, voyages: 0, sales: 0, purchases: 0, fuel: 0, fees: 0, upkeep: 0 },
      });
      return ok();
    }

    case 'renameShip': {
      const ship = findShip(cmd.shipId);
      if (!ship) return fail('그런 배가 없어요.');
      const name = cmd.name.replace(/\s+/g, ' ').trim();
      if (!name) return fail('이름을 적어 주세요.');
      if (name.length > SHIP_NAME_MAX) return fail(`이름은 ${SHIP_NAME_MAX}자까지 쓸 수 있어요.`);
      ship.name = name;
      return ok();
    }

    case 'sellShip': {
      const ship = findShip(cmd.shipId);
      if (!ship) return fail('그런 배가 없어요.');
      if (!isDocked(ship)) return fail('항구에 멈춘 배만 팔 수 있어요.');
      if (ship.cargo.length > 0) return fail('짐을 먼저 내려 주세요.');
      const type = shipType(ctx, ship.typeId);
      const value = type.price * type.resaleShare;
      state.ships = state.ships.filter((s) => s !== ship);
      state.sink -= value;
      credit(state, value);
      book(state, 'shipTrade', value);
      return ok();
    }

    case 'saveRoute': {
      const r = cmd.route;
      if (r.stops.length < 2) return fail('기항지가 두 곳 이상이어야 해요.');
      for (const stop of r.stops) {
        if (!ctx.portIds.includes(stop.cityId)) return fail('없는 항구가 들어 있어요.');
        for (const b of stop.buy) {
          if (!ctx.goodById[b.goodId]) return fail('없는 상품이 들어 있어요.');
          if (!(b.maxQuantity > 0)) return fail('살 수량은 0보다 커야 해요.');
        }
        for (const id of stop.sell) if (!ctx.goodById[id]) return fail('없는 상품이 들어 있어요.');
      }
      for (let k = 0; k < r.stops.length; k++) {
        if (r.stops[k].cityId === r.stops[(k + 1) % r.stops.length].cityId) return fail('같은 항구를 연달아 넣을 수 없어요.');
      }
      if (!(r.minMargin >= 0) || !(r.cashReserve >= 0)) return fail('조건 값을 확인해 주세요.');
      const route: TradeRoute = {
        id: r.id ?? `r${p.nextRouteNo++}`,
        name: r.name.trim() || `정기 항로 ${p.nextRouteNo - 1}`,
        stops: structuredClone(r.stops),
        minMargin: r.minMargin,
        cashReserve: r.cashReserve,
      };
      for (const s of state.ships.filter((s) => s.routeId === route.id)) {
        const reason = routeBlockReason(ctx, state, s.typeId!, route);
        if (reason) return fail(`${s.name}: ${reason}`);
      }
      const idx = p.routes.findIndex((x) => x.id === route.id);
      if (idx >= 0) p.routes[idx] = route;
      else p.routes.push(route);
      for (const s of state.ships) if (s.routeId === route.id && (s.routeStop ?? 0) >= route.stops.length) s.routeStop = 0;
      return ok();
    }

    case 'deleteRoute': {
      if (!p.routes.some((r) => r.id === cmd.routeId)) return fail('그런 항로가 없어요.');
      p.routes = p.routes.filter((r) => r.id !== cmd.routeId);
      for (const s of state.ships) {
        if (s.routeId === cmd.routeId) {
          s.routeId = undefined;
          s.routeStop = undefined;
          s.routeWaiting = undefined;
          s.routeWait = undefined;
        }
      }
      return ok();
    }

    case 'assignRoute': {
      const ship = findShip(cmd.shipId);
      if (!ship) return fail('그런 배가 없어요.');
      if (cmd.routeId === null) {
        // 지금 가던 길은 마저 가고, 도착하면 멈춰 기다린다
        ship.routeId = undefined;
        ship.routeStop = undefined;
        ship.routeWaiting = undefined;
        ship.routeWait = undefined;
        return ok();
      }
      const route = p.routes.find((r) => r.id === cmd.routeId);
      if (!route) return fail('그런 항로가 없어요.');
      const blocked = routeBlockReason(ctx, state, ship.typeId!, route);
      if (blocked) return fail(blocked);
      if (!route.stops.some((st) => st.cityId === ship.to)) {
        const first = estimateVoyage(ctx, ship.typeId!, ship.to, route.stops[0].cityId, state);
        if (!first.leg) return fail(first.reasons.join(' '));
      }
      ship.routeId = route.id;
      ship.routeWaiting = undefined;
      ship.routeWait = undefined;
      const here = route.stops.findIndex((st) => st.cityId === ship.to);
      if (isDocked(ship)) {
        // 기항지에 서 있으면 바로 그 항구 일부터, 아니면 첫 기항지로 간다
        ship.routeStop = here >= 0 ? here : 0;
        ship.holding = false;
        const at = clampTime(state, cmd.at);
        ship.departedAt = at;
        ship.arrivesAt = at;
        if (here < 0) {
          ship.to = ship.from;
          if (!depart(ctx, state, ship, route.stops[0].cityId, at)) {
            ship.holding = true;
            ship.routeId = undefined;
            ship.routeStop = undefined;
            return fail('첫 기항지까지 갈 연료비가 모자라요.');
          }
        }
      } else {
        // 항해 중이면 도착한 항구가 기항지일 때 그 일부터, 아니면 첫 기항지로
        ship.routeStop = here >= 0 ? here : 0;
      }
      return ok();
    }

    case 'addPolicy': {
      if (cmd.policy.countries.length === 0 || cmd.policy.endMonth <= cmd.policy.startMonth) return fail('정책 내용을 확인해 주세요.');
      scenarioPolicy(ctx, state, events, cmd.policy);
      return ok();
    }

    case 'addCultureWave': {
      if (cmd.wave.countries.length === 0 || cmd.wave.endMonth <= cmd.wave.startMonth) return fail('유행 내용을 확인해 주세요.');
      scenarioWave(ctx, state, events, cmd.wave);
      return ok();
    }

    case 'setPassage': {
      const p = ctx.passages[cmd.passageId];
      if (!p) return fail('그런 운하·해협이 없어요.');
      const all = (state.passages ??= {});
      const max = cmd.maxShipSize === null ? undefined : (cmd.maxShipSize ?? all[p.id]?.maxShipSize);
      if (!cmd.closed && max === undefined) delete all[p.id];
      else all[p.id] = { closed: cmd.closed, maxShipSize: max, reason: cmd.reason, since: state.month };
      const kind = cmd.closed ? 'closed' : max !== undefined ? 'restricted' : 'opened';
      const text =
        kind === 'closed'
          ? `${p.name}이(가) 막혔어요: ${cmd.reason}`
          : kind === 'restricted'
            ? `${p.name}은(는) 이제 크기 ${max} 이하의 배만 지날 수 있어요: ${cmd.reason}`
            : `${p.name}이(가) 다시 열렸어요.`;
      events.push({ type: 'passage', month: state.month, passageId: p.id, kind, text });
      invalidateLegTables(state);
      // 이미 그 길로 가던 배는 지금 위치에서 다시 길을 찾는다
      rerouteShips(ctx, state, clampTime(state, cmd.at), events);
      return ok();
    }
  }
}

// ---------------------------------------------------------------- 도착·자동항로·월 비용

/** 항해 중 상한 화물을 버린다 */
function spoil(ctx: EconomyContext, state: EconomyState, ship: Ship): { goodId: string; quantity: number }[] {
  if (shipType(ctx, ship.typeId).refrigerated) return [];
  const months = Math.max(0, ship.arrivesAt - ship.departedAt);
  const lost: { goodId: string; quantity: number }[] = [];
  for (const lot of ship.cargo) {
    if (ctx.goodById[lot.goodId].cargoClass !== 'perishable') continue;
    let q = lot.quantity * (1 - retainedFraction(ctx, ctx.goodById[lot.goodId], months));
    if (lot.quantity - q < CARGO_DUST) q = lot.quantity; // 부스러기만 남으면 통째로 버린다
    if (q <= 1e-9) continue;
    lot.quantity -= q;
    state.spoiled[lot.goodId] = (state.spoiled[lot.goodId] ?? 0) + q;
    book(state, 'spoiledCost', q * lot.unitCost);
    lost.push({ goodId: lot.goodId, quantity: q });
  }
  ship.cargo = ship.cargo.filter((l) => l.quantity > 1e-9);
  return lost;
}

function runRouteStop(ctx: EconomyContext, state: EconomyState, ship: Ship, route: TradeRoute, now: number, events: SimEvent[]): void {
  const k = ship.routeStop ?? 0;
  const stop = route.stops[k];
  const city = state.cities[stop.cityId];
  const month = state.month;

  // 1) 팔기
  for (const goodId of stop.sell) {
    const have = cargoOf(ship, goodId);
    if (have <= 1e-6) continue;
    if (city.target[goodId] <= 0) {
      events.push({ type: 'notice', month, shipId: ship.id, cityId: stop.cityId, text: `${ship.name}: ${cityName(ctx, stop.cityId)}에서는 ${ctx.goodById[goodId].name}을(를) 사지 않아 그대로 싣고 갑니다.` });
      continue;
    }
    doSell(ctx, state, ship, goodId, have, events);
  }

  // 예전 저장의 장거리 항로와 봉쇄로 길어진 항로도 새 화물을 사기 전에 멈춘다.
  const blocked = routeBlockReason(ctx, state, ship.typeId!, route);
  if (blocked) {
    waitAtStop(ship, k, now, { reason: 'blocked', since: ship.routeWait?.reason === 'blocked' ? ship.routeWait.since : now, detail: blocked });
    return;
  }
  // 새로 매입하기 전에 한 바퀴 전체의 연료·통과료를 회수할 수 있는지 확인한다.
  // 이 항로의 다른 기항지에서 팔 짐(반 개 이상)이 있어야 "실어 나르는 중"이다.
  // 부스러기나 이 항로에서 팔지 않는 짐만 있으면 빈 배와 같다(그 짐 때문에 헛되이 돌지 않는다)
  const delivering = route.stops.some((st, i) => i !== k && st.sell.some((id) =>
    state.cities[st.cityId].target[id] > 0 && cargoOf(ship, id) >= 0.5,
  ));
  if (!delivering) {
    const ev = evaluateRoute(ctx, state, route, ship.typeId!, { startStop: k, cash: state.player.cash, except: ship });
    if (ev.contribution <= 0) {
      if (!ship.routeWaiting) {
        events.push({
          type: 'notice', month, shipId: ship.id, cityId: stop.cityId,
          text:
            `${ship.name}: 지금은 이 항로를 돌면 연료비만큼도 벌지 못해요(한 바퀴 예상 ${Math.round(ev.contribution).toLocaleString('ko-KR')}). ` +
            `이번에는 짐을 사지 않았어요. ${cityName(ctx, stop.cityId)}에서 기다렸다가 다달이 다시 따져 봐요.`,
        });
      }
      waitAtStop(ship, k, now, { reason: 'profit', since: ship.routeWait?.reason === 'profit' ? ship.routeWait.since : now, estimate: ev.contribution });
      return;
    }
  }

  // 2) 사기: 도착 때의 값·경쟁 선박·관세·상함·항만비·연료·유지비(짐칸 몫)까지 따져 남고, 조건(최소 이익률)을 넘을 때만
  //    (지난번과 같은 이유로 또 사지 않을 때는 알림을 되풀이하지 않는다: 기다리는 동안 다달이 쌓이지 않게)
  const quiet = ship.routeWaiting === true;
  // 다음 기항지까지 갈 연료비·통과료는 남겨 두고 산다(물건을 사고 나서 출항 자금이 모자라지 않게)
  const nextLeg = legInfo(ctx, ship.typeId!, stop.cityId, route.stops[(k + 1) % route.stops.length].cityId, state);
  const legCost = Number.isFinite(nextLeg.fuel) ? nextLeg.fuel + nextLeg.fees : 0;
  for (const item of stop.buy) {
    const g = ctx.goodById[item.goodId];
    const budget = state.player.cash - route.cashReserve - legCost;
    const room = ship.capacity - cargoVolume(ctx, ship);
    const plan = planStopBuy(ctx, state, ship.typeId!, route, k, item, room, budget, ship);
    if (plan.reason === 'noSeller') {
      if (!quiet) events.push({ type: 'notice', month, shipId: ship.id, text: `${ship.name}: ${g.name}을(를) 팔 기항지가 없어 사지 않았어요.` });
      continue;
    }
    if (plan.reason === 'noMoney' || (budget <= 0 && plan.reason !== 'noRoom')) {
      if (!quiet) events.push({ type: 'notice', month, shipId: ship.id, text: `${ship.name}: 남겨 둘 현금(${route.cashReserve.toLocaleString('ko-KR')}) 때문에 ${g.name}을(를) 사지 않았어요.` });
      continue;
    }
    if (plan.reason === 'noRoom') continue;
    if (plan.reason === 'margin') {
      const e = plan.estimate;
      if (!quiet) {
        events.push({
          type: 'notice', month, shipId: ship.id, cityId: stop.cityId,
          text:
            `${ship.name}: ${cityName(ctx, stop.cityId)}의 ${g.name}은(는) 도착할 때 값과 운항비까지 따지면 ` +
            `${e.gain >= 0 ? `이익률 ${Math.round(e.margin * 100)}%` : `${Math.round(-e.gain).toLocaleString('ko-KR')}만큼 밑져`}라 사지 않았어요(기준 ${Math.round(route.minMargin * 100)}%).`,
        });
      }
      continue;
    }
    doBuy(ctx, state, ship, item.goodId, plan.estimate.quantity, events, item.brandCountryId);
  }

  // 3) 다음 기항지로. 짐이 없으면 빈 배로 가는 셈이니, 한 바퀴 돌며 벌 돈이 연료비를 넘을 때만 간다
  const next = (k + 1) % route.stops.length;
  const at = now + ctx.data.npc.portTimeMonths;
  ship.routeStop = next;
  if (!depart(ctx, state, ship, route.stops[next].cityId, at)) {
    events.push({ type: 'notice', month, shipId: ship.id, text: `${ship.name}: 연료비가 모자라 ${cityName(ctx, stop.cityId)}에서 한 달 기다립니다.` });
    waitAtStop(ship, k, now, { reason: 'fuel', since: ship.routeWait?.reason === 'fuel' ? ship.routeWait.since : now });
    return;
  }
  ship.routeWait = undefined;
  if (ship.routeWaiting) {
    ship.routeWaiting = undefined;
    events.push({ type: 'notice', month, shipId: ship.id, text: `${ship.name}: 다시 남는 거래가 생겨 ${cityName(ctx, route.stops[next].cityId)}(으)로 출발해요.` });
  }
}

/** 정기 항로의 배가 이 기항지에 서서 한 달 뒤 다시 따져 본다 */
function waitAtStop(ship: Ship, k: number, now: number, wait: NonNullable<Ship['routeWait']>): void {
  const unprofitable = wait.reason === 'profit';
  ship.routeWait = wait;
  ship.routeStop = k;
  ship.from = ship.to;
  ship.holding = false;
  ship.departedAt = now;
  ship.arrivesAt = now + 1;
  if (unprofitable) ship.routeWaiting = true;
}

/** 플레이어 선박이 항구에 닿았다 */
export function playerArrive(ctx: EconomyContext, state: EconomyState, ship: Ship, now: number, events: SimEvent[]): void {
  const moved = ship.from !== ship.to;
  const lost = moved ? spoil(ctx, state, ship) : [];
  if (moved) events.push({ type: 'arrival', month: state.month, shipId: ship.id, cityId: ship.to, spoiled: lost });
  if (moved && ship.expect && ship.expect.to === ship.to) ship.expect.arrivedAt = now;
  ship.from = ship.to;
  const route = ship.routeId ? state.player.routes.find((r) => r.id === ship.routeId) : undefined;
  if (route && route.stops[ship.routeStop ?? 0]?.cityId === ship.to) {
    runRouteStop(ctx, state, ship, route, now, events);
    return;
  }
  if (route) {
    // 항로에 막 배정되어 다른 항구에 닿았다: 다음 기항지로 간다
    const target = route.stops[ship.routeStop ?? 0].cityId;
    if (depart(ctx, state, ship, target, now)) return;
  }
  ship.holding = true;
  ship.departedAt = now;
  ship.arrivesAt = now;
}

/** 매달 선박 유지비. 현금이 모자라면 밀린 돈(arrears)으로 남는다. */
export function chargePlayerUpkeep(ctx: EconomyContext, state: EconomyState): void {
  let total = 0;
  for (const s of state.ships) {
    if (s.companyId !== PLAYER_ID) continue;
    const u = shipType(ctx, s.typeId).upkeepPerMonth;
    total += u;
    shipRecord(s, state.player.startMonth).upkeep += u;
  }
  if (total <= 0) return;
  const paid = Math.min(total, state.player.cash);
  state.player.cash -= paid;
  state.player.arrears += total - paid;
  state.sink += paid;
  book(state, 'upkeep', total);
}

/** 보관료는 월 갱신 때 점유 부피에 따라 부과. 일반 구역만 기존 부패 규칙을 적용한다. */
export function stepWarehouse(ctx: EconomyContext, state: EconomyState, events: SimEvent[]): void {
  const warehouse = state.player.warehouse;
  if (!warehouse) return;
  const fee = warehouseMonthlyFee(ctx, warehouse);
  if (fee > 0) {
    const paid = Math.min(fee, state.player.cash);
    state.player.cash -= paid;
    state.player.arrears += fee - paid;
    state.sink += paid;
    book(state, 'storageFees', fee);
  }
  const losses: string[] = [];
  for (const lot of warehouse.cargo) {
    const g = ctx.goodById[lot.goodId];
    if (g.cargoClass !== 'perishable') continue;
    let lost = lot.quantity * (1 - retainedFraction(ctx, g, 1));
    if (lot.quantity - lost < CARGO_DUST) lost = lot.quantity;
    if (lost <= 1e-9) continue;
    lot.quantity -= lost;
    state.spoiled[g.id] = (state.spoiled[g.id] ?? 0) + lost;
    book(state, 'spoiledCost', lost * lot.unitCost);
    losses.push(`${g.name} ${Math.round(lost * 100) / 100}개`);
  }
  warehouse.cargo = warehouse.cargo.filter((l) => l.quantity > 1e-9);
  if (losses.length) events.push({ type: 'notice', month: state.month, cityId: warehouse.cityId, text: `회사 일반 창고에서 ${losses.join(', ')}가 상했어요. 냉장 구역으로 옮기면 보관 중 부패를 막을 수 있어요.` });
}

export function trimLedger(ctx: EconomyContext, state: EconomyState): void {
  const max = ctx.data.player.ledgerMonths;
  const ledger = state.player.ledger;
  if (ledger.length > max) ledger.splice(0, ledger.length - max);
}

/** 한 달 장부의 순이익 */
export function netProfit(l: Omit<LedgerMonth, 'month'>): number {
  return l.sales - l.purchases - l.fuel - l.portFees - l.upkeep - (l.tariffs ?? 0) - (l.storageFees ?? 0);
}
