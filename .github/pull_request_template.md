## What and why

<!-- What does this change, and why? Link the issue it addresses (e.g. "Closes #12"). -->

## How I tested it

<!-- Demo mode, your own Supabase project, unit/database tests… Screenshots for UI changes. -->

## Checklist

- [ ] `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` pass
- [ ] Follows the conventions in [AGENTS.md](../AGENTS.md) (server actions return errors via `runAction`, money in cents, nothing organization-specific in code)
- [ ] Schema change? New numbered migration (never edit a released one), row-level security, types, demo data, a database test, and `pnpm db:bundle`
- [ ] Tax or compliance change (letters, 990 classes, 1099, PRIs)? Source cited above
- [ ] Docs updated if behaviour or setup changed
