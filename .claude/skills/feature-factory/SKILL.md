---
name: feature-factory
description: Use this skill when the user asks to build, ship, or implement a feature end to end. Runs the full chain of seven subagents with human approval points after the story and the brief, runs the build agents in order (backend, frontend, test-verifier), then validates. Triggers on: "build a feature", "ship a feature", "run the factory", "feature factory".
---

Process:

1. Invoke the codebase-researcher subagent. Pass the feature
   idea and the relevant area of code. Wait for findings.

2. Invoke the story-writer subagent. Pass the feature idea
   and the researcher's findings. Wait for the user story.

3. Show the story to the user. Ask: "Does this match what
   you want? Reply 'approved' to continue, describe what
   to change, or reply 'reject' to stop the chain."
   - If approved, continue.
   - If changes requested, invoke story-writer again with
     the user's feedback. Repeat this step until approved
     or rejected.
   - If rejected, stop the chain. Summarise what was
     explored so the user can decide what to do next.

4. Invoke the spec-writer subagent. Pass the approved story
   and the researcher's findings. Wait for the technical brief.

5. Show the brief to the user. Ask: "Any design red flags?
   Reply 'approved' to continue, describe what to change,
   or reply 'reject' to stop the chain."
   - If approved, continue.
   - If changes requested, invoke spec-writer again with
     the user's feedback. Repeat this step until approved
     or rejected.
   - If rejected, stop the chain. Keep the approved story
     so the user can resume later with a different
     technical approach.

6. Invoke the backend-builder subagent. Pass the brief and the
   researcher's findings. Wait for the backend implementation
   and its summary.

7. Invoke the frontend-builder subagent. Pass the brief, the
   researcher's findings, and the backend builder's summary
   (so it knows the API contract). Wait for the frontend
   implementation and its summary.

8. Invoke the test-verifier subagent. Pass the approved story,
   the brief, and both builder summaries. Wait for the
   acceptance tests and the verifier's report.

9. Invoke the implementation-validator subagent. Pass the
   approved story, the approved brief, the test verifier's
   report, and the current implementation. Wait for findings.

10. If the validator reports critical findings, route them to
    the right build agent (backend-builder or frontend-builder)
    along with the relevant test from test-verifier. Then
    re-run test-verifier and the validator.

11. Show the validator findings to the user. Ask:
    "Ready to open the PR?"

Rules:

- Never skip the human approval points.
- Never invoke frontend-builder before backend-builder.
- Never invoke test-verifier before both builders have
  finished.
- Never invoke the validator before the chain has produced
  some implementation and the verifier has run.
- Each agent runs in its own subagent context. Pass only
  the inputs that agent needs.
- If any agent reports it cannot complete its task, stop
  and surface the reason to the user.
