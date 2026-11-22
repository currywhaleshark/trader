import { EARTH_SPECIALTIES, INDUSTRY_SPECIALTY_NAMES } from '../earth/specialtyNames';
import { maxBuyable, quoteBuy, type PurchaseQuote } from './market';
import { splitKey } from './origin';
import { cityTrust, trustLevel } from './trust';
import type { CargoLot, EconomyContext, EconomyState } from './types';

/** 특산품은 별도 수요를 만들지 않는다. 일반 재고 중 선별해 수출하는 한정 물량이다. */
export const SPECIALTY_RULES = {
  productionShare: 0.08,
  monthlyVolume: 6,
  stockMonths: 2,
  foreignPremium: 0.35,
  minimumMargin: 0.25,
} as const;

export interface SpecialtyDef { id: string; countryId: string; goodId: string; name: string }

// 이름 조사 전 저장한 재고는 기존 계열과 수출 보증을 유지한다. 새로 공급하지 않는다.
const LEGACY_EARTH_SPECIALTIES: Record<string, Omit<SpecialtyDef, 'id'>> = {
  'bel:fuel': { countryId: 'bel', goodId: 'fuel', name: '벨기에 정제연료' },
  'esp:automobiles': { countryId: 'esp', goodId: 'automobiles', name: '스페인 승용차' },
  'can:furniture': { countryId: 'can', goodId: 'furniture', name: '캐나다 목제 가구' },
  'eth:clothing': { countryId: 'eth', goodId: 'clothing', name: '에티오피아 면직 의류' },
};

