/**
 * 쾨펜-가이거 기후 구분(Kottek et al. 2006, 0.5°) 코드표와 게임 기후대 대응.
 * 게임 기후대(CLIMATE_ZONES)는 초등 사회과 수준으로 묶은 것이라, 아래 대응은 단순화다.
 */
export const KOPPEN_CODES = [
  '', 'Af', 'Am', 'As', 'Aw', 'BWk', 'BWh', 'BSk', 'BSh', 'Cfa', 'Cfb', 'Cfc', 'Csa', 'Csb', 'Csc', 'Cwa', 'Cwb', 'Cwc',
  'Dfa', 'Dfb', 'Dfc', 'Dfd', 'Dsa', 'Dsb', 'Dsc', 'Dsd', 'Dwa', 'Dwb', 'Dwc', 'Dwd', 'EF', 'ET',
];

/** 쾨펜 코드 -> CLIMATE_ZONES id. 고산(10)은 고도로 따로 정한다. */
export function koppenToZone(code: string): number {
  if (!code) return 0;
  if (code === 'Af' || code === 'Am') return 1;
  if (code === 'As' || code === 'Aw') return 2;
  if (code.startsWith('BW')) return 3;
  if (code.startsWith('BS')) return 4;
  if (code.startsWith('Cs')) return 5;
  if (code === 'Cfa' || code === 'Cwa') return 6;
  if (code.startsWith('C')) return 7;
  if (code.startsWith('D')) return 8;
  return 9;
}

/** 이 고도(m)를 넘는 한대가 아닌 육지는 고산 기후로 묶는다 */
export const HIGHLAND_ELEVATION_M = 2500;
