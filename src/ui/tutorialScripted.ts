import type { TutorialScript } from '../sim/classroom/tutorialScript';
import { isOpenOrder, orderPurchasePlan } from '../sim/economy/orders';
import { estimateVoyage, isDocked, PLAYER_ID } from '../sim/economy/player';
import { citySpecialties, specialtyAvailable } from '../sim/economy/specialties';
import type { Simulation } from './useSimulation';

/**
 * 고정 튜토리얼(대본이 있는 튜토리얼 수업)의 단계.
 * 단계마다 "지금 상황에서 누를 곳 하나"를 계산한다(guide). 그래서
 * - 다른 창이 열려 있으면 먼저 닫으라고 하고,
 * - 배가 다른 항구에 있으면 그 항구로 가는 법을, 항해 중이면 기다리라고 알려 주며,
 * - 발주를 한 번에 못 채웠으면 남은 만큼 다시 실어 오라고 안내한다.
 */

/** 튜토리얼이 보는 화면 상태(게임 상태 밖의 것) */
export interface TutorialView {
  /** 항구 창이 열려 있는가 */
  portOpen: boolean;
  /** 지도에서 목적지를 고르는 중인가 */
  picking: boolean;
  /** 항구 창에서 고른 목적지 */
  dest: string | null;
  /** 열린 창(항구 창 말고): 회사·발주함·세계·도시 */
  win: 'company' | 'orders' | 'world' | 'city' | null;
  /** 회사 창에서 보고 있는 탭 */
  companyTab: string | null;
}

/** 단계에 들어설 때의 기록(그 뒤에 새로 한 일만 세려고) */
export interface StepBase {
  trades: number;
  /** 단계에 들어선 달(이어하기로 건너뛸 때는 없다) */
  month?: number;
}

/** 반짝일 곳 */
export type TutorialTarget = 'dock' | 'play' | 'company';

/** 항구 창에 전하는 대본: 이 상품·수량·힌트만 보여 준다 */
export interface Tutor {
  /** 힌트 한 줄(to·goodId·quantity)만 보여 준다. 아니면 힌트를 숨긴다 */
  hint?: boolean;
  to?: string;
  goodId?: string;
  /** 한정 특산품을 고르는 단계인가 */
  specialty?: boolean;
  /** 상품을 누르면 막대에 미리 맞춰 둘 수량 */
  quantity?: number;
}

/** 지금 상황에 맞춘 안내(단계의 기본 글·가리킬 곳을 바꾼다) */
export interface Guide {
  title?: string;
  body: string;
  tip?: string;
  point?: string[];
  pointText?: string;
  tutor?: Tutor;
  /** 지도에서 고를 때 화면 가운데로 돌려 보여 줄 도시 */
  lookAt?: string;
}

export interface Step {
  id: string;
  /** 튜토리얼 수업의 장 이름 */
  chapter?: string;
  /** 이 장을 이미 마쳤는가(이어하기 때 시작할 곳을 정한다) */
  chapterDone?: (sim: Simulation) => boolean;
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
  /** 고정 튜토리얼: 지금 상황에 맞춘 안내 */
  guide?: (sim: Simulation, v: TutorialView) => Guide;
  /** 이 단계에 들어서면 대본 발주를 낸다 */
  order?: boolean;
  /** 마지막 단계: 「계속 플레이」와 「다른 수업 고르기」 가운데 고르게 한다 */
  finish?: boolean;
}

const mine = (sim: Simulation) => sim.state.ships.filter((s) => s.companyId === PLAYER_ID);
/** 직접 모는 배(튜토리얼이 따라가는 배) */
const lead = (sim: Simulation) => mine(sim).find((s) => !s.routeId) ?? mine(sim)[0];
const qty = (n: number) => String(Math.round(n * 10) / 10);
const won = (n: number) => Math.round(n).toLocaleString('ko-KR');
const dom = (sel: string) => typeof document !== 'undefined' && !!document.querySelector(sel);
const count = (sel: string) => (typeof document === 'undefined' ? 0 : document.querySelectorAll(sel).length);
const texts = (sel: string) => (typeof document === 'undefined' ? [] : [...document.querySelectorAll(sel)].map((e) => e.textContent ?? ''));

const BUY = '.port-action.buy .pa-buttons .btn.primary';
const SELL = '.port-action.sell .pa-buttons .btn.primary';
const TUTOR_TILE = '[data-tut="tutor-tile"]';
const GO = '.btn.primary.go:not(:disabled)';
const PICK_ON_MAP = '.go-dest > .btn';
const MONTH = '[data-tut="month"]';

const CLOSE_WIN: Guide = {
  title: '열린 창 닫기',
  body: '먼저 열려 있는 창을 닫아요. 창 오른쪽 위의 ×를 눌러요.',
  point: ['.info-win .port-head .icon-btn[aria-label="닫기"]'],
};
const CLOSE_RESULT: Guide = {
  title: '결과 카드 닫기',
  body: '결과 카드를 다 읽었으면 카드 아래의 단추를 눌러 닫아요.',
  point: ['.trip-result .btn.primary'],
};

