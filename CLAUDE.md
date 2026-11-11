# Notes for Claude

## Skills CLI (`npx skills`) in cloud sessions

In Claude Code cloud sessions, run every `npx skills` command with
`NODE_USE_ENV_PROXY=1` in front of it, for example:

```bash
NODE_USE_ENV_PROXY=1 npx skills find pdf
```

Why: the CLI makes its web requests with Node's built-in `fetch`, which
ignores the container's HTTPS proxy unless this variable is set (Node 22.21 or
later). Without it every request fails, and the CLI hides the error: `find`
prints "No skills found" even when matching skills exist. Treat an empty
search result as suspect until you have rerun it with this setting.

The search API is on `skills.sh`, which must be on the cloud environment's
allowed network hosts.
