# Skill Tools

Skills are procedures the user wrote for doing a task their way — *how I want a
fund compared*, *what I check before opening a position*. Three tools plus MCP
resources expose them to a client.

| Tool | Purpose | Writes |
|---|---|---|
| `skills` | Find saved skills — names and a one-line description of when each applies | |
| `skillRead` | Read one skill's full procedure | |
| `skillSave` | Draft a new skill | ✓ |

## One tool covers browsing and searching

`skills` with a `q` searches; `skills` without one lists. They differ only by
that argument, so splitting them into `skillsList` and `skillsSearch` would only
give an agent a choice it can get wrong — the same reasoning the note tools
follow.

It returns names and descriptions, never the procedure itself. Call `skillRead`
once you know which one you want; when the user names a skill outright, skip the
search and read it directly.

## A skill written over MCP is a draft

`skillSave` creates a **draft**, and drafts never appear in `skills` or
`skillRead`. A skill becomes visible to the tools only when a person publishes it
in the dashboard.

That is the point: an agent must not be able to write itself an instruction and
then follow it in the same session. Publishing is a human act, on `/skills`.

## Skills as MCP resources

The server also registers skills as MCP **resources**, so a client that prefers
resource subscriptions over tool calls can read the same published procedures
that way.
