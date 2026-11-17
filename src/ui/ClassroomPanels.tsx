import { useMemo, useState } from 'react';
import { fixJosa } from '../sim/core/korean';
import { buildReport, reportToText } from '../sim/classroom/report';
import { goalProgress, scenarioById, SCENARIOS } from '../sim/classroom/scenarios';
import { DEFAULT_SETTINGS, type GameSettings } from '../sim/classroom/settings';
import type { World } from '../sim/world/types';
import { listSaves, loadGame, type SaveFile, type SlotId } from './save';
import { formatDate, type Simulation } from './useSimulation';

const won = (v: number) => Math.round(v).toLocaleString('ko-KR');

// ------------------------------------------------------------------ 새 수업(교사 설정)

export function NewLessonDialog(props: {
  current: GameSettings;
  onStart: (s: GameSettings) => void;
  onLoad: (f: SaveFile) => void;
  onClose?: () => void;
}) {
  const [s, setS] = useState<GameSettings>(props.current);
  const def = scenarioById(s.scenarioId);
  const saves = useMemo(() => listSaves(), []);
  const pick = (id: string) => {
    const d = scenarioById(id);
    setS((prev) => ({ ...prev, ...(d?.settings ?? {}), scenarioId: id }));
  };
  const toggle = (k: 'autoPolicies' | 'autoCulture' | 'longTermGrowth' | 'showHints', label: string, hint: string) => (
    <label className="check">
      <input type="checkbox" checked={s[k]} onChange={(e) => setS({ ...s, [k]: e.target.checked })} />
      <span>
        {label} <span className="muted small">— {hint}</span>
      </span>
    </label>
  );
  return (
    <div className="modal-back" role="dialog" aria-modal="true" aria-label="새 수업">
      <div className="modal">
        <header className="modal-head">
          <h2>새 수업 시작하기</h2>
          {props.onClose && (
            <button className="btn small" onClick={props.onClose}>
              닫기
            </button>
          )}
        </header>
        <h3>1. 시나리오</h3>
        <div className="scenario-list">
          {SCENARIOS.map((sc) => (
            <button key={sc.id} className={sc.id === s.scenarioId ? 'scenario on' : 'scenario'} onClick={() => pick(sc.id)}>
              <b>{sc.title}</b>
              <span className="muted small">
                약 {sc.minutes}분 · 게임 속 {Math.round(sc.months / 12)}년 · 목표 {sc.goals.length}개
              </span>
            </button>
          ))}
        </div>
        {def && (
          <div className="scenario-detail">
            <p>{def.summary}</p>
            <ul className="news">
              {def.learning.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
            {def.triggers.filter((t) => t.action.kind !== 'news').length > 0 && (
              <p className="muted small">
                미리 정한 사건:{' '}
                {def.triggers
                  .filter((t) => t.action.kind !== 'news')
                  .map((t) => `${Math.floor(t.atMonth / 12) + 1}년째 ${t.headline}`)
                  .join(' / ')}
              </p>
            )}
          </div>
        )}
        <h3>2. 설정</h3>
        <div className="settings">
          <label className="small">
            세계 시드{' '}
            <input value={s.seed} onChange={(e) => setS({ ...s, seed: e.target.value })} spellCheck={false} />
            <span className="muted"> 같은 시드면 모둠마다 같은 세계에서 시작해요</span>
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
          {toggle('showHints', '거래 힌트 보여 주기', '어디로 가면 남을지 이유와 함께 알려 줘요')}
          {toggle('longTermGrowth', '장기 변화', '인구·소득·공장·기술·항만이 해마다 바뀌어요')}
          {toggle('autoPolicies', '나라들이 스스로 정책 정하기', '관세·협정·무역 갈등이 저절로 생겨요')}
          {toggle('autoCulture', '문화 유행 저절로 생기기', '드라마·노래 유행이 상표 선호를 바꿔요')}
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => props.onStart(s)}>
            이 설정으로 시작
          </button>
        </div>
        {saves.some((x) => x.savedAt) && (
          <>
            <h3>또는 이어 하기</h3>
            <div className="row">
              {saves
                .filter((x) => x.savedAt)
                .map((x) => (
                  <button
                    key={x.id}
                    className="btn small"
                    onClick={() => {
                      const f = loadGame(x.id as SlotId);
                      if (f) props.onLoad(f);
                    }}
                  >
                    {x.name}: {x.label} ({new Date(x.savedAt!).toLocaleString('ko-KR')})
                  </button>
                ))}
            </div>
          </>
        )}
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
              {!done && g.check.kind !== 'firstSale' && (
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
