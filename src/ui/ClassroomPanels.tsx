import { useMemo, useState } from 'react';
import { fixJosa } from '../sim/core/korean';
import { buildReport, reportToText } from '../sim/classroom/report';
import { goalProgress, isOnceGoal, scenarioById, scenarioLevel, scenariosFor } from '../sim/classroom/scenarios';
import { DEFAULT_SETTINGS, type GameSettings } from '../sim/classroom/settings';
import { MODES, modeOf } from '../sim/modes';
import { WORLD_MODES, type World, type WorldMode } from '../sim/world/types';
import { listSaves, loadGame, readSaveFile, type SaveFile, type SlotId } from './save';
import { formatDate, type Simulation } from './useSimulation';
import { CompanySetup } from './CompanySetup';
import { Icon } from './icons';

const won = (v: number) => Math.round(v).toLocaleString('ko-KR');

// ------------------------------------------------------------------ 새 수업(4단계: 세계 · 수업 · 설정 · 회사)

const WIZARD_STEPS = ['세계', '수업', '설정', '회사'] as const;

/** 새 게임 화면 위쪽의 단계 표시(지금 단계와 지난 단계) */
export function WizardSteps({ at }: { at: number }) {
  return (
    <ol className="wizard-steps" aria-label="새 게임 단계">
      {WIZARD_STEPS.map((label, i) => (
        <li key={label} className={i === at ? 'now' : i < at ? 'done' : ''} aria-current={i === at ? 'step' : undefined}>
          <span>{i < at ? '✓' : i + 1}</span> {label}
        </li>
      ))}
    </ol>
  );
}

/** 세계 카드에 쓰는 짧은 소개(자세한 소개는 모드 정의의 blurb) */
const MODE_SHORT: Record<WorldMode, string> = {
  virtual: '두 대륙, 여섯 나라. 처음 배우기 좋아요.',
  earth: '진짜 지구의 나라와 항구에서 무역해요.',
};

const LEVELS: { level: 1 | 2 | 3; name: string; hint: string }[] = [
  { level: 1, name: '1단계', hint: '처음 해 봐요' },
  { level: 2, name: '2단계', hint: '익숙해지면' },
  { level: 3, name: '3단계', hint: '도전해 봐요' },
];

