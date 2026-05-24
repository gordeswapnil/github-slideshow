---
name: build-with-tests
description: Use this skill when implementing a feature or extending one. Captures how this project builds a feature: read the rules and the brief, match existing patterns, write production code and unit tests together in small steps, then run typecheck, lint, and the test suite at the end. Triggers when asked to build, implement, or extend a feature.
---

Process:

1. Read CLAUDE.md so you know the project rules and stack.
2. Read the technical brief so you stay inside its scope.
3. Look at 2-3 similar features in the codebase. Note their file
   layout, naming, and test style.
4. Implement the feature in the smallest coherent steps you can.
   For each step:
   - Write the production code.
   - Write a unit test that covers the new behaviour.
   - Run the test and confirm it passes.
5. When the feature is complete, run the full typecheck, lint,
   and test commands from CLAUDE.md.
6. Return a short summary: files changed, patterns reused, any
   rule you would suggest adding to CLAUDE.md.

Conventions used in this project:

- File names follow the existing folder structure.
- Tests live next to the code they cover (or in tests/ if that
  is the existing pattern).
- Use builders from test/builders/ for any entity setup.
- Cover success, validation failure, and one edge case per
  behaviour.

Rules:

- Do not refactor unrelated code.
- Do not change files outside the agreed scope.
- Do not add new dependencies without explicit instruction.
- If you cannot make the tests pass without violating a rule,
  stop and report the conflict.
