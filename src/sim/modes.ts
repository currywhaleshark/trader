import { buildEconomyData, VIRTUAL_PROFILE, type EconomyData, type EconomyProfile } from './economy/data';
import { EARTH_PROFILE, EARTH_START_PORTS } from './earth/profile';
import type { WorldMode } from './world/types';

/**
 * 모드 등록부. 모드마다 세계 자료의 위치와 경제 프로필만 다르고, 엔진은 하나다.
 * 외부 모드를 설치하는 플러그인 구조가 아니라, 두 모드를 이름으로 고르는 표다.
 */
export interface ModeDef {
  id: WorldMode;
  name: string;
  blurb: string;
  /** public/ 아래 세계 자료 폴더(배포 base 경로 기준). 가상 세계는 예전 경로를 그대로 쓴다. */
  assetDir: string;
  /** 자료 파일 이름(확장자 없이) */
  assetName: string;
  profile: EconomyProfile;
  /** 시드의 뜻(가상: 지형을 만든다 / 현실: 경제 사건·NPC만 재현한다) */
  seedMeaning: string;
  defaultSeed: string;
  /** 새 게임에서 고를 수 있는 시작 항구(없으면 프로필 기본값만) */
  startPorts?: { id: string; name: string }[];
}

export const MODES: Record<WorldMode, ModeDef> = {
  virtual: {
    id: 'virtual',
    name: '가상 세계',
    blurb: '두 대륙, 여섯 나라, 가상 도시. 시드마다 다른 지형이 만들어져요.',
    assetDir: 'world/',
    assetName: 'world',
    profile: VIRTUAL_PROFILE,
    seedMeaning: '같은 시드면 모둠마다 같은 세계에서 시작해요',
    defaultSeed: 'trade-world-1',
  },
  earth: {
    id: 'earth',
    name: '현실 지구',
    blurb: '실제 지구의 바다·나라·주요 무역항. 실제 자료로 시작하고, 그 뒤는 게임 속 경제가 계산해요.',
    assetDir: 'world/earth/',
    assetName: 'earth',
    profile: EARTH_PROFILE,
    seedMeaning: '지형은 실제 지구 그대로예요. 시드는 경제 사건·다른 회사 배의 움직임만 정해요',
    defaultSeed: 'earth-1',
    startPorts: EARTH_START_PORTS,
  },
};

export function modeOf(mode: WorldMode | undefined): ModeDef {
  return MODES[mode ?? 'virtual'];
}

/** 모드의 경제 데이터(공통 규칙 + 그 모드의 프로필) */
export function economyDataFor(mode: WorldMode | undefined): EconomyData {
  return buildEconomyData(modeOf(mode).profile);
}
