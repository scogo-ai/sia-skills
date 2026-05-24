---
name: scogo:incident-triage
description: "Use when the operator says 'look at this alert', 'what's wrong with X', or pastes an alert link. Pulls the alert, correlates logs/traces plus recent deploys in the window, and proposes a ranked root-cause hypothesis with the next 2-3 checks. Takes no remediating action."
tags: [meta, network, security, observability, incident-triage, troubleshooting, read-only]
# No `oem` tag and no `compatibility`: vendor-neutral, works over whatever
# observability MCP is configured. Lives under skills/_meta/ because it spans
# multiple domains (network + security + observability) — one canonical home,
# multi-tagged so SkillSearch finds it from any of those domains.
metadata:
  version: 1.1.0
allowed-tools: [pagerduty_get, logs_query, traces_query, deploys_list]
---

# Incident Triage (cross-domain)

Use when the operator says "look at this alert", "what's wrong with X", "we're seeing errors in Y", or pastes a PagerDuty/observability link. Goal: a ranked hypothesis plus a next-action list in **under five tool calls** — not a 30-call rabbit hole.

## 1. Anchor on the alert

Fetch the alert payload. Extract the service, time window, severity, and fingerprint. If you cannot identify the service, **ask before doing anything else**.

## 2. Correlate logs

Pull the service's logs scoped to the window (`--since` / `--until`, never `tail -f`). Cap at 200 lines / 16 KB. Look for error spikes, panics/stacktraces, and error strings that are new within the last hour.

## 3. Correlate traces

If a tracing MCP is configured, fetch the slowest/errored traces for the same service + window. Look for a newly-failing dependency or a new hot code path.

## 4. Recent deploys

List deploys to the affected service in `max(2 * window, 1h)`. A deploy at the front of the window is hypothesis #1 until refuted.

## 5. Propose a hypothesis

State the top hypothesis with confidence (HIGH / MEDIUM / LOW) and the single piece of evidence that would refute it. Then list the next 2-3 verification actions (e.g. "roll back deploy abc123", "check downstream X", "inspect flag Y"). **Take no action** — the operator decides.

## 6. Stop

Do not start a fix, page anyone, or file a ticket. Triage ends at "here is the hypothesis and the next checks." Handoff to a fix workflow is the operator's call (and a different skill).
