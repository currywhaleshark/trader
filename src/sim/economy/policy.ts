import type { SeededRNG } from '../core/rng';
import { originShares, splitKey } from './origin';
import type { AnnualStats, CultureWave, EconomyContext, EconomyState, Policy, PolicyBaseline, SimEvent } from './types';

/**
 * 무역 정책·문화(M4).
 *  - 관세는 "도착 나라 × 상품 × 원산지"로 정한다. 실어 온 항구가 아니라 만든 나라가 기준이다.
 *  - 무역협정(FTA)은 회원국이 만든 물건에만 관세를 없앤다. 다른 나라 물건을 회원국 창고에 넣었다 빼도 혜택이 없다.
 *  - 무역 갈등의 관세(보복 관세 포함)는 협정보다 우선한다.
 *  - 정책은 나라의 산업 사정에서 나오고, 몇 년 동안 유지된다. 1년 뒤 생산자·소비자·무역회사에 생긴 변화를 실제로 재서 보고한다.
 *  - 문화 유행은 그 나라 상표 상품의 수요와 판매 값에 웃돈을 붙인다. 물건이 저절로 생기지는 않는다.
 */

type PolicyEvent = Extract<SimEvent, { type: 'policy' }>;

const pct = (v: number) => `${Math.round(v * 100)}%`;
const signedPct = (v: number) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;

function active<T extends { startMonth: number; endMonth: number }>(x: T, month: number): boolean {
  return x.startMonth <= month && month < x.endMonth;
}

function covers(goods: string[] | undefined, goodId: string): boolean {
  return !goods || goods.includes(goodId);
}

/**
 * 같은 달·같은 정책 버전 안에서는 관세율·웃돈이 변하지 않는다. NPC가 항해를 고를 때 수천 번 묻기 때문에,
 * "도착 나라 × 상품 × 원산지(또는 상표) 나라" 숫자 표로 한 번에 만들어 두고 배열 위치로 읽는다.
 * 표는 상태 객체마다 따로 두고, 달이나 정책 버전이 바뀌면 다시 만든다.
 */
interface Index {
  country: Map<string, number>;
  good: Map<string, number>;
  nC: number;
  nG: number;
}
const indexes = new WeakMap<EconomyContext, Index>();

function indexFor(ctx: EconomyContext): Index {
  let ix = indexes.get(ctx);
  if (ix) return ix;
  const countries = Object.keys(ctx.countryNames);
  ix = {
    country: new Map(countries.map((k, i) => [k, i])),
    good: new Map(ctx.goods.map((g, i) => [g.id, i])),
    nC: countries.length,
    nG: ctx.goods.length,
  };
  indexes.set(ctx, ix);
  return ix;
}

interface PolicyCache {
  sig: string;
  /** [도착][상품][원산지] 관세율. 관세가 하나도 없으면 null */
  tariff: Float64Array | null;
  /** [도착][상품][상표] 웃돈·수요 증가율. 유행이 없으면 null */
  premium: Float64Array | null;
  boost: Float64Array | null;
  maxPremium: number;
}
const caches = new WeakMap<EconomyState, PolicyCache>();

