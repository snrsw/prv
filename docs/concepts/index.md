# Concepts

- [Diff mode](/concepts/diff-mode.md) - What prv compares — two git sides in git mode, or whole files in files mode.
- [Comment thread](/concepts/comment-thread.md) - A conversation anchored to a line range of one file, open or resolved, and pending when you spoke last.
- [Comment store](/concepts/comment-store.md) - The .prv/comments.json file that holds every comment thread, shared by the browser and the CLI.
- [Agent review](/concepts/agent-review.md) - Three read-only review agents run in parallel over the diff and leave their findings as comment threads.
- [Finish review](/concepts/finish-review.md) - Sends every pending comment thread to the agent in one apply-mode run; the agent edits files and answers each thread.
- [Diff chat](/concepts/diff-chat.md) - A read-only conversation with the local coding agent about the current diff.
- [Agent settings](/concepts/agent-settings.md) - The agent, model, and effort used for every agent run, remembered in the browser.
