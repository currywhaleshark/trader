import { useEffect, useRef, useState } from 'react';
import { scenarioById } from '../sim/classroom/scenarios';
import { fixJosa } from '../sim/core/korean';
import { estimateVoyage, isDocked, PLAYER_ID } from '../sim/economy/player';
import { citySpecialties, specialtyAvailable } from '../sim/economy/specialties';
import { warehouseOf } from '../sim/economy/warehouse';
import { Icon } from './icons';
import type { Simulation } from './useSimulation';

/**
 * 튜토리얼: 첫 거래부터 회사 운영까지 할 일을 한 단계씩 짚어 준다.
 * 단계마다 "할 일"과 "팁"을 보여 주고, 누를 곳(target)을 반짝인다.
 * 할 일을 하면(게임 상태·화면 상태로 판정) 저절로 다음 단계로 넘어간다. 읽기만 하는 단계는 「다음」을 누른다.
 *
 * 두 가지 안내가 있다.
 * - 짧은 안내(BASIC_STEPS): 보통 수업에서 튜토리얼을 켜면 첫 거래부터 정기 항로까지 짚어 준다.
 * - 튜토리얼 수업(FULL_STEPS): 튜토리얼 시나리오(scenario.tutorial)에서 장(chapter)별로 회사 운영 전체를 따라 하게 한다.
 */

/** 튜토리얼이 보는 화면 상태(게임 상태 밖의 것) */
export interface TutorialView {
  /** 항구 창이 열려 있는가 */
  portOpen: boolean;
  /** 항구 창에서 고른 목적지 */
  dest: string | null;
  /** 열린 창(항구 창 말고): 회사·발주함·세계·도시 */
  win: 'company' | 'orders' | 'world' | 'city' | null;
  /** 회사 창에서 보고 있는 탭 */
  companyTab: string | null;
}

/** 단계에 들어설 때의 기록(그 뒤에 새로 한 일만 세려고) */
interface StepBase {
  trades: number;
}

/** 반짝일 곳 */
export type TutorialTarget = 'dock' | 'play' | 'company';

interface Step {
  id: string;
  /** 튜토리얼 수업의 장 이름 */
  chapter?: string;
  title: string;
  /** 할 일. 게임 상태에 따라 달라지면 함수로 */
  body: string | ((sim: Simulation) => string);
  tip?: string;
  /** 이 조건이 되면 저절로 다음 단계로. 없으면 「다음」을 누른다 */
  done?: (sim: Simulation, v: TutorialView, base: StepBase) => boolean;
  target?: TutorialTarget;
  /**
   * 코치마크로 가리킬 곳(CSS 선택자). 앞에서부터 화면에 보이는 첫 요소를 가리킨다.
   * 상황(항구 창이 열렸는지, 상품을 골랐는지)마다 누를 곳이 달라 여러 개를 차례로 둔다.
   */
  point?: string[];
  /** 말풍선 글(없으면 「여기를 눌러요」) */
  pointText?: string;
}

const bought = (sim: Simulation) => sim.state.player.lifetime.purchases > 0;
const sold = (sim: Simulation) => sim.state.player.tradeCount > 0;
const mine = (sim: Simulation) => sim.state.ships.filter((s) => s.companyId === PLAYER_ID);