export function NewLessonDialog(props: {
  current: GameSettings;
  prepareWorld: (mode: WorldMode, seed: string) => Promise<World>;
  onStart: (s: GameSettings) => void;
  onLoad: (f: SaveFile) => void;
  onClose?: () => void;
  /** 불러오기·준비 중에 생긴 알림 */
  note?: string | null;
}) {
  const [s, setS] = useState<GameSettings>(() => ({ ...props.current, companyName: '', companyLogo: undefined, tutorial: props.current.tutorial ?? true }));
  const [step, setStep] = useState(0);
  const [setupWorld, setSetupWorld] = useState<Promise<World> | null>(null);
  const [showSaves, setShowSaves] = useState(false);
  const mode: WorldMode = s.mode ?? 'virtual';
  const modeDef = modeOf(mode);
  const all = scenariosFor(mode);
  /** 튜토리얼은 난이도 탭 밖에 따로 보여 준다 */
  const tutorialDef = all.find((sc) => sc.tutorial);
  const scenarios = all.filter((sc) => !sc.tutorial);
  const def = scenarioById(s.scenarioId);
  const [level, setLevel] = useState<1 | 2 | 3>(() => (def ? scenarioLevel(def) : 1));
  const saves = useMemo(() => listSaves(mode), [mode]);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const pick = (id: string) => {
    const d = scenarioById(id);
    setS((prev) => ({ ...prev, ...(d?.settings ?? {}), startCityId: d?.settings.startCityId, scenarioId: id }));
  };
  const pickMode = (m: WorldMode) => {
    if (m === mode) return;
    const first = scenariosFor(m).find((sc) => !sc.tutorial);
    setS((prev) => ({
      ...prev,
      ...(first?.settings ?? {}),
      mode: m,
      scenarioId: first?.id ?? 'free',
      seed: MODES[m].defaultSeed,
      startCityId: first?.settings.startCityId,
    }));
    if (first) setLevel(scenarioLevel(first));
  };
  const pickLevel = (l: 1 | 2 | 3) => {
    setLevel(l);
    // 탭을 바꾸면 그 단계의 첫 수업을 골라 둔다(고른 수업이 안 보이는 채로 넘어가지 않게)
    if (!def || def.tutorial || scenarioLevel(def) !== l) {
      const first = scenarios.find((sc) => scenarioLevel(sc) === l);
      if (first) pick(first.id);
    }
  };
  const importFile = (file: File) => {
    file
      .text()
      .then((text) => {
        const f = readSaveFile(JSON.parse(text));
        if (!f) setFileNote('저장 파일 모양이 아니에요.');
        else {
          setFileNote(null);
          props.onLoad(f);
        }
      })
      .catch(() => setFileNote('파일을 읽지 못했어요.'));
  };
  const toggle = (k: 'autoPolicies' | 'autoCulture' | 'longTermGrowth' | 'showHints', label: string, hint: string) => (
    <label className="check">
      <input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
      <span>
        {label} <span className="muted small">— {hint}</span>
      </span>
    </label>
  );
  const toCompany = () => {
    const seed = s.seed.trim() || modeDef.defaultSeed;
    // 튜토리얼은 힌트를 짚어 주므로 힌트도 켠다
    const next = { ...s, seed, showHints: s.showHints || !!s.tutorial };
    setS(next);
    setSetupWorld(props.prepareWorld(mode, seed));
  };
  if (setupWorld) {
    return (
      <CompanySetup settings={s} onChange={setS} worldReady={setupWorld} onStart={props.onStart}
        onBack={() => setSetupWorld(null)} steps={<WizardSteps at={3} />} />
    );
  }
  const shown = scenarios.filter((sc) => scenarioLevel(sc) === level);

  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="새 게임">
      <div className="modal wizard">
        <header className="modal-head">
          <h2>새 게임</h2>
          <div className="row">
            <button className={showSaves ? 'btn small on' : 'btn small'} aria-expanded={showSaves} onClick={() => setShowSaves((v) => !v)}>
              이어 하기
            </button>
            {props.onClose && (
              <button className="btn small" onClick={props.onClose}>
                닫기
              </button>
            )}
          </div>
        </header>
        <WizardSteps at={step} />
        {(props.note || fileNote) && <p className="notice-inline">{props.note ?? fileNote}</p>}

        {showSaves && (
          <div className="saves-box">
            <b className="small">{modeDef.name} 저장에서 이어 하기</b>
            <div className="row">
              {saves
                .filter((x) => x.savedAt)
                .map((x) => (
                  <button
                    key={x.id}
                    className="btn small"
                    onClick={() => {
                      const f = loadGame(mode, x.id as SlotId);
                      if (f) props.onLoad(f);
                    }}
                  >
                    {x.name}: {x.label} ({new Date(x.savedAt!).toLocaleString('ko-KR')})
                  </button>
                ))}
              {!saves.some((x) => x.savedAt) && <span className="muted small">이 세계의 저장이 아직 없어요.</span>}
              <label className="btn small">
                저장 파일 불러오기
                <input
                  type="file"
                  accept="application/json,.json"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) importFile(f);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
          </div>
        )}

        {step === 0 && (
          <>
            <h3 className="wizard-q">어느 세계에서 무역할까요?</h3>
            <div className="world-cards">
              {WORLD_MODES.map((m) => (
                <button key={m} className={m === mode ? 'world-card on' : 'world-card'} aria-pressed={m === mode} onClick={() => pickMode(m)} title={MODES[m].blurb}>
                  <img src={`${import.meta.env.BASE_URL}thumbs/${m}.png`} alt="" onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }} />
                  <b>{MODES[m].name}</b>
                  <span>{MODE_SHORT[m]}</span>
                </button>
              ))}
            </div>
          </>
        )}

        {step === 1 && (
          <>
            <h3 className="wizard-q">어떤 수업을 할까요?</h3>
            {tutorialDef && (
              <button className={def?.tutorial ? 'tutorial-pick on' : 'tutorial-pick'} aria-pressed={!!def?.tutorial} onClick={() => pick(tutorialDef.id)}>
                <Icon name="school" size={30} />
                <span>
                  <b>처음이라면 · 튜토리얼</b>
                  <span className="small">추천 무역 → 물품·도시 고르기 → 특산품 → 발주와 납품 → 창고 → 신뢰도 → 배 사기 → 정기 항로를 차례로 따라 해요.</span>
                </span>
              </button>
            )}
            <div className="level-tabs" role="tablist" aria-label="난이도">
              {LEVELS.map((l) => {
                const n = scenarios.filter((sc) => scenarioLevel(sc) === l.level).length;
                const on = !def?.tutorial && l.level === level;
                return (
                  <button key={l.level} role="tab" aria-selected={on} className={on ? 'on' : ''} disabled={n === 0} onClick={() => pickLevel(l.level)}>
                    <b>{l.name}</b>
                    <span>{l.hint}</span>
                  </button>
                );
              })}
            </div>
            <div className="scenario-list">
              {shown.map((sc) => (
                <button key={sc.id} className={sc.id === s.scenarioId ? 'scenario on' : 'scenario'} onClick={() => pick(sc.id)}>
                  <b>{sc.title}</b>
                  <span className="muted small">
                    약 {sc.minutes}분 · 목표 {sc.goals.length}개
                  </span>
                </button>
              ))}
            </div>
            {def && (def.tutorial || scenarioLevel(def) === level) && (
              <div className="scenario-detail">
                <b className="small">이번 수업의 목표</b>
                <ul className="wizard-goals">
                  {def.goals.map((g) => (
                    <li key={g.id}>○ {g.text}</li>
                  ))}
                </ul>
                <details className="small">
                  <summary>선생님용 설명</summary>
                  <p>{def.summary}</p>
                  <ul className="news">
                    {def.learning.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                  {def.triggers.filter((t) => t.action.kind !== 'news').length > 0 && (
                    <p className="muted">
                      미리 정한 사건:{' '}
                      {def.triggers
                        .filter((t) => t.action.kind !== 'news')
                        .map((t) => `${Math.floor(t.atMonth / 12) + 1}년째 ${t.headline}`)
                        .join(' / ')}
                    </p>
                  )}
                  <p className="muted">게임 속 {Math.round(def.months / 12)}년 동안 진행해요.</p>
                </details>
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <h3 className="wizard-q">어떻게 시작할까요?</h3>
            {def?.tutorial ? (
              <p className="notice-inline">
                <Icon name="school" size={18} /> 튜토리얼 수업이라 안내가 처음부터 끝까지 켜져 있어요. 언제든 안내 카드의 ×로 닫을 수 있어요.
              </p>
            ) : (
            <div className="tutorial-cards">
              <button className={s.tutorial ? 'tut-card on' : 'tut-card'} aria-pressed={!!s.tutorial} onClick={() => setS({ ...s, tutorial: true })}>
                <Icon name="school" size={30} />
                <b>튜토리얼 켜기</b>
                <span>할 일을 한 단계씩 알려 주고, 누를 곳을 반짝여 줘요.</span>
              </button>
              <button className={!s.tutorial ? 'tut-card on' : 'tut-card'} aria-pressed={!s.tutorial} onClick={() => setS({ ...s, tutorial: false })}>
                <Icon name="compass" size={30} />
                <b>튜토리얼 끄기</b>
                <span>안내 없이 내 마음대로 해 봐요.</span>
              </button>
            </div>
            )}
            <details className="teacher-settings">
              <summary>선생님 설정</summary>
              <div className="settings">
                <label className="small">
                  {mode === 'virtual' ? '세계 시드' : '경제 시드'}{' '}
                  <input value={s.seed} onChange={(e) => setS({ ...s, seed: e.target.value })} spellCheck={false} />
                  <span className="muted"> {modeDef.seedMeaning}</span>
                </label>
                <label className="small">
                  시작 자금{' '}
                  <input className="qty wide" value={s.startingCash} onChange={(e) => setS({ ...s, startingCash: Math.max(0, Number(e.target.value) || 0) })} />
                </label>
                <label className="small">
                  처음 속도{' '}
                  <select value={s.speed} onChange={(e) => setS({ ...s, speed: Number(e.target.value) })}>
                    <option value={1}>보통(5초 = 1달)</option>
                    <option value={2}>빠름</option>
                    <option value={5}>아주 빠름</option>
                  </select>
                </label>
                {toggle('showHints', '거래 힌트 보여 주기', '어디로 가면 남을지 이유와 함께 알려 줘요(튜토리얼을 켜면 함께 켜져요)')}
                {toggle('longTermGrowth', '장기 변화', '인구·소득·공장·기술·항만이 해마다 바뀌어요')}
                {toggle('autoPolicies', '나라들이 스스로 정책 정하기', '관세·협정·무역 갈등이 저절로 생겨요')}
                {toggle('autoCulture', '문화 유행 저절로 생기기', '드라마·노래 유행이 상표 선호를 바꿔요')}
              </div>
            </details>
          </>
        )}

        <footer className="wizard-nav">
          {step > 0 ? (
            <button className="btn" onClick={() => setStep(step - 1)}>
              이전
            </button>
          ) : (
            <span />
          )}
          {step < 2 ? (
            <button className="btn primary" onClick={() => setStep(step + 1)}>
              다음
            </button>
          ) : (
            <button className="btn primary" onClick={toCompany}>
              다음 · 회사 만들기
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export const DEFAULT_START: GameSettings = { ...DEFAULT_SETTINGS, ...(scenarioById(DEFAULT_SETTINGS.scenarioId)?.settings ?? {}) };

// ------------------------------------------------------------------ 수업 목표 카드

export function LessonCard({ sim }: { sim: Simulation }) {
  const { ctx, state } = sim;
  const sc = state.scenario;
  const def = sc ? scenarioById(sc.id) : undefined;
  if (!sc || !def) return null;
  const elapsed = state.month - sc.startMonth;
  const latest = sim.lessonNews.find((e) => e.type === 'scenario' && e.kind === 'trigger');
  return (
    <div className="lesson-card">
      <div className="row">
        <b>{def.title}</b>
        <span className="muted small" style={{ marginLeft: 'auto' }}>
          {Math.min(elapsed, def.months)}/{def.months}달
        </span>
      </div>
      {latest && latest.type === 'scenario' && (
        <p className="small lesson-news">
          {latest.text}
          {latest.question && <span className="why">생각해 보기: {latest.question}</span>}
        </p>
      )}
      <ul className="goals">
        {def.goals.map((g) => {
          const pr = goalProgress(ctx, state, g);
          // 달이 바뀌기 전이라도 지금 이뤘으면 바로 보여 준다
          const done = sc.goalsDone[g.id] !== undefined || pr.ratio >= 1;
          return (
            <li key={g.id} className={done ? 'done' : ''}>
              <span>{done ? '✔' : '○'}</span> {g.text}
              {!done && !isOnceGoal(g.check) && (
                <span className="fill goal-fill">
                  <i style={{ width: `${Math.round(pr.ratio * 100)}%` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {sc.ended && <p className="small good">수업 시간이 끝났어요. 「결과·회사」 탭에서 수업 리포트를 열어 보세요.</p>}
    </div>
  );
}

// ------------------------------------------------------------------ 첫 거래 따라하기

export function FirstTradeGuide({ sim }: { sim: Simulation }) {
  const p = sim.state.player;
  if (p.tradeCount > 0) return null;
  const steps = [
    { text: '화면 아래 내 배 카드를 눌러 항구 열기', done: p.lifetime.purchases > 0 },
    { text: '힌트를 누르거나 지도에서 갈 항구 고르기', done: p.lifetime.purchases > 0 },
    { text: '창고에서 상품을 눌러 배에 싣기', done: p.lifetime.purchases > 0 },
    { text: '「출발!」 누르기(시간이 흘러가요)', done: p.lifetime.fuel > 0 },
    { text: '도착하면 짐칸의 상품을 눌러 팔기', done: false },
  ];
  const next = steps.findIndex((x) => !x.done);
  return (
    <div className="guide">
      <b>처음 해 보기</b>
      <ol>
        {steps.map((x, i) => (
          <li key={i} className={x.done ? 'done' : i === next ? 'now' : ''}>
            {x.done ? '✔ ' : ''}
            {x.text}
          </li>
        ))}
      </ol>
    </div>
  );
}

// ------------------------------------------------------------------ 수업 리포트

export function ReportDialog({ sim, world, onClose }: { sim: Simulation; world: World; onClose: () => void }) {
  const report = useMemo(() => buildReport(sim.ctx, sim.state), [sim.ctx, sim.state]);
  const [copied, setCopied] = useState(false);
  const r = report;
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="수업 리포트">
      <div className="modal report">
        <header className="modal-head">
          <div>
            <h2>{r.title}</h2>
            <p className="muted small">
              {r.period.from} ~ {r.period.to} ({r.period.months}개월) · 세계 시드 {world.seed}
            </p>
          </div>
          <div className="row no-print">
            <button className="btn small" onClick={() => window.print()}>
              인쇄
            </button>
            <button
              className="btn small"
              onClick={() => {
                navigator.clipboard?.writeText(reportToText(r)).then(
                  () => setCopied(true),
                  () => setCopied(false),
                );
              }}
            >
              {copied ? '복사했어요' : '글로 복사'}
            </button>
            <button className="btn small" onClick={onClose}>
              닫기
            </button>
          </div>
        </header>

        {r.scenario && (
          <section>
            <h3>시나리오: {r.scenario.title}</h3>
            <ul className="goals">
              {r.scenario.goals.map((g) => (
                <li key={g.text} className={g.done ? 'done' : ''}>
                  <span>{g.done ? '✔' : '○'}</span> {g.text} <span className="muted small">({g.done ? g.when : g.progress})</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>회사</h3>
          <p>
            현금 <b>{won(r.company.cash)}</b> · 배 {r.company.ships}척 · 거래 {r.company.trades}번 · 순이익 <b>{won(r.company.profit)}</b> · 낸 관세 {won(r.company.tariffs)}
          </p>
          {r.routes.length > 0 && (
            <ul className="news">
              {r.routes.map((x) => (
                <li key={x.text}>
                  {x.text} — {x.count}번, {won(x.quantity)}개, 남은 돈 {won(x.profit)}(연료·유지비 빼기 전)
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h3>무역은 왜 생겼을까?</h3>
          {r.reasons.length === 0 ? (
            <p className="muted">아직 거래가 없어요.</p>
          ) : (
            <div className="reason-bars">
              {r.reasons.map((x) => {
                const max = Math.max(...r.reasons.map((y) => y.count));
                return (
                  <div key={x.category} className="reason">
                    <div className="row">
                      <b>{x.name}</b>
                      <span className="muted small">{x.count}번</span>
                    </div>
                    <span className="fill">
                      <i style={{ width: `${(x.count / max) * 100}%` }} />
                    </span>
                    {x.examples.map((e) => (
                      <span key={e} className="why">
                        {e}
                      </span>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section>
          <h3>나라들은 서로 기대고 있어요</h3>
          <ul className="news">
            {[...r.interdependence, ...r.mutual].map((x) => (
              <li key={x}>{x}</li>
            ))}
            {r.interdependence.length + r.mutual.length === 0 && <li>한 해가 지나면 나라들의 수입 기록이 쌓여요.</li>}
          </ul>
        </section>

        <section>
          <h3>내가 한 일</h3>
          <ul className="news">
            {r.myRole.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </section>

        {r.worldChanges.length > 0 && (
          <section>
            <h3>그동안 세계는</h3>
            <ul className="news">
              {r.worldChanges.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ul>
          </section>
        )}

        <section>
          <h3>생각해 볼 질문</h3>
          <ol className="questions">
            {r.questions.map((q) => (
              <li key={q}>{fixJosa(q)}</li>
            ))}
          </ol>
        </section>
        <p className="muted small">{formatDate(sim.ctx.data.startYear, sim.state.month)} 기준</p>
      </div>
    </div>
  );
}
