/**
 * 고정 튜토리얼 대본. 시드·항구·상품·수량을 모두 정해 두어 누구나 같은 길을 따라간다.
 * 한 바퀴 동선: 거점 → (추천 무역) → 특산품 사는 곳 → 특산품 파는 곳 → (직접 고른 무역) → 발주 조달처 → 거점.
 * 대본이 있는 튜토리얼 시나리오에서는 무작위 발주가 꺼지고, 발주 장에 들어설 때 대본 발주 한 건만 온다.
 * 값이 바뀌어 대본이 깨지지 않는지는 tests/tutorial.test.ts가 끝까지 재생해 확인한다.
 */
export interface TutorialScript {
  /** 이 대본이 맞춰진 세계 시드(새 게임 화면에서 바꿀 수 없다) */
  seed: string;
  /** 거점(회사 창고가 있는 출발 항구) */
  home: string;
  /** 1장: 힌트 한 줄을 그대로 따라 하는 첫 무역(거점에서 출발) */
  first: { to: string; goodId: string; quantity: number };
  /** 2장: at에서 그 나라 특산품을 사서 다른 나라인 sellAt에 판다 */
  specialty: { at: string; sellAt: string; quantity: number };
  /** 3장: 힌트 없이 지도에서 목적지를 고르고 상품·수량을 정해 무역한다 */
  pick: { from: string; to: string; goodId: string; quantity: number };
  /** 4장: 대본 발주. 조달처에서 사서 납품처로 실어 간다 */
  order: { sourceCityId: string; cityId: string; goodId: string; quantity: number };
  /** 5장: 거점에서 사서 회사 창고에 맡길 상품 */
  store: { goodId: string; quantity: number };
  /** 8장: 거점과 오가는 정기 항로 */
  route: { to: string; goodId: string };
}

/** 시나리오 id → 대본 */
export const TUTORIAL_SCRIPTS: Record<string, TutorialScript> = {
  tutorial: {
    seed: 'trade-world-1',
    home: 'portabel',
    first: { to: 'rivana', goodId: 'textiles', quantity: 45 },
    specialty: { at: 'rivana', sellAt: 'granbel', quantity: 12 },
    pick: { from: 'granbel', to: 'bellona', goodId: 'automobiles', quantity: 4 },
    order: { sourceCityId: 'bellona', cityId: 'portabel', goodId: 'processed_food', quantity: 20 },
    store: { goodId: 'textiles', quantity: 10 },
    route: { to: 'rivana', goodId: 'textiles' },
  },
  // 현실 지구: 부산 → 요코하마(화장품) → 상하이(일본 특산 자동차) → 톈진(과일) → 부산(원유 발주)
  'earth-tutorial': {
    seed: 'earth-1',
    home: 'busan',
    first: { to: 'yokohama', goodId: 'cosmetics', quantity: 14 },
    specialty: { at: 'yokohama', sellAt: 'shanghai', quantity: 6 },
    pick: { from: 'shanghai', to: 'tianjin', goodId: 'fruit', quantity: 30 },
    order: { sourceCityId: 'tianjin', cityId: 'busan', goodId: 'crude_oil', quantity: 20 },
    store: { goodId: 'cosmetics', quantity: 10 },
    route: { to: 'yokohama', goodId: 'cosmetics' },
  },
};

export function tutorialScript(scenarioId: string | undefined): TutorialScript | undefined {
  return scenarioId ? TUTORIAL_SCRIPTS[scenarioId] : undefined;
}