const BASIC_STEPS: Step[] = [
  {
    id: 'welcome',
    title: '무역회사 사장이 되었어요!',
    body: '싼 곳에서 사서 비싼 곳에 팔면 돈이 남아요. 이것이 무역이에요. 첫 거래를 함께 해 봐요.',
    tip: '지구본은 끌어서 돌리고, 마우스 휠이나 두 손가락으로 크게 볼 수 있어요.',
  },
  {
    id: 'open-port',
    point: ['.dock-ship'],
    title: '내 배의 항구 창 열기',
    body: '화면 아래의 배 카드를 눌러요.',
    tip: '항구 창에는 이 항구 창고의 상품과 내 배의 짐칸이 나와요.',
    done: (sim, v) => v.portOpen || bought(sim),
    target: 'dock',
  },
  {
    id: 'pick-dest',
    point: ['.go-ideas .idea', '.go-dest .btn', '.dock-ship'],
    title: '어디로 갈지 고르기',
    body: '항구 창 아래쪽의 힌트를 누르면, 갈 항구와 실을 상품을 함께 골라 줘요. 「지도에서 고르기」로 직접 골라도 돼요.',
    tip: '힌트의 +숫자는 연료비까지 빼고 남을 것으로 어림한 돈이에요. 꼭 그만큼 버는 건 아니에요.',
    done: (sim, v) => !!v.dest || bought(sim),
  },
  {
    id: 'load',
    point: ['.port-action.buy .pa-buttons .btn.primary', '.tile.coach', '.warehouse .tile:not(.cant)', '.dock-ship'],
    title: '상품 싣기',
    body: '창고에서 상품을 누르고(힌트를 눌렀다면 이미 골라져 있어요), 막대로 양을 정한 뒤 「싣기」를 눌러요.',
    tip: '초록 「싸요」는 세계 평균보다 싼 상품이에요. 동그란 표시에 마우스를 올리면 왜 싼지 알려 줘요.',
    done: (sim) => bought(sim),
  },
  {
    id: 'sail',
    point: ['.btn.primary.go:not(:disabled)', '.go-ideas .idea', '.dock-ship'],
    title: '출발!',
    body: '항구 창 오른쪽 아래의 「…(으)로 출발!」을 눌러요. 배가 떠나고 시간이 흐르기 시작해요.',
    tip: '떠날 때 연료비가 바로 빠져요. 먼 곳일수록 연료비가 많이 들어요.',
    done: (sim) => sim.state.player.lifetime.fuel > 0 || sold(sim),
  },
  {
    id: 'wait',
    point: ['[data-tut="play"]:not(.on)'],
    title: '시간이 흘러요',
    body: '위쪽 「시작」으로 시간을 흐르게 하거나 멈출 수 있어요. 「보통」을 누르면 더 빨라져요. 배가 도착하면 알림이 떠요.',
    tip: '배 카드의 막대는 남은 뱃길이에요. 멈춰 둔 채 「+1달」로 한 달씩 넘겨도 돼요.',
    done: (sim) =>
      sold(sim) || mine(sim).some((s) => s.from === s.to && s.holding && s.cargo.some((l) => l.originCityId !== s.to && l.quantity >= 0.5)),
    target: 'play',
  },
  {
    id: 'sell',
    point: ['.port-action.sell .pa-buttons .btn.primary', '.hold .tile:not(.cant)', '.toast .btn', '.dock-ship .dock-go'],
    title: '짐 팔기',
    body: '알림이나 배 카드의 「항구 열기」를 누르고, 짐칸의 상품을 눌러 「팔기」를 눌러요.',
    tip: '짐칸 상품의 +숫자는 산 값보다 얼마나 더 받는지예요.',
    done: (sim) => sold(sim),
    target: 'dock',
  },
  {
    id: 'result',
    point: ['.trip-result'],
    pointText: '여기를 읽어 봐요',
    title: '결과 확인하기',
    body: '결과 카드에서 산 값과 판 값, 그리고 왜 남았는지(밑졌는지)를 읽어 봐요.',
    tip: '까닭에는 기후·자원·공장·계절처럼 무역이 생기는 이유가 나와요. 수업 목표에도 쓰여요.',
  },
  {
    id: 'company',
    point: ['.dock-cash'],
    title: '회사 창 열기',
    body: '왼쪽 아래 돈 칸을 누르면 회사 창이 열려요. 장부, 배 사기, 정기 항로가 여기 있어요.',
    done: (_sim, v) => v.win === 'company',
    target: 'company',
  },
  {
    id: 'routes',
    point: ['[data-tab="routes"]:not(.on)', '.route-new'],
    title: '정기 항로로 자동 무역',
    body: '「정기 항로」 탭에서 여러 항구를 도는 길을 만들고 배를 맡기면, 배가 알아서 사고팔아요.',
    tip: '남는 거래가 없으면 배는 항구에서 기다리고, 카드에 그 이유가 나와요.',
  },
  {
    id: 'end',
    title: '튜토리얼 끝!',
    body: '오른쪽 위 「목표」를 보며 자유롭게 무역해 보세요. 돈이 모이면 배를 더 사 봐요.',
  },
];

// ------------------------------------------------------------------ 튜토리얼 수업(장별 전체 과정)

