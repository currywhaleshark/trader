import type { GameSettings } from '../sim/classroom/settings';
import type { EconomyState } from '../sim/economy/types';

/**
 * 저장·이어하기(§12.2). 브라우저 저장소에 게임 상태(JSON)를 담는다.
 * 세계(지형·기후)는 시드로 다시 만들 수 있으므로 저장하지 않는다.
 * 저장소를 못 쓰는 환경(사생활 보호 창 등)에서는 조용히 실패하고 게임은 계속된다.
 */
export interface SaveFile {
  version: 1;
  savedAt: string;
  /** 사람이 읽는 제목(회사 이름·날짜) */
  label: string;
  settings: GameSettings;
  state: EconomyState;
}

export type SlotId = 'auto' | 'slot1' | 'slot2' | 'slot3';
export const SLOTS: { id: SlotId; name: string }[] = [
  { id: 'auto', name: '자동 저장' },
  { id: 'slot1', name: '저장 1' },
  { id: 'slot2', name: '저장 2' },
  { id: 'slot3', name: '저장 3' },
];

const KEY = (slot: SlotId) => `trade-sim/save/${slot}`;

export function saveGame(slot: SlotId, file: Omit<SaveFile, 'version' | 'savedAt'>): boolean {
  try {
    const data: SaveFile = { ...file, version: 1, savedAt: new Date().toISOString() };
    localStorage.setItem(KEY(slot), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(slot: SlotId): SaveFile | null {
  try {
    const raw = localStorage.getItem(KEY(slot));
    if (!raw) return null;
    const data = JSON.parse(raw) as SaveFile;
    return data.version === 1 && data.state && data.settings ? data : null;
  } catch {
    return null;
  }
}

/** 슬롯마다 제목·저장 시각만(목록용) */
export function listSaves(): { id: SlotId; name: string; label?: string; savedAt?: string }[] {
  return SLOTS.map((s) => {
    const f = loadGame(s.id);
    return { ...s, label: f?.label, savedAt: f?.savedAt };
  });
}
