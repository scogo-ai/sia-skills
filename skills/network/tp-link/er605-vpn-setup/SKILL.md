---
name: scogo:tp-link-er605-vpn-setup
description: "Use when an operator needs to configure a TP-Link ER605 (TL-R605) router end-to-end over its web UI, including first-boot password setup, login, WAN, LAN, DHCP, and a site-to-site IPsec VPN tunnel, with values pulled from a per-device CSV and a redacted client-ready completion report at the end. Built for resumable, idempotent bulk field deployment of many ER605, TL-R605, or Omada SafeStream routers, driven through a headed browser via Chrome DevTools MCP. Triggers on requests to provision, onboard, configure, or bulk-deploy these routers, set up an IPsec VPN on a TP-Link router through the browser, run a router CSV, or produce a configuration completion report, even when the model number or 'IPsec' is not named."
tags: [network, tp-link, er605, tl-r605, vpn, ipsec, site-to-site, router, omada, safestream, csv, browser, field-deployment]
when_to_use:
  - configure the ER605 / TL-R605 router
  - set up the IPsec VPN on a TP-Link router
  - onboard or bulk-deploy routers from a CSV
  - generate a client-facing router configuration report
mutates: true
metadata:
  version: 1.0.0
author: scogo-ai
---

# TP-Link ER605 Configuration & IPsec VPN Setup

Provision a TP-Link ER605 / TL-R605 over its web UI in a **headed** browser, driven by a
per-device CSV, and produce a redacted, client-ready completion report. Built for field
deployment at scale (thousands of devices), so the workflow is resumable, idempotent, and
stops for a human when something looks wrong rather than plowing ahead.

This skill corrects several technical errors found in the original hand-written runbook.
Where the corrected behavior matters, the reasoning is in `references/`. Read those files
when you reach the relevant step — don't try to hold all of it in head at once.

## What you need before starting

