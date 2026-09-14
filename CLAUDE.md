# Claude Code Guidelines

## Token Budget & Context Management
- Strictly adhere to .claudeignore. Never bypass exclusions.
- Check installed packages and scripts via package.json only.
- Do not run commands that dump massive outputs into stdout (e.g. cat on large files or uncapped grep).
- Keep diffs atomic and focused on the requested task.

## Bug Fixing Strategy
- Confine edits to the target files causing the issue.
- Verify regressions locally using npm run build or the project linter command.
- Provide direct, concise summaries of changed files and why the bug was resolved.
