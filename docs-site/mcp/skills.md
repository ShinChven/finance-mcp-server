# Skill Tools

Skills are procedures the user wrote for doing a task their way — *how I want a
fund compared*, *what I check before opening a position*. Five tools plus MCP
resources expose them to a client.

| Tool | Purpose | Writes |
|---|---|---|
| `skills` | Find saved skills — names and a one-line description of when each applies | |
| `skillRead` | Read one skill's full procedure | |
| `skillSave` | Draft a new skill | ✓ |
| `skillUnpublish` | Take a skill out of service | ✓ |
| `skillPublish` | Put a withdrawn skill back | ✓ |

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

## Withdrawing is open; publishing is only an undo

`skillUnpublish` archives a live skill, and `skillPublish` brings an archived one
back. The asymmetry between them is deliberate.

Withdrawing only removes capability. The worst a hijacked conversation achieves
is switching off a procedure the user can switch back on, and the audit log says
who did it — so it needs no gate.

Publishing grants capability, which is the direction the draft boundary exists to
control. So `skillPublish` is **not** a general publish: it only restores a skill
that a person put into service at least once before. The `skills.published_at`
column records that first activation, nothing an agent can call ever sets it, and
without it `skillPublish` refuses and points at the dashboard.

The practical consequence: a skill an agent drafted in this conversation cannot
be turned on by that same conversation, no matter how it asks. Once you have
published it yourself, turning it off and on again is something you can just say.

A skill you moved back to **Draft** on the dashboard is also refused — that is
you taking it back for review, and an agent does not get to reverse it. Archive
it instead when you only mean to pause it.

Both directions write an `audit_log` row, tagged `via: "mcp"` when a tool did it.

## Skills as MCP resources

The server also registers skills as MCP **resources**, so a client that prefers
resource subscriptions over tool calls can read the same published procedures
that way.