1. **The device CSV.** One row per router. The canonical column spec and validation rules
   are in `references/csv-schema.md`. If the user gave you a CSV with different headers,
   reconcile them against that spec first (it's a single mapping table to edit).
2. **A reachable router.** The browser host (the laptop/jumpbox running this) must be on the
   same LAN segment as the router's management interface, typically plugged into a LAN port.
3. **Chrome DevTools MCP**, launched **headed** so the operator can watch and take over.
   If those tools error or won't connect, invoke the `chrome-devtools-mcp:chrome-devtools`
   skill for setup/troubleshooting.

> Secrets (admin password, IPsec pre-shared key) are **redacted everywhere** — chat, logs,
> reports. Never print them. See "Secret handling" below.

## Pre-flight (once per batch, before touching any device)

Validate the CSV before you connect to anything. A bad row caught here is far cheaper than a
half-configured router in the field.

```bash
python3 scripts/validate_devices.py <path-to-devices.csv>
```

The validator checks required columns, IP/mask/subnet sanity, that the DHCP pool falls inside
the **final** LAN subnet, that local/remote networks differ, and — importantly — it flags the
**IKEv1 Main Mode + non-IP ID** combination that will silently fail to negotiate (see
`references/ipsec-parameters.md`). It never prints secret values. Fix or quarantine any row
marked `FAIL` before proceeding. `WARN` rows can proceed but note them in the report.

Maintain a **ledger** (`deployment-ledger.csv` or `.json`) keyed by `device_id` with a status
per device: `pending | in_progress | success | needs_review | failed`. Update it as you go so
the batch is resumable — on a re-run, skip anything already `success`.

## Per-device workflow

Do these **in this order**. The order is deliberate: every step except the LAN-IP change keeps
your management session alive, so the unavoidable disconnect happens once, late, after the
important config is committed. The original runbook's order (WAN → LAN → DHCP → VPN) cuts the
session mid-procedure — don't follow it.

Create a todo list from these steps so none are skipped. For UI navigation paths and the exact
fields on each page, read `references/ui-navigation.md`.

### 1. Connect and establish state

- Navigate to **`http://{{mgmt_url}}`** (default `http://192.168.0.1`). The ER605 serves its UI
  over **HTTP by default** — do not assume HTTPS. Only fall back to `https://` (and click through
  the browser's "Advanced → Proceed" interstitial via a snapshot+click) if HTTP refuses.
- Take an accessibility snapshot and decide which of three states you're in:
  - **Factory / first boot** → a "create admin account" / set-password screen. Go to step 2a.
  - **Normal login page** → go to step 2b.
  - **Already logged in or already configured** (dashboard loads without login, or VPN policy
    `{{policy_name}}` already exists) → this device may have been done already. Check the ledger.
    If not recorded as `success`, treat as a re-run: verify config matches the CSV rather than
    blindly re-applying. See "Idempotency" below.

### 2a. First-boot password creation (factory units only)

Factory and freshly-reset units force you to create the admin credentials before the dashboard
is reachable. Set username/password to the CSV's `{{username}}` / `{{password}}` (the values the
CSV expects to log in with later). If the firmware also runs a "Quick Setup" wizard, exit/skip
it — this skill configures each interface explicitly. Then continue to login if prompted.

### 2b. Login

Enter `{{username}}` / `{{password}}`, submit. Confirm the dashboard renders before continuing.
If login fails on a unit you expected to be configured, stop and mark `needs_review` — wrong
creds mean either the wrong CSV row or a unit in an unexpected state.

### 3. Collect device information

Navigate **Status → System Status** (not "System Tools"). Record: Device Model, Hardware
Version, Firmware Version, Serial Number. These go in the report and the backup filename. Note
the firmware version — menu nesting for Backup/Diagnostics varies slightly between the classic
and Omada-style standalone firmware (`references/ui-navigation.md` covers both).

### 4. Configure WAN

Navigate **Network → WAN**. Set `{{wan_type}}`. If Static IP, fill `{{wan_ip}}`, `{{wan_mask}}`,
`{{wan_gateway}}`, `{{primary_dns}}`, `{{secondary_dns}}`. Save and confirm the WAN comes up
(status shows connected / an IP is bound). The VPN can't establish without a working WAN.

> **Hazard:** if you are ever managing a unit *remotely over the WAN link itself*, editing WAN
> can cut your only path in. This skill assumes **local LAN** management. Don't reconfigure WAN
> over WAN unless the operator has out-of-band access.

### 5. Configure the IPsec VPN

Do this while still on the original LAN subnet — these are policy values, not tied to the live
LAN interface, so entering the *final* `{{local_network}}` here is correct. Full field-by-field
detail and the parameter rationale are in `references/ipsec-parameters.md` — **read it before
filling Phase 1**, because of the Main Mode / ID interaction.

- **Policy** (VPN → IPSec → IPSec Policy → Add): `{{policy_name}}`, `{{remote_gateway}}`,
  `{{wan_interface}}`, Local Network `{{local_network}}`, Remote Network `{{remote_network}}`,
  Pre-Shared Key `{{pre_shared_key}}`, Status = Enable.
- **Phase 1** (Advanced): Exchange Mode, IKE version, encryption, auth, DH group, lifetime, DPD,
  Local ID, Remote ID — per CSV / skill defaults.
  - **Critical:** IKEv1 **Main Mode** identifies the peer by **IP address**. If `{{local_id}}` /
    `{{remote_id}}` are non-IP (FQDN/email/key-id), Main Mode + PSK will not negotiate. Either
    set Exchange Mode = **Aggressive**, or set the IDs to the peer IPs. The validator flags this;
    honor its verdict.
- **Phase 2**: Protocol ESP, encryption, auth, PFS, lifetime per CSV / defaults. Note: disabling
  PFS is a security downgrade — if the CSV leaves it unset, prefer PFS = DH14 to match Phase 1
  (and confirm the remote peer agrees, or the tunnel won't come up).
- Save the policy.

### 6. Change the LAN IP (do this LATE, expect a disconnect)

Only if `{{lan_ip}}` differs from the current LAN IP. Navigate **Network → LAN**, set `{{lan_ip}}`
and `{{lan_mask}}`, Save.

**This drops your session** — the browser is talking to the old IP and the router has moved to a
new subnet. Recovery sequence:

1. The browser host must get an address on the **new** subnet. If it uses DHCP from this router,
   renew its lease (`ipconfig /renew` on Windows, `sudo ipconfig set en0 DHCP` / `sudo dhclient -r
   && sudo dhclient` on macOS/Linux — the harness can run this, or prompt the on-site tech). If it
   uses a static IP, it must already be in the new subnet.
2. Re-navigate to **`http://{{lan_ip}}`** and log in again (step 2b).

If `{{lan_ip}}` equals the current IP, skip the disconnect handling entirely.

### 7. Configure DHCP

Navigate **Network → LAN → DHCP Server** (a tab under LAN, not a separate menu). Enable it; set
Start `{{dhcp_start}}`, End `{{dhcp_end}}`, Gateway = `{{lan_ip}}`, DNS `{{dns_server}}`. Save.

This comes **after** the LAN-IP change on purpose: the DHCP pool must fall inside the live LAN
subnet, so it's only valid once the interface is on the final subnet.

### 8. Bring up and verify the tunnel

Enable the policy (VPN → IPSec) if not already active. Then verify on the IPsec status/tunnel
view: **Phase 1 = UP, Phase 2 = UP, Tunnel = Connected**. A tunnel won't come up unless the
remote peer is configured and reachable and the proposals match on both ends — if it stays down,
capture the status and mark `needs_review`; don't fake success.

### 9. Connectivity validation

Use the router's own tool: **System Tools → Diagnostics → Ping** (the router has a route into the
remote LAN; the browser host usually does not). Ping the remote gateway, the remote LAN gateway,
and the remote server / application target from the CSV. Record pass/fail per target.

### 10. Back up the configuration

Navigate **System Tools → Backup & Restore** (on Omada-style firmware:
`System Tools → Management → Backup & Restore`), download the config. Save it named by identity,
e.g. `backups/{{device_id}}_{{serial}}_{{date}}.bin`, so 5000 backups stay traceable.

### 11. Generate the per-device report and update the ledger

Render the completion report (next section). Set the ledger status: `success` only if WAN up, LAN
+ DHCP applied, both IPsec phases UP, and backup saved. Anything short → `needs_review` with the
reason. Move to the next CSV row.

## Idempotency (re-runs)

At scale you will re-run rows. Before applying a step, check current state and only change what
differs: if the LAN IP already matches, don't trigger a needless disconnect; if the VPN policy
exists with matching parameters, verify rather than re-create. The goal is that running the same
row twice converges to the same config without damage and without a second avoidable outage.

## Secret handling

`{{password}}` and `{{pre_shared_key}}` are secrets. Type them into the router UI, but never echo
them to chat, the ledger, screenshots, or the report. In the report show only a masked form
(e.g. `••••<last4>`) and an "applied: yes/no" flag. When taking screenshots of pages that contain
a secret field, prefer the field's masked state; if a value would be visible, don't capture it.
Redaction is your responsibility when filling the report — never copy a raw secret into it.

## Completion report

Produce a per-device markdown report by filling `assets/report-template.md`, and a batch rollup at
the end. The report is **client-facing**: factual, redacted, and clear about anything that landed
in `needs_review`. Also print a short summary to
chat (device, serial, what was configured, tunnel status, any flags). At batch end, summarize:
total devices, `success` / `needs_review` / `failed` counts, and the list of devices needing
attention.

## When to stop and ask

Stop and flag for a human (don't guess) when: login fails on a unit expected to be configured;
the WAN won't come up; the tunnel won't reach Phase 2 UP after a reasonable wait; the UI doesn't
match either documented firmware layout; or the validator marked the row `FAIL`. A paused device
marked `needs_review` is a good outcome — a wrongly-configured router in the field is not.

## Reference files

- `references/csv-schema.md` — canonical CSV columns, types, validation rules, secret flags, and
  the mapping-table to reconcile against the user's actual CSV.
- `references/ipsec-parameters.md` — Phase 1 / Phase 2 fields, the Main-Mode-vs-ID rule, PFS
  guidance, UI value naming (`sha256`, `aes256`, `dh14`).
- `references/ui-navigation.md` — verified menu paths, firmware-variant notes, the LAN-IP
  session-loss recovery, and per-page field maps.
- `scripts/validate_devices.py` — pre-flight CSV validation (run before any device).
- `assets/report-template.md` — the report layout to fill for each device.