function cacheFor(ctx: EconomyContext, state: EconomyState): PolicyCache {
  const sig = `${state.month}|${state.policyVersion}`;
  const hit = caches.get(state);
  if (hit && hit.sig === sig) return hit;
  const ix = indexFor(ctx);
  const month = state.month;
  const countries = [...ix.country.keys()];
  const size = ix.nC * ix.nG * ix.nC;

  let tariff: Float64Array | null = null;
  if (ctx.data.policy.baseTariff > 0 || state.policies.some((p) => active(p, month))) {
    tariff = new Float64Array(size);
    for (let d = 0; d < ix.nC; d++) {
      for (let g = 0; g < ix.nG; g++) {
        for (let o = 0; o < ix.nC; o++) {
          tariff[(d * ix.nG + g) * ix.nC + o] = d === o ? 0 : computeTariff(ctx, state, countries[d], ctx.goods[g].id, countries[o]);
        }
      }
    }
  }

  let premium: Float64Array | null = null;
  let boost: Float64Array | null = null;
  let maxPremium = 0;
  const waves = state.cultureWaves.filter((w) => active(w, month));
  if (waves.length > 0) {
    premium = new Float64Array(size);
    boost = new Float64Array(size);
    const C = ctx.data.culture;
    for (const w of waves) {
      const b = ix.country.get(w.brand);
      if (b === undefined) continue;
      for (const dest of w.countries) {
        const d = ix.country.get(dest);
        if (d === undefined) continue;
        for (let g = 0; g < ix.nG; g++) {
          const sens = C.sensitivity[ctx.goods[g].id] ?? 0;
          if (sens <= 0) continue;
          const at = (d * ix.nG + g) * ix.nC + b;
          premium[at] += w.strength * sens * C.premiumScale;
          boost[at] += w.strength * sens * C.demandScale;
          maxPremium = Math.max(maxPremium, premium[at]);
        }
      }
    }
  }
  const c: PolicyCache = { sig, tariff, premium, boost, maxPremium };
  caches.set(state, c);
  return c;
}

function at(ix: Index, dest: string, goodId: string, other: string): number {
  const d = ix.country.get(dest);
  const g = ix.good.get(goodId);
  const o = ix.country.get(other);
  if (d === undefined || g === undefined || o === undefined) return -1;
  return (d * ix.nG + g) * ix.nC + o;
}

/** 이번 달에 판매 값을 올려 줄 수 있는 최대 웃돈(어림셈용) */
export function maxPremium(ctx: EconomyContext, state: EconomyState): number {
  return cacheFor(ctx, state).maxPremium;
}

/** destCountry가 origin 나라에서 만든 goodId에 매기는 관세율 */
export function tariffRate(ctx: EconomyContext, state: EconomyState, destCountry: string, goodId: string, origin: string): number {
  if (origin === destCountry) return 0;
  const t = cacheFor(ctx, state).tariff;
  if (!t) return 0;
  const i = at(indexFor(ctx), destCountry, goodId, origin);
  return i < 0 ? computeTariff(ctx, state, destCountry, goodId, origin) : t[i];
}

function computeTariff(ctx: EconomyContext, state: EconomyState, destCountry: string, goodId: string, origin: string): number {
  const month = state.month;
  let general = ctx.data.policy.baseTariff;
  let conflict = 0;
  let fta = false;
  for (const p of state.policies) {
    if (!active(p, month) || !covers(p.goods, goodId)) continue;
    if (p.kind === 'fta') {
      if (p.countries.includes(destCountry) && p.countries.includes(origin)) fta = true;
      continue;
    }
    if (!p.countries.includes(destCountry) || (p.targets && !p.targets.includes(origin))) continue;
    if (p.cause === 'conflict' || p.cause === 'retaliation') conflict = Math.max(conflict, p.rate);
    else general = Math.max(general, p.rate);
  }
  return Math.max(fta ? 0 : general, conflict);
}

/** 문화 유행: destCountry에서 brand 상표 goodId가 받는 웃돈 비율 */
export function brandPremium(ctx: EconomyContext, state: EconomyState, destCountry: string, goodId: string, brand: string): number {
  const p = cacheFor(ctx, state).premium;
  if (!p) return 0;
  const i = at(indexFor(ctx), destCountry, goodId, brand);
  return i < 0 ? 0 : p[i];
}

/** 문화 유행: destCountry 주민의 brand 상표 goodId 수요 증가율(그 상표 재고가 있을 때만 의미가 있다) */
export function brandDemandBoost(ctx: EconomyContext, state: EconomyState, destCountry: string, goodId: string, brand: string): number {
  const b = cacheFor(ctx, state).boost;
  if (!b) return 0;
  const i = at(indexFor(ctx), destCountry, goodId, brand);
  return i < 0 ? 0 : b[i];
}

/** "원산지/상표" 키 -> 나라 번호(구성 키 종류는 몇 개뿐이라 한 번만 쪼갠다) */
const parsedKeys = new Map<string, { o: number; b: number }>();

