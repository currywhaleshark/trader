import type { GoodDef } from './data';
import { brandPremium } from './policy';
import { addStock, brandStock, originKey, splitKey, type StockPart } from './origin';
import { emptyStats, type CityEconomy, type EconomyContext, type EconomyState } from './types';

/**
 * 도시 시장의 매매 규칙. NPC와 (M2의) 플레이어가 같은 함수를 쓴다.
 *  - 살 때는 비싸게, 팔 때는 싸게(호가 차이) → 같은 항구에서 사고팔면 반드시 손해.
 *  - 많이 살수록 단가가 오르고 많이 팔수록 내린다(재고 대비 거래량).
 *  - 실제 재고만큼만 살 수 있다. 상품은 복제되지 않는다.
 */
/** 항해하는 동안 남는 화물 비율. 부패 시간은 선적부터 하역까지의 항해 기간이다. */
export function retainedFraction(ctx: EconomyContext, good: GoodDef, months: number, refrigerated = false): number {
  return refrigerated || good.cargoClass !== 'perishable' ? 1 : Math.pow(1 - ctx.data.player.spoilagePerMonth, Math.max(0, months));
}

export interface Quote {
  quantity: number;
  /** 단가(수수료·가격 충격 포함) */
  unitPrice: number;
  total: number;
}

/** 가격 충격을 계산할 때 쓰는 "시장 깊이". 재고가 0이어도 0으로 나누지 않게 한다. */
function depth(ctx: EconomyContext, city: CityEconomy, goodId: string): number {
  return Math.max(city.stock[goodId], city.target[goodId] * ctx.data.market.depthFloor, 1);
}

/**
 * 이 도시에서 이 상품을 한 번에 살 수 있는 최대량.
 * 주민과 공장이 쓸 몫(reserve)은 팔지 않고, 그 위의 재고만 내놓는다.
 * 그래서 수입해 온 물건을 바로 다른 곳으로 되넘겨 바닥내는 일이 없다.
 */
export function maxBuyable(ctx: EconomyContext, city: CityEconomy, goodId: string): number {
  return Math.max(0, (city.stock[goodId] - city.reserve[goodId]) * ctx.data.market.maxBuyShare);
}

/**
 * 이 시장이 이 원자재를 배에 내놓지 않는가(설정 market.rawOnlyFromSource).
 * 생산 시설이 있거나, 이 항구를 관문으로 쓰는 내륙 경제권이 생산하면 내놓는다.
 */
export function withheldFromShips(ctx: EconomyContext, state: EconomyState, city: CityEconomy, goodId: string): boolean {
  if (!ctx.data.market.rawOnlyFromSource || ctx.goodById[goodId]?.source?.kind !== 'resource') return false;
  const produces = (c: CityEconomy | undefined) => !!c?.industries.some((i) => i.goodId === goodId && i.capacity > 0);
  if (produces(city)) return false;
  for (const l of ctx.inlandLinks) if (l.portId === city.id && produces(state.cities[l.inlandId])) return false;
  return true;
}

/** 배(플레이어·NPC·자동항로)가 이 시장에서 한 번에 살 수 있는 최대량 */
export function shipBuyable(ctx: EconomyContext, state: EconomyState, city: CityEconomy, goodId: string, brand?: string): number {
  if (brand) return Math.min(shipBuyable(ctx, state, city, goodId), brandStock(city, goodId)[brand] ?? 0);
  return withheldFromShips(ctx, state, city, goodId) ? 0 : maxBuyable(ctx, city, goodId);
}

export interface PurchasePart extends StockPart { unitPrice: number }
export interface PurchaseQuote extends Quote { baseUnit: number; parts: PurchasePart[] }

/** 재고 구성 그대로의 평가단가. 공장 내부 투입에는 거래 스프레드·항만비가 없다. */
export function inventoryUnit(ctx: EconomyContext, state: EconomyState, city: CityEconomy, goodId: string, month = state.month): number {
  let value = 0;
  let amount = 0;
  for (const key in city.mix[goodId]) {
    const q = city.mix[goodId][key];
    value += q * brandPremium(ctx, state, city.countryId, goodId, splitKey(key).brand, month);
    amount += q;
  }
  return city.price[goodId] * (1 + (amount > 0 ? value / amount : 0));
}

