#!/usr/bin/env node
// kmjh — kmjHarness CLI. UI와 동일한 core를 호출한다.
import { scanWorkspace } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { planLevel } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import { levelById, LEVELS } from '../core/levels.js';
import { workspaceRoot } from '../core/paths.js';
import { readWorkspace, writeWorkspace } from '../core/registry.js';
import { startServer } from '../server/index.js';

const [, , cmd = 'list', ...rest] = process.argv;
const flag = (n) => rest.includes(n);
const arg = () => rest.find((r) => !r.startsWith('-'));

const C = { r: '\x1b[31m', y: '\x1b[33m', g: '\x1b[32m', d: '\x1b[2m', b: '\x1b[1m', x: '\x1b[0m' };
const sevColor = { error: C.r, warn: C.y, info: C.d };

function cmdList() {
  const repos = scanWorkspace();
  console.log(`\n${C.b}워크스페이스${C.x} ${workspaceRoot}\n`);
  console.log('레포'.padEnd(22) + '프로파일'.padEnd(24) + '레벨'.padEnd(8) + '상태'.padEnd(16) + '브랜치');
  console.log('─'.repeat(88));
  for (const r of repos) {
    const lvl = r.level == null ? '—' : `L${r.level}`;
    const eol = r.eolArtifact ? ` ${C.d}(줄바꿈 차이만)${C.x}` : '';
    const dirty = r.dirtyCount ? ` ${C.y}±${r.dirtyCount}${C.x}` : '';
    console.log(
      r.name.padEnd(22) +
      (r.detectedProfile + (r.detectedAddons.length ? ` +${r.detectedAddons.join(',')}` : '')).padEnd(24) +
      lvl.padEnd(8) + r.handshake.label.padEnd(16) + (r.branch || '—') + dirty + eol
    );
  }
  console.log('');
}

function cmdDoctor() {
  const only = arg();
  const repos = scanWorkspace().filter((r) => !only || r.name === only);
  if (flag('--json')) {
    console.log(JSON.stringify(repos.map((r) => ({ ...diagnose(r), meta: r })), null, 2));
    return;
  }
  for (const r of repos) {
    const d = diagnose(r);
    const s = d.summary;
    console.log(`\n${C.b}${r.name}${C.x} ${C.d}(${r.detectedProfile}, ${r.level == null ? '미편입' : 'L' + r.level})${C.x}` +
      `  ${C.r}${s.error} error${C.x}  ${C.y}${s.warn} warn${C.x}  ${C.d}${s.info} info${C.x}`);
    if (!d.findings.length) { console.log(`  ${C.g}이상 없음${C.x}`); continue; }
    for (const f of d.findings) {
      console.log(`  ${sevColor[f.severity]}●${C.x} ${f.title}${f.fix ? C.d + '  → ' + f.fix + C.x : ''}`);
      if (f.detail) console.log(`    ${C.d}${f.detail}${C.x}`);
    }
  }
  console.log('');
}

function cmdPlan(apply) {
  const name = arg();
  if (!name) { console.error('레포 이름이 필요합니다. 예: kmjh promote age-of-sail --to 1'); process.exit(1); }
  const repo = scanWorkspace().find((r) => r.name === name);
  if (!repo) { console.error(`레포를 찾을 수 없습니다: ${name}`); process.exit(1); }
  const toIdx = rest.indexOf('--to');
  const target = toIdx >= 0 ? Number(rest[toIdx + 1]) : (repo.level ?? -1) + 1;
  const lv = levelById(target);
  const plan = planLevel(repo, target);

  console.log(`\n${C.b}${repo.name}${C.x} → ${C.b}${lv.name}${C.x}  ${C.d}${lv.summary}${C.x}\n`);
  for (const a of plan.actions) {
    const mark = { create: `${C.g}+ 생성${C.x}`, update: `${C.y}~ 수정${C.x}`, merge: `${C.y}~ 병합${C.x}`, skip: `${C.d}· 건너뜀${C.x}` }[a.kind];
    console.log(`  ${mark}  ${a.rel}${a.note ? C.d + '   ' + a.note + C.x : ''}`);
  }
  console.log(`\n  ${plan.changed}개 파일 변경 예정`);
  if (!apply) { console.log(`  ${C.d}실제 적용: kmjh promote ${name} --to ${target} --apply${C.x}\n`); return; }
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
  levels: () => { console.log(''); for (const l of LEVELS) console.log(`  ${C.b}${l.name}${C.x}  ${l.summary}`); console.log(''); },
  dashboard: () => startServer(),
  help: () => console.log(`
  kmjh list                          레포 목록과 편입 상태
  kmjh scan                          레지스트리 재생성 (클론 직후에 한 번)
  kmjh doctor [repo] [--json]        진단 (쓰기 없음)
  kmjh plan <repo> [--to N]          무엇이 바뀔지 미리보기
  kmjh promote <repo> [--to N] --apply   실제 적용
  kmjh levels                        편입 레벨 설명
  kmjh dashboard                     UI 대시보드 실행
`),
};

(commands[cmd] || commands.help)();