/**
 * src 도시에서 산 goodId를 dest 도시에 팔 때, 기대할 수 있는 (1 + 웃돈) × (1 − 관세) 비율.
 * 산 물건의 원산지·상표는 src 재고 구성 비율을 따른다고 보고 평균한다.
 */
export function expectedSaleFactor(ctx: EconomyContext, state: EconomyState, srcCityId: string, goodId: string, destCityId: string): number {
  const cache = cacheFor(ctx, state);
  if (!cache.tariff && !cache.premium) return 1;
  const ix = indexFor(ctx);
  const destCountry = ctx.countryOfCity[destCityId];
  const d = ix.country.get(destCountry)!;
  const g = ix.good.get(goodId)!;
  const base = (d * ix.nG + g) * ix.nC;
  const tariff = cache.tariff;
  const premium = cache.premium;
  const src = state.cities[srcCityId];
  const mix = src.mix[goodId];
  if (!mix || src.stock[goodId] <= 0) {
    const o = ix.country.get(ctx.countryOfCity[srcCityId])!;
    const t = tariff && o !== d ? tariff[base + o] : 0;
    const p = premium ? premium[base + o] : 0;
    return (1 + p) * (1 - t);
  }
  let f = 0;
  let w = 0;
  for (const key in mix) {
    const v = mix[key];
    if (v <= 0) continue;
    let k = parsedKeys.get(key);
    if (!k) {
      const s = splitKey(key);
      k = { o: ix.country.get(s.origin) ?? -1, b: ix.country.get(s.brand) ?? -1 };
      parsedKeys.set(key, k);
    }
    const t = tariff && k.o >= 0 && k.o !== d ? tariff[base + k.o] : 0;
    const p = premium && k.b >= 0 ? premium[base + k.b] : 0;
    f += v * (1 + p) * (1 - t);
    w += v;
  }
  return w > 0 ? f / w : 1;
}

/**
 * 협정 덕분에 피한 관세율: 도착 나라가 이 상품에 (협정국이 아닌 나라에) 매기는 관세가 있는데,
 * 원산지가 협정국이라 내지 않았다면 그 관세율. 아니면 0.
 */
export function ftaExemption(ctx: EconomyContext, state: EconomyState, destCountry: string, goodId: string, origin: string): number {
  if (origin === destCountry || tariffRate(ctx, state, destCountry, goodId, origin) > 0) return 0;
  const month = state.month;
  const member = state.policies.some((p) => active(p, month) && p.kind === 'fta' && covers(p.goods, goodId) && p.countries.includes(destCountry) && p.countries.includes(origin));
  if (!member) return 0;
  let avoided = 0;
  for (const p of state.policies) {
    if (!active(p, month) || p.kind !== 'tariff' || !p.countries.includes(destCountry) || !covers(p.goods, goodId)) continue;
    if (p.cause === 'conflict' || p.cause === 'retaliation') continue;
    if (p.targets && !p.targets.includes(origin)) continue;
    avoided = Math.max(avoided, p.rate);
  }
  return avoided;
}

/** 실은 화물 묶음 하나를 팔 때의 (1 + 웃돈), 관세율 */
export function lotTerms(ctx: EconomyContext, state: EconomyState, destCityId: string, goodId: string, origin: string, brand: string): { premium: number; tariff: number } {
  const destCountry = ctx.countryOfCity[destCityId];
  return { premium: brandPremium(ctx, state, destCountry, goodId, brand), tariff: tariffRate(ctx, state, destCountry, goodId, origin) };
}

// ------------------------------------------------------------------ 나라별 한 해 집계

interface CountryGood {
  produced: number;
  capacity: number;
  used: number;
  /** 다른 나라에서 만든 물건의 수입량 */
  foreignImports: number;
  /** 소비·투입량 가중 평균 값 */
  priceSum: number;
}

interface CountryAgg {
  goods: Record<string, CountryGood>;
  /** 원산지 나라별 수입액 */
  importValueFrom: Record<string, number>;
  importValue: number;
  tariffs: number;
}

