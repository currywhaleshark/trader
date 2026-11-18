import { fixJosa } from '../core/korean';
import { expectedSaleUnit } from './market';
import { incomingCargo } from './npc';
import { lotTerms } from './policy';
import type { EconomyContext, EconomyState, SaleExpectation, Ship, TradeReason } from './types';

/**
 * 예상과 실제(§ 항구 힌트의 예상 금액).
 * 출발할 때 목적지에서 1개당 받을 것으로 보인 값과 그때의 시장을 적어 두고, 항해하는 동안 목적지에서 실제로 일어난 일
 * (다른 배가 실어 온 양·생산·소비·사건)을 쌓는다. 팔았을 때 받은 값이 예상과 크게 다르면 그 까닭을 학생 말로 알려 준다.
 * 화면 설명용 기록이며 경제 계산에는 쓰지 않는다.
 */

/** 이만큼 넘게 다르면 "크게 달랐다"로 본다(1개당 받은 값 기준) */
export const SURPRISE_THRESHOLD = 0.15;

/** 출발할 때: 실은 상품마다 목적지에서 1개당 받을 것으로 보이는 값과 그때의 시장 */
export function makeExpectation(ctx: EconomyContext, state: EconomyState, ship: Ship, to: string, months: number, at: number): SaleExpectation | undefined {
  const dest = state.cities[to];
  const goods: SaleExpectation['goods'] = {};
  const byGood = new Map<string, { q: number; factor: number }>();
  for (const lot of ship.cargo) {
    if (dest.target[lot.goodId] <= 0) continue;
    const t = lotTerms(ctx, state, to, lot.goodId, lot.originCountryId, lot.brandCountryId);
    const e = byGood.get(lot.goodId) ?? { q: 0, factor: 0 };
    e.q += lot.quantity;
    e.factor += lot.quantity * (1 + t.premium) * (1 - t.tariff);
    byGood.set(lot.goodId, e);
  }
  for (const [goodId, { q, factor }] of byGood) {
    if (q <= 1e-6) continue;
    const g = ctx.goodById[goodId];
    const keep = g.cargoClass === 'perishable' && !ctx.data.shipTypes.find((x) => x.id === ship.typeId)?.refrigerated ? Math.pow(1 - ctx.data.player.spoilagePerMonth, months) : 1;
    const known = incomingCargo(state, to, goodId, ship);
    const l = dest.last;
    const a = dest.annual;
    const rate = a.months > 0 ? a.imported[goodId] / a.months : l.imported[goodId];
    goods[goodId] = {
      unit: expectedSaleUnit(ctx, dest, goodId, known, q * keep, months) * (factor / q),
      price: dest.price[goodId],
      stock: dest.stock[goodId],
      knownIncoming: known,
      resupply: Math.max(0, rate * months - known),
      produced: l.produced[goodId],
      used: l.consumed[goodId] + l.usedAsInput[goodId],
      factor: factor / q,
      events: state.modifiers.filter((m) => m.cityId === to && m.goodId === goodId).map((m) => m.reason),
    };
  }
  if (Object.keys(goods).length === 0) return undefined;
  return { to, departedAt: at, plannedMonths: months, goods, seen: {} };
}

/** 매달 끝에: 항해 중이거나 막 도착한 내 배의 목적지에서 이번 달 일어난 일을 쌓는다 */
export function observeExpectations(ctx: EconomyContext, state: EconomyState, playerId: string): void {
  for (const ship of state.ships) {
    const e = ship.expect;
    if (ship.companyId !== playerId || !e || ship.to !== e.to) continue;
    const l = state.cities[e.to].last;
    for (const goodId of Object.keys(e.goods)) {
      const s = (e.seen[goodId] ??= { imported: 0, produced: 0, used: 0, months: 0 });
      s.imported += l.imported[goodId];
      s.produced += l.produced[goodId];
      s.used += l.consumed[goodId] + l.usedAsInput[goodId];
      s.months++;
    }
  }
}

const n = (v: number) => Math.round(v).toLocaleString('ko-KR');

/**
 * 팔고 난 뒤: 1개당 받은 값(관세 뗀 뒤)이 예상과 크게 다르면 예상·실제와 까닭(큰 것부터 3개까지).
 * sale.lot: 판 묶음 하나(원산지·상표로 관세·유행 변화를 본다), sale.push: 팔기 직전에 본 "한꺼번에 팔아 밀리는 비율"
 */
