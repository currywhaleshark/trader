import { citySpecialties, specialties, specialtyById } from './specialties';
import type { CargoLot, EconomyContext, EconomyState } from './types';

/** 상품은 따로 거래하되, goodId가 가리키는 계열의 시세·수요·운송 규칙을 공유한다. */
export interface TradeProduct {
  id: string;
  goodId: string;
  name: string;
  specialtyId: string | null;
}

export function productCatalog(ctx: EconomyContext): TradeProduct[] {
  const regional = specialties(ctx);
  return ctx.goods.flatMap((g) => [
    { id: g.id, goodId: g.id, name: g.name, specialtyId: null },
    ...regional.filter((s) => s.goodId === g.id).map((s) => ({ id: s.id, goodId: g.id, name: s.name, specialtyId: s.id })),
  ]);
}

/** undefined는 기존 계열 전체 명령, null은 일반 상품, 문자열은 해당 특산품만 선택한다. */
export function matchesProduct(lot: CargoLot, goodId: string, specialtyId?: string | null): boolean {
  return lot.goodId === goodId && (specialtyId === undefined || (lot.specialtyId ?? null) === specialtyId);
}

export const productIdOf = (lot: CargoLot): string => lot.specialtyId ?? lot.goodId;

export function cargoProducts(ctx: EconomyContext, lots: CargoLot[]): TradeProduct[] {
  const ids = new Set(lots.filter((l) => l.quantity > 1e-9).map(productIdOf));
  const products = productCatalog(ctx).filter((p) => ids.has(p.id));
  for (const id of ids) {
    if (products.some((p) => p.id === id)) continue;
    const legacy = specialtyById(ctx, id);
    if (legacy) products.push({ id, goodId: legacy.goodId, name: legacy.name, specialtyId: id });
  }
  return products;
}

export function marketProducts(ctx: EconomyContext, state: EconomyState, cityId: string): TradeProduct[] {
  const local = new Set(citySpecialties(ctx, state, cityId).map((s) => s.id));
  return productCatalog(ctx).filter((p) => p.specialtyId ? local.has(p.id) : state.cities[cityId].target[p.goodId] > 0);
}
