# ER605 standalone UI — verified navigation and per-page field maps

Menu labels and nesting differ slightly between the **classic** ER605 firmware and the newer
**Omada-style** standalone firmware. Both layouts are noted where they diverge. When in doubt,
take an accessibility snapshot and match by label text rather than assuming a fixed path. If a page
genuinely doesn't match either layout, stop and mark the device `needs_review`.

## Access

- Default URL: **`http://192.168.0.1`** — HTTP, not HTTPS. HTTPS management is an optional toggle,
  not the factory default, so don't expect a certificate warning on a fresh unit.
- If HTTP is refused (a unit hardened to HTTPS-only), try `https://<ip>` and click through the
  browser interstitial: snapshot the page, click **Advanced**, then **Proceed to …**. (This is a
  normal page interaction, not a JS dialog.)
- Default credentials: `admin` / `admin`. A factory/reset unit **forces creation** of a new admin
  username + password (6–64 chars) on first login before the dashboard loads — handle that screen
  first (workflow step 2a).

## Driving it with Chrome DevTools MCP (headed)

Typical loop per page:
1. `take_snapshot` to get the accessibility tree with element `uid`s.
2. `fill` / `fill_form` for inputs and selects, `click` for buttons (use the `uid` from the snapshot).
3. `wait_for` text that confirms the save (e.g. a success toast or the new value rendered).
4. `take_screenshot` for the report **only** when no secret is visible on screen.

`evaluate_script` is handy to read a field's current value (for idempotency checks) or to confirm a
status string. If pages or the connection misbehave, the `chrome-devtools-mcp:chrome-devtools` skill
covers troubleshooting.

## Page-by-page

### Status → System Status  *(device info — step 3)*
Top-level **Status** menu, **System Status** page. Read Device Model, Hardware Version, Firmware
Version, Serial Number, system time. (The original runbook's "System Tools → System Status" is
wrong — it's under **Status**.)

### Network → WAN  *(step 4)*
Select the WAN port, set Connection Type (`Static IP` / `Dynamic IP` / `PPPoE`). For Static IP fill
IP / mask / gateway / primary + secondary DNS. Save; confirm the WAN shows connected / bound IP.

### Network → LAN  *(step 6 — do LATE)*
Edit the LAN interface IP and mask. **Saving a changed LAN IP drops your session.** Recovery:
1. Get the browser host onto the new subnet — renew its DHCP lease (`ipconfig /renew` on Windows;
   `sudo ipconfig set en0 DHCP` on macOS; `sudo dhclient -r && sudo dhclient` on Linux) or rely on a
   static IP already in the new subnet.
2. Re-open `http://<new-lan-ip>` and log in again.
If the target LAN IP equals the current one, no disconnect — skip recovery.

### Network → LAN → DHCP Server  *(step 7 — after the LAN-IP change)*
DHCP is a **tab/sub-section under LAN**, not its own top-level menu. Enable the DHCP server; set
Start IP, End IP, Default Gateway (= the LAN IP), DNS. The pool must be inside the live LAN subnet,
which is why this runs after the LAN-IP change.

### VPN → IPSec → IPSec Policy  *(step 5)*
The menu is **IPSec** (not "IPSec VPN"). Add a policy with the basic parameters, then open
**Advanced** for Phase 1 / Phase 2. Field values and the Main-Mode/ID rule are in
`ipsec-parameters.md`. After saving, the IPsec status/tunnel view shows Phase 1 / Phase 2 / Tunnel
state — that's where step 8 verification reads UP/Connected.

### System Tools → Diagnostics  *(step 9 — connectivity)*
Built-in **Ping** (and Traceroute). Ping from here, not from the browser host — the router has the
route into the remote LAN over the tunnel. Run the remote gateway, remote LAN gateway, and remote
server targets; record pass/fail.

### System Tools → Backup & Restore  *(step 10)*
Classic firmware: **System Tools → Backup & Restore**. Omada-style firmware: **System Tools →
Management → Backup & Restore**. Click Backup / Export and save the downloaded config file named by
device identity (`{{device_id}}_{{serial}}_{{date}}.bin`).

## Order recap (why it's not the runbook's order)

```
1 connect/state → 2 login/first-boot → 3 info → 4 WAN → 5 IPsec policy+P1+P2
→ 6 LAN-IP (disconnect, reconnect) → 7 DHCP → 8 verify tunnel → 9 ping → 10 backup
```

Everything before step 6 keeps the session alive. The LAN-IP change is the only step that
disconnects you, so it goes late — one disconnect, one reconnect, after the heavy config is
committed. DHCP follows it because the pool must be valid in the final subnet.
