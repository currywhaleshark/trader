import type { CityTradeTrust, EconomyState, TradeOrder } from './types';

export const TRUST_RULES = { completed: 10, cancelled: -5, expired: -8, max: 100 } as const;
export const TRUST_LEVELS = [
  { score: 0, name: '새 거래처', bonus: 0, specialtyBonus: 0, localInterval: 4 },
  { score: 20, name: '익숙한 거래처', bonus: 0.05, specialtyBonus: 0.10, localInterval: 3 },
  { score: 50, name: '믿을 만한 거래처', bonus: 0.10, specialtyBonus: 0.20, localInterval: 2 },
  { score: 80, name: '우수 협력사', bonus: 0.15, specialtyBonus: 0.30, localInterval: 2 },
] as const;

export function cityTrust(state: EconomyState, cityId: string): CityTradeTrust {
  return state.player.cityTrust?.[cityId] ?? { score: 0, completed: 0, cancelled: 0, expired: 0 };
}

export function trustLevel(score: number) {
  return [...TRUST_LEVELS].reverse().find((level) => score >= level.score) ?? TRUST_LEVELS[0];
}

/** 지난 이력은 소급 계산하지 않는다. 실제로 종료되는 계약에 한 번만 적용한다. */
export function settleOrderTrust(state: EconomyState, order: TradeOrder): number {
  if (order.trustChange !== undefined || order.acceptedMonth === undefined) return 0;
  const outcome = order.status;
  if (outcome !== 'completed' && outcome !== 'cancelled' && outcome !== 'expired') return 0;
  const trust = cityTrust(state, order.cityId);
  const next = Math.max(0, Math.min(TRUST_RULES.max, trust.score + TRUST_RULES[outcome]));
  order.trustChange = next - trust.score;
  trust.score = next;
  trust[outcome]++;
  trust.lastChange = { month: state.month, orderId: order.id, delta: order.trustChange, outcome };
  (state.player.cityTrust ??= {})[order.cityId] = trust;
  return order.trustChange;
}

export function trustChangeText(change: number): string {
  return `지역 신뢰도 ${change >= 0 ? '+' : ''}${change}`;
}