export function quoteBuy(ctx: EconomyContext, city: CityEconomy, goodId: string, quantity: number, state?: EconomyState, brand?: string, month = state?.month, origin?: string): PurchaseQuote {
  const m = ctx.data.market;
  const mix = city.mix[goodId];
  let available = 0;
  for (const key in mix) if ((!brand || splitKey(key).brand === brand) && (!origin || splitKey(key).origin === origin)) available += mix[key];
  const q = Math.max(0, Math.min(quantity, available, maxBuyable(ctx, city, goodId)));
  if (q <= 0) return { quantity: 0, unitPrice: 0, baseUnit: 0, total: 0, parts: [] };
  const s = depth(ctx, city, goodId);
  const impact = Math.pow(s / Math.max(s - q / 2, s * 0.25), m.impactExponent);
  const unitPrice = city.price[goodId] * (1 + m.spread) * impact;
  const parts: PurchasePart[] = [];
  let total = 0;
  for (const key in mix) {
    const id = splitKey(key);
    if (mix[key] <= 0 || (brand && id.brand !== brand) || (origin && id.origin !== origin)) continue;
    const part = { ...id, quantity: mix[key] * (q / available), unitPrice: unitPrice * (1 + brandPremium(ctx, state, city.countryId, goodId, id.brand, month)) };
    total += part.quantity * part.unitPrice;
    parts.push(part);
  }
  return { quantity: q, unitPrice: total / q, baseUnit: unitPrice, total, parts };
}

/** premium은 해당 시장에서 산업 평판과 문화 유행을 합한 비율이다. */
export function quoteSell(ctx: EconomyContext, city: CityEconomy, goodId: string, quantity: number, premium = 0): Quote {
  return quoteSellAt(ctx, city, goodId, quantity, city.price[goodId] * (1 + premium), city.stock[goodId]);
}

export function quoteSellAt(ctx: EconomyContext, city: CityEconomy, goodId: string, quantity: number, price: number, stock: number): Quote {
  const m = ctx.data.market;
  const q = Math.max(0, quantity);
  if (q <= 0) return { quantity: 0, unitPrice: 0, total: 0 };
  const s = Math.max(stock, city.target[goodId] * m.depthFloor, 1);
  const impact = Math.pow(s / (s + q / 2), m.impactExponent);
  const unitPrice = price * (1 - m.spread) * impact;
  return { quantity: q, unitPrice, total: unitPrice * q };
}

function clampPrice(ctx: EconomyContext, good: GoodDef, price: number): number {
  const m = ctx.data.market;
  return Math.min(good.basePrice * m.priceCeil, Math.max(good.basePrice * m.priceFloor, price));
}

/** 거래 직후 시세를 조금 움직인다(같은 달에 연달아 거래해도 같은 값에 사고팔 수 없다). */
function nudgePrice(ctx: EconomyContext, city: CityEconomy, good: GoodDef, depthBefore: number, depthAfter: number): void {
  const k = ctx.data.market.impactExponent / 2;
  const current = city.price[good.id];
  // 한도 밖의 옛 저장 시세는 다음 월말에 조정한다. 같은 달에 반복 매매해도 한도까지 밀어 올릴 수 없다.
  if (current !== clampPrice(ctx, good, current)) return;
  city.price[good.id] = clampPrice(ctx, good, current * Math.pow(depthBefore / depthAfter, k));
}

/**
 * 재고를 실제로 줄이고 대금을 계산한다. 반환된 몫(parts: 원산지·상표별 수량)만큼만 화물로 옮겨야 한다.
 * 재고 구성 비율대로 꺼내므로, 수입해 온 물건은 원산지를 그대로 지닌 채 실린다.
 */
export function executeBuy(ctx: EconomyContext, city: CityEconomy, goodId: string, quantity: number, state?: EconomyState, brand?: string, origin?: string): PurchaseQuote {
  const quote = quoteBuy(ctx, city, goodId, quantity, state, brand, undefined, origin);
  if (quote.quantity <= 0) return { ...quote, parts: [] };
  const before = depth(ctx, city, goodId);
  for (const p of quote.parts) {
    const key = originKey(p.origin, p.brand);
    const mix = city.mix[goodId];
    mix[key] -= p.quantity;
    if (mix[key] <= 0) delete mix[key];
  }
  city.stock[goodId] = Math.max(0, city.stock[goodId] - quote.quantity);
  city.treasury += quote.total;
  city.last.exported[goodId] += quote.quantity;
  nudgePrice(ctx, city, ctx.goodById[goodId], before, depth(ctx, city, goodId));
  return quote;
}

