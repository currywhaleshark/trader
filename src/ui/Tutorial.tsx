import { useEffect, useState } from 'react';
import { PLAYER_ID } from '../sim/economy/player';
import { Icon } from './icons';
import type { Simulation } from './useSimulation';

/**
 * 튜토리얼: 첫 거래부터 회사 운영까지 할 일을 한 단계씩 짚어 준다.
 * 단계마다 "할 일"과 "팁"을 보여 주고, 누를 곳(target)을 반짝인다.
 * 할 일을 하면(게임 상태·화면 상태로 판정) 저절로 다음 단계로 넘어간다. 읽기만 하는 단계는 「다음」을 누른다.
 */

/** 튜토리얼이 보는 화면 상태(게임 상태 밖의 것) */
export interface TutorialView {
  /** 항구 창이 열려 있는가 */
  portOpen: boolean;
  /** 항구 창에서 고른 목적지 */
  dest: string | null;
  /** 회사 창이 열려 있는가 */
  companyOpen: boolean;
}

/** 반짝일 곳 */
export type TutorialTarget = 'dock' | 'play' | 'company';

interface Step {
  id: string;
  title: string;
  body: string;
  tip?: string;
  /** 이 조건이 되면 저절로 다음 단계로. 없으면 「다음」을 누른다 */
  done?: (sim: Simulation, v: TutorialView) => boolean;
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

const STEPS: Step[] = [
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
    done: (_sim, v) => v.companyOpen,
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

/** 저장을 불러왔을 때: 이미 해낸 단계는 건너뛴다(마지막으로 끝난 자동 단계 다음부터) */
function firstStep(sim: Simulation): number {
  const v: TutorialView = { portOpen: false, dest: null, companyOpen: false };
  let at = 0;
  STEPS.forEach((s, i) => {
    if (s.done && s.id !== 'company' && s.done(sim, v)) at = i + 1;
  });
  return Math.min(at, STEPS.length - 1);
}

/** 튜토리얼 진행 상태. on이 아니면 아무것도 하지 않는다 */
export function useTutorial(sim: Simulation | null, view: TutorialView) {
  const on = !!sim && sim.settings.tutorial === true;
  const [step, setStep] = useState<number | null>(null);
  const [closed, setClosed] = useState(false);
  // 새 게임·불러오기마다 처음(또는 해낸 곳 다음)부터
  const gameKey = sim ? `${sim.ctx.data.player.companyName}|${sim.settings.seed}|${sim.settings.scenarioId}` : '';
  useEffect(() => {
    setClosed(false);
    setStep(sim && on ? firstStep(sim) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameKey, on]);
  // 할 일을 했으면 저절로 다음 단계로(여러 단계를 한꺼번에 해냈으면 한꺼번에)
  useEffect(() => {
    if (!sim || step === null) return;
    let k = step;
    while (k < STEPS.length - 1 && STEPS[k].done?.(sim, view)) k++;
    if (k !== step) setStep(k);
  });
  const active = on && !closed && step !== null;
  const current = active ? STEPS[step!] : null;
  return {
    active,
    step: current,
    index: step ?? 0,
    count: STEPS.length,
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
        <span className="muted small">
          튜토리얼 {t.index + 1}/{t.count}
        </span>
        <button className="x" onClick={t.close} aria-label="튜토리얼 닫기" title="튜토리얼 닫기">
          ×
        </button>
      </div>
      <b className="tut-title">{s.title}</b>
      <p>{s.body}</p>
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
        <span className="tut-dots" aria-hidden="true">
          {Array.from({ length: t.count }, (_, i) => (
            <i key={i} className={i < t.index ? 'done' : i === t.index ? 'now' : ''} />
          ))}
        </span>
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
      const found = target && inView(target) ? target.getBoundingClientRect() : null;
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
