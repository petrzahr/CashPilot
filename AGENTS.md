# Agent Instructions & Context Budget Optimization

## Context Preservation & File Exclusions
To conserve token limits and avoid context rot:
- Don't open or analyze:
  - Build/compiler directories: .next/, dist/, build/, out/
  - Package dependencies: node_modules/
  - Lockfiles: package-lock.json, pnpm-lock.yaml, yarn.lock
  - Large binary/vector assets: *.svg, *.png, *.jpg, *.ico
- If dependency information is needed, refer only to package.json.

## Bug Fixing Protocol
1. Targeted Investigation: Start from the files named in the prompt or stack trace, and read further only as far as the fix requires.
2. Minimal Changes: Do not refactor surrounding code or reformat unrelated lines.
3. Verification: Run `npm run build` (type-check + build) rather than the full test suite unless requested.
4. Keep explanations brief, and don't redesign for speculative edge cases.
