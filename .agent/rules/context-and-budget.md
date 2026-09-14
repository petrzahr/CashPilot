# Antigravity Context & Efficiency Rules

## Scope & File Access Restrictions
- NEVER inspect, read, or grep inside:
  - node_modules/, dist/, build/, .next/, out/
  - Lockfiles: package-lock.json, pnpm-lock.yaml, yarn.lock, bun.lockb
  - Static media: *.svg, *.png, *.jpg, *.ico, *.mp4, *.webp
  - Map & build artifacts: *.map, *.tsbuildinfo, *.log
- For checking project dependencies or scripts, read strictly package.json. Never check lockfiles.

## Bug Fixing & Workflow Discipline
- Focus strictly on the files directly implicated in the user prompt.
- Do NOT perform whole-project recursive refactoring or unprompted file scans.
- When fixing an issue:
  1. Identify root cause in the affected component/module.
  2. Apply the minimal viable fix.
  3. Validate changes with a build command (npm run build or typecheck) before completing.
- Keep diffs compact and do not rewrite entire files unless strictly necessary.