/**
 * 원산지·상표가 정해진 화물을 판다. 관세는 부르는 쪽이 따로 계산해 낸다(대금에서 떼어 도시에 낸다).
 * 같은 주문의 여러 원산지는 전체 수량으로 구한 batchUnit을 공유한다.
 */
export function executeSell(
  ctx: EconomyContext,
  city: CityEconomy,
  goodId: string,
  quantity: number,
  origin: string,
  brand: string,
  state?: EconomyState,
  batchUnit = quoteSell(ctx, city, goodId, quantity).unitPrice,
  fixedUnitPrice?: number,
): Quote {
  const unitPrice = fixedUnitPrice ?? batchUnit * (1 + brandPremium(ctx, state, city.countryId, goodId, brand));
  const quote = { quantity, unitPrice, total: quantity * unitPrice };
  if (quote.quantity <= 0) return quote;
  const before = depth(ctx, city, goodId);
  addStock(city, goodId, quote.quantity, origin, brand);
  city.treasury -= quote.total;
  city.last.imported[goodId] += quote.quantity;
  if (origin !== city.countryId) {
    const from = (city.annual.importsFrom[goodId] ??= {});
    from[origin] = (from[origin] ?? 0) + quote.quantity;
    city.annual.importValueFrom[origin] = (city.annual.importValueFrom[origin] ?? 0) + quote.total;
  }
  nudgePrice(ctx, city, ctx.goodById[goodId], before, depth(ctx, city, goodId));
  return quote;
}

/**
 * 월말 가격 갱신. 가격은 임의로 흔들리지 않는다:
 * 재고가 목표보다 적으면 오르고 많으면 내리며, 한 달에 일부만 움직인다(완충).
 */
export function updatePrices(ctx: EconomyContext, city: CityEconomy): void {
  completedStats.delete(city);
  const m = ctx.data.market;
  for (const g of ctx.goods) {
    const target = city.target[g.id];
    if (target <= 0) {
      city.price[g.id] = g.basePrice; // 시장이 없는 상품
      continue;
    }
    const desired = settledPrice(ctx, city, g.id, city.stock[g.id]);
    city.price[g.id] = clampPrice(ctx, g, city.price[g.id] + (desired - city.price[g.id]) * (g.priceResponse?.priceAdjust ?? m.priceAdjust));
  }
}

/** 가격이 기준에서 벗어난 까닭을 화면에 설명하기 위한 진단 */
export interface PriceReason {
  /** 재고 / 목표 */
  stockRatio: number;
  /** 지난달 생산 − 소비 − 투입 */
  localBalance: number;
  netImport: number;
  shortage: number;
}

export function explainPrice(city: CityEconomy, goodId: string): PriceReason {
  const l = city.last;
  return {
    stockRatio: city.target[goodId] > 0 ? city.stock[goodId] / city.target[goodId] : 1,
    localBalance: l.produced[goodId] - l.consumed[goodId] - l.usedAsInput[goodId],
    netImport: l.imported[goodId] - l.exported[goodId],
    shortage: l.shortage[goodId],
  };
}

// 월 중 생산은 소비보다 먼저 기록된다. 항해 예측에는 마지막으로 완료된 달의 양쪽 흐름을 쓴다.
const completedStats = new WeakMap<CityEconomy, CityEconomy['last']>();
export function beginMarketMonth(ctx: EconomyContext, city: CityEconomy): void {
  completedStats.set(city, city.last);
  city.last = emptyStats(ctx.goods);
}

function monthlyDrain(ctx: EconomyContext, city: CityEconomy, id: string): number {
  const l = completedStats.get(city) ?? city.last;
  const net = l.consumed[id] + l.usedAsInput[id] - l.produced[id];
  return ctx.goodById[id].priceResponse ? net : Math.max(0, net);
}

/** 재고가 이만큼일 때 시장이 자리 잡을 값(월말 가격 갱신이 향하는 값) */
export function settledPrice(ctx: EconomyContext, city: CityEconomy, goodId: string, stock: number): number {
  const g = ctx.goodById[goodId];
  const target = city.target[goodId];
  if (target <= 0) return g.basePrice;
  const ratio = Math.max(stock, target * 0.02) / target;
  // 투입비 변화의 일부를 전가하고 나머지는 가동률·재고를 통해 반영한다.
  const basis = g.basePrice + (g.priceResponse ? 0.25 * (city.inputCostDelta?.[goodId] ?? 0) : 0);
  return clampPrice(ctx, g, basis * Math.pow(ratio, -(g.priceResponse?.stockExponent ?? ctx.data.market.stockExponent)));
}

