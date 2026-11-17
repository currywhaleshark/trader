import { explainDestination, explainSource } from '../classroom/reasons';
import type { CityEconomy, EconomyContext, EconomyState, TradeReason } from './types';

/**
 * 정기 항로를 짤 때 보는 "이 항구의 값 성향": 대체로 싸게 살 수 있는 상품과 비싸게 팔 수 있는 상품.
 * 한 번의 시세가 아니라 올해 들어 지금까지의 평균 값을 세계 평균과 견준다(해가 바뀐 직후에는 지금 값뿐이다).
 * 정답을 알려 주는 기능이 아니라, 학생이 이유를 읽고 항로를 고르도록 돕는 정보다.
 */
export interface OutlookItem {
  goodId: string;
  /** 이 항구의 평소 값 */
  price: number;
  /** 평소 값 / 세계 평균 */
  vsWorld: number;
  /** 기후·자원·공장처럼 잘 바뀌지 않는 까닭이면 true, 수확철·사고처럼 한때의 까닭이면 false */
  steady: boolean;
  reason: TradeReason;
}

export interface PortOutlook {
  cheap: OutlookItem[];
  dear: OutlookItem[];
}

/** 세계 평균보다 이만큼 싸야/비싸야 눈에 띄는 것으로 친다 */
const CHEAP = 0.88;
const DEAR = 1.12;

const STEADY_CHEAP: TradeReason['category'][] = ['climate', 'resource', 'industry'];
const STEADY_DEAR: TradeReason['category'][] = ['climate', 'resource', 'industry', 'demand'];

/** 올해 들어 지금까지의 평균 값(이번 달 포함) */
function typicalPrice(city: CityEconomy, goodId: string): number {
  const a = city.annual;
  return ((a.priceSum[goodId] ?? 0) + city.price[goodId]) / ((a.priceSum[goodId] === undefined ? 0 : a.months) + 1);
}

/** 거래 기록용 문장(지난 일)을 지금의 성향을 말하는 문장으로 */
function present(reason: TradeReason): TradeReason {
  return { ...reason, text: reason.text.replace('쌓여 있었어요', '쌓여 있어요').replace('모자랐어요', '모자라요').replace('많이 나왔어요', '많이 나와요') };
}

export function portOutlook(ctx: EconomyContext, state: EconomyState, cityId: string): PortOutlook {
  const city = state.cities[cityId];
  const cheap: OutlookItem[] = [];
  const dear: OutlookItem[] = [];
  for (const g of ctx.goods) {
    if (city.target[g.id] <= 0) continue; // 이 항구에는 그 상품의 시장이 없다
    let sum = 0;
    let n = 0;
    for (const id of ctx.cityIds) {
      const c = state.cities[id];
      if (c.target[g.id] <= 0) continue;
      sum += typicalPrice(c, g.id);
      n++;
    }
    if (n < 2) continue;
    const price = typicalPrice(city, g.id);
    const vsWorld = price / (sum / n);
    if (vsWorld <= CHEAP) {
      const reason = present(explainSource(ctx, state, cityId, g.id));
      cheap.push({ goodId: g.id, price, vsWorld, steady: STEADY_CHEAP.includes(reason.category), reason });
    } else if (vsWorld >= DEAR) {
      const reason = present(explainDestination(ctx, state, cityId, g.id));
      dear.push({ goodId: g.id, price, vsWorld, steady: STEADY_DEAR.includes(reason.category), reason });
    }
  }
  // 꾸준한 것 먼저, 그 안에서는 차이가 큰 순서
  cheap.sort((a, b) => Number(b.steady) - Number(a.steady) || a.vsWorld - b.vsWorld);
  dear.sort((a, b) => Number(b.steady) - Number(a.steady) || b.vsWorld - a.vsWorld);
  return { cheap, dear };
}
