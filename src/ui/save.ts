import type { GameSettings } from '../sim/classroom/settings';
import type { EconomyData } from '../sim/economy/data';
import type { EconomyState } from '../sim/economy/types';
import type { World, WorldMode } from '../sim/world/types';

/**
 * 저장·이어하기(§12.2, 현실 지구 요구서 §13.1). 브라우저 저장소에 게임 상태(JSON)를 담는다.
 *  - 가상 세계의 지형은 시드로 다시 만들 수 있어 저장하지 않는다. 현실 지구는 고정 자료를 다시 읽는다.
 *  - 저장 파일만 보고 어떤 세계(모드·세계 id·자료 버전)와 경제 프로필인지 알 수 있다.
 *  - 모드가 없는 예전 저장(버전 1)은 가상 세계로 읽는다.
 *  - 가상 세계와 현실 지구는 저장 칸(자동 저장 포함)을 따로 쓴다. 가상 세계 칸은 예전 이름 그대로다.
 * 저장소를 못 쓰는 환경(사생활 보호 창 등)에서는 조용히 실패하고 게임은 계속된다.
 */
export const SAVE_VERSION = 2;

export interface SaveWorldRef {
  mode: WorldMode;
  worldId: string;
  /** 세계 자료 버전 */
  dataVersion: string;
  /** 세계 지문(같은 자료인지 확인용) */
  worldHash?: string;
  /** 경제 프로필 id·버전 */
  profileId: string;
  profileVersion: string;
}

export interface SaveFile {
  version: 2;
  savedAt: string;
  /** 사람이 읽는 제목(회사 이름·날짜) */
  label: string;
  world: SaveWorldRef;
  settings: GameSettings;
  state: EconomyState;
}

