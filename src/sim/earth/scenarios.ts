import type { ScenarioDef } from '../classroom/scenarios';

/**
 * 현실 지구 수업 시나리오(§14.4). 대상 id는 현실 지구 경제권·나라·통과 지점이다.
 * 사건은 모두 "게임 속 사건"이다: 실제 뉴스·현행 정책을 재현한 것이 아니다.
 */
const EVENT = '게임 속 사건 · ';

export const EARTH_SCENARIOS: ScenarioDef[] = [
  {
    id: 'earth-first-trade',
    level: 1,
    modes: ['earth'],
    title: '부산에서 첫 무역 — 가까운 항구부터',
    minutes: 20,
    months: 60,
    summary:
      '부산에서 작은 배 한 척으로 시작한다. 상하이·요코하마처럼 가까운 항구의 생산·수요 차이로 첫 거래를 하고, 돈이 모이면 더 먼 항구와 큰 배로 넓힌다. 2년째에 미국 중서부에 가뭄이 든다(게임 속 사건).',
    learning: ['[6사11-03] 무역이 발생하는 이유: 나라마다 자연환경·자원·기술이 다르다', '왜 부산과 상하이의 같은 물건 값이 다를까?'],
    settings: { autoPolicies: false, autoCulture: false, longTermGrowth: true, showHints: true, startCityId: 'busan' },
    triggers: [
      { id: 'intro', atMonth: 1, action: { kind: 'news' }, headline: '시장 보기에서 부산·상하이·요코하마의 값을 비교해 보세요. 가까운 항구부터 다녀 보면 연료비가 적게 들어요.', question: '한국에서 남고 중국에서 모자라는 물건은 무엇일까요?' },
      {
        id: 'midwest-drought', atMonth: 18,
        action: { kind: 'harvestFailure', cityId: 'new_york', goodId: 'grain', factor: 0.55, months: 8, reason: '게임 속 사건: 미국 중서부 가뭄' },
        headline: `${EVENT}미국 중서부 곡창에 가뭄이 들어 곡물 수확이 줄었어요.`,
        question: '곡물 값은 어디에서 어떻게 달라질까요?',
      },
      { id: 'second-ship', atMonth: 30, action: { kind: 'news' }, headline: '돈이 모였다면 배를 한 척 더 사 볼까요? 결과·회사 탭에서 살 수 있어요.' },
    ],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'profit', text: '순이익 2만 만들기', check: { kind: 'profit', target: 20000 } },
      { id: 'ships', text: '배 두 척 가지기', check: { kind: 'ships', target: 2 } },
      { id: 'reasons', text: '서로 다른 이유 3가지로 무역해 보기(기후·자원·공장·계절…)', check: { kind: 'reasonKinds', target: 3 } },
    ],
  },
  {
    id: 'earth-hemispheres',
    level: 2,
    modes: ['earth'],
    title: '반대인 계절 — 북반구와 남반구의 농업',
    minutes: 25,
    months: 72,
    summary:
      '브라질(산투스)·칠레(산안토니오)·남아프리카(더반)는 남반구라 북반구와 수확철이 반대다. 수확기 차이로 생긴 곡물·과일 무역을 경험한다. 3년째에 브라질 남부에 가뭄이 든다(게임 속 사건).',
    learning: ['[6사09-01] 지구본·위도와 계절', '[6사10-02] 세계의 기후와 인간 생활', '1월에 칠레의 과일 값은 왜 쌀까?'],
    settings: { autoPolicies: false, autoCulture: false, longTermGrowth: false, showHints: true, startCityId: 'santos' },
    triggers: [
      { id: 'season-hint', atMonth: 1, action: { kind: 'news' }, headline: '항구 정보에서 산투스와 함부르크의 기온 그래프를 비교해 보세요. 어느 달이 여름인가요?', question: '1월에 남반구는 무슨 계절일까요?' },
      {
        id: 'brazil-drought', atMonth: 28,
        action: { kind: 'harvestFailure', cityId: 'santos', goodId: 'grain', factor: 0.5, months: 8, reason: '게임 속 사건: 브라질 남부 가뭄' },
        headline: `${EVENT}브라질 남부에 가뭄이 들어 곡물 수확이 줄었어요.`,
      },
    ],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'season', text: '수확철 차이 때문에 생긴 거래 2번 하기', check: { kind: 'reason', category: 'season', target: 2 } },
      { id: 'cross', text: '다른 대륙으로 3번 실어 나르기', check: { kind: 'crossContinent', target: 3 } },
      { id: 'grain', text: '곡물 200개 실어 나르기', check: { kind: 'deliver', goodId: 'grain', target: 200 } },
    ],
  },
  {
    id: 'earth-canal',
    level: 3,
    modes: ['earth'],
    title: '운하가 막히면 — 수에즈와 파나마',
    minutes: 35,
    months: 72,
    summary:
      '싱가포르에서 시작해 아시아–유럽 항로를 다닌다. 1년째에 수에즈 운하가 막혀 아프리카 남쪽으로 돌아가야 하고(게임 속 사건), 반년 뒤 다시 열린다. 3년째에는 가뭄으로 파나마 운하에 큰 배가 못 지나간다. 항로·기간·연료비·값이 어떻게 달라지는지 비교한다.',
    learning: ['[6사11-03] 국가 간 상호 의존', '바닷길이 막히면 왜 먼 나라의 물건 값까지 오를까?', '운하 통과료를 내는 것과 돌아가는 것 중 무엇이 쌀까?'],
    settings: { autoPolicies: false, autoCulture: false, longTermGrowth: true, showHints: true, startCityId: 'singapore', startingCash: 60000 },
    triggers: [
      { id: 'route-hint', atMonth: 1, action: { kind: 'news' }, headline: '싱가포르에서 로테르담까지 항로를 그려 보세요. 어느 운하·해협을 지나나요?', question: '수에즈 운하가 없다면 배는 어디로 가야 할까요?' },
      {
        id: 'suez-closed', atMonth: 12,
        action: { kind: 'passage', passageId: 'suez', closed: true, reason: '게임 속 사건: 큰 배가 좌초해 수에즈 운하 통행이 멈췄어요' },
        headline: `${EVENT}수에즈 운하가 막혔어요. 아시아–유럽 배들이 아프리카 남쪽으로 돌아가요.`,
        question: '항해 기간과 연료비는 얼마나 늘었나요? 로테르담의 값은 어떻게 될까요?',
      },
      {
        id: 'suez-open', atMonth: 18,
        action: { kind: 'passage', passageId: 'suez', closed: false, maxShipSize: null, reason: '다시 열림' },
        headline: `${EVENT}수에즈 운하가 다시 열렸어요.`,
      },
      {
        id: 'panama-drought', atMonth: 36,
        action: { kind: 'passage', passageId: 'panama', closed: false, maxShipSize: 2, reason: '게임 속 사건: 가뭄으로 갑문 물이 모자라 큰 배(크기 3)는 못 지나가요' },
        headline: `${EVENT}가뭄으로 파나마 운하는 크기 2 이하의 배만 지날 수 있어요.`,
        question: '큰 컨테이너선을 가진 회사는 어떻게 해야 할까요?',
      },
      {
        id: 'panama-open', atMonth: 48,
        action: { kind: 'passage', passageId: 'panama', closed: false, maxShipSize: null, reason: '비가 와서 통행 제한이 풀림' },
        headline: `${EVENT}파나마 운하의 통행 제한이 풀렸어요.`,
      },
    ],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'cross', text: '다른 대륙으로 4번 실어 나르기', check: { kind: 'crossContinent', target: 4 } },
      { id: 'profit', text: '순이익 3만 만들기', check: { kind: 'profit', target: 30000 } },
    ],
  },
  {
    id: 'earth-landlocked',
    level: 2,
    modes: ['earth'],
    title: '바다가 없는 나라 — 관문항을 통한 무역',
    minutes: 30,
    months: 60,
    summary:
      '스위스와 체코는 바다가 없지만 로테르담·함부르크 항구와 강·철도로 이어져 세계와 무역한다. 관문항에서 체코·스위스산 물건을 사서 다른 대륙에 팔아 보고, 원산지가 항구 나라가 아니라 만든 나라로 남는 것을 확인한다.',
    learning: ['[6사11-03] 국가 간 상호 의존', '바다가 없는 나라는 어떻게 수출할까?(이 게임의 관문항 연결은 단순화한 예시예요)'],
    settings: { autoPolicies: false, autoCulture: false, longTermGrowth: true, showHints: true, startCityId: 'rotterdam' },
    triggers: [
      { id: 'hint', atMonth: 1, action: { kind: 'news' }, headline: '함부르크 항구 정보를 열어 보세요. 체코 배후 경제권과 이어진 갈색 선이 보이나요?', question: '함부르크에서 산 자동차는 어느 나라에서 만들었을까요?' },
    ],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'landlocked', text: '바다가 없는 나라(스위스·체코)에서 만든 물건을 3번 팔기', check: { kind: 'origin', countries: ['che', 'cze'], target: 3 } },
      { id: 'profit', text: '순이익 2만 만들기', check: { kind: 'profit', target: 20000 } },
    ],
  },
  {
    id: 'earth-free',
    modes: ['earth'],
    title: '자유 놀이(현실 지구)',
    minutes: 40,
    months: 360,
    summary: '사건을 미리 정하지 않는다. 나라들이 스스로 관세·협정을 정하고 문화 유행도 저절로 생긴다(모두 게임 속 사건).',
    learning: ['30년 동안 나라들의 산업과 무역이 어떻게 바뀌는지 관찰한다. 실제 미래를 예측하는 것이 아니다.'],
    settings: { autoPolicies: true, autoCulture: true, longTermGrowth: true, showHints: true },
    triggers: [],
    goals: [
      { id: 'first-sale', text: '처음으로 물건을 팔아 보기', check: { kind: 'firstSale' } },
      { id: 'ships', text: '배 다섯 척 가지기', check: { kind: 'ships', target: 5 } },
      { id: 'countries', text: '여덟 나라와 무역하기', check: { kind: 'countries', target: 8 } },
    ],
  },
];