function aggregate(ctx: EconomyContext, state: EconomyState): Record<string, CountryAgg> {
  const out: Record<string, CountryAgg> = {};
  for (const id of ctx.cityIds) {
    const k = ctx.countryOfCity[id];
    const a: AnnualStats = state.cities[id].annual;
    const e = (out[k] ??= { goods: {}, importValueFrom: {}, importValue: 0, tariffs: 0 });
    e.tariffs += a.tariffs;
    for (const [o, v] of Object.entries(a.importValueFrom)) {
      e.importValueFrom[o] = (e.importValueFrom[o] ?? 0) + v;
      e.importValue += v;
    }
    for (const g of ctx.goods) {
      const cg = (e.goods[g.id] ??= { produced: 0, capacity: 0, used: 0, foreignImports: 0, priceSum: 0 });
      cg.produced += a.produced[g.id];
      cg.capacity += a.capacity[g.id];
      cg.used += a.used[g.id];
      const from = a.importsFrom[g.id] ?? {};
      for (const [o, q] of Object.entries(from)) if (o !== k) cg.foreignImports += q;
      const avgPrice = a.months > 0 ? a.priceSum[g.id] / a.months : g.basePrice;
      cg.priceSum += avgPrice * a.used[g.id];
    }
  }
  return out;
}

function paidRatio(ctx: EconomyContext, cg: CountryGood, goodId: string): number {
  return cg.used > 0 ? cg.priceSum / cg.used / ctx.goodById[goodId].basePrice : 1;
}

function baselineFor(ctx: EconomyContext, agg: Record<string, CountryAgg>, countries: string[], goods: string[]): PolicyBaseline {
  const b: PolicyBaseline = { produced: {}, paid: {}, foreignImports: {}, importValueFrom: {}, tariffs: 0 };
  for (const k of countries) {
    const e = agg[k];
    if (!e) continue;
    b.tariffs += e.tariffs;
    b.importValueFrom[k] = { ...e.importValueFrom };
    for (const g of goods) {
      const cg = e.goods[g];
      b.produced[`${k}|${g}`] = cg.produced;
      b.paid[`${k}|${g}`] = paidRatio(ctx, cg, g);
      b.foreignImports[`${k}|${g}`] = cg.foreignImports;
    }
  }
  return b;
}

// ------------------------------------------------------------------ 정책 결정(1월마다)

