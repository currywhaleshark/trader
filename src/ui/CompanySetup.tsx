import { useEffect, useRef, useState } from 'react';
import { renderBaseLayer } from '../render/baseLayer';
import { drawBase } from '../render/compose';
import { scenarioById } from '../sim/classroom/scenarios';
import type { GameSettings } from '../sim/classroom/settings';
import { COMMON_RULES } from '../sim/economy/data';
import { modeOf } from '../sim/modes';
import type { World } from '../sim/world/types';
import { COMPANY_LOGOS, CompanyLogo, companyLogo } from './CompanyLogo';

function PortMap({ world, ports, selected, fixed, onPick }: {
  world: World;
  ports: World['cities'];
  selected: string;
  fixed: boolean;
  onPick: (id: string) => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (canvas.current) drawBase(renderBaseLayer(world, { layer: 'terrain', scale: 1, month: 0, cropId: 'grain' }), canvas.current);
  }, [world]);
  return (
    <div className="base-map" role="group" aria-label="근거지 지도">
      <canvas ref={canvas} aria-hidden="true" />
      {ports.map((port) => (
        <button key={port.id} type="button" className="base-pin" aria-pressed={port.id === selected}
          style={{ left: `${(port.lon + 180) / 3.6}%`, top: `${(90 - port.lat) / 1.8}%` }}
          aria-label={port.name} title={port.name} disabled={fixed} onClick={() => onPick(port.id)}>
          <span className="pin-label">{port.name}</span>
        </button>
      ))}
    </div>
  );
}

export function CompanySetup({ settings, onChange, worldReady, onStart, onBack }: {
  settings: GameSettings;
  onChange: (settings: GameSettings) => void;
  worldReady: Promise<World>;
  onStart: (settings: GameSettings) => void;
  onBack: () => void;
}) {
  const mode = modeOf(settings.mode);
  const scenario = scenarioById(settings.scenarioId);
  const [world, setWorld] = useState<World | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    worldReady.then(
      (result) => { if (active) setWorld(result); },
      (e: Error) => { if (active) setError(e.message); },
    );
    return () => { active = false; };
  }, [worldReady]);

  const fixed = scenario?.settings.startCityId;
  const ports = world?.cities.filter((city) => {
    if (!city.isPort) return false;
    if (fixed) return city.id === fixed;
    return !mode.startPorts || mode.startPorts.some((p) => p.id === city.id);
  }) ?? [];
  const requestedPort = fixed ?? settings.startCityId ?? mode.profile.startCityId;
  const home = ports.find((p) => p.id === requestedPort) ?? ports.find((p) => p.id === mode.profile.startCityId) ?? ports[0];
  const logo = companyLogo(settings.companyLogo);
  const pickPort = (startCityId: string) => onChange({ ...settings, startCityId });
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="회사 설립">
      <div className="modal company-setup">
        <header className="modal-head">
          <div><h2>회사 설립</h2><p className="muted small">{scenario?.title ?? mode.name}</p></div>
          <button className="btn small" onClick={onBack}>이전</button>
        </header>
        <label className="company-field">회사 이름
          <input autoFocus value={settings.companyName ?? ''} maxLength={32} placeholder={COMMON_RULES.player.companyName}
            onChange={(e) => onChange({ ...settings, companyName: e.target.value })} />
        </label>
        <fieldset className="logo-picker">
          <legend>회사 로고</legend>
          <div>{COMPANY_LOGOS.map((item) => (
            <button key={item.id} type="button" aria-label={item.name} aria-pressed={item.id === logo.id}
              onClick={() => onChange({ ...settings, companyLogo: item.id })}>
              <CompanyLogo id={item.id} /><span>{item.name}</span>
            </button>
          ))}</div>
        </fieldset>
        <div className="base-heading"><h3>근거지</h3>
          {home && (fixed ? <b>{home.name} · 시나리오 지정항</b> :
            <select aria-label="근거지 항구" value={home.id} onChange={(e) => pickPort(e.target.value)}>
              {ports.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>)}
        </div>
        {world && home ? <>
          <PortMap world={world} ports={ports} fixed={!!fixed} selected={home.id} onPick={pickPort} />
          <p className="small muted">{home.name} · {['', '작은', '중간', '큰'][home.portSize]} 항구. 첫 배와 새로 사는 배는 이곳에서 출발해요.</p>
        </> : <p role="status">{error || (world ? '시작할 수 있는 항구가 없어요.' : '항구 지도를 준비하고 있어요…')}</p>}
        <button className="btn primary" disabled={!home} onClick={() => home && onStart({
          ...settings, companyName: settings.companyName?.trim() || COMMON_RULES.player.companyName, companyLogo: logo.id, startCityId: home.id,
        })}>이 회사로 시작</button>
      </div>
    </div>
  );
}
