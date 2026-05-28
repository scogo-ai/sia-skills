---
name: scogo:fortinet-config-change
description: "Use when an operator needs fortinet config change. Use when an operator asks to change a Fortinet device or policy. Walks an ADOM-aware FortiManager change: pull current config, preview a unified diff, wait for the mutation gate, apply, verify with a get/show, and commit a revision. Never skips preview or post-verify."
tags: [network, fortinet, config, change, config-change, change-management, multi-tenant]
when_to_use:
  - change a Fortinet firewall policy or address object
  - push a FortiManager config with preview and rollback
  - apply a FortiGate rule change through the mutation gate
mutates: true
compatibility: "fortios>=7.2,<7.6,fortimanager>=7.2"
metadata:
  version: 1.3.0
author: scogo-ai
allowed-tools: [fortinet_get, fortinet_set, fortinet_revision_commit]
---
# Fortinet Config Change (ADOM-aware)

Use when an operator asks for a change to a Fortinet device or policy. Walk these steps deliberately — never skip the preview (step 3) or the post-change verify (step 6), even under time pressure.

## 1. Establish ADOM context

Confirm the target ADOM. If the operator did not name one, **ask** — do not assume `root`. ADOM scoping is how multi-tenant policy stays isolated; the wrong ADOM is a cross-tenant incident.

## 2. Fetch current state

Call the fortinet MCP to read the current value of the target object (policy / address / service group / route). Save the output — you need it for the step-6 diff.

## 3. Propose the diff

Print a one-line change summary and a unified before/after diff:

```
Change: <one line>
ADOM:   <name>
Diff:
  <diff body>
```

For large policy tables, `scripts/preview-diff.sh` renders a side-by-side the operator can run themselves. It is **not** auto-executed — shell-in-skill is disabled (binding contract §2.1). Point the operator at it; never claim to have run it.

## 4. Pause for the mutation gate

Fortinet writes are mutation-gated by sia's policy hook. **Do not attempt to bypass it.** The operator sees the approval dialog; wait for their decision. Under `--yolo` / `--allow-writes` the gate auto-approves and you may proceed.

## 5. Apply

Call the fortinet MCP write tool with the proposed args. Capture the full response.

## 6. Verify

Re-run the step-2 get/show and compare against the intended diff. If live state ≠ intent, surface the mismatch immediately — do **not** declare success.

## 7. Commit revision

Call the revision-commit tool with a message containing: the change summary, the operator id, and `${SIA_SESSION_ID}` if exposed. This anchors the Fortinet-side audit trail; sia's audit log is the second anchor.

## 8. Report and stop

One line: what changed, the revision id, and the verify result. Do not propose follow-ups unless asked.

## Version notes (why `compatibility` is bounded)

- FortiOS 7.2–7.5 share the FortiManager revision/ADOM model this skill assumes (`fortimanager>=7.2`).
- 7.6 changed the workspace-locking flow; a separate `scogo:fortinet-config-change-legacy`-style skill would cover divergent ranges. **Never run two with overlapping ranges** — keep `compatibility` ranges disjoint so sia lists only the matching one.
- Within 7.2–7.5, branch inside this body for any minor-version step differences rather than forking the skill (design §5.3).