/** 가상 세계의 대표 산업은 세계 생성 때 정해지고 저장된 평판 배정을 그대로 사용한다. */
export function specialties(ctx: EconomyContext): SpecialtyDef[] {
  return Object.keys(ctx.countryNames).flatMap((countryId) => {
    const earth = ctx.data.profile.mode === 'earth';
    const named = earth ? EARTH_SPECIALTIES[countryId] : undefined;
    if (earth && !named) return [];
    const goodId = named?.goodId ?? Object.entries(ctx.reputation.premiums[countryId] ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
    if (!goodId || !ctx.goodById[goodId]) return [];
    const names = INDUSTRY_SPECIALTY_NAMES[goodId] ?? [ctx.goodById[goodId].name];
    const index = Array.from(countryId).reduce((hash, char) => (hash * 31 + char.charCodeAt(0)) >>> 0, 0) % names.length;
    return [{ id: `${countryId}:${goodId}`, countryId, goodId, name: named?.name ?? `${ctx.countryNames[countryId]} ${names[index]}` }];
  });
}

export function specialtyById(ctx: EconomyContext, id: string | null | undefined): SpecialtyDef | undefined {
  if (!id) return undefined;
  const current = specialties(ctx).find((s) => s.id === id);
  const legacy = ctx.data.profile.mode === 'earth' ? LEGACY_EARTH_SPECIALTIES[id] : undefined;
  return current ?? (legacy && ctx.countryNames[legacy.countryId] ? { id, ...legacy } : undefined);
}

export function citySpecialties(ctx: EconomyContext, state: EconomyState, cityId: string): SpecialtyDef[] {
  const city = state.cities[cityId];
  return specialties(ctx).filter((s) => s.countryId === city.countryId && city.industries.some((i) => i.goodId === s.goodId && i.capacity > 0 && (!i.brandCountryId || i.brandCountryId === city.countryId)));
}

/** 국가 전체가 공유하는 기본 공급 배정량(신뢰 혜택 적용 전). 조회는 저장 상태를 바꾸지 않는다. */
export function specialtySupply(ctx: EconomyContext, state: EconomyState, def: SpecialtyDef) {
  const monthlyCap = Math.floor(SPECIALTY_RULES.monthlyVolume / ctx.goodById[def.goodId].volume);
  const capacity = monthlyCap * SPECIALTY_RULES.stockMonths;
  const produced = ctx.cityIds.filter((id) => ctx.countryOfCity[id] === def.countryId).reduce((q, id) => {
    const city = state.cities[id];
    // 아직 한 달도 생산하지 않은 새 세계는 초기 시설을 기준으로 한 번 배정한다.
    return q + (state.month === 0 ? city.industries.filter((i) => i.goodId === def.goodId).reduce((n, i) => n + i.capacity, 0) : city.last.produced[def.goodId]);
  }, 0);
  const refill = Math.min(monthlyCap, Math.floor(Math.max(0, produced) * SPECIALTY_RULES.productionShare));
  const saved = state.specialtySupply?.[def.id];
  const remaining = saved ? Math.min(capacity, Math.max(0, saved.remaining) + Math.max(0, state.month - saved.month) * refill) : refill;
  return { month: state.month, remaining, refill, capacity, monthlyCap };
}

export function tickSpecialties(ctx: EconomyContext, state: EconomyState): void {
  const supplies = (state.specialtySupply ??= {});
  for (const def of specialties(ctx)) {
    const supply = specialtySupply(ctx, state, def);
    supplies[def.id] = { month: state.month, remaining: supply.remaining };
  }
}

function supplyMultiplier(state: EconomyState, cityId: string): number {
  return 1 + trustLevel(cityTrust(state, cityId).score).specialtyBonus;
}

/**
 * 높은 신뢰도는 같은 기본 배정에서 최대 30% 더 선별해 주는 혜택이다.
 * 국가 공통 배정을 비례 차감하므로 나눠 사거나 항구·배를 바꿔도 한도가 복제되지 않는다.
 */
export function consumeSpecialtySupply(ctx: EconomyContext, state: EconomyState, cityId: string, def: SpecialtyDef, quantity: number): void {
  const supply = specialtySupply(ctx, state, def);
  (state.specialtySupply ??= {})[def.id] = {
    month: state.month,
    remaining: Math.max(0, supply.remaining - quantity / supplyMultiplier(state, cityId)),
  };
}

/** 신뢰 혜택은 공급 배정만 늘린다. 일반 재고·주민 몫·국내 생산분은 그대로 지킨다. */
export function specialtyAvailable(ctx: EconomyContext, state: EconomyState, cityId: string, def: SpecialtyDef): number {
  if (!citySpecialties(ctx, state, cityId).some((s) => s.id === def.id)) return 0;
  const city = state.cities[cityId];
  const domestic = Object.entries(city.mix[def.goodId] ?? {}).reduce((q, [key, n]) => {
    const part = splitKey(key);
    return q + (part.origin === def.countryId && part.brand === def.countryId ? n : 0);
  }, 0);
  const allocation = specialtySupply(ctx, state, def).remaining * supplyMultiplier(state, cityId);
  return Math.max(0, Math.min(domestic, maxBuyable(ctx, city, def.goodId), allocation));
}

export function quoteSpecialtyBuy(ctx: EconomyContext, state: EconomyState, cityId: string, def: SpecialtyDef, quantity: number): PurchaseQuote {
  return quoteBuy(ctx, state.cities[cityId], def.goodId, Math.min(quantity, specialtyAvailable(ctx, state, cityId, def)), state, def.countryId, undefined, def.countryId);
}

/** 해외에서 첫 판매할 때의 순수령 최저가. 운항·보관·부패 비용은 따로 든다. */
export function specialtySaleUnit(ctx: EconomyContext, lot: CargoLot, destCountry: string, marketGross: number, tariff: number, fee: number) {
  const def = specialtyById(ctx, lot.specialtyId);
  const eligible = def && def.goodId === lot.goodId && def.countryId === lot.originCountryId && def.countryId === lot.brandCountryId && ctx.countryOfCity[lot.originCityId] === def.countryId && destCountry !== def.countryId;
  if (!eligible) return { grossUnit: marketGross, minimumNet: 0, floorApplied: false };
  const minimumNet = lot.unitCost * (1 + SPECIALTY_RULES.minimumMargin);
  const premiumGross = marketGross * (1 + SPECIALTY_RULES.foreignPremium);
  const floorGross = (minimumNet + fee) / Math.max(1e-6, 1 - tariff);
  return { grossUnit: Math.max(premiumGross, floorGross), minimumNet, floorApplied: floorGross > premiumGross };
}
