import type { ScenarioGoal } from './scenarios';

/** 튜토리얼 시나리오(가상 세계·현실 지구)가 함께 쓰는 목표. 튜토리얼의 장과 같은 차례다. */
export const TUTORIAL_GOALS: ScenarioGoal[] = [
  { id: 'first-sale', text: '추천대로 첫 무역 하기', check: { kind: 'firstSale' } },
  { id: 'specialty', text: '한정 특산품을 다른 나라에 팔기', check: { kind: 'specialtySale' } },
  { id: 'order', text: '도시 발주를 받아 모두 납품하기', check: { kind: 'ordersCompleted', target: 1 } },
  { id: 'warehouse', text: '회사 창고에 물건 맡기기', check: { kind: 'warehouse' } },
  { id: 'ships', text: '배 두 척 가지기', check: { kind: 'ships', target: 2 } },
  { id: 'route', text: '정기 항로에 배 맡기기', check: { kind: 'routeShip' } },
];
