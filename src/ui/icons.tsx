import type { CSSProperties } from 'react';

/**
 * 아이콘 자리표시자(Tabler 아이콘 글꼴, MIT, 로컬 설치).
 * 화면은 아래 표의 "의미 이름"(상품 id, 이유 분류 …)으로만 아이콘을 부른다.
 * 나중에 전용 그림(SVG)으로 바꿀 때는 이 파일의 표와 <Icon>만 바꾸면 된다.
 */

/** 상품 id -> 아이콘 */
export const GOOD_ICON: Record<string, string> = {
  grain: 'wheat',
  fruit: 'apple',
  cotton: 'cloud',
  timber: 'trees',
  iron_ore: 'pick',
  crude_oil: 'barrel',
  steel: 'hammer',
  textiles: 'needle-thread',
  fuel: 'gas-station',
  electronics: 'cpu',
  processed_food: 'baguette',
  clothing: 'shirt',
  furniture: 'armchair',
  machinery: 'settings',
  automobiles: 'car',
  cosmetics: 'perfume',
};

/** 무역이 생긴 이유 분류 -> 아이콘 */
export const REASON_ICON: Record<string, string> = {
  climate: 'sun',
  resource: 'pick',
  industry: 'building-factory-2',
  season: 'leaf',
  shortage: 'alert-triangle',
  demand: 'users',
  policy: 'receipt-tax',
  culture: 'movie',
  market: 'coin',
};

/** 화물 구분 -> 아이콘 */
export const CARGO_ICON: Record<string, string> = {
  bulk: 'stack-2',
  general: 'box',
  perishable: 'snowflake',
};

/** 화면 곳곳에서 쓰는 일반 아이콘 */
export const UI_ICON = {
  ship: 'ship',
  port: 'anchor',
  money: 'coin',
  date: 'calendar',
  play: 'player-play',
  pause: 'player-pause',
  goal: 'flag',
  menu: 'menu-2',
  tariff: 'receipt-tax',
  fuel: 'gas-station',
  cold: 'snowflake',
  crane: 'crane',
} as const;

/** 상품 분류별 테두리 색(원재료·중간재·완제품) */
export const CATEGORY_TINT: Record<string, string> = {
  raw: 'var(--tint-raw)',
  intermediate: 'var(--tint-mid)',
  final: 'var(--tint-final)',
};

export function Icon({ name, size, label, style }: { name: string; size?: number; label?: string; style?: CSSProperties }) {
  return (
    <i
      className={`ti ti-${name}`}
      aria-hidden={label ? undefined : true}
      aria-label={label}
      role={label ? 'img' : undefined}
      style={{ fontSize: size, lineHeight: 1, ...style }}
    />
  );
}

export function GoodIcon({ id, size, label }: { id: string; size?: number; label?: string }) {
  return <Icon name={GOOD_ICON[id] ?? 'box'} size={size} label={label} />;
}

export function ReasonIcon({ category, size }: { category: string; size?: number }) {
  return <Icon name={REASON_ICON[category] ?? 'coin'} size={size} />;
}