export function annualPolicyStep(ctx: EconomyContext, state: EconomyState, rng: SeededRNG, events: SimEvent[]): void {
  const P = ctx.data.policy;
  const month = state.month;
  const agg = aggregate(ctx, state);
  const cname = (k: string) => ctx.countryNames[k] ?? k;
  const gname = (g: string) => ctx.goodById[g]?.name ?? g;
  const push = (e: Omit<PolicyEvent, 'type' | 'month'>) => events.push({ type: 'policy', month, ...e });
  const countries = Object.keys(agg);

  // ---- 1) 끝난 정책·유행 알리기, 1년 지난 정책 효과 보고
  for (const p of state.policies) {
    if (p.endMonth <= month && !p.ended) {
      p.ended = true;
      push({ kind: p.kind === 'fta' ? 'fta_end' : 'tariff_end', countries: p.countries, goods: p.goods, text: `${p.title}이(가) 끝났어요.`, causes: [`정해 둔 기간(${Math.round((p.endMonth - p.startMonth) / 12)}년)이 지났어요.`], effects: [] });
    }
    if (!p.reviewed && p.baseline && month - p.startMonth >= 12) {
      p.reviewed = true;
      push({ kind: 'review', countries: p.countries, goods: p.goods, text: `${p.title} 1년 뒤, 무엇이 달라졌을까요?`, causes: [p.title], effects: reviewEffects(ctx, p, agg) });
    }
  }
  for (const w of state.cultureWaves) {
    if (w.endMonth <= month && !w.ended) {
      w.ended = true;
      push({ kind: 'culture_end', countries: w.countries, text: `${w.title}의 인기가 식었어요.`, causes: ['유행은 몇 년이 지나면 잦아들어요.'], effects: [] });
    }
  }
  const live = (k: string) => state.policies.filter((p) => active(p, month) && p.countries.includes(k)).length;

  // ---- 2) 산업 보호 관세: 국내 시설이 놀고 수입품이 많이 들어올 때
  for (const k of countries) {
    if (live(k) >= P.maxActivePerCountry) continue;
    for (const g of ctx.goods) {
      const cg = agg[k].goods[g.id];
      if (cg.capacity <= 0 || cg.used <= 0) continue;
      const util = cg.produced / cg.capacity;
      // 들여온 양이 쓴 양보다 많은 해(재고로 쌓이거나 다시 팔려 나감)도 있으므로 100%를 넘지 않게 본다
      const importShare = Math.min(1, cg.foreignImports / cg.used);
      if (util >= P.protection.utilizationBelow || importShare < P.protection.importShareAbove) continue;
      if (state.policies.some((p) => active(p, month) && p.kind === 'tariff' && p.countries.includes(k) && covers(p.goods, g.id))) continue;
      if (rng.next() >= P.protection.chance) continue;
      const users = ctx.goods.filter((h) => h.recipe?.[g.id]).map((h) => h.name);
      addPolicy(ctx, state, events, agg, {
        kind: 'tariff', countries: [k], goods: [g.id], rate: P.protection.rate, cause: 'protection',
        startMonth: month, endMonth: month + P.protection.years * 12,
        title: `${cname(k)}의 ${g.name} 수입 관세 ${pct(P.protection.rate)}`,
        causes: [
          util < 0.5
            ? `${cname(k)}의 ${g.name} 시설이 절반 넘게 놀고 있었어요(가동률 ${pct(util)}).`
            : `${cname(k)}의 ${g.name} 시설을 다 돌리지 못했어요(가동률 ${pct(util)}).`,
          `${cname(k)}에서 쓰는 ${g.name}의 ${pct(importShare)}가 다른 나라에서 만든 것이었어요.`,
          `국내 ${g.name} 생산자들이 정부에 보호를 요청했어요.`,
        ],
        effects: [
          `${cname(k)}의 ${g.name} 생산자: 수입품이 비싸져 국내 물건이 더 잘 팔릴 수 있어요.`,
          `${cname(k)}의 소비자: ${g.name} 값이 오를 수 있어요.`,
          ...(users.length ? [`${g.name}을(를) 원료로 쓰는 ${users.join('·')} 공장: 원료비가 늘 수 있어요.`] : []),
          `무역회사: ${cname(k)}에 ${g.name}을(를) 팔 때 관세만큼 덜 남아요.`,
        ],
      });
      break;
    }
  }

  // ---- 3) 소비자 반발로 보호 관세를 일찍 거둔다
  for (const p of state.policies) {
    if (!active(p, month) || p.cause !== 'protection' || !p.goods) continue;
    const k = p.countries[0];
    const g = p.goods[0];
    const ratio = paidRatio(ctx, agg[k].goods[g], g);
    if (ratio < P.protection.repealPriceRatio || month - p.startMonth < P.minYears * 12) continue;
    p.endMonth = month;
    p.ended = true;
    state.policyVersion++;
    push({
      kind: 'tariff_repeal', countries: p.countries, goods: p.goods, text: `${p.title}을(를) 일찍 거두었어요.`,
      causes: [`${cname(k)}에서 ${gname(g)} 값이 기준의 ${ratio.toFixed(2)}배까지 올라 소비자와 공장들이 반발했어요.`], effects: [],
    });
  }

  // ---- 4) 무역협정: 서로 많이 사고파는 두 나라
  for (let i = 0; i < countries.length; i++) {
    for (let j = i + 1; j < countries.length; j++) {
      const a = countries[i];
      const b = countries[j];
      if (state.policies.some((p) => active(p, month) && (p.kind === 'fta' || p.cause === 'conflict' || p.cause === 'retaliation') && p.countries.includes(a) && (p.countries.includes(b) || p.targets?.includes(b)))) continue;
      if (live(a) >= P.maxActivePerCountry || live(b) >= P.maxActivePerCountry) continue;
      const ftas = (k: string) => state.policies.filter((p) => active(p, month) && p.kind === 'fta' && p.countries.includes(k)).length;
      if (ftas(a) >= P.maxFtaPerCountry || ftas(b) >= P.maxFtaPerCountry) continue;
      const ab = agg[a].importValueFrom[b] ?? 0;
      const ba = agg[b].importValueFrom[a] ?? 0;
      const share = (ab + ba) / Math.max(1, agg[a].importValue + agg[b].importValue);
      if (share < P.fta.tradeShareAbove || rng.next() >= P.fta.chance) continue;
      addPolicy(ctx, state, events, agg, {
        kind: 'fta', countries: [a, b], rate: 0, cause: 'agreement',
        startMonth: month, endMonth: month + P.fta.years * 12,
        title: `${cname(a)}·${cname(b)} 자유무역협정`,
        causes: [`두 나라의 수입 가운데 ${pct(share)}가 서로에게서 온 것이었어요.`, '관세를 없애 서로 더 싸게 사고팔기로 했어요.'],
        effects: [
          `두 나라가 만든 물건은 서로 관세 없이 팔 수 있어요.`,
          `다른 나라에서 만든 물건은 회원국 항구를 거쳐 와도 혜택이 없어요(원산지 기준).`,
          `협정 밖 나라의 수출업자: 경쟁이 더 어려워질 수 있어요.`,
        ],
      });
    }
  }

  // ---- 5) 무역 갈등: 한쪽으로 크게 기운 무역 적자 → 관세, 상대는 보복
  for (const a of countries) {
    for (const b of countries) {
      if (a === b) continue;
      if (state.policies.some((p) => active(p, month) && (p.cause === 'conflict' || p.cause === 'retaliation') && (p.countries.includes(a) || p.countries.includes(b)))) continue;
      const ab = agg[a].importValueFrom[b] ?? 0;
      const ba = agg[b].importValueFrom[a] ?? 0;
      if (ab < agg[a].importValue * P.conflict.minShareOfImports || ab < P.conflict.deficitRatio * Math.max(ba, 1)) continue;
      if (rng.next() >= P.conflict.chance) continue;
      const top = (imp: string, exp: string, n: number) =>
        ctx.goods
          .map((g) => {
            let v = 0;
            for (const id of ctx.cityIds) if (ctx.countryOfCity[id] === imp) v += state.cities[id].annual.importsFrom[g.id]?.[exp] ?? 0;
            return { id: g.id, v: v * g.basePrice };
          })
          .filter((x) => x.v > 0)
          .sort((x, y) => y.v - x.v)
          .slice(0, n)
          .map((x) => x.id);
      const goodsA = top(a, b, P.conflict.goodsCount);
      const goodsB = top(b, a, Math.max(1, P.conflict.goodsCount - 1));
      if (goodsA.length === 0) continue;
      const years = P.conflict.years;
      addPolicy(ctx, state, events, agg, {
        kind: 'tariff', countries: [a], targets: [b], goods: goodsA, rate: P.conflict.rate, cause: 'conflict',
        startMonth: month, endMonth: month + years * 12,
        title: `${cname(a)}의 ${cname(b)}산 ${goodsA.map(gname).join('·')} 관세 ${pct(P.conflict.rate)}`,
        causes: [`${cname(a)}은(는) ${cname(b)}에서 산 것이 판 것의 ${(ab / Math.max(ba, 1)).toFixed(1)}배였어요(무역 적자).`, '자기 나라 산업을 지키려고 상대 나라 물건에 관세를 매겼어요.'],
        effects: [
          `${cname(a)}의 소비자: ${goodsA.map(gname).join('·')}을(를) 다른 나라에서 사거나 더 비싸게 사야 해요.`,
          `${cname(b)}의 수출업자: ${cname(a)}에 팔기 어려워져 다른 시장을 찾아야 해요.`,
          `무역회사: 다른 나라에서 만든 같은 물건을 실어 가면 관세를 피할 수 있어요.`,
        ],
      });
      if (goodsB.length > 0) {
        addPolicy(ctx, state, events, agg, {
          kind: 'tariff', countries: [b], targets: [a], goods: goodsB, rate: P.conflict.rate, cause: 'retaliation',
          startMonth: month, endMonth: month + years * 12,
          title: `${cname(b)}의 보복 관세: ${cname(a)}산 ${goodsB.map(gname).join('·')} ${pct(P.conflict.rate)}`,
          causes: [`${cname(a)}이(가) 먼저 관세를 매기자 ${cname(b)}도 맞섰어요.`],
          effects: [`${cname(a)}의 수출업자: ${cname(b)}에 팔기 어려워져요.`, '두 나라 사이 무역이 줄고, 다른 나라와의 무역이 늘 수 있어요.'],
        });
      }
    }
  }

  // ---- 6) 문화 유행
  const C = ctx.data.culture;
  if (rng.next() < C.waveChance) {
    const weights = countries.map((k) => (C.influence[k] ?? 0.1) * (agg[k] ? 1 : 0));
    const total = weights.reduce((s, v) => s + v, 0);
    let r = rng.next() * total;
    let brand = countries[0];
    for (let i = 0; i < countries.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        brand = countries[i];
        break;
      }
    }
    const others = countries.filter((k) => k !== brand && !state.cultureWaves.some((w) => active(w, month) && w.brand === brand && w.countries.includes(k)));
    if (others.length > 0) {
      const n = Math.min(others.length, 1 + (rng.next() < 0.4 ? 1 : 0));
      const picked: string[] = [];
      for (let i = 0; i < n; i++) picked.push(others.splice(rng.int(0, others.length - 1), 1)[0]);
      const media = C.media[rng.int(0, C.media.length - 1)];
      const work = C.titles[rng.int(0, C.titles.length - 1)];
      const years = rng.int(C.yearsMin, C.yearsMax);
      const goods = Object.keys(C.sensitivity).filter((g) => (C.sensitivity[g] ?? 0) >= 0.5).map(gname);
      addWave(ctx, state, events, {
        brand, countries: picked, strength: rng.range(C.strengthMin, C.strengthMax),
        startMonth: month, endMonth: month + years * 12,
        title: `${cname(brand)} ${media} 「${work}」 유행`,
        causes: [`${cname(brand)}의 ${media} 「${work}」이(가) ${picked.map(cname).join('·')}에서 큰 인기를 얻었어요.`],
        effects: [
          `${picked.map(cname).join('·')} 사람들이 ${cname(brand)} 상표의 ${goods.join('·')}을(를) 더 찾고, 더 비싸게라도 사려고 해요.`,
          `하지만 물건이 저절로 생기지는 않아요. 누군가 실어 와야 팔 수 있어요.`,
        ],
      });
    }
  }
}

