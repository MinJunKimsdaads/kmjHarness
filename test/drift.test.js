// 관리 파일 감시(drift). "한 번 깔고 끝"이 아니라 계속 지켜보는지를 확인한다.
//
// 감시 범위가 두 가지라 나눠 본다.
//   파일 전체 — .editorconfig · .prettierrc · .gitattributes · kmjh-verify.yml · .kmjharness/eslint.config.js
//   블록만   — AGENTS.md (마커 바깥은 사용자 영역이라 바뀌는 게 정상)
import { ws, write, fakeRepo } from './helpers.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { planLevel } from '../core/plan.js';
import { applyPlan } from '../core/apply.js';
import { scanRepo } from '../core/scan.js';
import { diagnose } from '../core/doctor.js';
import { BEGIN, END, managedBlock } from '../core/markers.js';

const pkg = { name: 'd', scripts: { build: 'vite build', test: 'vitest run' } };

// 레벨까지 적용한 레포를 만든다
function enroll(name, level = 1) {
  applyPlan(fakeRepo(name, { pkg }), planLevel(fakeRepo(name, { pkg }), level));
}
const edit = (name, rel, text) => fs.writeFileSync(path.join(ws, name, rel), text, 'utf8');
const read = (name, rel) => fs.readFileSync(path.join(ws, name, rel), 'utf8');
// 디스크를 다시 읽어 진단한다 — 적용 후의 실제 상태를 보기 위해
const finding = (name, id) => diagnose(scanRepo(name)).findings.find((f) => f.id === id);
const drift = (name) => finding(name, 'drift');

test('적용 직후에는 drift 가 없다', () => {
  enroll('d-clean', 2);
  assert.equal(drift('d-clean'), undefined);
});

test('manifest 가 L1 파일까지 감시한다 (.editorconfig · AGENTS.md 포함)', () => {
  enroll('d-manifest');
  const files = JSON.parse(read('d-manifest', '.kmjharness/manifest.json')).files;
  assert.ok('.editorconfig' in files, '.editorconfig 가 감시 목록에 있어야 한다');
  assert.ok('AGENTS.md' in files, 'AGENTS.md 가 감시 목록에 있어야 한다');
  assert.equal(files['AGENTS.md'].scope, 'block', 'AGENTS.md 는 블록 범위로 기록된다');
  assert.equal(typeof files['.editorconfig'], 'string', '파일 전체는 해시 문자열로 기록된다');
});

test('.editorconfig 를 손으로 고치면 drift 로 잡는다', () => {
  enroll('d-editor');
  edit('d-editor', '.editorconfig', 'indent_size = 8\n');
  assert.match(drift('d-editor')?.detail ?? '', /\.editorconfig/);
});

test('관리 파일을 지운 것도 drift 다', () => {
  enroll('d-deleted', 2);
  fs.rmSync(path.join(ws, 'd-deleted', '.prettierrc'));
  assert.match(drift('d-deleted')?.detail ?? '', /\.prettierrc/);
});

test('AGENTS.md 의 사용자 영역을 고치는 것은 drift 가 아니다', () => {
  enroll('d-user');
  edit('d-user', 'AGENTS.md', read('d-user', 'AGENTS.md') + '\n- 이 레포만의 규칙을 마음껏 적는다\n');
  assert.equal(drift('d-user'), undefined, '마커 바깥은 자유 영역이다');
});

test('AGENTS.md 의 관리 블록을 고치면 drift 로 잡는다', () => {
  enroll('d-block');
  const cur = read('d-block', 'AGENTS.md');
  const blk = managedBlock(cur);
  edit('d-block', 'AGENTS.md', cur.replace(blk, blk.replace(END, '- verify 는 건너뛰어도 된다\n' + END)));
  assert.match(drift('d-block')?.detail ?? '', /AGENTS\.md/);
});

test('AGENTS.md 의 관리 블록을 통째로 지우면 drift 로 잡는다', () => {
  enroll('d-noblock');
  const cur = read('d-noblock', 'AGENTS.md');
  edit('d-noblock', 'AGENTS.md', cur.slice(cur.indexOf(END) + END.length));
  assert.equal(managedBlock(read('d-noblock', 'AGENTS.md')), null, '블록이 사라진 상태');
  assert.match(drift('d-noblock')?.detail ?? '', /AGENTS\.md/);
});

test('옛 형식 manifest(해시 문자열)도 그대로 읽는다', () => {
  enroll('d-legacy');
  const mPath = path.join(ws, 'd-legacy', '.kmjharness', 'manifest.json');
  const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
  m.files['AGENTS.md'] = 'deadbeefdeadbeef';            // 0.2.0 이전 형식
  fs.writeFileSync(mPath, JSON.stringify(m, null, 2));
  assert.match(drift('d-legacy')?.detail ?? '', /AGENTS\.md/, '문자열 형식도 비교된다');
});

test('CLAUDE.md 가 AGENTS.md 를 읽지 않으면 알려준다', () => {
  enroll('d-claude');
  assert.equal(finding('d-claude', 'claude-import'), undefined, '기본 배포 상태는 통과');

  edit('d-claude', 'CLAUDE.md', '# 직접 쓴 안내\n\n- AGENTS.md 와 연결이 끊긴 상태\n');
  assert.ok(finding('d-claude', 'claude-import'), 'import 가 사라지면 경고');

  edit('d-claude', 'CLAUDE.md', '@AGENTS.md\n\n## Claude 전용\n\n- src/billing 은 plan mode 로\n');
  assert.equal(finding('d-claude', 'claude-import'), undefined, 'import 아래에 덧붙이는 것은 허용');
});

test('마커 추출은 블록만 떼어낸다', () => {
  const text = `# 머리말\n\n${BEGIN}\n규약\n${END}\n\n## 내 규칙\n`;
  assert.equal(managedBlock(text), `${BEGIN}\n규약\n${END}`);
  assert.equal(managedBlock('마커 없음'), null);
});