const orders = (sim: Simulation) => sim.state.player.orders?.items ?? [];
const soldSpecialty = (sim: Simulation) => sim.state.player.chronicle.some((e) => !!e.specialtyId);
const homeName = (sim: Simulation) => sim.ctx.cityNames[warehouseOf(sim.ctx, sim.state).cityId];
function warehouseUsed(sim: Simulation): boolean {
  const w = sim.state.player.warehouse;
  return !!w && (w.cargo.length > 0 || w.coldCargo.length > 0);
}

/** 지금 배가 바로 갈 수 있는 가까운 특산품 항구(같은 달·같은 자리면 다시 계산하지 않는다) */
const nearCache = new Map<string, string>();
function nearSpecialties(sim: Simulation): string {
  const { ctx, state } = sim;
  const ship = mine(sim).find((s) => isDocked(s) && !s.routeId) ?? mine(sim)[0];
  if (!ship?.typeId) return '';
  const key = `${state.month}|${ship.to}|${ship.typeId}`;
  const hit = nearCache.get(key);
  if (hit !== undefined) return hit;
  const found: { name: string; months: number }[] = [];
  for (const id of ctx.portIds) {
    const sp = citySpecialties(ctx, state, id).filter((d) => specialtyAvailable(ctx, state, id, d) >= 1);
    if (!sp.length) continue;
    let months = 0;
    if (id !== ship.to) {
      const v = estimateVoyage(ctx, ship.typeId, ship.to, id, state);
      if (!v.leg) continue;
      months = v.months;
    }
    found.push({ name: `${ctx.cityNames[id]}(${sp.map((d) => d.name).join(', ')})`, months });
  }
  found.sort((a, b) => a.months - b.months);
  const text = found.length ? ` ${ship.name}이(가) 바로 갈 수 있는 특산품 항구: ${found.slice(0, 3).map((f) => f.name).join(', ')}.` : '';
  if (nearCache.size > 50) nearCache.clear();
  nearCache.set(key, text);
  return text;
}

/** 항구 창에서 지금 눌러야 할 곳: 고른 상품의 사기·팔기 → 목적지를 정했고 짐이 있으면 출발 → 창고 상품 → 짐칸 상품 → 목적지 고르기 */
const SAIL_POINT = '.port-win:has(.dest-chip):has(.hold .tile) .btn.primary.go:not(:disabled)';
const AWAY_POINTS = ['.go-dest .btn', '.toast .btn', '.dock-ship'];
const TRADE_POINTS = [
  '.port-action .pa-buttons .btn.primary',
  SAIL_POINT,
  '.port-win:has(.dest-chip) .warehouse .tile:not(.cant)',
  '.port-win:not(:has(.dest-chip)) .hold .tile:not(.cant)',
  ...AWAY_POINTS,
];

const ch = (chapter: string, steps: Step[]): Step[] => steps.map((s) => ({ ...s, chapter }));
const basic = (id: string): Step => BASIC_STEPS.find((s) => s.id === id)!;