function addPolicy(
  ctx: EconomyContext,
  state: EconomyState,
  events: SimEvent[],
  agg: Record<string, CountryAgg> | null,
  p: Omit<Policy, 'id' | 'reviewed' | 'ended' | 'baseline'>,
): Policy {
  const goods = p.goods ?? ctx.goods.map((g) => g.id);
  const policy: Policy = {
    ...p,
    id: `pol${state.nextPolicyNo++}`,
    reviewed: false,
    ended: false,
    baseline: agg ? baselineFor(ctx, agg, p.countries, goods) : undefined,
  };
  state.policies.push(policy);
  state.policyVersion++;
  events.push({
    type: 'policy', month: state.month,
    kind: p.kind === 'fta' ? 'fta_start' : p.cause === 'conflict' || p.cause === 'retaliation' ? 'conflict_start' : 'tariff_start',
    countries: p.countries, goods: p.goods, text: `${policy.title}을(를) 시작했어요(${Math.round((p.endMonth - p.startMonth) / 12)}년).`,
    causes: p.causes, effects: p.effects,
  });
  return policy;
}

function addWave(ctx: EconomyContext, state: EconomyState, events: SimEvent[], w: Omit<CultureWave, 'id' | 'ended'>): CultureWave {
  const wave: CultureWave = { ...w, id: `cw${state.nextPolicyNo++}`, ended: false };
  state.cultureWaves.push(wave);
  state.policyVersion++;
  events.push({ type: 'policy', month: state.month, kind: 'culture_start', countries: [w.brand, ...w.countries], text: `${w.title}이(가) 시작됐어요.`, causes: w.causes, effects: w.effects });
  return wave;
}

