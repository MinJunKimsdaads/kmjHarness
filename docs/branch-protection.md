# 정말로 막고 싶을 때 — branch protection

하네스가 깔아주는 것들은 **어긋났다는 걸 알려주지만, 올라가는 것을 막지는 못합니다.**

| 층 | 우회 | 하는 일 |
|---|---|---|
| git 훅 (`lefthook.yml`) | `--no-verify`, `LEFTHOOK=0`, 설치 안 하기 | 커밋·푸시 전에 **빨리 알려준다** (CI 3분 → 3초) |
| GitHub Actions (`kmjh-verify.yml`) | 불가 | push 하면 반드시 돈다. 다만 **빨간 X 가 뜰 뿐 코드는 이미 올라가 있다** |
| **branch protection** | 불가 | **서버가 push·머지 자체를 거부한다** |

훅은 실수를 줄이는 장치이지 의도를 막는 장치가 아닙니다. 급할 때 건너뛸 수 있어야 도구를 꺼버리지 않게 됩니다.
**정말로 막아야 한다면 세 번째 층이 필요하고, 그건 레포 설정이라 하네스가 대신 켜지 않습니다** —
잘못 걸면 자기 레포에 push 를 못 하게 되고, 파일을 쓰는 것과는 되돌리는 방법이 다릅니다.

## 켜는 법 (GitHub CLI)

`gh` 가 설치돼 있고 로그인돼 있어야 합니다.

```bash
# main 을 보호한다: PR 필수 + kmjh verify 통과해야 머지 가능
gh api -X PUT repos/{owner}/{repo}/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f "required_status_checks[strict]=true" \
  -f "required_status_checks[contexts][]=verify" \
  -F "enforce_admins=true" \
  -F "required_pull_request_reviews=null" \
  -F "restrictions=null"
```

- `contexts[]=verify` 는 **job 이름**입니다 (`kmjh-verify.yml` 의 `jobs.verify`).
  Actions 탭에서 실제로 표시되는 이름과 같아야 합니다.
- `enforce_admins=true` 를 빼면 소유자는 그냥 push 할 수 있습니다. 혼자 쓰는 레포라면 빼 두는 편이 편합니다.
- `required_pull_request_reviews=null` 은 "리뷰는 요구하지 않음"입니다. 1인 레포에서 리뷰를 요구하면 자기 PR 을 자기가 승인할 수 없어 막힙니다.

웹에서 하려면: **Settings → Branches → Add branch ruleset** 에서
`Require a pull request before merging` 과 `Require status checks to pass` → `verify` 를 고릅니다.

## 끄는 법

```bash
gh api -X DELETE repos/{owner}/{repo}/branches/main/protection
```

## 1인 레포에서 권하는 선

전부 켜면 **모든 변경이 PR 을 거쳐야 해서** 꽤 성가십니다. 단계적으로 가는 쪽을 권합니다.

1. 지금 상태 — 훅 + 모든 브랜치 CI. 어긋나면 바로 보인다
2. `required_status_checks` 만 켜기 — 직접 push 는 되지만, 빨간 상태로는 머지가 안 된다
3. `Require a pull request` 까지 — 팀이 생겼을 때

바꾸는 사람이 혼자인 동안에는 2단계까지가 현실적인 선입니다.
