---
name: scogo:tp-link-agrex-vpn-setup
description: "Use when an operator needs to roll out the Agrex customer's TP-Link ER605 site-to-site IPsec VPN end to end through the router web UI, driving login, WAN, internet verification, an IPsec plus LAN recipe replay, the LAN-IP reconnect, and tunnel verification from a per-site CSV. One router, one browser, no human intervention: the agent drives login/WAN/verify and the tunnel check with its own browser_* tools and replays the IPSec/LAN config with browser_run_recipe, then prints a deployment checklist. Triggers on requests to provision, onboard, or set up the Agrex TP-Link router VPN, run the ER605 IPsec recipe for a site, or verify the Agrex VPN tunnel after rollout, even when the model number or IPsec is not named."
tags: [network, tp-link, er605, tl-r605, vpn, ipsec, site-to-site, agrex, browser, recipe, csv, rollout]
when_to_use:
  - set up the Agrex TP-Link ER605 VPN for a site
  - run the ER605 IPsec + LAN recipe for an Agrex site
  - verify the Agrex router VPN tunnel after rollout
  - onboard an Agrex ER605 router end to end
mutates: true
metadata:
  version: 1.0.0
author: scogo-ai
---

# TP-Link ER605 — VPN Deployment Instructions (for Agrex customer)

You (the sia agent) configure one ER605 in one browser, no human intervention. Drive steps 1–3 and
5–7 with your own `browser_*` tools; replay the IPSec/LAN config with `browser_run_recipe`. Never
run `sia browser replay` (it opens a second browser). Stay on the default browser profile.

## Inputs (from the prompt)

- `site_id`, `admin_username`, `router_url` (current), `router_url_new` (after LAN change)
- `recipe_json` — path to the recipe `.json`
- `vars_csv` — path to this site's one-row CSV
- `PSK` and `ADMIN_PASSWORD` are in the environment; use only as `{{PSK}}` / `{{ADMIN_PASSWORD}}`,
  never print them.

## 1. Log in

`browser_navigate` to `router_url`. If the first screen asks to create an admin account
(factory-fresh), create it with `admin_username` + `{{ADMIN_PASSWORD}}`; otherwise log in with the
same. If login is rejected → STOP `LOGIN_FAILED`. After login, land on the dashboard and wait ~2s.

## 2. WAN

UI: Quick Setup → WAN (or Network → WAN → WAN1). Internet Connection Type = Dynamic IP → Save.
Wait up to 30s for a WAN IP (retry ×3). No IP → STOP `WAN_NO_IP`.

## 3. Verify internet

UI: System Tools → Diagnostics. Ping `8.8.8.8` and `google.com`; both must succeed (one retry).
Fail → STOP `WAN_NO_INTERNET`.

## 4. Replay IPSec + LAN (same browser)

1. Read `vars_csv` (header + first data row) into a `vars` object. Drop empty columns; do not
   include any PSK/password column.
2. Call `browser_run_recipe` with `recipe = recipe_json` (the .json path is accepted directly) and
   `vars`, then approve the one confirmation.
3. Here in the last step, Connectivity will drop here. Changing the LAN IP moves the router off 192.168.0.1 and usually triggers a reboot. After saving:
- Release/renew the host's DHCP lease (it must move into the new {{router_url_new}} subnet). Ensure to disable/enable the right network interface of the host machine. Double check before doing any chagne. Continue to check if the host has got a new IP address, 
- Re-point the browser to https://{{router_url_new}} and re-login before continuing.

If the host doesn't get a new lease within 120s, any earlier failure → STOP → LAN_RECONNECT_FAILED.
`REPLAY_FAILED`. The router is now at `router_url_new` and your laptop has lost its link.

Confirm a new lease in `router_url_new`'s subnet within 90s, else STOP `LAN_RECONNECT_FAILED`.
Then `browser_navigate` to `router_url_new` and re-login with `admin_username` + `{{ADMIN_PASSWORD}}`.

## 5. Verify the tunnel

Navigate: VPN → IPSec → Status.

- Expect Phase 1 = Connected and Phase 2 = Connected.
- Poll up to 60s (tunnels take time / may need traffic to trigger). If still down, do one ping (next step) to nudge it, then re-check.
- If still down → STOP → VPN_DOWN 

## 8 Deployment checklist

Output Deployment Checklist to the user in a user friendly format.

```
[ ] WAN IP received        [ ] DHCP serving
[ ] Internet working       [ ] VPN policy created
[ ] LAN IP changed         [ ] Phase 1 UP
[ ] Reconnected at new IP  [ ] Phase 2 UP
```

## Stop codes

`LOGIN_FAILED`, `WAN_NO_IP`, `WAN_NO_INTERNET`, `REPLAY_FAILED`, `LAN_RECONNECT_FAILED`,
`VPN_DOWN`, `VPN_NO_TRAFFIC`. On any STOP: report the code and what you saw, change nothing further,
never factory-reset, never reuse another site's values.
</content>
</invoke>
