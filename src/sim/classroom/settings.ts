import type { EconomyData } from '../economy/data';
import type { WorldMode } from '../world/types';

/**
 * 교사 설정(M5). 수업마다 바꾸고 싶은 것만 모았다. 나머지 수치는 economy/data.ts의 기본값을 쓴다.
 */
export interface GameSettings {
  /** 세계 모드(없으면 가상 세계: 예전 저장과 호환) */
  mode?: WorldMode;
  companyName?: string;
  companyLogo?: string;
  /** 플레이어가 처음 서 있는 항구(없으면 모드 프로필의 기본값) */
  startCityId?: string;
  /** 교사가 끈 시나리오 사건 id(게임 속 사건을 수업 목적에 맞게 고른다) */
  disabledTriggers?: string[];
  /** 시나리오 id(scenarios.ts). 'free'는 자유 놀이 */
  scenarioId: string;
  /** 세계 시드. 같은 시드면 모두 같은 세계에서 시작한다(모둠 비교용) */
  seed: string;
  startingCash: number;
  /** 나라들이 스스로 관세·협정·갈등을 만드는가(꺼도 시나리오의 사건은 일어난다) */
  autoPolicies: boolean;
  /** 문화 유행이 저절로 생기는가 */
  autoCulture: boolean;
  /** 인구·소득·산업·기술·항만이 해마다 바뀌는가 */
  longTermGrowth: boolean;
  /** 거래 힌트를 보여 주는가 */
  showHints: boolean;
  /**
   * 튜토리얼: 할 일을 한 단계씩 짚어 주고 팁을 보여 준다(누를 곳을 반짝인다).
   * 끄면 안내 없이 자유롭게 한다. 없으면(예전 저장) 첫 거래까지만 짧은 안내를 보여 준다.
   */
  tutorial?: boolean;
  /** 처음 속도(1 보통, 2 빠름, 5 아주 빠름) */
  speed: number;
}

export const DEFAULT_SETTINGS: GameSettings = {
  mode: 'virtual',
  scenarioId: 'first-trade',
  seed: 'trade-world-1',
  startingCash: 30000,
  autoPolicies: false,
  autoCulture: false,
  longTermGrowth: true,
  showHints: true,
  tutorial: true,
  speed: 1,
};

/** 설정을 경제 데이터에 반영한 복사본 */
export function applySettings(data: EconomyData, s: GameSettings): EconomyData {
  const d: EconomyData = structuredClone(data);
  d.player.companyName = s.companyName?.trim() || d.player.companyName;
  d.player.startingCash = s.startingCash;
  if (s.startCityId && d.cities[s.startCityId]) d.player.startCityId = s.startCityId;
  if (!s.autoPolicies) {
    d.policy.protection.chance = 0;
    d.policy.fta.chance = 0;
    d.policy.conflict.chance = 0;
  }
  if (!s.autoCulture) d.culture.waveChance = 0;
  d.growth.enabled = s.longTermGrowth;
  return d;
}