export function explainSurprise(
  ctx: EconomyContext,
  state: EconomyState,
  ship: Ship,
  cityId: string,
  goodId: string,
  quantity: number,
  actualUnit: number,
  sale: { lot?: { originCountryId: string; brandCountryId: string }; push: number },
): { expectedUnit: number; actualUnit: number; priceAtDeparture: number; priceNow: number; reasons: TradeReason[] } | undefined {
  const e = ship.expect;
  const x = e?.goods[goodId];
  if (!e || !x || e.to !== cityId || x.unit <= 0) return undefined;
  const miss = actualUnit / x.unit - 1;
  if (Math.abs(miss) < SURPRISE_THRESHOLD) return undefined;
  const g = ctx.goodById[goodId];
  const city = state.cities[cityId];
  const name = ctx.cityNames[cityId];
  const seen = e.seen[goodId] ?? { imported: 0, produced: 0, used: 0, months: 0 };
  const months = Math.max(1, seen.months);
  const down = miss < 0;
  // 까닭마다 "재고를 몇 개만큼 바꿨나"로 크기를 재서 큰 것부터 보여 준다
  const found: { size: number; reason: TradeReason }[] = [];
  const small = Math.max(3, quantity * 0.2, city.target[goodId] * 0.1);

  const expectedArrivals = x.knownIncoming + x.resupply;
  const extra = seen.imported - expectedArrivals;
  if (down && extra > small) {
    found.push({
      size: extra,
      reason: {
        category: 'market',
        text: `항해하는 동안 다른 배들이 ${name}에 ${g.name}을(를) ${n(seen.imported)}개 실어 왔어요(출발할 때 어림한 양은 ${n(expectedArrivals)}개). 값이 높던 곳이라 다른 회사들도 같은 물건을 싣고 몰려왔어요.`,
      },
    });
  } else if (!down && -extra > small) {
    found.push({ size: -extra, reason: { category: 'market', text: `다른 배들이 ${name}에 ${g.name}을(를) 어림한 것보다 적게(${n(seen.imported)}개) 실어 와 값이 덜 떨어졌어요.` } });
  }

  const prodExtra = seen.produced - x.produced * months;
  if (Math.abs(prodExtra) > small && (prodExtra > 0) === down) {
    const crop = g.source?.kind === 'crop';
    found.push({
      size: Math.abs(prodExtra),
      reason: prodExtra > 0
        ? { category: crop ? 'season' : 'industry', text: crop ? `${name}에 ${g.name} 수확철이 와서 출발 때보다 ${n(prodExtra)}개를 더 거뒀어요.` : `${name}에서 ${g.name}을(를) 출발 때보다 ${n(prodExtra)}개 더 만들었어요.` }
        : { category: crop ? 'season' : 'industry', text: crop ? `${name}의 ${g.name} 수확철이 끝나 출발 때보다 ${n(-prodExtra)}개 덜 거뒀어요.` : `${name}에서 ${g.name}을(를) 출발 때보다 ${n(-prodExtra)}개 덜 만들었어요.` },
    });
  }

  const usedLess = x.used * months - seen.used;
  if (Math.abs(usedLess) > small && (usedLess > 0) === down) {
    found.push({
      size: Math.abs(usedLess),
      reason: usedLess > 0
        ? { category: 'demand', text: `${name}에서 ${g.name}을(를) 출발 때 어림보다 ${n(usedLess)}개 덜 썼어요(값이 오르면 덜 사고, 공장이 멈추면 덜 쓴다).` }
        : { category: 'demand', text: `${name}에서 ${g.name}을(를) 출발 때 어림보다 ${n(-usedLess)}개 더 썼어요.` },
    });
  }

  const now = state.modifiers.filter((m) => m.cityId === cityId && m.goodId === goodId);
  for (const m of now) {
    if (x.events.includes(m.reason)) continue;
    if ((m.factor < 1) === down) continue; // 생산이 줄면 값이 오른다
    found.push({ size: small * 2, reason: { category: m.factor < 1 ? 'shortage' : 'industry', text: fixJosa(`항해하는 동안 ${name}에 사건이 있었어요: ${m.reason}.`) } });
  }
  for (const r of x.events) {
    if (now.some((m) => m.reason === r)) continue;
    found.push({ size: small * 1.5, reason: { category: 'shortage', text: fixJosa(`출발할 때 ${name}의 ${r}이(가) 끝나 값이 제자리로 돌아갔어요.`) } });
  }

  // 관세·문화 유행이 바뀌었는가(받은 값에 곱해지는 몫)
  const ref = sale.lot;
  if (ref) {
    const t = lotTerms(ctx, state, cityId, goodId, ref.originCountryId, ref.brandCountryId);
    const f = (1 + t.premium) * (1 - t.tariff);
    if (Math.abs(f / x.factor - 1) > 0.05 && (f < x.factor) === down) {
      found.push({ size: small * 2, reason: { category: 'policy', text: `항해하는 동안 ${ctx.countryNames[city.countryId]}의 관세나 유행이 바뀌어 손에 쥐는 몫이 ${Math.round((f / x.factor - 1) * 100)}% 달라졌어요.` } });
    }
  }

  // 더 오래 걸렸는가(우회·지연): 그동안 다른 배가 더 오고 값도 더 움직인다
  const took = (e.arrivedAt ?? e.departedAt + e.plannedMonths) - e.departedAt;
  if (took > e.plannedMonths + 0.5) {
    found.push({ size: small, reason: { category: 'market', text: `항로가 막히거나 돌아가느라 ${Math.max(1, Math.round((took - e.plannedMonths) * 30))}일 더 걸려, 그동안 시장이 더 움직였어요.` } });
  }

  // 한꺼번에 판 양이 시장에 비해 많았는가(예상에도 들어 있지만, 시장이 줄어 있으면 더 밀린다)
  if (down) {
    const push = sale.push;
    if (push < -0.12) found.push({ size: small * 0.8, reason: { category: 'market', text: `${n(quantity)}개를 한꺼번에 팔아 값이 ${Math.round(-push * 100)}% 밀렸어요. 나눠 팔거나 다른 항구에도 팔면 덜 밀려요.` } });
  }

  found.sort((a, b) => b.size - a.size);
  const reasons = found.slice(0, 3).map((f) => ({ ...f.reason, text: fixJosa(f.reason.text) }));
  if (reasons.length === 0) {
    const rose = city.price[goodId] > x.price;
    const moved = `${name}의 ${g.name} 값이 출발 때 ${n(x.price)}에서 지금 ${n(city.price[goodId])}(으)로 ${rose ? '올랐어요' : '내렸어요'}.`;
    reasons.push({
      category: 'market',
      text: fixJosa(
        down
          ? `${moved} 여러 배의 거래가 겹치면 어림보다 크게 움직일 수 있어요.`
          : `${moved} 재고가 어림보다 빨리 줄어 값이 버텼어요.`,
      ),
    });
  }
  return { expectedUnit: x.unit, actualUnit, priceAtDeparture: x.price, priceNow: city.price[goodId], reasons };
}
