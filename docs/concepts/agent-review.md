---
type: Workflow
title: Agent review
description: Three read-only review agents run in parallel over the diff and leave their findings as comment threads.
resource: https://github.com/snrsw/prv/blob/main/src/review/runner.ts
tags: [review, agent]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
sources:
  - id: decisions
    resource: https://github.com/snrsw/prv/blob/main/decisions.md
    title: prv decision log
---

# Definition

An agent review is one run started by the **Review** button. It starts three read-only runs of the selected agent CLI at the same time, one per lens. A lens is a single review focus: correctness, silent failures, or test coverage.

# Steps

1. prv sends each lens the whole diff, with old and new line numbers on every line.
2. Each lens returns up to 8 findings. A finding has a file, side, line range, severity, title, and body.
3. The browser turns each finding into a [comment thread](/concepts/comment-thread.md) anchored to the lines it cites, and saves it in the [comment store](/concepts/comment-store.md).

# Rules

* **Re-running stacks new findings on top of the old ones; prv does not deduplicate them.**
* Clear agent comments removes open findings that no one has replied to.
* Stop cancels the run.
* A finding is a normal thread: you can reply, Ask agent, Apply with agent, resolve, or delete it. A reply makes it pending for [Finish review](/concepts/finish-review.md).

The agent and model come from [agent settings](/concepts/agent-settings.md). Severity values, lenses, and run phases are in [Review findings](/notation/review-findings.md).[^decisions]

[^decisions]: decisions.md — "Agent review panel scope (issue #20)"
