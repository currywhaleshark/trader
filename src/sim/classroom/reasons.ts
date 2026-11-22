import { culturePremium } from '../economy/policy';
import { formatResidents, marketPopulation } from '../economy/population';
import { shareOf } from '../economy/origin';
import type { EconomyContext, EconomyState, TradeReason } from '../economy/types';

/**
 * "왜 여기서는 싸고 저기서는 비쌌을까?"를 학생 말로 설명한다(M5 거래 연대기·리포트용).
 * 무역이 생기는 이유를 사회과 성취기준([6사11-03])의 말로 묶는다:
 *  - climate: 기후가 달라 기를 수 있는 작물이 다르다
 *  - resource: 땅속 자원이 고르게 묻혀 있지 않다
 *  - industry: 공장·기술이 있는 곳과 없는 곳이 있다
 *  - season: 남북반구의 계절이 반대라 수확 시기가 다르다
 *  - shortage: 흉작·사고로 갑자기 모자라졌다
 *  - demand: 사람이 많거나 잘살아 많이 쓴다
 *  - policy: 관세·협정 같은 나라의 정책
 *  - culture: 문화 유행으로 그 나라 상표를 찾는다
 */
export type Reason = TradeReason;
export type ReasonCategory = TradeReason['category'];

export const REASON_NAMES: Record<ReasonCategory, string> = {
  climate: '기후가 달라서',
  resource: '자원이 달라서',
  industry: '공장·기술이 달라서',
  season: '계절이 달라서',
  shortage: '갑자기 모자라서',
  demand: '쓰는 사람이 많아서',
  policy: '나라의 정책 때문에',
  culture: '문화 유행 때문에',
  market: '값의 차이',
};

const MONTH = (m: number) => `${(m % 12) + 1}월`;

/** 이 도시의 기후가 작물 생육 조건과 어떻게 다른가(학생 말로) */
function climateMismatch(ctx: EconomyContext, cityId: string, cropId: string): string {
  const info = ctx.cityInfo[cityId];
  const need = ctx.cropNeeds[cropId];
  if (!need) return `${info.climate} 기후라`;
  const avgPrecip = info.annualPrecip / 12;
  const parts: string[] = [];
  if (avgPrecip < need.water[1]) parts.push(`비가 적고(연 ${info.annualPrecip}mm)`);
  else if (info.precipMin > need.water[2]) parts.push(`비가 너무 많고(연 ${info.annualPrecip}mm)`);
  if (info.tempMax < need.temp[1]) parts.push(`여름에도 서늘하고(가장 더운 달 ${info.tempMax}°C)`);
  else if (info.tempMin > need.temp[2]) parts.push(`너무 덥고(가장 서늘한 달 ${info.tempMin}°C)`);
  else if (info.tempMin < need.temp[0] && info.tempMax - info.tempMin > 15) parts.push(`겨울이 길고 추워(가장 추운 달 ${info.tempMin}°C)`);
  if (parts.length === 0) return `${info.climate} 기후인데 알맞은 땅이 적어`;
  return parts.join(' ').replace(/고\(([^)]*)\)$/, '어($1)').replace(/고$/, '어');
}

/** 이 도시의 기후가 작물에 알맞은 점 */
function climateFit(ctx: EconomyContext, cityId: string, cropId: string): string {
  const info = ctx.cityInfo[cityId];
  return `${info.climate} 기후(연 강수 ${info.annualPrecip}mm, 기온 ${info.tempMin}~${info.tempMax}°C)`;
}

/** 이 도시에서 이 상품이 싼(남는) 까닭 */
export function explainSource(ctx: EconomyContext, state: EconomyState, cityId: string, goodId: string): Reason {
  const g = ctx.goodById[goodId];
  const city = state.cities[cityId];
  const name = ctx.cityNames[cityId];
  const info = ctx.cityInfo[cityId];
  const ind = city.industries.find((i) => i.goodId === goodId);
  if (g.source?.kind === 'crop' && ind) {
    const coef = ctx.cropCoef[cityId]?.[g.source.id];
    if (coef && coef[state.month % 12] >= 1.8) {
      return { category: 'season', text: `${name}은(는) 지금(${MONTH(state.month)})이 ${g.name} 수확철이라 한꺼번에 많이 나왔어요.` };
    }
    const suit = info.cropSuitability[g.source.id] ?? 0;
    return {
      category: 'climate',
      text: `${name} 주변은 ${climateFit(ctx, cityId, g.source.id)}라 ${g.name}을(를) 기르기 ${suit >= 0.5 ? '아주 ' : ''}알맞아요.`,
    };
  }
  if (g.source?.kind === 'resource' && ind) {
    return { category: 'resource', text: `${name} 주변 땅속에 ${g.name}이(가) 많이 묻혀 있어요.` };
  }
  if (ind) {
    const tech = state.tech[city.countryId] ?? 0;
    return { category: 'industry', text: `${name}에는 ${g.name} 공장이 있고, ${ctx.countryNames[city.countryId]}의 기술 수준(${tech.toFixed(1)})이 높아 많이 만들어요.` };
  }
  return { category: 'market', text: `${name}에는 ${g.name}이(가) 쓰고도 남을 만큼 쌓여 있었어요.` };
}

