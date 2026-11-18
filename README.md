# 현대 국제무역 시뮬레이터

가상 행성에서 무역회사를 운영하는 경영 시뮬레이션. 현재 단계: **M5 — 수업용 기능**. 교사가 시나리오(20~40분)와 설정을 고르면, 학생은 작은 배 한 척으로 무역을 시작하고, 끝나면 무역이 생긴 이유와 나라 사이 상호 의존을 담은 수업 리포트를 받는다.

- 기준 요구서: [docs/SPEC_v0.1.md](docs/SPEC_v0.1.md)
- 아키텍처와 M0~M5 계획: [docs/PLAN.md](docs/PLAN.md)

## 실행

```bash
npm install
npm run dev        # 세계 데이터가 없으면 먼저 생성한 뒤 뷰어를 띄운다
```

| 명령 | 하는 일 |
| --- | --- |
| `npm run gen:world` | 시드에서 세계를 오프라인 생성 → `public/world/world.json`, `world.bin` |
| `npm run gen:world -- --seed 아무말 --verbose` | 다른 시드, 도시별 배후지 통계 출력 |
| `npm run preview:png -- --layer terrain,climate` | 브라우저 없이 `preview/*.png`로 확인 |
| `npm run gen:earth` | 현실 지구 세계를 고정 자료(`data/earth/sources`)로 조립 → `public/world/earth/earth.*` (외부 접속 없음) |
| `npm run fetch:earth` | 현실 지구 원자료 갱신(Natural Earth·ETOPO1·쾨펜·World Bank·NASA POWER, 개발 단계 전용) |
| `npm run sim -- --mode earth --years 10 --cities` | 현실 지구 경제를 화면 없이 돌린다 |
| `npx tsx scripts/perf-earth.ts` · `scripts/earth-longrun.ts` | 현실 지구 월 갱신 시간 · 30년 결정성 |
| `npm run sim -- --years 10` | 화면 없이 경제를 돌려 상품별 생산·소비·교역·가격 요약 출력 |
| `npm run play -- --years 10 --ships small,medium` | 자동 플레이어로 회사 성장 속도 측정 |
| `npm run decades -- --years 30 [--events]` | 30년 장기 변화(나라별 성장, 수출입 구조 변화, 공장 신설·쇠퇴, 정책·유행과 1년 뒤 효과) 요약 |
| `npm run lesson -- --scenario first-trade` | 수업 시나리오를 자동 플레이어로 돌리고 리포트 미리보기 |
| `npm test` | 단위·통합 테스트 |
| `npm run build` | 타입 검사 + 배포용 빌드 |

현실 지구 모드의 자료·변환·검증 기록은 [docs/EARTH_MODE.md](docs/EARTH_MODE.md)와 [docs/EARTH_TABLES.md](docs/EARTH_TABLES.md)에 있다.

## 구조

```
src/sim/core     난수, 노이즈, 구면 기하, 격자, 경로 탐색 (순수 TS)
src/sim/world    세계 생성 파이프라인, 타입, 직렬화, 런타임 항로 탐색
src/sim/economy  상품·레시피 데이터, 시장 규칙, 월별 틱, NPC·플레이어 회사, 성장, 정책
src/sim/classroom 교사 설정, 시나리오, 거래 이유, 수업 리포트
src/render       World -> 등장방형 그림 -> 3D 지구본 / 2D 지도
src/ui           React 패널
scripts          오프라인 생성, PNG 미리보기
tests            sim 테스트
```

세계 생성의 모든 수치(대륙 청사진, 해협, 국가·도시 앵커, 기후 계수, 작물·자원 규칙)는
[src/sim/world/config.ts](src/sim/world/config.ts) 한 곳에 있다. 값을 바꾸고 `npm run gen:world`를 다시 돌리면 된다.

경제의 모든 수치(상품·레시피·수요·도시 인구와 공장·시장 계수·NPC)는 [src/sim/economy/data.ts](src/sim/economy/data.ts)에 있다.
