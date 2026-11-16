import type { CityEconomy } from './types';

/**
 * 도시 재고의 원산지·브랜드 구성(M4).
 * 재고 한 단위마다 "어느 나라에서 만들었나(원산지)"와 "어느 나라 상표인가(브랜드)"를 함께 기록한다.
 *  - 생산하면 그 도시 나라산(브랜드는 시설의 상표 나라)으로 들어간다.
 *  - 소비·공장 투입·판매로 나갈 때는 구성 비율대로 빠진다.
 *  - 그래서 수입품을 창고에 넣었다가 다시 사 가도 원산지가 바뀌지 않는다(단순 환적은 원산지를 바꾸지 않는다).
 * 원산지가 바뀌는 길은 오직 "다른 나라 공장의 원료로 쓰여 새 상품이 되는 것"뿐이다.
 */
export interface StockPart {
  origin: string;
  brand: string;
  quantity: number;
}

export function originKey(origin: string, brand: string): string {
  return `${origin}/${brand}`;
}

export function splitKey(key: string): { origin: string; brand: string } {
  const k = key.indexOf('/');
  return { origin: key.slice(0, k), brand: key.slice(k + 1) };
}

export function addStock(city: CityEconomy, goodId: string, quantity: number, origin: string, brand: string): void {
  if (!(quantity > 0)) return;
  city.stock[goodId] += quantity;
  const mix = (city.mix[goodId] ??= {});
  const key = originKey(origin, brand);
  mix[key] = (mix[key] ?? 0) + quantity;
}

/** 재고에서 quantity만큼 구성 비율대로 꺼낸다. 꺼낸 몫들을 돌려준다. */
export function takeStock(city: CityEconomy, goodId: string, quantity: number): StockPart[] {
  const stock = city.stock[goodId];
  const q = Math.min(quantity, stock);
  if (!(q > 0)) return [];
  const mix = (city.mix[goodId] ??= {});
  const ratio = q / stock;
  const parts: StockPart[] = [];
  if (ratio >= 1 - 1e-12) {
    for (const [key, v] of Object.entries(mix)) if (v > 0) parts.push({ ...splitKey(key), quantity: v });
    city.mix[goodId] = {};
    city.stock[goodId] = 0;
    return scaleParts(parts, q);
  }
  for (const [key, v] of Object.entries(mix)) {
    const take = v * ratio;
    if (take <= 0) continue;
    mix[key] = v - take;
    parts.push({ ...splitKey(key), quantity: take });
  }
  city.stock[goodId] = stock - q;
  if (city.stock[goodId] < 1e-9) {
    city.stock[goodId] = 0;
    city.mix[goodId] = {};
  }
  return scaleParts(parts, q);
}

/** 구성 합이 재고와 어긋난 만큼(부동소수 오차) 맞춘다 */
function scaleParts(parts: StockPart[], total: number): StockPart[] {
  const sum = parts.reduce((s, p) => s + p.quantity, 0);
  if (sum <= 0) return [];
  const k = total / sum;
  for (const p of parts) p.quantity *= k;
  return parts;
}

/** 재고 중 원산지(또는 브랜드)가 이 나라인 비율 */
export function shareOf(city: CityEconomy, goodId: string, countryId: string, by: 'origin' | 'brand'): number {
  const mix = city.mix[goodId];
  const stock = city.stock[goodId];
  if (!mix || stock <= 0) return 0;
  let q = 0;
  for (const [key, v] of Object.entries(mix)) if (splitKey(key)[by] === countryId) q += v;
  return Math.min(1, q / stock);
}

/** 원산지별 비율 */
export function originShares(city: CityEconomy, goodId: string): Record<string, number> {
  const mix = city.mix[goodId];
  const stock = city.stock[goodId];
  const out: Record<string, number> = {};
  if (!mix || stock <= 0) return out;
  for (const [key, v] of Object.entries(mix)) {
    const o = splitKey(key).origin;
    out[o] = (out[o] ?? 0) + v / stock;
  }
  return out;
}
