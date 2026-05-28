---
name: scogo:google-workspace-gmail
description: "Use when an operator needs google workspace gmail. Gmail: Send, read, and manage email."
tags: [cloud, google-workspace, gmail]
metadata:
  version: 0.22.5
author: scogo-ai
---

# gmail (v1)

> **PREREQUISITE:** Read `../shared-cli/SKILL.md` for auth, global flags, and security rules. If missing, run `gws generate-skills` to create it.

```bash
gws gmail <resource> <method> [flags]
```

## Helper Commands

| Command | Description |
|---------|-------------|
| `+send` | Send an email |
| `+triage` | Show unread inbox summary (sender, subject, date) |
| `+reply` | Reply to a message (handles threading automatically) |
| `+reply-all` | Reply-all to a message (handles threading automatically) |
| `+forward` | Forward a message to new recipients |
| `+read` | Read a message and extract its body or headers |
| `+watch` | Watch for new emails and stream them as NDJSON |

## API Resources

### users

  - `getProfile` — Gets the current user's Gmail profile.
  - `stop` — Stop receiving push notifications for the given user mailbox.
  - `watch` — Set up or update a push notification watch on the given user mailbox.
  - `drafts` — Operations on the 'drafts' resource
  - `history` — Operations on the 'history' resource
  - `labels` — Operations on the 'labels' resource
  - `messages` — Operations on the 'messages' resource
  - `settings` — Operations on the 'settings' resource
  - `threads` — Operations on the 'threads' resource

## Discovering Commands

Before calling any API method, inspect it:

```bash
# Browse resources and methods
gws gmail --help

# Inspect a method's required params, types, and defaults
gws schema gmail.<resource>.<method>
```

Use `gws schema` output to build your `--params` and `--json` flags.
