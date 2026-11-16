# Contributing to nuxt-airplane

The full guidelines live in the docs: **[Pull requests](https://treygrr.github.io/nuxt-airplane/contributing/pull-requests)**.

The short version:

1. Open an issue first for features and behaviour changes; bug fixes and docs changes can go straight to a PR.
2. One concern per PR, with the diff limited to what the change needs.
3. Every behaviour change comes with tests (`test/client.test.ts` for runtime, `test/codegen.test.ts` for build-time, `test/basic.test.ts` for the module in a Nuxt app), and with docs and playground updates when users will notice.
4. Use [Conventional Commits](https://www.conventionalcommits.org); releases build the changelog from them.
5. Run the checks CI runs: `npm run lint`, `npm run test`, `npm run test:types`, and `npm run lint` inside `docs/`.

```bash
npm install
npm run dev        # playground with an in-memory, token-protected GraphQL API
npm run docs:dev   # docs site
```

Security issues: use a private security advisory on GitHub rather than a public issue.