/**
 * 도착할 즈음의 예상 값: 지금 재고에 "이미 배로 실어 오고 있는 양"과 내가 실어 갈 양을 더하고,
 * 항해하는 동안 소비로 줄어들 양을 빼서 계산한다. 다른 배와의 경쟁을 학생이 미리 볼 수 있게 한다.
 */
export function forecastPrice(
  ctx: EconomyContext,
  city: CityEconomy,
  goodId: string,
  incoming: number,
  months: number,
): number {
  const drain = monthlyDrain(ctx, city, goodId);
  const stock = Math.max(0, city.stock[goodId] + incoming - drain * months);
  return ctx.goodById[goodId].priceResponse ? projectedPrice(ctx, city, goodId, stock, months) : settledPrice(ctx, city, goodId, stock);
}

function projectedPrice(ctx: EconomyContext, city: CityEconomy, goodId: string, stock: number, months: number): number {
  const target = settledPrice(ctx, city, goodId, stock);
  const adjust = ctx.goodById[goodId].priceResponse?.priceAdjust ?? ctx.data.market.priceAdjust;
  return target + (city.price[goodId] - target) * Math.pow(1 - adjust, Math.max(0, months));
}

/**
 * 항해하는 동안 다른 무역회사가 더 실어 올 것으로 보이는 양.
 * 지금 항해 중인 배의 짐(incomingOthers)은 이미 알고 있으니 빼고, 올해 이 항구에 들어온 평균 속도로 어림한다.
 * 값이 높아 보이는 항구에는 다른 회사들도 같은 상품을 싣고 오기 때문이다(힌트가 너무 낙관하지 않게).
 */
export function expectedResupply(city: CityEconomy, goodId: string, incomingOthers: number, months: number): number {
  const a = city.annual;
  const rate = a.months > 0 ? a.imported[goodId] / a.months : (completedStats.get(city) ?? city.last).imported[goodId];
  return Math.max(0, rate * Math.max(0, months) - incomingOthers);
}

/**
 * 도착할 즈음의 그 항구 시장(내 짐을 내리기 직전).
 * 재고: 지금 재고 + 다른 배들이 실어 오고 있는 양 + 더 실어 올 것으로 보이는 양 − 항해하는 동안 쓰여 없어질 양.
 * 값: 시장은 한 달에 일부(priceAdjust)만 자리 잡을 값으로 움직이므로, 지금 값에서 그만큼만 다가간다.
 */
export function arrivalProjection(
  ctx: EconomyContext,
  dst: CityEconomy,
  goodId: string,
  incomingOthers: number,
  months: number,
): { price: number; stock: number; resupply: number } {
  const drain = monthlyDrain(ctx, dst, goodId);
  const resupply = expectedResupply(dst, goodId, incomingOthers, months);
  const stock = Math.max(0, dst.stock[goodId] + incomingOthers + resupply - drain * months);
  const price = projectedPrice(ctx, dst, goodId, stock, months);
  return { price, stock, resupply };
}

export function arrivalMarket(ctx: EconomyContext, dst: CityEconomy, goodId: string, incoming: number, months: number) {
  const at = arrivalProjection(ctx, dst, goodId, incoming, months);
  const city = { ...dst, price: { ...dst.price, [goodId]: at.price }, stock: { ...dst.stock, [goodId]: at.stock } };
  return { ...at, city };
}

/**
 * 도착해서 mine개를 팔 때 1개당 받을 것으로 보이는 값(호가 차이·내 판매로 밀리는 값 포함, 관세·웃돈 전).
 * 항구 힌트·항구 창·자동항로가 모두 이 값을 쓴다.
 */
export function expectedSaleUnit(ctx: EconomyContext, dst: CityEconomy, goodId: string, incomingOthers: number, mine: number, months: number): number {
  const at = arrivalProjection(ctx, dst, goodId, incomingOthers, months);
  return quoteSellAt(ctx, dst, goodId, mine, at.price, at.stock).unitPrice;
}
