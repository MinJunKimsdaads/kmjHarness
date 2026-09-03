# 기존 CI를 공용 워크플로로 옮기기

`kmjh`는 **검증만 하는** `ci.yml`만 자동으로 교체합니다.
배포·릴리스처럼 레포 고유 스텝이 섞여 있으면 건드리지 않습니다 — 덮어쓰는 순간 배포가 죽기 때문입니다.

그런 레포는 **job 두 개로 쪼개면** 됩니다. 검증은 공용 워크플로에 맡기고, 배포는 그 결과를 받아서 돕니다.

## 구조

```
verify (공용 워크플로)  →  dist 아티팩트  →  deploy (이 레포 고유)
```

공용 워크플로에 `upload-dist: true`를 주면 빌드 결과를 아티팩트로 올려줍니다.
배포 job은 그걸 내려받아 쓰므로 **빌드를 두 번 하지 않습니다.**

## 예시 — age-of-sail

기존 `ci.yml`은 한 job 안에서 검증 후 `peaceiris/actions-gh-pages`로 `dist/`를
`age-of-sail-release` 레포에 밀고 있었습니다. 이렇게 나눕니다.

```yaml
name: CI

on:
  push: { branches: [main] }
  pull_request: { branches: [main] }
  workflow_dispatch:

concurrency:
  group: deploy-release
  cancel-in-progress: false

jobs:
  # 검증은 하네스 한 곳에서 관리된다
  verify:
    uses: MinJunKimsdaads/kmjHarness/.github/workflows/verify.yml@main
    with:
      package-manager: pnpm
      node-version: '22'
      upload-dist: true          # dist/ 를 아티팩트로 올린다
    secrets: inherit

  # 배포는 이 레포만의 일 — 하네스가 건드리지 않는다
  deploy:
    needs: verify
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - name: 빌드 결과 내려받기
        uses: actions/download-artifact@v4
        with:
          name: dist
          path: dist

      - name: 릴리스 레포로 배포
        uses: peaceiris/actions-gh-pages@v4
        with:
          personal_token: ${{ secrets.RELEASE_REPO_TOKEN }}
          external_repository: MinJunKimsdaads/age-of-sail-release
          publish_branch: main
          publish_dir: ./dist
          user_name: 'github-actions[bot]'
          user_email: 'github-actions[bot]@users.noreply.github.com'
          commit_message: "Deploy ${{ github.sha }}"
```

## 확인할 것

- `secrets: inherit` 이 있어야 호출된 워크플로가 시크릿을 볼 수 있습니다.
- `needs: verify` 가 있어야 검증 실패 시 배포가 멈춥니다.
- 나눈 뒤 한 번은 실제로 push해서 배포가 되는지 눈으로 확인하세요.

## 왜 자동화하지 않는가

배포 스텝은 레포마다 대상·시크릿·조건이 전부 다릅니다.
기계가 추측해서 옮기면 "린트를 통일하려다 배포를 죽이는" 사고가 납니다.
하네스는 **위험한 것을 자동으로 하지 않고, 대신 무엇을 해야 하는지 정확히 알려주는** 쪽을 택했습니다.
