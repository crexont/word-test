# 진도표 버튼 즉시 반영 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 진도표의 통과·재시험·↶·학생 추가·수정·삭제가 화면에 즉시 반영되고, 시트 저장은 뒤에서 한 줄로 처리된다.

**Architecture:** app.js 안에 저장 줄(queue) 하나를 둔다. 버튼은 화면 데이터(`prog.data.rows`)를 먼저 고치고 저장 작업을 줄에 넣는다. 작업은 실행 순간에 학생을 이름+교재로 다시 찾아 그때의 행 번호로 요청한다.

**Tech Stack:** 순수 브라우저 JS (ES5 스타일, 기존 app.js IIFE), Apps Script 웹 앱 (변경 없음).

**Spec:** `docs/superpowers/specs/2026-11-20-instant-progress-design.md`

## Global Constraints
- app.js만 고친다. `apps-script/Code.gs`는 바꾸지 않는다 (재배포 없음).
- 검증 중 실제 시트에 쓰지 않는다: POST는 브라우저에서 `fetch`를 가짜로 바꿔 시험한다. GET(읽기)은 허용.
- 날짜 형식은 서버와 같은 `M/d` (예: `11/20`), 재시험 표시는 `재M/d`.
- 학생 이름을 저장소·커밋·로그에 남기지 않는다.

## Review Focus
1. 저장 중에 ↻ 새로고침이나 시트 모드에서 돌아오기 → 시트의 옛 값으로 화면이 덮이면 안 된다 (저장 줄이 빌 때까지 다시 읽기 보류).
2. 학생 추가 직후 같은 학생 통과 → 버튼이 잠겨 있어야 한다 (`row.pending`).
3. 학생 A를 위로 추가한 뒤 아래 학생 B 통과 → B의 요청은 다시 읽은 뒤의 새 행 번호로 나가야 한다.
4. 요청 실패 → 남은 작업을 버리고, 시트를 다시 읽고, 빨간 상태 글씨에 실패한 작업 이름.
5. 저장 중 창 닫기 → `beforeunload` 경고.

---

### Task 1: 칸 계산 함수 (서버와 같은 규칙)

**Files:** Modify `app.js` (studentInfo 근처, selfTest)

**Interfaces — Produces:**
- `todayMD(): string` — `'11/20'`
- `cellAfterRecord(value: string, pass: boolean, clear: boolean, date: string): string` — `record_`과 같음: `재`로 시작하는 조각 제거 후 pass면 `date`, (pass도 clear도 아니면) `'재'+date` 추가, `', '`로 잇기
- `cellAfterUndo(value: string): string` — `set_` clear와 같음: 마지막 조각 제거

- [ ] **Step 1:** selfTest에 단언 추가
  - `cellAfterRecord('', true, false, '11/20') === '11/20'`
  - `cellAfterRecord('11/1, 재11/5', true, false, '11/20') === '11/1, 11/20'`
  - `cellAfterRecord('11/1', false, false, '11/20') === '11/1, 재11/20'`
  - `cellAfterRecord('재11/5', false, true, '11/20') === ''`
  - `cellAfterUndo('11/1, 11/9') === '11/1'`, `cellAfterUndo('11/1') === ''`
- [ ] **Step 2:** `http://localhost:8765/?selftest` → 콘솔에 실패(함수 없음).
- [ ] **Step 3:** 세 함수 구현.
- [ ] **Step 4:** 콘솔 `selftest: 모두 통과`.

### Task 2: 저장 줄 + 통과·재시험·↶

**Files:** Modify `app.js` (`markPass`, `recordRows`, `loadSheet`, 재시험 클릭 핸들러, init)

**Interfaces — Produces:**
- `queueSave(label: string, run: () => Promise, opts?: { reload: boolean })` — 줄에 넣고 상태 줄 `저장 중 N건`. 하나씩 실행, `reload`면 성공 뒤 `loadSheet(true)`를 기다림. 실패: 줄 비우고 `loadSheet(true)` 후 `setStatus('저장 실패: ' + label + ' — ' + err.message, 'err')`. 다 끝나면 `setStatus('저장됨', 'ok')`.
- `findRowNow(name: string, book: string): row|null` — 실행 시점의 `prog.data.rows`에서 찾기, 없으면 에러로 실패 처리.
- `loadSheet(fromQueue?: boolean)` — 줄에 작업이 있고 `fromQueue`가 아니면 아무것도 안 함 (상태 줄 유지).
- `prog.busy` 잠금은 없앤다. `window` `beforeunload`: 줄이 비어 있지 않으면 `e.preventDefault(); e.returnValue = ''`.

- [ ] **Step 1:** 통과: 다음 범위 칸을 `cellAfterRecord`로 즉시 바꾸고 `prog.selected`에서 빼고 `renderProgList(); renderBatchSoon()`. 저장 작업은 `api('POST', {action:'record', r: 지금 행, name, units, range, pass:true})`, 응답 `values`로 칸 덮어쓰기. 목록 다시 읽기 없음.
- [ ] **Step 2:** 재시험 / 재시험 지우기: 같은 방식 (`pass:false`, `clear`).
- [ ] **Step 3:** ↶: confirm 후 `st.last.range.units` 칸을 `cellAfterUndo`로 즉시 바꾸고, 작업은 칸마다 차례로 `action:'set', clear:true`.
- [ ] **Step 4:** 검증 (브라우저, 가짜 fetch): POST를 1.5초 뒤 성공하는 가짜로 바꾸고 통과 클릭 → 0.2초 안에 다음 범위가 바뀜, 상태 `저장 중 1건` → `저장됨`. 두 명 연달아 → POST가 겹치지 않고 차례로. 가짜가 실패하면 → 빨간 `저장 실패: …`, 화면이 시트 값으로 돌아옴.

### Task 3: 학생 추가·수정·삭제

**Files:** Modify `app.js` (`saveStudent`, `deleteStudent`, `renderProgList`)

- [ ] **Step 1:** 추가: 대화상자를 바로 닫고 `prog.data.rows`에 `{r: 0, pending: true, grade, book, name, note, cells: {}}`를 넣고 다시 그림. 작업 = `adminCall(addStudent)`, `{reload: true}`.
- [ ] **Step 2:** 수정: 행의 grade/book/name/note를 바로 바꾸고 `pending: true`. 작업은 실행 시점에 옛 이름+교재로 행 번호를 찾아 `updateStudent`, `{reload: true}`.
- [ ] **Step 3:** 삭제: confirm 후 행을 목록·선택에서 바로 빼기. 작업 `deleteStudent`(옛 r·이름은 실행 시점에 찾음), `{reload: true}`.
- [ ] **Step 4:** `renderProgList`: `row.pending`이면 체크·통과·재시험·↶·✎ 버튼 disabled, 이름 옆 `저장 중` 표시.
- [ ] **Step 5:** 검증 (가짜 fetch): 추가 → 목록에 즉시 보이고 버튼 잠김 → 가짜 성공 뒤 GET 다시 읽기 1번. 저장 중 ↻ → 화면 그대로.
- [ ] **Step 6:** 커밋 `진도표: 버튼 즉시 반영, 시트 저장은 뒤에서 차례로`.
