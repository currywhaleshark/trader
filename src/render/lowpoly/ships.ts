import type * as THREE from 'three';
import { ModelBuilder, PALETTE } from './kit';

/**
 * 로우폴리 화물선. 길이 1(뱃머리 +x, 고물 -x), 위 +y, 물높이 y = 0.
 * 선종마다 모양이 달라 멀리서도 구분되게 했다(§10.2의 선택이 눈에 보이도록).
 *  - 소형 일반화물선: 짧고 통통한 빨간 배, 작은 크레인
 *  - 중형 일반화물선: 남색, 크레인 둘, 해치 셋
 *  - 벌크선: 넓고 긴 검붉은 배, 해치 덮개 여럿, 높은 선교
 *  - 컨테이너선: 색색의 컨테이너 더미
 *  - 냉장선: 흰 배에 청록 띠, 하얀 냉장 화물칸
 *  - NPC 화물선: 중형선 모양에 회사 색 굴뚝
 * 굴뚝 띠(funnel)는 회사 색이다. 내 배는 금색.
 */
export interface ShipLook {
  /** 'small' | 'medium' | 'bulk' | 'container' | 'reefer' | 'npc' */
  kind: string;
  funnel: string;
}

/** 위에서 본 선체 윤곽(고물이 평평하고 뱃머리가 뾰족하다) */
function hullOutline(beam: number, bowStart = 0.22): [number, number][] {
  const b = beam / 2;
  return [
    [-0.5, -b * 0.92],
    [bowStart, -b],
    [0.4, -b * 0.62],
    [0.5, 0],
    [0.4, b * 0.62],
    [bowStart, b],
    [-0.5, b * 0.92],
  ];
}

function hull(m: ModelBuilder, beam: number, top: number, color: string, bowStart?: number): void {
  const outline = hullOutline(beam, bowStart);
  m.prism(outline, -0.035, 0.012, PALETTE.antifoul); // 물에 잠기는 부분
  m.prism(outline, 0.012, top, color);
  const inner = outline.map(([x, z]) => [x * 0.96, z * 0.86] as [number, number]);
  m.prism(inner, top, top + 0.006, PALETTE.deck);
}

/** 고물 쪽 선교(조타실)와 굴뚝 */
function bridge(m: ModelBuilder, x: number, beam: number, deck: number, levels: number, funnel: string): void {
  const w = 0.12;
  const d = beam * 0.86;
  const lh = 0.05;
  for (let i = 0; i < levels; i++) m.block(w * (1 - i * 0.08), lh, d * (1 - i * 0.04), PALETTE.white, x, deck + i * lh, 0);
  m.block(w * 0.82, lh * 0.45, d * 1.02, PALETTE.window, x + 0.004, deck + (levels - 1) * lh + lh * 0.35, 0);
  m.block(w * 1.05, 0.01, d * 1.08, PALETTE.white, x, deck + levels * lh, 0);
  // 굴뚝: 회사 색 띠
  const fx = x - w * 0.55;
  m.block(0.05, 0.05, 0.05, PALETTE.white, fx, deck + levels * lh, 0);
  m.block(0.052, 0.035, 0.052, funnel, fx, deck + levels * lh + 0.05, 0);
  m.block(0.054, 0.012, 0.054, PALETTE.hullDark, fx, deck + levels * lh + 0.085, 0);
}

function crane(m: ModelBuilder, x: number, deck: number, h: number, boomLen: number, rot: number): void {
  m.cylinder(0.008, 0.01, h, PALETTE.crane, x, deck, 0, 5);
  const bx = x + Math.cos(rot) * boomLen * 0.45;
  const bz = Math.sin(rot) * boomLen * 0.45;
  m.box(boomLen, 0.008, 0.008, PALETTE.crane, bx, deck + h * 0.85, bz, -rot);
}

function hatch(m: ModelBuilder, x: number, len: number, beam: number, deck: number, color: string): void {
  m.block(len, 0.022, beam * 0.62, color, x, deck, 0);
  m.block(len * 0.9, 0.008, beam * 0.5, color, x, deck + 0.022, 0);
}

export function buildShip(look: ShipLook): THREE.BufferGeometry {
  const m = new ModelBuilder();
  const funnel = look.funnel;
  switch (look.kind) {
    case 'small': {
      const beam = 0.3;
      const deck = 0.07;
      hull(m, beam, deck, PALETTE.hullRed, 0.18);
      bridge(m, -0.34, beam, deck, 2, funnel);
      hatch(m, 0.02, 0.18, beam, deck, PALETTE.hatchGreen);
      hatch(m, 0.22, 0.12, beam, deck, PALETTE.hatchBlue);
      crane(m, 0.12, deck, 0.12, 0.16, 0.6);
      m.block(0.06, 0.015, beam * 0.6, PALETTE.white, 0.42, deck, 0); // 뱃머리 갑판
      break;
    }
    case 'bulk': {
      const beam = 0.22;
      const deck = 0.06;
      hull(m, beam, deck, PALETTE.hullDark, 0.3);
      bridge(m, -0.4, beam, deck, 4, funnel);
      for (let i = 0; i < 5; i++) hatch(m, -0.22 + i * 0.13, 0.1, beam, deck, PALETTE.antifoul);
      break;
    }
    case 'container': {
      const beam = 0.2;
      const deck = 0.055;
      hull(m, beam, deck, PALETTE.hullNavy, 0.28);
      bridge(m, -0.3, beam, deck, 5, funnel);
      const C = PALETTE.containers;
      let k = 0;
      for (let col = 0; col < 6; col++) {
        const x = -0.18 + col * 0.095;
        if (Math.abs(x - -0.3) < 0.06) continue;
        const tiers = col === 0 || col === 5 ? 2 : 3;
        for (let t = 0; t < tiers; t++) {
          for (let row = -1; row <= 1; row++) {
            m.block(0.085, 0.028, beam * 0.27, C[k++ % C.length], x, deck + t * 0.029, row * beam * 0.29);
          }
        }
      }
      break;
    }
    case 'reefer': {
      const beam = 0.22;
      const deck = 0.065;
      hull(m, beam, deck, PALETTE.hullWhite, 0.24);
      m.prism(hullOutline(beam, 0.24).map(([x, z]) => [x * 1.002, z * 1.01] as [number, number]), 0.03, 0.042, PALETTE.hullTeal);
      bridge(m, -0.36, beam, deck, 3, funnel);
      m.block(0.42, 0.05, beam * 0.7, PALETTE.white, 0.06, deck, 0);
      m.block(0.42, 0.01, beam * 0.74, PALETTE.hullTeal, 0.06, deck + 0.05, 0);
      crane(m, -0.18, deck, 0.11, 0.14, -0.7);
      break;
    }
    case 'npc':
    case 'medium':
    default: {
      const beam = 0.22;
      const deck = 0.06;
      hull(m, beam, deck, look.kind === 'npc' ? PALETTE.hullTeal : PALETTE.hullNavy, 0.24);
      bridge(m, -0.37, beam, deck, 3, funnel);
      hatch(m, -0.14, 0.13, beam, deck, PALETTE.hatchGreen);
      hatch(m, 0.03, 0.13, beam, deck, PALETTE.hatchGreen);
      hatch(m, 0.2, 0.13, beam, deck, PALETTE.hatchBlue);
      crane(m, -0.05, deck, 0.12, 0.17, 0.7);
      crane(m, 0.12, deck, 0.12, 0.17, -0.7);
      break;
    }
  }
  return m.build();
}