const FULL_STEPS: Step[] = [
  ...ch('추천대로 무역', [
    {
      id: 'welcome',
      title: '무역회사 사장이 되었어요!',
      body: '싼 곳에서 사서 비싼 곳에 팔면 돈이 남아요. 이 튜토리얼은 8장으로 회사 운영을 차례로 배워요. 먼저 추천(힌트)대로 첫 무역을 해 봐요.',
      tip: '지구본은 끌어서 돌리고, 마우스 휠이나 두 손가락으로 크게 볼 수 있어요. 안내 카드 아래 점 8개가 8장이에요.',
    },
    basic('open-port'),
    basic('pick-dest'),
    basic('load'),
    basic('sail'),
    basic('wait'),
    basic('sell'),
    basic('result'),
  ]),
  ...ch('물품과 거래 도시 고르기', [
    {
      id: 'world',
      point: ['[data-tut="world"]'],
      title: '어디가 싼지 보기',
      body: '이번엔 힌트 없이 직접 골라 봐요. 위쪽 「세계」를 눌러요.',
      done: (_sim, v) => v.win === 'world',
    },
    {
      id: 'prices',
      point: ['.price-rows'],
      pointText: '여기를 읽어 봐요',
      title: '값 차이 찾기',
      body: '「어디가 쌀까」 표에는 상품마다 가장 싼 도시와 가장 비싼 도시가 나와요. 값 차이가 크면서 서로 가까운 두 도시를 찾아봐요.',
      tip: '상품 이름을 누르면 「상품 렌즈」로 지도에서 그 상품이 싼 곳과 비싼 곳을 한눈에 볼 수 있어요.',
    },
    {
      id: 'own-trade',
      point: TRADE_POINTS,
      title: '직접 골라 무역하기',
      body: '항구 창에서 「지도에서 고르기」로 갈 항구를 고르고, 창고에서 상품을 골라 실은 뒤 출발해 팔아 봐요.',
      tip: '목적지를 고르면 창고 상품에 초록 숫자가 나와요. 그 항구에서 팔면 1개당 남는 돈이에요(연료비 빼기 전). 먼 곳은 연료비가 많이 들고, 과일처럼 상하는 물건은 오래 가면 줄어요.',
      done: (sim, _v, b) => sim.state.player.tradeCount > b.trades,
      target: 'dock',
    },
  ]),
  ...ch('특산품', [
    {
      id: 'specialty-buy',
      point: ['.port-action.buy .pa-buttons .btn.primary', '.warehouse .tile:has(.specialty-tag):not(.cant)', ...AWAY_POINTS],
      title: '한정 특산품 사기',
      body: (sim) => `창고 상품 중 「한정 특산품」 표시가 붙은 것은 그 나라가 조금씩만 내놓는 특산품이에요. 다른 나라에 팔면 시세보다 웃돈을 받아요.${nearSpecialties(sim)} 그곳으로 가서 사 봐요.`,
      tip: '특산품 물량은 나라마다 정해져 있고 매달 조금씩 다시 채워져요. 그 도시의 신뢰도가 오르면 더 많이 살 수 있어요.',
      done: (sim) => mine(sim).some((s) => s.cargo.some((l) => l.specialtyId)) || soldSpecialty(sim),
      target: 'dock',
    },
    {
      id: 'specialty-sell',
      point: ['.port-action.sell .pa-buttons .btn.primary', '.port-win:not(:has(.dest-chip)) .hold .tile:has(.specialty-tag):not(.cant)', SAIL_POINT, ...AWAY_POINTS],
      title: '다른 나라에 팔기',
      body: '특산품을 다른 나라 항구로 실어 가서 팔아요. 같은 나라 안에서 팔면 웃돈이 없어요.',
      tip: '해외에서 처음 팔 때는 관세·하역비를 빼고도 산 값보다 25% 넘게 받도록 보장돼요.',
      done: (sim) => soldSpecialty(sim),
      target: 'dock',
    },
  ]),
  ...ch('발주와 납품', [
    {
      id: 'orders-open',
      point: ['[data-tut="orders"]'],
      title: '발주함 열기',
      body: '도시들은 모자란 물건을 정해진 값에 실어 달라고 요청해요(발주). 위쪽 「발주」를 눌러요.',
      done: (sim, v) => v.win === 'orders' || orders(sim).some((o) => o.acceptedMonth !== undefined),
    },
    {
      id: 'orders-accept',
      point: ['[data-tut="order-accept"]:not(:disabled)', '[data-tut="orders"]'],
      title: '발주 받기',
      body: '요청 카드에서 이유·수량·대금·기한을 읽고 「발주 받기」를 눌러요. 요청이 없으면 배를 항구에 세워 둔 채 시간을 흘려 기다려요. 몇 달마다 새 요청이 와요.',
      tip: '받지 않는 건 괜찮아요. 받은 뒤 취소하면 그 도시 신뢰도 −5, 기한을 넘기면 −8이에요.',
      done: (sim) => orders(sim).some((o) => o.acceptedMonth !== undefined),
    },
    {
      id: 'orders-fill',
      point: ['.port-orders .order-actions .btn.primary:not(:disabled)', SAIL_POINT, '.port-orders .order-actions .btn.small', '.toast .btn', '.dock-ship'],
      title: '발주 물건 싣고 출발',
      body: '배가 선 항구의 항구 창에 「이 항구에서 할 발주 작업」이 나와요. 「발주품목 채우기」로 싣고, 「납품처로 목적지 설정」을 누른 뒤 출발해요.',
      tip: '추천 조달처가 아니어도 그 상품을 파는 항구면 돼요. 단, 납품처에서 산 물건은 납품할 수 없어요.',
      done: (sim) => {
        const open = orders(sim).filter((o) => o.status === 'accepted');
        return (
          orders(sim).some((o) => o.delivered > 0 || o.status === 'completed') ||
          mine(sim).some((s) => s.from !== s.to && open.some((o) => o.cityId === s.to && s.cargo.some((l) => l.goodId === o.goodId)))
        );
      },
      target: 'dock',
    },
    {
      id: 'orders-deliver',
      point: ['[data-tut="order-deliver"]', '.toast .btn', '.dock-ship'],
      title: '납품하기',
      body: '납품처에 도착하면 항구 창의 「발주품목 납품하기」를 눌러요. 모두 채우면 대금을 받고, 그 도시의 신뢰도가 +10 올라요.',
      tip: '나눠서 납품해도 그때그때 대금을 받아요. 기한 안에 다 채워야 신뢰도가 올라요.',
      done: (sim) => orders(sim).some((o) => o.status === 'completed'),
      target: 'dock',
    },
  ]),
  ...ch('회사 창고', [
    {
      id: 'warehouse-open',
      point: ['[data-tab="warehouse"]:not(.on)', '.dock-cash'],
      title: '회사 창고 열기',
      body: (sim) => `거점 ${homeName(sim)}에 회사 창고가 있어요. 왼쪽 아래 돈 칸을 눌러 회사 창을 열고 「회사 창고」 탭을 눌러요.`,
      done: (sim, v) => (v.win === 'company' && v.companyTab === 'warehouse') || warehouseUsed(sim),
      target: 'company',
    },
    {
      id: 'warehouse-store',
      point: ['[data-tut="warehouse-store"]:not(:disabled)', '.storage-controls select', '[data-tab="warehouse"]:not(.on)', '.dock-ship'],
      title: '창고에 맡기기',
      body: (sim) =>
        `${homeName(sim)}에 정박한 배의 짐을 「배 → 창고」로 맡겨 봐요. 값이 오를 때 팔거나, 거점 발주에 바로 납품할 수 있어요. 배가 다른 곳에 있으면 ${homeName(sim)}(으)로 오고, 짐이 없으면 ${homeName(sim)}에서 상품을 사서 실은 뒤 맡겨요.`,
      tip: '맡긴 부피만큼 매달 보관료가 나가요. 과일 같은 식료품은 냉장 구역을 지어 따로 보관해요.',
      done: (sim) => warehouseUsed(sim),
    },
  ]),
  ...ch('도시 신뢰도', [
    {
      id: 'trust-open',
      point: ['[data-tab="local"]:not(.on)', '.dock-cash'],
      title: '신뢰도 보기',
      body: '회사 창의 「지역 거래」 탭을 열어요. 도시마다 우리 회사를 얼마나 믿는지(신뢰도)가 나와요.',
      done: (_sim, v) => v.win === 'company' && v.companyTab === 'local',
      target: 'company',
    },
    {
      id: 'trust-read',
      point: ['.local-trust'],
      pointText: '여기를 읽어 봐요',
      title: '신뢰도가 주는 혜택',
      body: '발주를 기한 안에 모두 납품하면 그 도시 신뢰도가 +10 올라요. 20·50·80점이 되면 새 발주 단가가 5·10·15% 오르고, 특산품도 10·20·30% 더 살 수 있어요.',
      tip: '다른 도시의 신뢰도는 아래 「다른 도시의 거래 신뢰도」를 펼쳐 봐요. 발주 카드에도 그 도시의 신뢰도가 나와요.',
    },
  ]),
  ...ch('배 사기', [
    {
      id: 'ships-open',
      point: ['[data-tab="ships"]:not(.on)', '.dock-cash'],
      title: '배 가게 열기',
      body: '배가 많으면 여러 곳과 한꺼번에 무역할 수 있어요. 회사 창의 「배 사기」 탭을 열어요.',
      done: (sim, v) => (v.win === 'company' && v.companyTab === 'ships') || mine(sim).length >= 2,
      target: 'company',
    },
    {
      id: 'ships-buy',
      point: ['[data-tut="buy-ship"]:not(:disabled)'],
      title: '배 한 척 더 사기',
      body: '처음엔 값싼 「소형 일반화물선」이 좋아요. 돈이 모자라면 무역을 더 해서 모은 뒤 사요.',
      tip: '배마다 매달 유지비가 나가요. 큰 배는 많이 싣지만 큰 항구에만 들어가고 연료도 많이 써요.',
      done: (sim) => mine(sim).length >= 2,
    },
  ]),
  ...ch('정기 항로', [
    {
      id: 'routes-open',
      point: ['[data-tab="routes"]:not(.on)', '.dock-cash'],
      title: '정기 항로 열기',
      body: '정기 항로를 만들어 배를 맡기면, 배가 알아서 항구를 돌며 사고팔아요. 회사 창의 「정기 항로」 탭을 열어요.',
      done: (sim, v) => (v.win === 'company' && v.companyTab === 'routes') || sim.state.player.routes.length > 0,
      target: 'company',
    },
    {
      id: 'routes-make',
      point: ['.planner-actions .btn.primary:not(:disabled)', '.route-new'],
      title: '항로 짜기',
      body: '「지도에서 새 정기 항로 짜기」를 누르고, 지도에서 항구를 차례로 두 곳 이상 눌러요. 항구마다 살 상품과 팔 상품을 넣고 「저장」을 눌러요.',
      tip: '처음엔 앞에서 남았던 두 항구를 오가는 항로가 좋아요. 항로 짜기 화면에 어느 상품이 남을지 함께 나와요.',
      done: (sim) => sim.state.player.routes.length > 0,
    },
    {
      id: 'routes-assign',
      point: ['[data-tut="route-assign"]:not(:disabled)'],
      title: '배 맡기기',
      body: '항로 카드의 「배 맡기기」에서 배를 눌러요. 그 배는 이제 알아서 항로를 돌아요.',
      tip: '남는 거래가 없으면 배는 항구에서 기다리고, 카드에 그 이유가 나와요. 항로에서 빼면 다시 직접 몰 수 있어요.',
      done: (sim) => mine(sim).some((s) => !!s.routeId),
    },
    {
      id: 'end',
      title: '튜토리얼을 모두 마쳤어요!',
      body: '무역회사 운영에 필요한 것을 모두 해 봤어요. 배와 항로를 늘려 회사를 키워 보세요. 다른 수업은 메뉴 → 「새 수업」에서 고를 수 있어요.',
    },
  ]),
];