const legCache = new Map<string, boolean>();
/** 지금 배로 한 번에 갈 수 있는가(같은 달·같은 자리면 다시 계산하지 않는다) */
function direct(sim: Simulation, from: string, to: string): boolean {
  const ship = lead(sim);
  const key = `${sim.state.month}|${ship.typeId}|${from}|${to}`;
  let hit = legCache.get(key);
  if (hit === undefined) {
    hit = !!ship.typeId && !!estimateVoyage(sim.ctx, ship.typeId, from, to, sim.state).leg;
    if (legCache.size > 80) legCache.clear();
    legCache.set(key, hit);
  }
  return hit;
}

export function scriptedSteps(S: TutorialScript): Step[] {
  const cn = (sim: Simulation, id: string) => sim.ctx.cityNames[id] ?? id;
  const gn = (sim: Simulation, id: string) => sim.ctx.goodById[id]?.name ?? id;
  const at = (sim: Simulation, city: string) => isDocked(lead(sim)) && lead(sim).to === city;
  const hasGood = (sim: Simulation, goodId: string) => lead(sim).cargo.some((l) => l.goodId === goodId && !l.specialtyId && l.quantity >= 0.5);
  const chronicle = (sim: Simulation) => sim.state.player.chronicle;

  // ---------------------------------------------------------------- 공통 안내
  const waiting = (sim: Simulation): Guide => ({
    title: '도착을 기다려요',
    body: sim.playing ? `배가 ${cn(sim, lead(sim).to)}에 도착할 때까지 기다려요. 도착하면 알림이 떠요.` : `배가 ${cn(sim, lead(sim).to)}(으)로 가는 중이에요. 위쪽 「시작」을 눌러 시간을 흐르게 해요.`,
    point: sim.playing ? [] : ['[data-tut="play"]:not(.on)'],
  });
  const openPort = (sim: Simulation, v: TutorialView): Guide =>
    v.picking
      ? { title: '지도 고르기 그만두기', body: '지금은 목적지를 고를 때가 아니에요. 위쪽 안내 줄의 「취소」를 눌러요.', point: ['.pick-banner .btn'] }
      : { title: '항구 창 열기', body: `화면 아래의 ${lead(sim).name} 카드를 눌러 ${cn(sim, lead(sim).to)} 항구 창을 열어요.`, point: ['.toast .btn', '.dock-ship'] };

  /** 배를 to로 보내는 안내: 창 닫기 → 항구 창 열기 → 목적지 고르기 → 출발 → 도착 기다리기 */
  const travel = (sim: Simulation, v: TutorialView, to: string, o: { why?: string; destBody?: string; destPoint?: string[]; tutor?: Tutor } = {}): Guide => {
    const ship = lead(sim);
    if (!isDocked(ship)) return waiting(sim);
    // 한 번에 못 가는 곳이면 거점을 거친다
    const next = direct(sim, ship.to, to) || ship.to === S.home ? to : S.home;
    const N = cn(sim, next);
    if (v.picking) return { title: '지도에서 목적지 고르기', body: `지도를 ${N} 쪽으로 돌려 놓았어요. 가운데에 있는 ${N}을(를) 눌러요.`, point: ['[data-tut="map-target"]'], pointText: `${N}을(를) 눌러요`, lookAt: next, tutor: o.tutor };
    if (v.win) return CLOSE_WIN;
    if (!v.portOpen) return openPort(sim, v);
    if (dom('.trip-result')) return CLOSE_RESULT;
    const why = o.why ?? '';
    if (v.dest !== next) {
      return {
        title: '목적지 고르기',
        body: why + (next === to && o.destBody ? o.destBody : `항구 창 아래쪽의 「지도에서 고르기」를 누른 뒤, 지도에서 ${N}을(를) 눌러요.`),
        point: next === to && o.destPoint ? o.destPoint : [PICK_ON_MAP],
        lookAt: next,
        tutor: o.tutor,
      };
    }
    return { title: '출발!', body: `${why}항구 창 오른쪽 아래의 「${N}(으)로 출발!」을 눌러요.`, point: [GO], tutor: o.tutor };
  };

  /** city의 항구 창에서 할 일(inner). 배가 다른 곳에 있으면 먼저 그리로 보낸다 */
  const atPort = (sim: Simulation, v: TutorialView, city: string, inner: Guide): Guide => {
    const ship = lead(sim);
    if (!isDocked(ship) || ship.to !== city) return travel(sim, v, city, { why: `이 일은 ${cn(sim, city)}에서 해요. ` });
    if (v.win) return CLOSE_WIN;
    if (!v.portOpen) return openPort(sim, v);
    if (dom('.trip-result')) return CLOSE_RESULT;
    return inner;
  };

  /** 회사 창의 tab에서 할 일(inner) */
  const company = (v: TutorialView, tab: string, label: string, inner: Guide): Guide => {
    if (v.win !== 'company') return { title: '회사 창 열기', body: '왼쪽 아래의 돈 칸을 눌러 회사 창을 열어요.', point: ['.dock-cash'] };
    if (v.companyTab !== tab) return { title: `「${label}」 탭 열기`, body: `회사 창 위쪽의 「${label}」 탭을 눌러요.`, point: [`[data-tab="${tab}"]`] };
    return inner;
  };

  // ---------------------------------------------------------------- 장별 상태
  const F = S.first, P = S.specialty, K = S.pick;
  const firstTutor: Tutor = { hint: true, to: F.to, goodId: F.goodId, quantity: F.quantity };
  const c1 = (sim: Simulation) => sim.state.player.tradeCount > 0;

  const spec = (sim: Simulation) => citySpecialties(sim.ctx, sim.state, P.at)[0];
  const hasSp = (sim: Simulation) => lead(sim).cargo.some((l) => !!l.specialtyId && l.quantity >= 0.5);
  const c2 = (sim: Simulation) => chronicle(sim).some((e) => !!e.specialtyId);
  const spTutor = (sim: Simulation): Tutor => ({ goodId: spec(sim)?.goodId, specialty: true, quantity: P.quantity });

  const loaded3 = (sim: Simulation) => lead(sim).cargo.some((l) => l.originCityId === K.from && !l.specialtyId && l.quantity >= 0.5);
  const c3 = (sim: Simulation) => chronicle(sim).some((e) => e.fromCityId === K.from && e.toCityId === K.to && !e.specialtyId);
  const pickTutor: Tutor = { goodId: K.goodId, quantity: K.quantity };

  const scripted = (sim: Simulation) => (sim.state.player.orders?.items ?? []).filter((o) => o.scripted).at(-1);
  const accepted = (sim: Simulation) => !!sim.state.player.orders?.items.some((o) => o.scripted && (o.status === 'accepted' || o.status === 'completed'));
  const c4 = (sim: Simulation) => !!sim.state.player.orders?.items.some((o) => o.scripted && o.status === 'completed');

  const stored = (sim: Simulation) => {
    const w = sim.state.player.warehouse;
    return (!!w && (w.cargo.length > 0 || w.coldCargo.length > 0)) || sim.state.scenario?.goalsDone.warehouse !== undefined;
  };
  const c7 = (sim: Simulation) => mine(sim).length >= 2;
  const c8 = (sim: Simulation) => mine(sim).some((s) => !!s.routeId);
  const cheapest = (sim: Simulation) => sim.ctx.data.shipTypes.reduce((a, b) => (a.price <= b.price ? a : b));

  // ---------------------------------------------------------------- 발주: 받기 → 조달 → 납품(남으면 되풀이)
  const acceptGuide = (sim: Simulation, v: TutorialView): Guide => {
    const o = scripted(sim);
    if (v.win !== 'orders') {
      return { title: '발주함 열기', body: '도시들은 모자란 물건을 정해진 값에 실어 달라고 요청해요(발주). 위쪽 「발주」를 눌러요.', point: ['[data-tut="orders"]'] };
    }
    if (!o || !isOpenOrder(o)) return { title: '요청을 기다려요', body: '곧 새 요청이 와요.' };
    return {
      title: '발주 받기',
      body: `${cn(sim, o.cityId)}에서 ${gn(sim, o.goodId)} ${o.quantity}개를 요청했어요. 카드에서 이유·수량·대금·기한을 읽고 「발주 받기」를 눌러요.`,
      tip: '받지 않는 건 괜찮아요. 받은 뒤 취소하면 그 도시 신뢰도 −5, 기한을 넘기면 −8이에요.',
      point: ['[data-tut="order-accept"]:not(:disabled)'],
    };
  };

  const orderRun = (sim: Simulation, v: TutorialView): Guide => {
    const o = scripted(sim);
    if (!o || o.status !== 'accepted') return acceptGuide(sim, v);
    const ship = lead(sim);
    if (!isDocked(ship)) return waiting(sim);
    const good = gn(sim, o.goodId), src = cn(sim, o.sourceCityId), dst = cn(sim, o.cityId);
    const remaining = o.quantity - o.delivered;
    const aboard = ship.cargo.filter((l) => l.goodId === o.goodId && l.originCityId !== o.cityId).reduce((n, l) => n + l.quantity, 0);
    const plan = ship.to !== o.cityId ? orderPurchasePlan(sim.ctx, sim.state, ship, o) : null;
    const canAdd = !!plan && plan.quantity > 0;
    const again = o.delivered > 0 ? `${qty(o.delivered)}개를 납품했고, 아직 ${qty(remaining)}개가 남았어요. ` : '';

    // 납품할 차례: 실은 것이 있고, 납품처에 있거나 여기서는 더 실을 수 없다
    if (aboard >= 0.5 && (ship.to === o.cityId || !canAdd)) {
      const short = plan && plan.needed > 0 ? `${qty(remaining)}개 중 ${qty(aboard)}개만 실었어요. 먼저 이만큼 납품하고, 모자란 만큼은 한 번 더 실어 와요. ` : '';
      if (ship.to !== o.cityId) {
        return travel(sim, v, o.cityId, {
          why: short,
          destBody: `「이 항구에서 할 발주 작업」의 「납품처로 목적지 설정」을 눌러요. 납품처 ${dst}(으)로 가요.`,
          destPoint: ['.port-orders .order-actions .btn.small', PICK_ON_MAP],
        });
      }
      return atPort(sim, v, o.cityId, {
        title: '납품하기',
        body: `납품처 ${dst}에 왔어요. 항구 창 위쪽 「이 항구에서 할 발주 작업」의 「발주품목 납품하기」를 눌러요.`,
        tip: '일반 「팔기」가 아니라 「납품하기」를 눌러야 발주 대금을 받아요. 모두 채우면 그 도시의 신뢰도가 +10 올라요.',
        point: ['[data-tut="order-deliver"]'],
      });
    }
    // 조달할 차례
    if (!canAdd && ship.to !== o.sourceCityId) {
      return travel(sim, v, o.sourceCityId, { why: `${again}${good}은(는) 조달처 ${src}에서 사요. ${ship.to === o.cityId ? '납품처에서 산 물건은 납품할 수 없어요. ' : ''}` });
    }
    if (!canAdd) {
      return atPort(sim, v, ship.to, {
        title: '지금은 실을 수 없어요',
        body: `${plan?.reason ?? ''} 위쪽 「+1달」을 눌러 한 달을 넘긴 뒤 다시 채워요.`,
        point: [MONTH],
      });
    }
    return atPort(sim, v, ship.to, {
      title: '발주 물건 싣기',
      body: `${again}항구 창 위쪽에 「이 항구에서 할 발주 작업」이 나와요. 「발주품목 채우기」를 눌러 ${good}을(를) 실어요.`,
      tip: '추천 조달처가 아니어도 그 상품을 파는 항구면 돼요. 단, 납품처에서 산 물건은 납품할 수 없어요.',
      point: ['.port-orders .order-actions .btn.primary:not(:disabled)'],
    });
  };

  // ---------------------------------------------------------------- 정기 항로 짜기(항로 짜기 화면의 상태를 보고 안내)
  const routeMake = (sim: Simulation, v: TutorialView): Guide => {
    const home = cn(sim, S.home), to = cn(sim, S.route.to);
    if (!dom('.planner')) {
      return company(v, 'routes', '정기 항로', { title: '새 항로 짜기', body: '「지도에서 새 정기 항로 짜기」를 눌러요.', point: ['.route-new'] });
    }
    if (count('.planner-stop') < 2) {
      return {
        title: '들를 항구 넣기',
        body: `1번 항구로 거점 ${home}이(가) 이미 들어 있어요. 「+ 목록에서 항구 넣기」를 눌러 ${to}을(를) 골라요.`,
        tip: '지도에서 항구를 눌러 넣어도 돼요. 마지막 항구 다음엔 처음으로 돌아가요.',
        point: ['.planner-stops select'],
      };
    }
    // 살 상품이 하나라도 들어갔는가(들르는 차례의 요약 글로 본다)
    const hasGoods = texts('.planner-stop-main').some((t) => t.includes('사기 ') && !t.includes('사기 없음'));
    if (!hasGoods) {
      if (dom('.opp:not(:disabled)')) {
        return {
          title: '사고팔 상품 넣기',
          body: '「이 항로에서 실제로 남는 상품」의 맨 위 상품을 눌러요. 여기서 살 상품과 저기서 팔 상품에 한 번에 들어가요.',
          point: ['.opp:not(:disabled)'],
        };
      }
      return {
        title: '다른 항구 살펴보기',
        body: '이 항구에서 사면 남는 상품이 없어요. 「들르는 차례」에서 다른 항구를 눌러 남는 상품을 찾아봐요.',
        point: ['.planner-stop:not(.on) .planner-stop-main'],
      };
    }
    return {
      title: '항로 저장하기',
      body: '살 상품과 팔 상품이 들어갔어요. 아래의 「저장」을 눌러요.',
      tip: '항로 짜기 화면 아래에 어느 상품이 얼마나 남을지 함께 나와요.',
      point: ['.planner-actions .btn.primary:not(:disabled)'],
    };
  };

  const chapter = (name: string, done: (sim: Simulation) => boolean, steps: Step[]): Step[] => steps.map((s) => ({ ...s, chapter: name, chapterDone: done }));

  return [
    ...chapter('추천대로 무역', c1, [
      {
        id: 'welcome',
        title: '무역회사 사장이 되었어요!',
        body: '싼 곳에서 사서 비싼 곳에 팔면 돈이 남아요. 이 튜토리얼은 정해진 길을 따라 8장으로 회사 운영을 배워요. 안내 카드가 지금 누를 곳을 하나씩 알려 줘요.',
        tip: '지구본은 끌어서 돌리고, 마우스 휠이나 두 손가락으로 크게 볼 수 있어요. 안내 카드 아래 점 8개가 8장이에요.',
      },
      {
        id: 'open-port',
        title: '내 배의 항구 창 열기',
        body: '',
        tip: '항구 창에는 이 항구 창고의 상품과 내 배의 짐칸이 나와요.',
        guide: (sim, v) => atPort(sim, v, S.home, { body: '' }),
        done: (sim, v) => v.portOpen || hasGood(sim, F.goodId) || lead(sim).to !== S.home || c1(sim),
        target: 'dock',
      },
      {
        id: 'pick-hint',
        title: '힌트 누르기',
        body: '',
        guide: (sim, v) =>
          atPort(sim, v, S.home, {
            body: `항구 창 아래쪽의 힌트 「→ ${cn(sim, F.to)}」을(를) 눌러요. 갈 항구(${cn(sim, F.to)})와 실을 상품(${gn(sim, F.goodId)})을 함께 골라 줘요.`,
            tip: '힌트의 +숫자는 연료비까지 빼고 남을 것으로 어림한 돈이에요. 꼭 그만큼 버는 건 아니에요.',
            point: ['.go-ideas .idea'],
            tutor: firstTutor,
          }),
        done: (sim, v) => v.dest === F.to || hasGood(sim, F.goodId) || lead(sim).to !== S.home || c1(sim),
      },
      {
        id: 'load',
        title: '상품 싣기',
        body: '',
        guide: (sim, v) =>
          atPort(sim, v, S.home, {
            body: `${gn(sim, F.goodId)}이(가) 골라져 있어요. 「싣기」를 눌러요.`,
            tip: '초록 「싸요」는 세계 평균보다 싼 상품이에요. 동그란 표시에 마우스를 올리면 왜 싼지 알려 줘요.',
            point: [BUY, '.go-ideas .idea'],
            tutor: firstTutor,
          }),
        done: (sim) => hasGood(sim, F.goodId) || lead(sim).to !== S.home || c1(sim),
      },
      {
        id: 'sail',
        title: '출발!',
        body: '',
        tip: '떠날 때 연료비가 바로 빠져요. 먼 곳일수록 연료비가 많이 들어요.',
        guide: (sim, v) => travel(sim, v, F.to, { destBody: `힌트 「→ ${cn(sim, F.to)}」을(를) 다시 눌러 목적지를 정해요.`, destPoint: ['.go-ideas .idea', PICK_ON_MAP], tutor: firstTutor }),
        done: (sim) => lead(sim).to === F.to || c1(sim),
      },
      {
        id: 'wait',
        title: '시간이 흘러요',
        body: '',
        tip: '배 카드의 막대는 남은 뱃길이에요. 멈춰 둔 채 「+1달」로 한 달씩 넘겨도 돼요.',
        guide: (sim, v) => travel(sim, v, F.to),
        done: (sim) => at(sim, F.to) || c1(sim),
        target: 'play',
      },
      {
        id: 'sell',
        title: '짐 팔기',
        body: '',
        tip: '짐칸 상품의 +숫자는 산 값보다 얼마나 더 받는지예요.',
        guide: (sim, v) =>
          atPort(sim, v, F.to, { body: `${cn(sim, F.to)}에 도착했어요. 짐칸의 ${gn(sim, F.goodId)}을(를) 누르고 「팔기」를 눌러요.`, point: [SELL, '.hold .tile:not(.cant)'] }),
        done: (sim) => c1(sim),
        target: 'dock',
      },
      {
        id: 'result',
        point: ['.trip-result'],
        pointText: '여기를 읽어 봐요',
        title: '결과 확인하기',
        body: '결과 카드에서 산 값과 판 값, 그리고 왜 남았는지를 읽어 봐요. 다 읽었으면 「다음」을 눌러요.',
        tip: '까닭에는 기후·자원·공장·계절처럼 무역이 생기는 이유가 나와요.',
      },
    ]),
    ...chapter('특산품', c2, [
      {
        id: 'specialty-buy',
        title: '한정 특산품 싣기',
        body: '',
        guide: (sim, v) => {
          const sp = spec(sim);
          if (sp && specialtyAvailable(sim.ctx, sim.state, P.at, sp) < 1) {
            return atPort(sim, v, P.at, { title: '특산품이 다 팔렸어요', body: '이번 달 물량이 없어요. 위쪽 「+1달」을 눌러 다음 달 생산분을 기다려요.', point: [MONTH] });
          }
          return atPort(sim, v, P.at, {
            body: `${cn(sim, P.at)} 창고에서 「한정 특산품」 표시가 붙은 ${sp?.name ?? '특산품'}을(를) 누르고 「싣기」를 눌러요. 다른 나라에 팔면 시세보다 웃돈을 받아요.`,
            tip: '특산품 물량은 나라마다 정해져 있고 매달 조금씩 다시 채워져요. 그 도시의 신뢰도가 오르면 더 많이 살 수 있어요.',
            point: [BUY, TUTOR_TILE, '.warehouse .tile:has(.specialty-tag):not(.cant)'],
            tutor: spTutor(sim),
          });
        },
        done: (sim) => hasSp(sim) || c2(sim),
      },
      {
        id: 'specialty-dest',
        title: '다른 나라로 목적지 고르기',
        body: '',
        tip: '같은 나라 안에서 팔면 웃돈이 없어요. 그래서 다른 나라 항구로 가요.',
        guide: (sim, v) => travel(sim, v, P.sellAt, { why: `특산품은 다른 나라인 ${cn(sim, P.sellAt)}에 팔아요. `, tutor: spTutor(sim) }),
        done: (sim, v) => v.dest === P.sellAt || lead(sim).to === P.sellAt || c2(sim),
      },
      {
        id: 'specialty-sail',
        title: '출발!',
        body: '',
        guide: (sim, v) => travel(sim, v, P.sellAt, { tutor: spTutor(sim) }),
        done: (sim) => lead(sim).to === P.sellAt || c2(sim),
      },
      {
        id: 'specialty-wait',
        title: '도착을 기다려요',
        body: '',
        guide: (sim, v) => travel(sim, v, P.sellAt),
        done: (sim) => at(sim, P.sellAt) || c2(sim),
        target: 'play',
      },
      {
        id: 'specialty-sell',
        title: '다른 나라에 팔기',
        body: '',
        tip: '해외에서 처음 팔 때는 관세·하역비를 빼고도 산 값보다 25% 넘게 받도록 보장돼요.',
        guide: (sim, v) =>
          atPort(sim, v, P.sellAt, {
            body: `${cn(sim, P.sellAt)}에 도착했어요. 짐칸의 특산품을 누르고 「팔기」를 눌러요.`,
            point: [SELL, '.hold .tile:has(.specialty-tag):not(.cant)', '.hold .tile:not(.cant)'],
          }),
        done: (sim) => c2(sim),
        target: 'dock',
      },
    ]),
    ...chapter('직접 골라 무역', c3, [
      {
        id: 'world',
        title: '어디가 싼지 보기',
        body: '이번엔 힌트 없이 직접 골라 봐요. 먼저 위쪽 「세계」를 눌러요.',
        point: ['[data-tut="world"]'],
        done: (sim, v) => v.win === 'world' || loaded3(sim) || c3(sim),
      },
      {
        id: 'prices',
        title: '값 차이 찾기',
        body: '',
        guide: (sim, v) =>
          v.win !== 'world'
            ? { body: '위쪽 「세계」를 눌러 값 표를 다시 열어요. 다 읽었으면 「다음」을 눌러요.', point: ['[data-tut="world"]'] }
            : {
                body: `「어디가 쌀까」 표에는 상품마다 가장 싼 도시와 가장 비싼 도시가 나와요. 지금 배가 있는 ${cn(sim, K.from)}에서는 ${gn(sim, K.goodId)}이(가) 싼 편이에요. 다 읽었으면 「다음」을 눌러요.`,
                tip: '상품 이름을 누르면 「상품 렌즈」로 지도에서 그 상품이 싼 곳과 비싼 곳을 한눈에 볼 수 있어요.',
                point: ['.price-rows'],
                pointText: '여기를 읽어 봐요',
              },
      },
      {
        id: 'pick-dest',
        title: '지도에서 목적지 고르기',
        body: '',
        tip: '목적지를 고르면 창고 상품에 초록 숫자가 나와요. 그 항구에서 팔면 1개당 남는 돈이에요(연료비 빼기 전).',
        guide: (sim, v) =>
          at(sim, K.from)
            ? travel(sim, v, K.to, { why: `${gn(sim, K.goodId)}을(를) 가까운 ${cn(sim, K.to)}에 팔아 볼 거예요. `, tutor: pickTutor })
            : atPort(sim, v, K.from, { body: '' }),
        done: (sim, v) => v.dest === K.to || loaded3(sim) || lead(sim).to === K.to || c3(sim),
      },
      {
        id: 'pick-load',
        title: '상품과 수량 정하기',
        body: '',
        tip: '많이 실을수록 좋은 건 아니에요. 작은 도시에 한꺼번에 많이 팔면 값이 뚝 떨어져요.',
        guide: (sim, v) =>
          atPort(sim, v, K.from, {
            body: `창고에서 ${gn(sim, K.goodId)}을(를) 눌러요. 막대가 ${K.quantity}개에 맞춰져 있으니 그대로 「싣기」를 눌러요.`,
            point: [BUY, TUTOR_TILE],
            tutor: pickTutor,
          }),
        done: (sim) => loaded3(sim) || lead(sim).to === K.to || c3(sim),
      },
      {
        id: 'pick-sail',
        title: '출발!',
        body: '',
        guide: (sim, v) => travel(sim, v, K.to, { tutor: pickTutor }),
        done: (sim) => lead(sim).to === K.to || c3(sim),
      },
      {
        id: 'pick-wait',
        title: '도착을 기다려요',
        body: '',
        guide: (sim, v) => travel(sim, v, K.to),
        done: (sim) => at(sim, K.to) || c3(sim),
        target: 'play',
      },
      {
        id: 'pick-sell',
        title: '직접 고른 짐 팔기',
        body: '',
        guide: (sim, v) =>
          atPort(sim, v, K.to, { body: `${cn(sim, K.to)}에 도착했어요. 짐칸의 상품을 누르고 「팔기」를 눌러요.`, point: [SELL, '.hold .tile:not(.cant)'] }),
        done: (sim, _v, b) => c3(sim) || (b.trades > 0 && sim.state.player.tradeCount > b.trades),
        target: 'dock',
      },
    ]),
    ...chapter('발주와 납품', c4, [
      {
        id: 'orders-open',
        title: '발주함 열기',
        body: '',
        order: true,
        guide: acceptGuide,
        done: (sim, v) => v.win === 'orders' || accepted(sim),
      },
      {
        id: 'orders-accept',
        title: '발주 받기',
        body: '',
        order: true,
        guide: acceptGuide,
        done: (sim) => accepted(sim),
      },
      {
        id: 'orders-run',
        title: '조달하고 납품하기',
        body: '',
        order: true,
        guide: orderRun,
        done: (sim) => c4(sim),
        target: 'dock',
      },
    ]),
    ...chapter('회사 창고', (sim) => stored(sim), [
      {
        id: 'store-load',
        title: '맡길 물건 싣기',
        body: '',
        tip: '값이 쌀 때 사서 창고에 두었다가, 값이 오를 때 팔거나 다른 배로 실어 보낼 수 있어요.',
        guide: (sim, v) =>
          atPort(sim, v, S.home, {
            body: `거점 ${cn(sim, S.home)}에는 회사 창고가 있어요. 맡길 물건으로 항구 창고에서 ${gn(sim, S.store.goodId)}을(를) 누르고 「싣기」를 눌러요(${S.store.quantity}개에 맞춰져 있어요).`,
            point: [BUY, TUTOR_TILE],
            tutor: { goodId: S.store.goodId, quantity: S.store.quantity },
          }),
        done: (sim) => (at(sim, S.home) && lead(sim).cargo.some((l) => l.quantity >= 0.5)) || stored(sim),
      },
      {
        id: 'warehouse-open',
        title: '회사 창고 열기',
        body: '',
        guide: (sim, v) =>
          v.portOpen && at(sim, S.home)
            ? { body: '항구 창 위쪽의 「회사 창고」 단추를 눌러요.', point: ['[data-tut="port-warehouse"]', '.dock-cash'] }
            : company(v, 'warehouse', '회사 창고', { body: '' }),
        done: (sim, v) => (v.win === 'company' && v.companyTab === 'warehouse') || stored(sim),
        target: 'company',
      },
      {
        id: 'warehouse-store',
        title: '창고에 맡기기',
        body: '',
        tip: '맡긴 부피만큼 매달 보관료가 나가요. 과일 같은 식료품은 냉장 구역을 지어 따로 보관해요.',
        guide: (sim, v) => {
          if (!at(sim, S.home) || !lead(sim).cargo.length) return atPort(sim, v, S.home, { body: `맡길 짐이 없어요. 항구 창고에서 ${gn(sim, S.store.goodId)}을(를) 실어요.`, point: [BUY, TUTOR_TILE], tutor: { goodId: S.store.goodId, quantity: S.store.quantity } });
          return company(v, 'warehouse', '회사 창고', { body: '아래쪽에서 상품과 수량을 확인하고 「배 → 창고」를 눌러요.', point: ['[data-tut="warehouse-store"]:not(:disabled)', '.storage-controls'] });
        },
        done: (sim) => stored(sim),
      },
    ]),
    ...chapter('도시 신뢰도', c7, [
      {
        id: 'trust-open',
        title: '신뢰도 보기',
        body: '',
        guide: (_sim, v) => company(v, 'local', '지역 거래', { body: '' }),
        done: (_sim, v) => v.win === 'company' && v.companyTab === 'local',
        target: 'company',
      },
      {
        id: 'trust-read',
        title: '신뢰도가 주는 혜택',
        body: '',
        guide: (sim, v) =>
          company(v, 'local', '지역 거래', {
            body: `방금 발주를 기한 안에 모두 납품해서 ${cn(sim, S.order.cityId)} 신뢰도가 +10 올랐어요. 20·50·80점이 되면 새 발주 단가가 5·10·15% 오르고, 특산품도 10·20·30% 더 살 수 있어요. 다 읽었으면 「다음」을 눌러요.`,
            tip: '다른 도시의 신뢰도는 아래 「다른 도시의 거래 신뢰도」를 펼쳐 봐요. 발주 카드에도 그 도시의 신뢰도가 나와요.',
            point: ['.local-trust'],
            pointText: '여기를 읽어 봐요',
          }),
      },
    ]),
    ...chapter('배 사기', c7, [
      {
        id: 'ships-open',
        title: '배 가게 열기',
        body: '',
        guide: (_sim, v) => company(v, 'ships', '배 사기', { body: '' }),
        done: (sim, v) => (v.win === 'company' && v.companyTab === 'ships') || c7(sim),
        target: 'company',
      },
      {
        id: 'ships-buy',
        title: '배 한 척 더 사기',
        body: '',
        tip: '배마다 매달 유지비가 나가요. 큰 배는 많이 싣지만 큰 항구에만 들어가고 연료도 많이 써요.',
        guide: (sim, v) => {
          const type = cheapest(sim), cash = sim.state.player.cash;
          return company(
            v, 'ships', '배 사기',
            cash < type.price
              ? { body: `「${type.name}」은(는) ${won(type.price)}이에요. 돈이 ${won(type.price - cash)} 모자라요. 무역을 더 해서 모은 뒤 사요.` }
              : { body: `배가 많으면 여러 곳과 한꺼번에 무역할 수 있어요. 값싼 「${type.name}」의 사기 단추를 눌러요.`, point: ['[data-tut="buy-ship"]:not(:disabled)'] },
          );
        },
        done: (sim) => c7(sim),
      },
    ]),
    ...chapter('정기 항로', c8, [
      {
        id: 'routes-open',
        title: '정기 항로 열기',
        body: '',
        guide: (_sim, v) => company(v, 'routes', '정기 항로', { body: '' }),
        done: (sim, v) => (v.win === 'company' && v.companyTab === 'routes') || sim.state.player.routes.length > 0,
        target: 'company',
      },
      {
        id: 'routes-make',
        title: '항로 짜기',
        body: '',
        guide: routeMake,
        done: (sim) => sim.state.player.routes.length > 0,
      },
      {
        id: 'routes-assign',
        title: '배 맡기기',
        body: '',
        tip: '남는 거래가 없으면 배는 항구에서 기다리고, 카드에 그 이유가 나와요. 항로에서 빼면 다시 직접 몰 수 있어요.',
        guide: (_sim, v) =>
          company(v, 'routes', '정기 항로', { body: '항로 카드의 「배 맡기기」에서 배를 눌러요. 그 배는 이제 알아서 항로를 돌며 사고팔아요.', point: ['[data-tut="route-assign"]:not(:disabled)'] }),
        done: (sim) => c8(sim),
      },
      {
        id: 'routes-watch',
        title: '정기 항로 지켜보기',
        body: '',
        tip: '배 카드에 지금 무엇을 하는지 나와요. 남는 거래가 없으면 항구에서 기다려요.',
        guide: (sim, v) => {
          if (dom('.planner')) return { title: '항로 짜기 닫기', body: '항로 짜기 화면의 「취소」를 눌러 닫아요.', point: ['.planner-actions .btn:not(.primary)'] };
          if (v.win) return { ...CLOSE_WIN, body: '이제 배가 스스로 일하는 모습을 볼 거예요. 창 오른쪽 위의 ×를 눌러 회사 창을 닫아요.' };
          if (v.portOpen) return { title: '항구 창 닫기', body: '항구 창 오른쪽 위의 ×를 눌러 닫아요.', point: ['.port-win .port-head .icon-btn[aria-label="닫기"]'] };
          if (!sim.playing) return { body: '위쪽 「시작」을 눌러 시간을 흐르게 해요. 정기 항로를 맡은 배가 알아서 항구를 오가며 사고팔아요.', point: ['[data-tut="play"]:not(.on)'] };
          return { body: '정기 항로를 맡은 배가 알아서 항구를 오가며 사고파는 것을 두 달쯤 지켜봐요. 왼쪽 아래 돈이 어떻게 바뀌는지도 봐요.' };
        },
        done: (sim, _v, b) => b.month !== undefined && sim.state.month >= b.month + 2,
        target: 'play',
      },
      {
        id: 'result-open',
        title: '회사 결과 보기',
        body: '',
        guide: (_sim, v) => company(v, 'result', '결과', { body: '' }),
        done: (_sim, v) => v.win === 'company' && v.companyTab === 'result',
        target: 'company',
      },
      {
        id: 'result-read',
        title: '얼마나 벌었을까?',
        body: '',
        guide: (_sim, v) =>
          company(v, 'result', '결과', {
            body: '「결과」 탭에는 최근 순이익과 번 돈·쓴 돈이 나와요. 배를 사느라 쓴 돈, 무역으로 번 돈을 살펴봐요. 다 봤으면 「다음」을 눌러요.',
            tip: '「배 현황」 탭에서는 배마다 얼마나 벌었는지 따로 볼 수 있어요.',
            point: ['.stat-cards'],
            pointText: '여기를 읽어 봐요',
          }),
      },
      {
        id: 'result-close',
        title: '회사 창 닫기',
        body: '',
        guide: () => ({ ...CLOSE_WIN, title: '회사 창 닫기', body: '다 봤으면 창 오른쪽 위의 ×를 눌러 회사 창을 닫아요.' }),
        done: (_sim, v) => v.win !== 'company',
      },
      {
        id: 'end',
        finish: true,
        title: '튜토리얼을 모두 마쳤어요!',
        body: '무역회사 운영에 필요한 것을 모두 해 봤어요. 이 회사로 계속 플레이할까요, 아니면 다른 수업을 시작할까요? 계속하면 다른 도시의 발주도 오고, 어디든 자유롭게 무역할 수 있어요.',
      },
    ]),
  ];
}
