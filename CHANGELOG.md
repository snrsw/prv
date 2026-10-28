# Changelog

## [v0.0.3](https://github.com/snrsw/prv/compare/v0.0.2...v0.0.3) - 2026-10-28

### Other Changes
- 🐛 Drop x86_64-darwin so the FlakeHub publish succeeds by @snrsw in https://github.com/snrsw/prv/pull/94

## [v0.0.2](https://github.com/snrsw/prv/compare/v0.0.1...v0.0.2) - 2026-10-24

### Other Changes
- 👷 Publish release tags to FlakeHub by @snrsw in https://github.com/snrsw/prv/pull/91
- 🔧 Update Bun to 1.4.2 by @snrsw in https://github.com/snrsw/prv/pull/93

## [v0.0.1](https://github.com/snrsw/prv/commits/v0.0.1) - 2026-10-18

### Other Changes
- ✨ Compare a git ref against an arbitrary folder by @snrsw in https://github.com/snrsw/prv/pull/3
- ✨ Show remote-tracking branches in ref dropdowns by @snrsw in https://github.com/snrsw/prv/pull/4
- ✨ Add per-file "File" view that shows the full modified file by @snrsw in https://github.com/snrsw/prv/pull/5
- ✨ Add syntax highlighting to diff view by @snrsw in https://github.com/snrsw/prv/pull/8
- ✨ Add GitHub-style split (side-by-side) diff view by @snrsw in https://github.com/snrsw/prv/pull/7
- 🎨 Render split-diff empty placeholders as plain white by @snrsw in https://github.com/snrsw/prv/pull/9
- ✨ Chat about the diff + inline AI review comments (Claude Code) by @snrsw in https://github.com/snrsw/prv/pull/10
- ✨ Install prv via Nix by @snrsw in https://github.com/snrsw/prv/pull/11
- ✨ Support running prv on a single file: prv <file> by @snrsw in https://github.com/snrsw/prv/pull/23
- 🎨 Right-align comment-pane action buttons under the textarea by @snrsw in https://github.com/snrsw/prv/pull/22
- ✨ Render Markdown files as a formatted preview in the File view by @snrsw in https://github.com/snrsw/prv/pull/24
- 🔧 Update deps hash for aarch64-darwin after adding marked/dompurify by @snrsw in https://github.com/snrsw/prv/pull/25
- ✨ Surface live agent activity in the review chat by @snrsw in https://github.com/snrsw/prv/pull/26
- ✨ Polish: relative tool targets, working ellipsis, dev HMR by @snrsw in https://github.com/snrsw/prv/pull/27
- ✨ Agent review panel: parallel lens reviews land as inline comments by @snrsw in https://github.com/snrsw/prv/pull/29
- ✨ Ship prv as a Claude Code plugin (headless comments CLI + /prv + skill) by @snrsw in https://github.com/snrsw/prv/pull/28
- ✨(chat): render agent answers as Markdown by @snrsw in https://github.com/snrsw/prv/pull/31
- 🐛(chat): don't send on the Enter that confirms an IME conversion by @snrsw in https://github.com/snrsw/prv/pull/33
- 🎨(chat): drop the grey card behind agent answers by @snrsw in https://github.com/snrsw/prv/pull/36
- ✨ Reveal hidden context from the hunk header by @snrsw in https://github.com/snrsw/prv/pull/41
- 🔥 Drop the two directory comparison modes: prv compares git refs only by @snrsw in https://github.com/snrsw/prv/pull/40
- ✨(ui): make the sidebar and chat panel widths resizable by @snrsw in https://github.com/snrsw/prv/pull/43
- ✨(chat): pick the agent's model and effort from the chat panel by @snrsw in https://github.com/snrsw/prv/pull/44
- ✨(cli): show a file whole when git can't diff it by @snrsw in https://github.com/snrsw/prv/pull/45
- ✨(chat): support OpenAI Codex as a second agent backend by @snrsw in https://github.com/snrsw/prv/pull/46
- Add change navigation and marks to File view by @snrsw in https://github.com/snrsw/prv/pull/47
- 📝(docs): UX review with prioritized findings and issue dependency map by @snrsw in https://github.com/snrsw/prv/pull/64
- 🐛(diff): parse renames, hide .prv/, surface git errors, keep paths in the mode query by @snrsw in https://github.com/snrsw/prv/pull/65
- ✨(chat): stop a running turn, persist transcripts from an effect, undo thread deletion by @snrsw in https://github.com/snrsw/prv/pull/66
- ✨(ui): keep place and per-file state across Refresh, revert the picker on a bad ref by @snrsw in https://github.com/snrsw/prv/pull/67
- ✨(ui): bundle diff2html/hljs CSS and add a dark theme by @snrsw in https://github.com/snrsw/prv/pull/68
- ✨(ui): show review progress in the sidebar and topbar, navigate findings by @snrsw in https://github.com/snrsw/prv/pull/69
- ✨(ui): keyboard access for the diff and global shortcuts by @snrsw in https://github.com/snrsw/prv/pull/70
- 💄(ui): descriptive tab title and favicon, keep file names visible, compact chat composer by @snrsw in https://github.com/snrsw/prv/pull/71
- 💄(ui): compact layout below 1000px by @snrsw in https://github.com/snrsw/prv/pull/72
- 🐛(server): serve cwd-independent asset URLs when running from source by @snrsw in https://github.com/snrsw/prv/pull/73
- ✨(batch): pending-comment rule, /api/batch protocol types, and docs for Finish review by @snrsw in https://github.com/snrsw/prv/pull/74
- 📝(docs): replace old plans and UX review with OKF concept and notation docs by @snrsw in https://github.com/snrsw/prv/pull/79
- 🔧 Automate releases with tagpr by @snrsw in https://github.com/snrsw/prv/pull/37
- 🐛(ui): start comment threads only from the + button (#75) by @snrsw in https://github.com/snrsw/prv/pull/76
- ✨(ui): comment from the File view (#77) by @snrsw in https://github.com/snrsw/prv/pull/80
- ✨(ui): Rendered/Source toggle in the card header, render .markdown files (#82) by @snrsw in https://github.com/snrsw/prv/pull/85
- ✨(chat): list models from the agent CLI (#84) by @snrsw in https://github.com/snrsw/prv/pull/86
- ✨(ui): one split send button in comment threads (#83) by @snrsw in https://github.com/snrsw/prv/pull/87
- ✨(describe): change description with prv describe and an Overview pane by @snrsw in https://github.com/snrsw/prv/pull/88
- 🔧(fmt): exclude tagpr-generated CHANGELOG.md from oxfmt by @snrsw in https://github.com/snrsw/prv/pull/90