const NO_VIEW: TutorialView = { portOpen: false, dest: null, win: null, companyTab: null };
const baseOf = (sim: Simulation): StepBase => ({ trades: sim.state.player.tradeCount });

/** 저장을 불러왔을 때: 이미 해낸 단계는 건너뛴다(마지막으로 끝난 자동 단계 다음부터) */
function firstStep(sim: Simulation, steps: Step[]): number {
  let at = 0;
  steps.forEach((s, i) => {
    if (s.done && s.done(sim, NO_VIEW, { trades: 0 })) at = i + 1;
  });
  return Math.min(at, steps.length - 1);
}

/** 이 게임이 따라갈 단계 목록: 튜토리얼 수업이면 전체 과정, 아니면 짧은 안내 */
export function tutorialSteps(sim: Simulation): Step[] {
  return scenarioById(sim.settings.scenarioId)?.tutorial ? FULL_STEPS : BASIC_STEPS;
}

/** 튜토리얼 진행 상태. on이 아니면 아무것도 하지 않는다 */
export function useTutorial(sim: Simulation | null, view: TutorialView) {
  const on = !!sim && sim.settings.tutorial === true;
  const STEPS = sim ? tutorialSteps(sim) : BASIC_STEPS;
  const [step, setStep] = useState<number | null>(null);
  const base = useRef<StepBase>({ trades: 0 });
  const [closed, setClosed] = useState(false);
  // 새 게임·불러오기마다 처음(또는 해낸 곳 다음)부터
  const gameKey = sim ? `${sim.ctx.data.player.companyName}|${sim.settings.seed}|${sim.settings.scenarioId}` : '';
  useEffect(() => {
    setClosed(false);
    setStep(sim && on ? firstStep(sim, STEPS) : null);
    if (sim) base.current = { trades: 0 };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, on]);
  // 할 일을 했으면 저절로 다음 단계로(여러 단계를 한꺼번에 해냈으면 한꺼번에)
  useEffect(() => {
    if (!sim || step === null) return;
    let k = step;
    // 지금 단계는 들어설 때의 기록과 비교하고, 한꺼번에 넘는 뒤 단계는 지금을 기준으로 본다
    while (k < STEPS.length - 1 && STEPS[k].done?.(sim, view, k === step ? base.current : baseOf(sim))) k++;
    if (k !== step) setStep(k);
  });
  // 새 단계에 들어서면 그때의 기록을 남긴다
  useEffect(() => {
    if (sim) base.current = baseOf(sim);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);
  const active = on && !closed && step !== null;
  const current = active ? STEPS[step!] : null;
  const chapters = [...new Set(STEPS.map((s) => s.chapter).filter((c): c is string => !!c))];
  const inChapter = current?.chapter ? STEPS.filter((s) => s.chapter === current.chapter) : [];
  return {
    active,
    step: current,
    body: current && sim ? fixJosa(typeof current.body === 'function' ? current.body(sim) : current.body) : '',
    index: step ?? 0,
    count: STEPS.length,
    /** 장으로 나뉜 튜토리얼 수업이면 장 목록과 지금 장 안에서의 차례 */
    chapters,
    chapterIndex: current?.chapter ? chapters.indexOf(current.chapter) : -1,
    chapterStep: current ? inChapter.indexOf(current) : -1,
    chapterSteps: inChapter.length,
    target: current?.target ?? null,
    next: () => setStep((k) => (k === null ? k : k >= STEPS.length - 1 ? (setClosed(true), k) : k + 1)),
    close: () => setClosed(true),
  };
}

/**
 * compact: 항구 창이 열려 있을 때. 항구 창을 가리지 않게 아래쪽 배 카드 자리에 짧게(제목과 할 일만, 팁은 눌러서) 보여 준다.
 */
export function TutorialCard({ t, compact }: { t: ReturnType<typeof useTutorial>; compact?: boolean }) {
  const s = t.step;
  const [tipOpen, setTipOpen] = useState(false);
  if (!t.active || !s) return null;
  const last = t.index >= t.count - 1;
  return (
    <div className={compact ? "tutorial compact" : "tutorial"} role="status" aria-live="polite">
      <div className="tut-head">
        <Icon name="school" size={18} />
        {t.chapterIndex >= 0 ? (
          <span className="small">
            <span className="tut-chapter">{t.chapterIndex + 1}장 {s.chapter}</span>{' '}
            <span className="muted">
              {t.chapterStep + 1}/{t.chapterSteps}
            </span>
          </span>
        ) : (
          <span className="muted small">
            튜토리얼 {t.index + 1}/{t.count}
          </span>
        )}
        <button className="x" onClick={t.close} aria-label="튜토리얼 닫기" title="튜토리얼 닫기">
          ×
        </button>
      </div>
      <b className="tut-title">{s.title}</b>
      <p>{t.body}</p>
      {s.tip && compact && (
        <button className="tut-tip-btn" aria-expanded={tipOpen} onClick={() => setTipOpen((v) => !v)}>
          <Icon name="bulb" size={15} /> 팁
        </button>
      )}
      {s.tip && (!compact || tipOpen) && (
        <p className="tut-tip">
          <Icon name="bulb" size={15} /> {s.tip}
        </p>
      )}
      <div className="tut-foot">
        {t.chapterIndex >= 0 ? (
          <span className="tut-dots" aria-hidden="true" title={t.chapters.map((c, i) => `${i + 1}장 ${c}`).join(' · ')}>
            {t.chapters.map((c, i) => (
              <i key={c} className={i < t.chapterIndex ? 'done' : i === t.chapterIndex ? 'now' : ''} />
            ))}
          </span>
        ) : (
          <span className="tut-dots" aria-hidden="true">
            {Array.from({ length: t.count }, (_, i) => (
              <i key={i} className={i < t.index ? 'done' : i === t.index ? 'now' : ''} />
            ))}
          </span>
        )}
        {s.done ? (
          <button className="btn small" onClick={t.next} title="이 단계를 건너뛰어요">
            건너뛰기
          </button>
        ) : (
          <button className="btn small primary" onClick={t.next}>
            {last ? '마치기' : '다음'}
          </button>
        )}
      </div>
    </div>
  );
}

/** 그려지는 요소인가(크기가 있고 숨겨지지 않았다). 화면 밖·스크롤 밖이어도 된다 */
function shown(el: Element): boolean {
  const r = el.getBoundingClientRect();
  if (r.width < 2 || r.height < 2) return false;
  const st = getComputedStyle(el);
  return st.visibility !== 'hidden' && st.display !== 'none' && Number(st.opacity) !== 0;
}

/** 스크롤 칸·화면·다른 것(창 아래에 붙은 출발 영역, 튜토리얼 카드)에 가려지지 않고 보이는가 */
function inView(el: Element): boolean {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const hit = cx >= 0 && cy >= 0 && cx < window.innerWidth && cy < window.innerHeight ? document.elementFromPoint(cx, cy) : null;
  if (!hit || !(el === hit || el.contains(hit))) return false;
  let top = Math.max(r.top, 0);
  let bottom = Math.min(r.bottom, window.innerHeight);
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const o = getComputedStyle(p).overflowY;
    if (o === 'visible') continue;
    const pr = p.getBoundingClientRect();
    top = Math.max(top, pr.top);
    bottom = Math.min(bottom, pr.bottom);
  }
  return bottom - top >= Math.min(r.height, 24);
}

