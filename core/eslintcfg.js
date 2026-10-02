// 레포에 ESLint 설정이 있는가 / 하네스가 L3에서 넣어 줄 수 있는가.
// L2 는 verify 에 lint 를 넣을지, L3 는 L2가 lint 없이 만든 verify 를 고칠지를 이것으로 정한다.
// (설정이 없는데 "eslint ." 를 verify 에 넣으면 "couldn't find an eslint.config" 로 verify 가 막힌다)
import fs from 'node:fs';
import path from 'node:path';
import { profileFile } from './profiles.js';

export const ESLINT_CONFIGS = [
  'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs', 'eslint.config.ts', 'eslint.config.mts', 'eslint.config.cts',
  '.eslintrc', '.eslintrc.js', '.eslintrc.cjs', '.eslintrc.json', '.eslintrc.yml', '.eslintrc.yaml',
];

export function hasEslintConfig(repo) {
  if (repo.pkg?.eslintConfig) return true;
  return ESLINT_CONFIGS.some((f) => (repo.files ? repo.files.includes(f) : false) || fs.existsSync(path.join(repo.dir, f)));
}

// 이 레포의 프로파일에 하네스 공용 ESLint 설정이 있는가 (있으면 L3가 배포한다)
export const harnessShipsEslint = (repo) => Boolean(profileFile(repo.profile ?? repo.detectedProfile, 'eslint.config.js'));

// lint 스크립트가 ESLint 를 부르는가 (사용자가 다른 도구를 lint 로 쓰는 경우는 그대로 verify 에 넣는다)
export const lintUsesEslint = (cmd) => /(^|[\s/])eslint(\s|$)/.test(String(cmd || ''));
