import { isDocked } from '../sim/economy/player';
import type { Ship } from '../sim/economy/types';
import type { Simulation } from './useSimulation';

/**
 * 내 배가 지금 무엇을 하는지. 독·배 목록·항로 카드·항구 창이 같은 말을 쓰도록 한곳에서 정한다.
 *  sailing   항해 중
 *  docked    항구에 서서 내 명령을 기다림(직접 운항)
 *  loading   정기 항로 기항지에서 싣고 내리는 중(잠깐)
 *  waitProfit 정기 항로: 지금은 돌아도 남지 않아 기다림
 *  waitFuel  정기 항로: 연료비가 모자라 기다림
 */
export type ShipStatusKind = 'sailing' | 'docked' | 'loading' | 'waitProfit' | 'waitFuel';

export interface ShipStatus {
  kind: ShipStatusKind;
  /** 독처럼 좁은 곳에 쓰는 짧은 말 */
  short: string;
  /** 배 목록·항구 창에 쓰는 한 줄 */
  text: string;
  /** 더 자세한 까닭(없으면 빈 문자열) */
  detail: string;
}

const won = (v: number) => Math.round(v).toLocaleString('ko-KR');

export function shipStatus(sim: Simulation, ship: Ship, name: (cityId: string) => string): ShipStatus {
  const now = sim.now();
  const route = ship.routeId ? sim.state.player.routes.find((r) => r.id === ship.routeId) : undefined;
  if (ship.from !== ship.to) {
    const days = Math.max(0, Math.round((ship.arrivesAt - now) * 30));
    const eta = days < 1 ? '곧 도착' : `${days}일 남음`;
    const empty = ship.cargo.every((l) => l.quantity < 0.5);
    return {
      kind: 'sailing',
      short: days < 1 ? '곧 도착' : `${days}일`,
      text: `${name(ship.to)}(으)로 가는 중 · ${eta}${route && empty ? ' · 빈 배' : ''}`,
      detail: route && empty ? '이번 구간은 실어 나를 짐이 없어 빈 배로 가요. 다음 기항지에서 살 것이 있어요.' : '',
    };
  }
  if (isDocked(ship)) {
    return { kind: 'docked', short: '항구 열기', text: `${name(ship.to)}에 멈춰 있어요`, detail: '' };
  }
  const w = ship.routeWait;
  if (route && w) {
    const months = Math.max(0, Math.floor(now - w.since + 1e-6));
    const since = months >= 1 ? ` · ${months}달째` : '';
    if (w.reason === 'fuel') {
      return {
        kind: 'waitFuel',
        short: '연료비 부족',
        text: `${name(ship.to)}에서 기다리는 중 · 연료비가 모자라요${since}`,
        detail: '다음 기항지까지 갈 연료비가 없어요. 현금이 생기면 다달이 다시 출발해 봐요.',
      };
    }
    return {
      kind: 'waitProfit',
      short: '남는 거래 없음',
      text: `${name(ship.to)}에서 기다리는 중 · 남는 거래가 없어요${since}`,
      detail:
        `지금 값으로는 한 바퀴 돌아도 연료비·유지비만큼 벌지 못해요` +
        (w.estimate !== undefined ? `(한 바퀴 예상 ${w.estimate >= 0 ? '+' : ''}${won(w.estimate)})` : '') +
        `. 다달이 다시 따져 남으면 출발해요.`,
    };
  }
  return {
    kind: 'loading',
    short: '싣고 내리는 중',
    text: `${name(ship.to)}에서 싣고 내리는 중`,
    detail: '',
  };
}
