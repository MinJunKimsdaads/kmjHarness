#!/usr/bin/env node
// kmjh — kmjHarness CLI. UI와 동일한 core를 호출한다.
import { scanWorkspace, listRepoNames } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { planLevel } from '../core/plan.js';
import { applyPlan, applyBlocker } from '../core/apply.js';
import { levelById, LEVELS, checkLevel, TOP_LEVEL } from '../core/levels.js';
import { workspaceRoot } from '../core/paths.js';
import { readWorkspace, writeWorkspace, setExcluded, excludedNames } from '../core/registry.js';
import { staleDeps } from '../core/deps.js';
import { nowTask } from '../core/steps.js';
import { startServer } from '../server/index.js';

const [, , cmd = 'list', ...rest] = process.argv;
const flag = (n) => rest.includes(n);
const arg = () => rest.find((r) => !r.startsWith('-'));

// 파이프·파일로 내보낼 때(그리고 NO_COLOR 일 때)는 색 코드를 넣지 않는다
const color = process.stdout.isTTY && !process.env.NO_COLOR;
const C = color
  ? { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' }
  : { r: '', y: '', g: '', d: '', b: '', x: '' };
const fail = (msg) => { console.error(msg); process.exit(1); };
const sevColor = { error: C.r, warn: C.y, info: C.d };

// 한글은 터미널에서 두 칸을 차지한다. padEnd 는 글자 수로 세므로 직접 맞춘다.
const width = (t) => [...t].reduce((n, ch) => n + (/[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 2 : 1), 0);
const pad = (t, n) => t + ' '.repeat(Math.max(1, n - width(t)));

// 제외한 폴더 안내 한 줄 (목록 · 진단 공통)
function excludedNote(count) {
  if (count) console.log(`  ${C.d}제외한 폴더 ${count}개 — 다시 보려면 kmjh include <폴더>${C.x}`);
}

const TASK_TAG = { block: `${C.r}[막힘]${C.x}`, do: `${C.y}[먼저]${C.x}`, next: '[다음]', done: `${C.g}[완료]${C.x}` };

// 지금 할 일 — 대시보드와 같은 계산 (core/steps.js 의 nowTask)
function taskOf(r) {
  const deps = staleDeps(r);
  const pending = r.level == null || !levelById(r.level).implemented ? 0 : planLevel(r, r.level).changed;
  return nowTask(r, diagnose(r), deps, { pendingSync: pending });
}

function cmdList() {
  const all = scanWorkspace();
  const repos = all.filter((r) => !r.excluded);
  console.log(`\n${C.b}워크스페이스${C.x} ${workspaceRoot}\n`);
  console.log(pad('레포', 22) + pad('프로파일', 24) + pad('레벨', 8) + pad('상태', 18) + pad('브랜치', 22) + '지금 할 일');
  console.log('─'.repeat(118));
  for (const r of repos) {
    const lvl = r.level == null ? '—' : `L${r.level}`;
    const eol = r.eolArtifact ? ' (줄바꿈 차이만)' : '';
    const dirty = r.dirtyCount ? ` ±${r.dirtyCount}` : '';
    const branch = (r.branch || '—') + dirty + eol;
    const t = taskOf(r);
    console.log(
      pad(r.name, 22) +
      pad((r.profile ?? r.detectedProfile) + (r.detectedAddons.length ? ` +${r.detectedAddons.join(',')}` : ''), 24) +
      pad(lvl, 8) + pad(r.handshake.label, 18) + pad(branch, 22) + `${TASK_TAG[t.kind]} ${t.text}`
    );
  }
  console.log('');
  excludedNote(all.length - repos.length);
  if (all.length !== repos.length) console.log('');
}

function cmdDoctor() {
  const only = arg();
  // 이름을 직접 준 경우에는 제외한 폴더라도 보여준다
  const all = scanWorkspace();
  const repos = all.filter((r) => (only ? r.name === only : !r.excluded));
  if (only && !repos.length) fail(`레포를 찾을 수 없습니다: ${only}`);
  if (flag('--json')) {
    console.log(JSON.stringify(repos.map((r) => ({ ...diagnose(r), meta: r })), null, 2));
    return;
  }
  for (const r of repos) {
    const d = diagnose(r);
    const s = d.summary;
    console.log(`\n${C.b}${r.name}${C.x} ${C.d}(${r.profile ?? r.detectedProfile}, ${r.level == null ? '미편입' : 'L' + r.level})${C.x}` +
      `  ${C.r}${s.error} error${C.x}  ${C.y}${s.warn} warn${C.x}  ${C.d}${s.info} info${C.x}`);
    if (!d.findings.length) { console.log(`  ${C.g}이상 없음${C.x}`); continue; }
    for (const f of d.findings) {
      console.log(`  ${sevColor[f.severity]}●${C.x} ${f.title}${f.fix ? C.d + '  → ' + f.fix + C.x : ''}`);
      if (f.detail) console.log(`    ${C.d}${f.detail}${C.x}`);
    }
  }
  console.log('');
  if (!only) { excludedNote(all.filter((r) => r.excluded).length); if (all.some((r) => r.excluded)) console.log(''); }
}

// 이 머신에서 하네스를 적용하지 않을 폴더 (workspace.json 의 exclude — 커밋하지 않음)
function cmdExclude(excluded) {
  const name = arg();
  if (!name) { console.error(`폴더 이름이 필요합니다. 예: kmjh ${excluded ? 'exclude' : 'include'} Diablo2`); process.exit(1); }
  if (excluded && !listRepoNames().includes(name)) { console.error(`폴더를 찾을 수 없습니다: ${name}`); process.exit(1); }
  if (!excluded && !excludedNames().includes(name)) { console.log(`\n  ${name} 은(는) 제외 목록에 없습니다.\n`); return; }
  const list = setExcluded(name, excluded);
  console.log(`\n  ${excluded ? `${name} 을(를) 목록에서 뺐습니다` : `${name} 을(를) 다시 넣었습니다`}` +
    `  ${C.d}(제외 ${list.length}개 — 이 머신의 workspace.json 에만 기록)${C.x}\n`);
}

function cmdPlan(apply) {
  const name = arg();
  if (!name) fail('레포 이름이 필요합니다. 예: kmjh promote age-of-sail --to 1');
  const repo = scanWorkspace().find((r) => r.name === name);
  if (!repo) fail(`레포를 찾을 수 없습니다: ${name}`);
  const toIdx = rest.indexOf('--to');
  // --to 없이 불렀는데 이미 구현된 최고 레벨이면 할 일이 없다 → 안내만 하고 정상 종료(0)
  if (toIdx < 0 && repo.level != null && repo.level >= TOP_LEVEL) {
    console.log(`\n  ${repo.name} 은(는) 이미 구현된 최고 레벨(L${TOP_LEVEL})입니다.` +
      `\n  ${C.d}표준을 다시 적용하려면: kmjh promote ${repo.name} --to ${repo.level} --apply${C.x}\n`);
    return;
  }
  // --to 는 정수 0..구현된 최고 레벨만 받는다 (L4 처럼 준비 중인 레벨은 거부)
  const check = checkLevel(toIdx >= 0 ? rest[toIdx + 1] : (repo.level ?? -1) + 1);
  if (!check.ok) fail(check.error);
  const target = check.level;
  const lv = levelById(target);
  const plan = planLevel(repo, target);

  console.log(`\n${C.b}${repo.name}${C.x} → ${C.b}${lv.name}${C.x}  ${C.d}${lv.summary}${C.x}\n`);
  for (const a of plan.actions) {
    const mark = { create: `${C.g}+ 생성${C.x}`, update: `${C.y}~ 수정${C.x}`, merge: `${C.y}~ 병합${C.x}`,
      delete: `${C.r}- 삭제${C.x}`, skip: `${C.d}· 건너뜀${C.x}` }[a.kind];
    console.log(`  ${mark}  ${a.rel}${a.note ? C.d + '   ' + a.note + C.x : ''}`);
  }
  console.log(`\n  ${plan.changed}개 파일 변경 예정`);
  const blocked = applyBlocker(repo);
  if (blocked) console.log(`  ${C.r}적용할 수 없음${C.x} — ${blocked}`);
  if (!apply) { console.log(`  ${C.d}실제 적용: kmjh promote ${name} --to ${target} --apply${C.x}\n`); return; }
  if (blocked) process.exit(1);
  const res = applyPlan(repo, plan);
  console.log(`\n  ${C.g}적용 완료${C.x} — ${res.written.length}개 파일, workspace.json 등록됨\n`);
}

function cmdScan() {
  // workspace.json 은 머신마다 다르므로 커밋하지 않는다.
  // 각 레포의 kmjharness.json 을 읽어 레지스트리를 다시 만든다.
  const repos = scanWorkspace();
  const ws = readWorkspace();
  ws.repos = ws.repos || {};
  let added = 0, unmanaged = 0;
  for (const r of repos) {
    if (!r.config) { unmanaged++; continue; }
    if (!ws.repos[r.name]) added++;
    ws.repos[r.name] = {
      profile: r.config.profile ?? r.detectedProfile,
      addons: r.config.addons ?? r.detectedAddons,
      level: r.config.level ?? 0,
      lastSync: ws.repos[r.name]?.lastSync ?? null,
    };
  }
  for (const name of Object.keys(ws.repos)) {
    if (!repos.some((r) => r.name === name)) { delete ws.repos[name]; console.log(`  ${C.d}유령 레포 제거: ${name}${C.x}`); }
  }
  writeWorkspace(ws);
  console.log(`\n  레지스트리 갱신 — 관리 중 ${Object.keys(ws.repos).length}개 (새로 등록 ${added}개), 미편입 ${unmanaged}개\n`);
}

const commands = {
  list: cmdList,
  scan: cmdScan,
  doctor: cmdDoctor,
  plan: () => cmdPlan(false),
  promote: () => cmdPlan(flag('--apply')),
  adopt: () => { rest.push('--to', '0'); cmdPlan(flag('--apply')); },
  exclude: () => cmdExclude(true),
  include: () => cmdExclude(false),
  levels: () => { console.log(''); for (const l of LEVELS) console.log(`  ${C.b}${l.name}${C.x}  ${l.summary}`); console.log(''); },
  dashboard: () => startServer(),
  help: () => console.log(`
  kmjh list                          레포 목록 · 편입 상태 · 지금 할 일
  kmjh scan                          레지스트리 재생성 (클론 직후에 한 번)
  kmjh doctor [repo] [--json]        진단 (쓰기 없음)
  kmjh plan <repo> [--to N]          무엇이 바뀔지 미리보기 (--to 없으면 다음 레벨, 이미 L3면 안내만)
  kmjh promote <repo> [--to N] --apply   실제 적용
  kmjh exclude <repo>                이 머신에서 그 폴더를 목록에서 빼기
  kmjh include <repo>                뺀 폴더 다시 넣기
  kmjh levels                        편입 레벨 설명
  kmjh dashboard                     UI 대시보드 실행
`),
};

if (cmd === '--help' || cmd === '-h') commands.help();
else if (!Object.hasOwn(commands, cmd)) { console.error(`알 수 없는 명령입니다: ${cmd}`); commands.help(); process.exit(1); }
else commands[cmd]();