/** 이 도시에서 이 상품이 비싼(모자란) 까닭 */
export function explainDestination(ctx: EconomyContext, state: EconomyState, cityId: string, goodId: string, brand?: string): Reason {
  const g = ctx.goodById[goodId];
  const city = state.cities[cityId];
  const name = ctx.cityNames[cityId];
  const info = ctx.cityInfo[cityId];
  if (brand && culturePremium(ctx, state, city.countryId, goodId, brand) > 0) {
    return { category: 'culture', text: `${name}에서는 ${ctx.countryNames[brand]} 문화가 유행해 ${ctx.countryNames[brand]} 상표 ${g.name}을(를) 더 찾아요.` };
  }
  if (brand && ctx.reputation.premiums[brand]?.[goodId]) {
    return { category: 'industry', text: `${ctx.countryNames[brand]} 브랜드 ${g.name}에는 산업 평판 웃돈이 붙어요.` };
  }
  const hit = state.modifiers.find((m) => m.cityId === cityId && m.goodId === goodId && m.factor < 1);
  if (hit) return { category: 'shortage', text: `${name}에서 ${hit.reason}(으)로 ${g.name} 생산이 줄어 모자랐어요.` };
  const users = city.industries.filter((i) => ctx.goodById[i.goodId].recipe?.[goodId]);
  if (users.length > 0 && !city.industries.some((i) => i.goodId === goodId)) {
    const products = users.map((i) => ctx.goodById[i.goodId].name).join('·');
    return { category: 'industry', text: `${name}의 ${products} 공장에서 원료로 쓸 ${g.name}을(를) 다른 항구에서 사 와야 해요.` };
  }
  if ((ctx.data.cities[cityId]?.demand?.[goodId] ?? 1) >= 1.4) {
    return { category: 'demand', text: `${name}에서는 생활·산업 특성 때문에 ${g.name}을(를) 다른 도시보다 많이 소비해요.` };
  }
  const ind = city.industries.find((i) => i.goodId === goodId);
  if (!ind) {
    if (g.source?.kind === 'crop') {
      const suit = info.cropSuitability[g.source.id] ?? 0;
      if (suit < 0.25) return { category: 'climate', text: `${name} 주변은 ${climateMismatch(ctx, cityId, g.source.id)} ${g.name}을(를) 기르기 어려워요.` };
      return { category: 'market', text: `${name}에는 ${g.name} 농장이 없어 다른 곳에서 사 와야 해요.` };
    }
    if (g.source?.kind === 'resource') return { category: 'resource', text: `${name} 주변에는 ${g.name}이(가) 묻혀 있지 않아 다른 곳에서 사 와야 해요.` };
    const tech = state.tech[city.countryId] ?? 0;
    if (tech < g.techRequired) {
      return { category: 'industry', text: `${ctx.countryNames[city.countryId]}은(는) 아직 ${g.name}을(를) 만들 기술(필요 ${g.techRequired}, 지금 ${tech.toFixed(1)})이 없어요.` };
    }
    return { category: 'industry', text: `${name}에는 ${g.name} 공장이 없어 다른 항구에서 사 와야 해요.` };
  }
  if (g.source?.kind === 'crop') {
    const coef = ctx.cropCoef[cityId]?.[g.source.id];
    if (coef && coef[state.month % 12] < 0.5) {
      return { category: 'season', text: `${name}은(는) 지금(${MONTH(state.month)}) ${g.name} 수확철이 아니라 창고가 비어 가요.` };
    }
  }
  if (city.population >= 9 || city.income >= 1.3) {
    const residents = marketPopulation(ctx.data, city).market;
    return { category: 'demand', text: `${name} 시장은 배후지를 포함해 ${formatResidents(residents)}에게 공급해요. 이곳의 인구와 소득이 ${g.name} 소비에 반영돼요.` };
  }
  return { category: 'market', text: `${name}에서는 만드는 양보다 쓰는 양이 많아 ${g.name}이(가) 모자랐어요.` };
}

/** 협정 덕분에 관세를 내지 않았다면 한 줄 */
export function explainExemption(ctx: EconomyContext, avoided: number, destCountry: string, origin: string): Reason | null {
  if (avoided <= 0.001) return null;
  return {
    category: 'policy',
    text: `${ctx.countryNames[origin]}과(와) ${ctx.countryNames[destCountry]}은(는) 자유무역협정을 맺어, 다른 나라 물건에 붙는 관세 ${Math.round(avoided * 100)}%를 내지 않았어요.`,
  };
}

/** 관세·협정이 이 판매에 영향을 줬다면 한 줄 */
export function explainPolicy(ctx: EconomyContext, tariffRate: number, destCountry: string, origin: string): Reason | null {
  if (tariffRate > 0.001) {
    return { category: 'policy', text: `${ctx.countryNames[destCountry]}은(는) ${ctx.countryNames[origin]}산에 관세 ${Math.round(tariffRate * 100)}%를 매겨요.` };
  }
  return null;
}

export { shareOf };
