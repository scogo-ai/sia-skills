---
name: scogo:ticket-asset-config
description: "Use when an operator needs the asset configuration details recorded against a Scogo ticket, such as the IP address or other config values captured for the ticket's asset. Looks up asset-config entries by ticket number via the Scogo platform API (GET /v1/asset-configs/search) and reports each entry's configuration key/values, asset link, and timestamps. Read-only — never mutates."
tags: [internal, scogo-platform, ticket, asset-config, lookup, read-only]
when_to_use:
  - get the asset configuration recorded for ticket 22614
  - what IP address was captured against this ticket
  - show the asset-config entries for a Scogo ticket number
  - look up a ticket's asset configuration details
mutates: false
metadata:
  version: 1.0.1
author: scogo-ai
allowed-tools: Bash
---

# Scogo Ticket → Asset Configuration Lookup

Fetch the asset-configuration entries recorded against a Scogo ticket and report them. This skill is **read-only**: it issues exactly one GET call and never writes anything back to the platform.

## Inputs

- **Ticket number** — from the operator's request (e.g. `22614`). Digits only. If the operator did not give one, ask for it before calling anything.
- Authentication — use `SCOGO_API_TOKEN` and `SCOGO_ORG_ID` when both are set; otherwise read `accessToken` and `activeOrgId` from `~/.sia/scogo-auth.json`.

The access token is a secret. Never print it, include it in output, echo a command after expansion, or ask the operator to paste it into chat.

## 1. Preflight

Confirm the ticket number contains digits only. Authentication is resolved by the bundled script without printing credentials. Environment variables take precedence only when both are set; otherwise it reads the SIA authentication file.

## 2. Call the search API

```sh
sh <SKILL_DIR>/scripts/fetch.sh <TICKET_NUMBER>
```

Replace `<SKILL_DIR>` with this skill's directory and `<TICKET_NUMBER>` with the digits from the request. Run it exactly once. If authentication cannot be loaded, report the script's safe error and stop; never display the auth file contents.

A successful response is `{"data": [ ...entries ]}`, one entry per asset-config record:

```json
{
  "id": "assetconfig_…",
  "ticket_id": "ticket_…",
  "asset_id": "inventoryasset_…",   // may be null — config not linked to an inventory asset
  "site_id": null,
  "config": [ { "ip_address": "1.2.34.4" } ],
  "created_by": "user_…", "created_at": "2026-07-15T06:44:58Z",
  "updated_by": "user_…", "updated_at": "2026-07-15T06:44:58Z"
}
```

`config` is a list of objects with **arbitrary keys** (`ip_address` is just one example). Flatten and report every key/value pair — do not assume the schema.

## 3. Report

Sort entries newest-first by `updated_at` and flag the newest as **current**. Present one row per entry:

| Config entry | Asset | Configuration | Updated |
|--------------|-------|---------------|---------|
| `assetconfig_…` (current) | `inventoryasset_…` or *not linked* | `ip_address = 1.2.34.4` | 2026-07-15 06:44 UTC |

Then state the ticket id (`ticket_id`) the entries belong to and stop. Do **not** propose creating or editing asset configs — that is a mutation owned by a different workflow.

## Failure modes

| Symptom | Meaning | Action |
|---------|---------|--------|
| `data: []` | No asset config recorded for that ticket | Report "no asset configuration recorded for ticket N" — not an error |
| `401` | Token invalid or expired | Ask the operator to sign in to SIA again |
| `403` | Token not authorised for the active organisation | Ask the operator to select or confirm the active organisation in SIA |
| Other non-2xx | API error | Show the HTTP status and response body verbatim |
| Connection failure | `api.scogo.in` unreachable | Report it; retry once, then stop |
