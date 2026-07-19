# Issue #14 — Ship prv as a Claude Code plugin (loop state)

Full approved plan: ~/.claude/plans/https-github-com-snrsw-prv-issues-14-mighty-finch.md
Branch: issue/14-claude-plugin (worktree). plan.md is git-excluded (worktree info/exclude).

## Acceptance criteria

- Headless CLI: `prv comments list [--unresolved] [--json]`, `prv comment <file>:<line> "msg"`,
  `prv reply <id> "msg"`, `prv resolve|unresolve <id>` — file-based protocol on .prv/comments.json.
- CLI-created comments anchor correctly in the UI (id/anchorText derived from computeDiff).
- Plugin scaffolding: .claude-plugin/plugin.json + marketplace.json, commands/prv.md (/prv),
  skills/prv-review/SKILL.md. Installable via `claude plugin marketplace add snrsw/prv`.
- README "Use with Claude Code" section.
- All CI steps green (format, lint, typecheck, test, build).

## Steps

- [x] S1 structural: src/shared/lines.ts extraction (commit b3bf827; 110 tests green)
- [ ] S2 parseTarget
- [ ] S3 comments list
- [ ] S4 comment
- [ ] S5 reply
- [ ] S6 resolve/unresolve
- [ ] S7 dispatch + HELP
- [ ] S8 plugin scaffolding (+ flake src filter check)
- [ ] S9 manual plugin install check (post-push)
- [ ] S10 README

## Notes (plan-state)

- Plan phase: reviewed via plan-mode flow (2 Explore + 1 Plan agent, user Q&A locked
  surface=CLI+skill, distribution=PATH). Scored plan loop folded into plan-mode review; user approved.
- Impl review loop: pending (after S10) — axes: correctness, spec-fit, coverage, security,
  architecture+design, simplicity, ai-pr-checks; threshold 80; MAX_ROUNDS 3.
