<!--
Thanks for the PR. Fill every section. A PR without test evidence will be sent back —
"tests pass" is not evidence, the command and its output are.
Keep it under ~400 changed lines where you can; say so if the change is mechanical.
-->

## Related issue

<!-- Closes #123, or "Part of #123". If there is no issue, say why this does not need one. -->

Closes #

## Summary

<!-- What changed and, more importantly, why. The diff shows what; this explains the reason. -->

## Files or modules affected

<!-- List the paths, grouped. This makes the blast radius visible to a reviewer. -->

- `apps/api/src/...`
- `packages/contracts/...`
- `docs/...`

## Test evidence

<!-- The exact commands you ran and their real output. Do not paste an expectation. -->

```
$ pnpm typecheck
...
```

```
$ pnpm --filter @veritrade/api test
 Test Files  N passed (N)
      Tests  N passed (N)
```

## Security considerations

<!-- Tick what applies and explain. "None" is an acceptable answer, but write it. -->

- [ ] No secret, key, token or connection string added anywhere (code, tests, fixtures, docs)
- [ ] Every new query is scoped by `organizationId` from the verified token
- [ ] No new endpoint accepts a key, raw transaction, calldata or destination address
- [ ] No guard, validation pipe, CORS setting or rate limit was relaxed
- [ ] This PR does not submit a chain transaction — or, if it does: it is idempotent and a
      timeout becomes `UNKNOWN` rather than a retry
- [ ] No contract deployment (deployments require explicit Tech Lead approval)

## Documentation updates

<!-- Which docs changed? If none, say why the behaviour change needs no doc. -->

- [ ] `docs/current-status.md` updated if what works has changed
- [ ] `.env.example` and `docs/onboarding.md` updated if an env var changed
- [ ] `docs/decisions.md` updated if a past decision was reversed
- [ ] Not applicable — no behaviour change

## Known limitations

<!-- What this PR deliberately does not do. Be specific; this is the section reviewers trust. -->

## Definition of Done

- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm format:check` passes
- [ ] `pnpm test` passes, and no existing test was weakened
- [ ] New behaviour has a test that fails without this change
- [ ] No unrelated refactoring included
