# Contributing

Thanks for helping. This project serves small nonprofits that often have no technical staff, so we favor features that are simple, correct and safe over features that are clever.

1. Read [AGENTS.md](AGENTS.md). It lists the conventions, gotchas and checklists every change follows, whether you write the code yourself or with a coding agent. [docs/architecture.md](docs/architecture.md) and [docs/features.md](docs/features.md) explain how the code fits together.
2. Open an issue first for anything larger than a small fix, so we can agree on the approach.
3. Develop against demo mode (`pnpm dev` with no `.env.local`), or against your own Supabase project.
4. Fork the repository, make your change on a branch, and open a pull request against `main`. Before you do, meet the definition of done: `pnpm typecheck`, `pnpm lint`, `pnpm test` and `pnpm build` all pass; CI runs them all, and a maintainer reviews every pull request before it's merged.
5. For schema changes, follow the "Add a table or column" checklist in [AGENTS.md](AGENTS.md): migration, row-level security, types, demo data, a database test, and `pnpm db:bundle` to regenerate `supabase/setup.sql`. Read the migrations policy there before editing an existing migration.
6. Keep the code generic. Anything specific to one organization belongs in settings, not in code. Sample data uses `example.org` and invented names.

Tax and compliance changes (acknowledgement letters, 990 classes, 1099 rules, PRI treatment) need a cited source in the pull request description. [docs/glossary.md](docs/glossary.md) explains the terms.
