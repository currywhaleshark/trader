import { citySpecialties, specialtyAvailable, specialtyById, specialtySupply, SPECIALTY_RULES } from '../sim/economy/specialties';
import type { CargoLot, EconomyContext } from '../sim/economy/types';
import { cityTrust, trustLevel, TRUST_LEVELS } from '../sim/economy/trust';
import { GoodIcon, Icon } from './icons';
import { qty } from './tradeModel';
import type { Simulation } from './useSimulation';

export function SpecialtyInfo({ sim, cityId }: { sim: Pick<Simulation, 'ctx' | 'state'>; cityId: string }) {
  const { ctx, state } = sim;
  const items = citySpecialties(ctx, state, cityId);
  if (!items.length) return null;
  const trust = cityTrust(state, cityId), level = trustLevel(trust.score);
  const next = TRUST_LEVELS.find((l) => l.score > trust.score);
  return <section className="specialty-info" aria-label="이 지역의 특산품">
    <p><Icon name="building-community" size={16} /> 도시 신뢰도 {trust.score} · {level.name} · 특산품 물량 <b>+{Math.round(level.specialtyBonus * 100)}%</b></p>
    {items.map((item) => {
      const supply = specialtySupply(ctx, state, item);
      return <div key={item.id}>
        <b><Icon name="award" size={18} /> {item.name} <span className="specialty-tag">한정 특산품</span></b>
        <p><GoodIcon id={item.goodId} size={16} /> {ctx.goodById[item.goodId].name} 계열 · 별도 상품 · 시세·수요 공유</p>
        <p>이 항구 구매 가능 {Math.floor(specialtyAvailable(ctx, state, cityId, item) + 1e-9)}개{level.specialtyBonus > 0 ? ' (신뢰 혜택 적용)' : ''} · 국가 공통 기본 공급 {qty(supply.remaining)}개</p>
        <small>기본 공급은 매달 최대 {supply.monthlyCap}개, 실제 생산의 {Math.round(SPECIALTY_RULES.productionShare * 100)}% 이내로 보충 · 최대 {supply.capacity}개까지 누적</small>
      </div>;
    })}
    <details><summary>신뢰가 쌓이면 물량을 더 살 수 있어요</summary><p>도시 신뢰도 20·50·80점에서 특산품 구매 물량이 10·20·30% 늘어요. {next ? `다음 혜택까지 ${next.score - trust.score}점 남았어요.` : '최대 물량 혜택을 받고 있어요.'}</p><p>이 도시의 신뢰도가 적용되며 국가 공통 한도를 함께 써요. 실제 판매 재고가 있어야 살 수 있어요. 구매는 1개 단위이며 남은 배정은 누적 상한 안에서 다음 달로 이월돼요. 배나 항구를 바꿔도 한도가 새로 생기지는 않아요.</p></details>
    <details><summary>해외에서 더 비싸게 팔 수 있어요</summary><p>해외 일반 판매에서 시세에 {Math.round(SPECIALTY_RULES.foreignPremium * 100)}% 웃돈을 붙여요. 값이 떨어져도 판매한 물량의 관세·하역비를 뺀 대금은 매입원가보다 최소 {Math.round(SPECIALTY_RULES.minimumMargin * 100)}% 높아요.</p><p>운항·보관비와 부패 손실은 별도예요. 국내 판매에는 혜택이 없고, 발주는 계약 단가를 따라요. 판매하면 수출 보증이 끝나며, 일반 상품으로 시장에 풀려요.</p></details>
  </section>;
}

export function SpecialtyCargo({ ctx, lots }: { ctx: EconomyContext; lots: CargoLot[] }) {
  const names = [...new Set(lots.map((l) => specialtyById(ctx, l.specialtyId)?.name).filter(Boolean))];
  return names.length ? <span className="specialty-tag" title={names.join(' · ')}>특산 · {names.join(' · ')}</span> : null;
}