/** 버전 1 저장 파일(모드 도입 전) */
interface SaveFileV1 {
  version: 1;
  savedAt: string;
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

/** 저장 칸 이름. 가상 세계는 예전 저장이 그대로 보이도록 예전 이름을 쓴다. */
export function slotKey(mode: WorldMode, slot: SlotId): string {
  return mode === 'virtual' ? `trade-sim/save/${slot}` : `trade-sim/${mode}/save/${slot}`;
}

export function worldRef(world: World, data: EconomyData): SaveWorldRef {
  return {
    mode: world.mode,
    worldId: world.worldId,
    dataVersion: world.dataVersion,
    worldHash: world.hash,
    profileId: data.profile.id,
    profileVersion: data.profile.version,
  };
}

/**
 * 저장 파일(JSON 객체)을 지금 형식으로 읽는다. 모양이 틀리면 null.
 * 버전 1은 가상 세계 저장으로 올린다(모드·자료 버전을 모르므로 가상 세계 기본값으로 둔다).
 */
export function readSaveFile(raw: unknown): SaveFile | null {
  if (!raw || typeof raw !== 'object') return null;
  const f = raw as Partial<SaveFile> | Partial<SaveFileV1>;
  if (!f.state || !f.settings) return null;
  if (f.version === 1) {
    const v1 = f as SaveFileV1;
    return {
      version: 2,
      savedAt: v1.savedAt,
      label: v1.label,
      world: { mode: 'virtual', worldId: 'virtual', dataVersion: 'virtual-gen-1', profileId: 'virtual', profileVersion: '1' },
      settings: { ...v1.settings, mode: 'virtual' },
      state: v1.state,
    };
  }
  if (f.version === 2) {
    const v2 = f as SaveFile;
    if (!v2.world?.mode) return null;
    return { ...v2, settings: { ...v2.settings, mode: v2.world.mode } };
  }
  return null;
}

export function saveGame(slot: SlotId, file: Omit<SaveFile, 'version' | 'savedAt'>): boolean {
  try {
    const data: SaveFile = { ...file, version: 2, savedAt: new Date().toISOString() };
    localStorage.setItem(slotKey(file.world.mode, slot), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadGame(mode: WorldMode, slot: SlotId): SaveFile | null {
  try {
    const raw = localStorage.getItem(slotKey(mode, slot));
    if (!raw) return null;
    const f = readSaveFile(JSON.parse(raw));
    // 다른 모드의 저장이 이 칸에 들어 있으면(손으로 옮긴 경우 등) 읽지 않는다
    return f && f.world.mode === mode ? f : null;
  } catch {
    return null;
  }
}

/** 지금 게임 상태로 저장 파일 내용을 만든다(저장 칸에 쓰지 않는다) */
export function makeSaveFile(file: Omit<SaveFile, 'version' | 'savedAt'>): SaveFile {
  return { ...structuredClone(file), version: 2, savedAt: new Date().toISOString() };
}

/**
 * 저장 파일을 이 세계·경제 데이터로 불러올 수 있는지.
 *  - 모드·세계 id가 다르면 불러오지 않는다.
 *  - 자료 버전이 다르면, 저장에 나오는 항구·도시 id가 이 세계에 모두 그대로 있을 때만 불러오고 그 사실을 알린다.
 *    없는 항구를 이름이 비슷한 다른 항구에 이어 붙이지 않는다.
 */
export function checkSaveCompat(
  file: SaveFile,
  world: World,
  data: EconomyData,
): { ok: true; warning?: string } | { ok: false; reason: string } {
  if (file.world.mode !== world.mode || file.world.worldId !== world.worldId) {
    return { ok: false, reason: `이 저장은 ${file.world.mode === 'earth' ? '현실 지구' : '가상 세계'} 모드의 것이에요.` };
  }
  const ids = new Set(world.cities.map((c) => c.id));
  const used = new Set<string>(Object.keys(file.state.cities ?? {}));
  for (const s of file.state.ships ?? []) {
    used.add(s.from);
    used.add(s.to);
  }
  for (const r of file.state.player?.routes ?? []) for (const st of r.stops) used.add(st.cityId);
  const missing = [...used].filter((id) => !ids.has(id));
  const sameData = file.world.dataVersion === world.dataVersion && file.world.profileVersion === data.profile.version;
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `저장할 때의 자료(${file.world.dataVersion})에 있던 항구가 지금 자료(${world.dataVersion})에 없어요: ${missing.slice(0, 5).join(', ')}`,
    };
  }
  const extra = [...ids].filter((id) => !(id in (file.state.cities ?? {})));
  if (extra.length > 0 && !sameData) {
    return { ok: false, reason: `지금 자료(${world.dataVersion})에는 저장에 없던 항구가 있어 시장을 이어 붙일 수 없어요: ${extra.slice(0, 5).join(', ')}` };
  }
  if (!sameData) {
    return { ok: true, warning: `저장할 때와 자료 버전이 달라요(${file.world.dataVersion} → ${world.dataVersion}). 항구는 모두 같아 이어서 할 수 있어요.` };
  }
  return { ok: true };
}

/**
 * 지금 게임 상태를 파일(JSON)로 내려받는다. 브라우저 저장소는 그 브라우저에서만 보이므로,
 * 저장을 다른 사람에게 보여 주거나 따로 보관할 때 쓴다.
 * 저장 칸(slot)에 예전에 저장해 둔 것이 아니라, 누른 순간의 상태를 내보낸다.
 */
export function exportSave(file: Omit<SaveFile, 'version' | 'savedAt'>): boolean {
  try {
    const raw = JSON.stringify(makeSaveFile(file));
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade-sim-${file.world.mode}-save-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return true;
  } catch {
    return false;
  }
}

/** 한 모드의 슬롯마다 제목·저장 시각만(목록용) */
export function listSaves(mode: WorldMode): { id: SlotId; name: string; label?: string; savedAt?: string }[] {
  return SLOTS.map((s) => {
    const f = loadGame(mode, s.id);
    return { ...s, label: f?.label, savedAt: f?.savedAt };
  });
}