/** 시나리오·교사 설정·테스트용: 지금 바로 정책을 건다(기준선은 다음 1월의 집계로 잡는다) */
export function scenarioPolicy(ctx: EconomyContext, state: EconomyState, events: SimEvent[], p: Omit<Policy, 'id' | 'reviewed' | 'ended' | 'baseline'>): Policy {
  return addPolicy(ctx, state, events, aggregateIfAny(ctx, state), p);
}

export function scenarioWave(ctx: EconomyContext, state: EconomyState, events: SimEvent[], w: Omit<CultureWave, 'id' | 'ended'>): CultureWave {
  return addWave(ctx, state, events, w);
}

/**
 * 시나리오 정책의 비교 기준: 올해 통계가 쌓여 있으면 그것을, 해가 막 바뀌어 비어 있으면 지난해 기록을 쓴다.
 */
function aggregateIfAny(ctx: EconomyContext, state: EconomyState): Record<string, CountryAgg> | null {
  const hasData = ctx.cityIds.some((id) => state.cities[id].annual.months > 0);
  if (hasData) return aggregate(ctx, state);
  const last = state.history[state.history.length - 1];
  if (!last) return null;
  const out: Record<string, CountryAgg> = {};
  for (const [k, c] of Object.entries(last.countries)) {
    const goods: Record<string, CountryGood> = {};
    for (const g of ctx.goods) {
      const from = c.importsByGood[g.id] ?? {};
      const foreign = Object.entries(from).filter(([o]) => o !== k).reduce((s, [, v]) => s + v, 0);
      const used = c.used[g.id] ?? 0;
      goods[g.id] = { produced: c.produced[g.id] ?? 0, capacity: 0, used, foreignImports: foreign, priceSum: (c.paid[g.id] ?? 1) * g.basePrice * used };
    }
    const importValue = Object.values(c.importValueFrom).reduce((s, v) => s + v, 0);
    out[k] = { goods, importValueFrom: { ...c.importValueFrom }, importValue, tariffs: c.tariffs };
  }
  return out;
}