/** 요소 중 스크롤 칸·화면 안에 실제로 보이는 부분(긴 목록을 가리킬 때 테두리가 창 밖으로 나가지 않게) */
function visibleRect(el: Element): { left: number; top: number; width: number; height: number } {
  const r = el.getBoundingClientRect();
  let left = Math.max(r.left, 0);
  let top = Math.max(r.top, 0);
  let right = Math.min(r.right, window.innerWidth);
  let bottom = Math.min(r.bottom, window.innerHeight);
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const st = getComputedStyle(p);
    if (st.overflowY === 'visible' && st.overflowX === 'visible') continue;
    const pr = p.getBoundingClientRect();
    left = Math.max(left, pr.left);
    top = Math.max(top, pr.top);
    right = Math.min(right, pr.right);
    bottom = Math.min(bottom, pr.bottom);
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * 코치마크: 지금 단계에서 눌러야 할 곳을 테두리와 말풍선으로 가리킨다.
 * 가리킬 곳은 단계의 선택자 목록에서 화면에 보이는 첫 요소다. 창이 열리고 닫히면 저절로 다른 곳을 가리킨다.
 * 화면을 가리지 않도록 누르기는 통과시킨다(pointer-events: none).
 */
export function CoachMark({ t }: { t: ReturnType<typeof useTutorial> }) {
  const step = t.active ? t.step : null;
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    if (!step?.point) {
      setRect(null);
      return;
    }
    let raf = 0;
    // 처음 한 번은 꼭 반영한다(가리킬 곳이 없으면 앞 단계의 테두리를 지운다)
    let last = '-';
    let scrolled: Element | null = null;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      let target: Element | null = null;
      for (const sel of step.point!) {
        for (const el of document.querySelectorAll(sel)) {
          if (shown(el)) {
            target = el;
            break;
          }
        }
        if (target) break;
      }
      // 스크롤 칸 안에 가려져 있으면 한 번 그쪽으로 넘겨 준다(휴대폰처럼 좁은 화면)
      if (target && !inView(target) && scrolled !== target) {
        scrolled = target;
        target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
      const found = target && inView(target) ? visibleRect(target) : null;
      const next = found ? { x: found.left, y: found.top, w: found.width, h: found.height } : null;
      const key = next ? `${Math.round(next.x)},${Math.round(next.y)},${Math.round(next.w)},${Math.round(next.h)}` : '';
      if (key !== last) {
        last = key;
        setRect(next);
      }
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [step]);
  if (!step || !rect) return null;
  const pad = 6;
  // 말풍선은 아래에 자리가 있으면 아래, 없으면 위에
  const below = rect.y + rect.h + 56 < window.innerHeight;
  const bx = Math.min(Math.max(rect.x + rect.w / 2, 70), window.innerWidth - 70);
  return (
    <div className="coach-mark" aria-hidden="true">
      <div className="coach-ring" style={{ left: rect.x - pad, top: rect.y - pad, width: rect.w + pad * 2, height: rect.h + pad * 2 }} />
      <div className={below ? 'coach-bubble below' : 'coach-bubble above'} style={{ left: bx, top: below ? rect.y + rect.h + pad + 10 : rect.y - pad - 10 }}>
        {step.pointText ?? '여기를 눌러요'}
      </div>
    </div>
  );
}
