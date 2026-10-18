---
type: CliSyntax
title: CLI targets
description: The <file>:<line> syntax, flags, and output of prv comment(s), and the forms of prv describe.
resource: https://github.com/snrsw/prv/blob/main/src/comments/cli.ts
tags: [cli, comments, description]
generated: { by: claude-code/claude-opus-5-5, at: 2026-10-18T00:00:00Z }
---

# Target syntax

`prv comment <file>:<line> "msg"`

- The target splits on the last colon. `<line>` is an integer of 1 or more.
- **`<line>` is always a new-side line number.** The CLI cannot anchor to a deleted line, and it accepts no ranges (`src/a.ts:10-12` is rejected).
- The line must appear in the HEAD vs working-tree diff, as a changed or context line.
- A leading `./` is stripped. A path starting with `-` is rejected.
- `comments`, `comment`, `reply`, `resolve`, and `unresolve` are subcommands. To view a file with one of those names, write `prv ./comment`.

`reply`, `resolve`, and `unresolve` take a comment ID; its format is in [Comment IDs](/notation/comment-ids.md).

# Flags

| Flag                     | Applies to                      | Meaning                                          |
| ------------------------ | ------------------------------- | ------------------------------------------------ |
| `--unresolved`           | `comments list`                 | Only open threads                                |
| `--json`                 | `comments list`, `comment`      | Machine-readable output                          |
| `--role user\|assistant` | `comment`, `reply`              | Author of the message; default `assistant`       |
| `--file <path>`          | `reply`, `resolve`, `unresolve` | Pick the file when an ID exists in several files |
| `--`                     | all                             | End of options                                   |

# Output

`comments list` prints two lines per thread. Fields are separated by two spaces:

```
c:_42:_42  src/app.ts:42  open  2 messages
  This branch is dead code.
```

- The second line is the first line of the first message.
- With no comments it prints `no comments`.
- `--json` prints the raw comment array, as stored in `.prv/comments.json` but without the `schema_version` wrapper.
- Errors go to stderr as `prv <command>: <message>` and exit 1.

# prv describe

`prv describe` writes the [change description](/concepts/change-description.md). It takes no positional arguments, and `describe` wins over a file with that name, like the comment subcommands.

| Form                         | Effect                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------- |
| `prv describe`               | Saves Markdown from stdin; refuses an interactive terminal                   |
| `prv describe --file <path>` | Saves Markdown from `<path>`, relative to the current directory              |
| `prv describe --show`        | Prints the description; exits 1 with `no description yet` when there is none |
| `prv describe --clear`       | Removes the description                                                      |

- A write prints `wrote .prv/description.md`. Empty or whitespace-only input, and input over the 1 MiB [size limit](/concepts/change-description.md), is rejected and the old description is kept.
- `--show` and `--clear` cannot be combined with each other or with `--file`.
- `--file` here names the input file; on `reply`, `resolve`, and `unresolve` it names the commented file.
