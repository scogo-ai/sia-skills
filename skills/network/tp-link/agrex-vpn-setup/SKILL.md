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
  version: 1.1.0
author: scogo-ai
---

# TP-Link ER605 — VPN Deployment Instructions (for Agrex customer)

You (the sia agent) configure one ER605 in one browser, no human intervention. Drive login, WAN,
internet verification, and the tunnel check with your own `browser_*` tools; replay the IPSec/LAN
config with `browser_run_recipe`. Never run `sia browser replay` (it opens a second browser). Stay
on the default browser profile.

## Inputs

The prompt gives you only two paths:

- `recipe_json` — the IPSec/LAN recipe `.json`
- `vars_csv` — this site's one-row CSV

Everything else comes from the **first data row** of `vars_csv`. Read that row before step 1 and
map the columns you need:

| Need                                | CSV column              |
| ----------------------------------- | ----------------------- |
| site id                             | `site_id`               |
| login user                          | `admin_username`        |
| current router URL                  | `router_url`            |
| new router URL (after the LAN change) | `router_new_ip_address` |
| admin password (secret)             | `admin_password`        |
| pre-shared key (secret)             | `pre_shared_key`        |

`admin_password` and `pre_shared_key` are secrets: type them into the UI / feed them to the recipe,
but never print them to chat, logs, or screenshots. If the CSV has more than one data row, use the
first and say so. Wherever a later step names `router_url_new`, it means `router_new_ip_address`.

## 1. Log in

`browser_navigate` to `router_url`. If the first screen asks to create an admin account
(factory-fresh), create it with `admin_username` + `admin_password`; otherwise log in with the same.
If login is rejected → STOP `LOGIN_FAILED`. After login, land on the dashboard and wait ~2s.

## 2. WAN

UI: Quick Setup → WAN (or Network → WAN → WAN1). Internet Connection Type = Dynamic IP → Save.
Wait up to 30s for a WAN IP (retry ×3). No IP → STOP `WAN_NO_IP`.

## 3. Verify internet

UI: System Tools → Diagnostics. Diagnostic Tool = Ping.

**Set the Interface to `WAN1` before you click Start.** The dropdown defaults to `---`, and Start
does nothing while it stays unselected — that is why the run hangs on the Diagnostics screen. This
dropdown is the step that most often fails to take, so drive it deliberately instead of a single
click:

1. Take a fresh snapshot / `browser_get_state` and grab the ref of the **Interface** control (not
   the "Diagnostic Tool" one above it).
2. Select `WAN1` — try these in order, stopping as soon as the field reads `WAN1`:
   - If it's a native `<select>`: use the select-option tool with the label `WAN1`.
   - Otherwise (TP-Link renders a custom dropdown): click the control to open it, take a **new**
     snapshot so the freshly-rendered option list is in the DOM, then click the `WAN1` option by
     its ref from that new snapshot. Do not reuse a ref captured before the list opened.
   - Fallback: focus the control and use the keyboard — press `Down` (or type `W`) until `WAN1`
     is highlighted, then `Enter`.
3. **Verify before Start:** re-snapshot and confirm the Interface field shows `WAN1`, not `---`.
   Only then type the destination and click Start. If it still reads `---` after the attempts
   above, STOP `WAN_NO_INTERNET` (a hung Start is the same failure) rather than clicking into a
   hang.

Ping `8.8.8.8` over `WAN1` (one retry). Success is enough — skip any hostname ping.
Fail → STOP `WAN_NO_INTERNET`.

## 4. Replay IPSec + LAN (same browser)

1. Read `vars_csv` (header + first data row) into a `vars` object; drop empty columns. Keep
   `pre_shared_key` — the recipe fills the IPSec PSK from it. Leave the login-only columns
   (`admin_username`, `admin_password`) out; login already happened in step 1.
2. Call `browser_run_recipe` with `recipe = recipe_json` (the .json path is accepted directly) and
   `vars`, then approve the one confirmation. If the replay errors → STOP `REPLAY_FAILED`.
3. The recipe's LAN-IP change is the last thing it does, and it drops your connection — the router
   moves off `router_url` onto the `router_url_new` subnet and usually reboots. Recover:
   - Release/renew the host's DHCP lease so it lands in the `router_url_new` subnet. Disable then
     re-enable the correct host network interface; double-check you picked the right one before
     changing anything. Poll until the host has a new IP in that subnet.
   - Re-point the browser to `https://router_url_new` and re-login with `admin_username` +
     `admin_password`.

   If the host has no new lease in the `router_url_new` subnet within 120s → STOP
   `LAN_RECONNECT_FAILED`.

## 5. Verify the tunnel

Navigate: VPN → IPSec → Status.

- Expect Phase 1 = Connected and Phase 2 = Connected.
- If either is down → STOP `VPN_DOWN`.

## 6. Deployment checklist

Output Deployment Checklist to the user in a user friendly format.

```
[ ] WAN IP received        [ ] DHCP serving
[ ] Internet working       [ ] VPN policy created
[ ] LAN IP changed         [ ] Phase 1 UP
[ ] Reconnected at new IP  [ ] Phase 2 UP
```

## Stop codes

`LOGIN_FAILED`, `WAN_NO_IP`, `WAN_NO_INTERNET`, `REPLAY_FAILED`, `LAN_RECONNECT_FAILED`,
`VPN_DOWN`. On any STOP: report the code and what you saw, change nothing further, never
factory-reset, never reuse another site's values.