/** 시행 1년 뒤: 이해관계자별로 실제로 생긴 변화 */
function reviewEffects(ctx: EconomyContext, p: Policy, agg: Record<string, CountryAgg>): string[] {
  const b = p.baseline!;
  const out: string[] = [];
  const cname = (k: string) => ctx.countryNames[k] ?? k;
  const goods = p.goods ?? [];
  if (p.kind === 'tariff') {
    for (const k of p.countries) {
      for (const g of goods.slice(0, 3)) {
        const key = `${k}|${g}`;
        const cg = agg[k]?.goods[g];
        if (!cg) continue;
        const name = ctx.goodById[g].name;
        const prod0 = b.produced[key] ?? 0;
        const imp0 = b.foreignImports[key] ?? 0;
        const paid0 = b.paid[key] ?? 1;
        const paid1 = paidRatio(ctx, cg, g);
        if (prod0 > 0) out.push(`생산자: ${cname(k)}의 ${name} 생산 ${signedPct(cg.produced / prod0 - 1)}`);
        out.push(`소비자: ${cname(k)}에서 치른 ${name} 값 ${signedPct(paid1 / paid0 - 1)}`);
        if (imp0 > 0) out.push(`무역: ${cname(k)}의 ${name} 수입 ${signedPct(cg.foreignImports / imp0 - 1)}`);
      }
      const t1 = agg[k]?.tariffs ?? 0;
      out.push(`정부: 이 해 거둔 관세 ${Math.round(t1).toLocaleString('ko-KR')}`);
    }
  } else {
    const [a, c] = p.countries;
    const v0 = (b.importValueFrom[a]?.[c] ?? 0) + (b.importValueFrom[c]?.[a] ?? 0);
    const v1 = (agg[a]?.importValueFrom[c] ?? 0) + (agg[c]?.importValueFrom[a] ?? 0);
    if (v0 > 0) out.push(`두 나라 사이 무역액 ${signedPct(v1 / v0 - 1)}`);
  }
  return out;
}

export { originShares };
