## 공통 규약 (kmjHarness base)

- 작업을 마치기 전에 반드시 `{{PM}} verify`를 통과시킬 것. lint · typecheck · test · build를 한 번에 돌린다.
- 커밋 메시지는 Conventional Commits (`feat:`, `fix:`, `chore:` …).
- `.kmjharness/`, `.github/workflows/ci.yml` 등 **관리 파일은 직접 수정하지 말 것.** 변경은 `kmjh sync`로만 이뤄진다.
- 공통 표준 문서: https://github.com/MinJunKimsdaads/kmjHarness/tree/main/docs
- 이 레포의 표준 설정은 `../kmjHarness`에 있다. 필요하면 참조할 것.
