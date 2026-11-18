import type { LatLon } from '../core/sphere';
import type { EconomyContext, EconomyState, PassageInfo, RouteOption, Ship } from './types';

/**
 * 해상 구간의 공통 결과(§8.2). 지도 표시·도착 시각·실제 비용 차감·NPC·수동 거래 견적·자동항로 평가가
 * 모두 이 결과를 쓴다(직선거리 견적과 실제 우회가 따로 놀지 않게).
 */
export interface ShipProfile {
  /** 크기 등급(항만·운하 제한) */
  size: 1 | 2 | 3;
  speedKmPerMonth: number;
  fuelPer1000Km: number;
  upkeepPerMonth: number;
}

export interface LegChoice extends RouteOption {
  /** 항해 기간(통과 대기 포함, 항구에 머무는 시간은 뺌) */
  months: number;
  fuel: number;
  /** 통과료 합(이 배 크기 기준) */
  fees: number;
  /** 통과·대기로 더 걸리는 기간 */
  delayMonths: number;
  /** 연료 + 통과료 + 항해 기간의 유지비(경로를 고르는 기준) */
  cost: number;
  /** 기본 항로가 아닌 길로 간다 */
  detour: boolean;
  /** 경로 선택에 영향을 준 제한·까닭(학생용 문장) */
  reasons: string[];
  /** 같은 출발·도착의 기본 항로 거리(비교용) */
  baseDistanceKm: number;
}

/** 통과료(배 크기 기준) */
export function passageFee(p: PassageInfo, size: 1 | 2 | 3): number {
  return p.fee[size - 1] ?? 0;
}

/** 지금 이 배가 지날 수 없는 통과 지점: 막혔거나(사건) 배가 너무 크다(고정 제한·사건 제한) */
export function blockedPassages(ctx: EconomyContext, state: EconomyState | undefined, size: number): string[] {
  const out: string[] = [];
  for (const p of Object.values(ctx.passages)) {
    const live = state?.passages?.[p.id];
    const max = live?.maxShipSize ?? p.maxShipSize;
    if (live?.closed || (max !== undefined && size > max)) out.push(p.id);
  }
  return out;
}

function passageName(ctx: EconomyContext, id: string): string {
  return ctx.passages[id]?.name ?? id;
}

/**
 * from→to 구간에서 이 배가 실제로 갈 길: 미리 계산한 기본·대체 항로 가운데 지날 수 있는 것 중
 * 연료 + 통과료 + 유지비가 가장 적은 길. 미리 계산한 길로 안 되면 막힌 곳을 빼고 다시 찾는다.
 * 갈 수 없으면 null.
 */
export function chooseLeg(
  ctx: EconomyContext,
  state: EconomyState | undefined,
  from: string,
  to: string,
  ship: ShipProfile,
): LegChoice | null {
  if (from === to) return null;
  const options = ctx.routeOptions(from, to);
  if (options.length === 0) return null;
  const base = options[0];
  const blocked = blockedPassages(ctx, state, ship.size);
  let usable = options.filter((o) => o.passages.every((p) => !blocked.includes(p)));
  if (usable.length === 0 && blocked.length > 0) {
    const live = ctx.liveRoute(from, to, blocked);
    if (live) usable = [live];
  }
  if (usable.length === 0) return null;
  const evaluate = (o: RouteOption): LegChoice => {
    let fees = 0;
    let delay = 0;
    for (const id of o.passages) {
      const p = ctx.passages[id];
      if (!p) continue;
      fees += passageFee(p, ship.size);
      delay += p.delayMonths;
    }
    const months = o.distanceKm / ship.speedKmPerMonth + delay;
    const fuel = (o.distanceKm / 1000) * ship.fuelPer1000Km;
    return {
      ...o,
      months,
      fuel,
      fees,
      delayMonths: delay,
      cost: fuel + fees + months * ship.upkeepPerMonth,
      detour: o !== base,
      reasons: [],
      baseDistanceKm: base.distanceKm,
    };
  };
  const evaluated = usable.map(evaluate);
  // 같은 비용이면 미리 계산한 순서(기본 항로 먼저)를 따른다
  let best = evaluated[0];
  for (const e of evaluated) if (e.cost < best.cost - 1e-9) best = e;
  if (best.detour) {
    const avoided = base.passages.filter((p) => !best.passages.includes(p));
    const closedBy = avoided.filter((p) => blocked.includes(p));
    for (const p of closedBy) {
      const live = state?.passages?.[p];
      best.reasons.push(
        live?.closed
          ? `${passageName(ctx, p)}이(가) 막혀 돌아가요(${Math.round(best.distanceKm - base.distanceKm).toLocaleString('ko-KR')}km 더).`
          : `이 배는 ${passageName(ctx, p)}을(를) 지나기에 너무 커서 돌아가요.`,
      );
    }
    for (const p of avoided.filter((x) => !blocked.includes(x))) {
      best.reasons.push(`${passageName(ctx, p)} 통과료보다 돌아가는 연료·시간이 더 싸서 다른 길로 가요.`);
    }
  }
  return best;
}

/** NPC 선단의 배 모습(추상화된 범용선: 중형 크기) */
export function npcProfile(ctx: EconomyContext): ShipProfile {
  const npc = ctx.data.npc;
  return {
    size: 2,
    speedKmPerMonth: npc.speedKmPerMonth,
    fuelPer1000Km: ctx.data.shipping.costPerUnitPer1000Km * npc.shipCapacity,
    upkeepPerMonth: npc.shipUpkeep,
  };
}

/** 지금 항해의 경로 위 점들(지도에 그릴 실제 길). 기항지 좌표는 화면이 앞뒤에 붙인다. */
export function voyageWaypoints(ctx: EconomyContext, ship: Ship): LatLon[] | null {
  if (ship.from === ship.to) return null;
  const v = ship.voyage;
  if (v?.path) return v.path;
  const options = ctx.routeOptions(ship.from, ship.to);
  if (!options.length) return null;
  if (!v || v.avoid.length === 0) return options[0].waypoints;
  const same = options.find((o) => o.avoid.join(',') === v.avoid.join(',') || o.passages.join(',') === v.passages.join(','));
  if (same) return same.waypoints;
  return ctx.liveRoute(ship.from, ship.to, v.avoid)?.waypoints ?? options[0].waypoints;
}
