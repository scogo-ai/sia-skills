# CSV Schema — per-device variables

One row per router. The columns below are the **canonical** names this skill and the scripts
expect. If the user's CSV uses different headers, don't rename their file — instead edit the
single `COLUMN_MAP` block at the top of `scripts/validate_devices.py` to point each canonical name
at the actual header. That keeps the mapping in one place.

> **Pending reconciliation:** the user is providing a CSV exported from a known-good ("golden")
> device config. When it arrives, compare its headers to this table, update `COLUMN_MAP`, and note
> any columns here that don't exist in their file (the skill will fall back to the defaults below
> for crypto parameters; it cannot fall back for the per-site values).

## Identity / connection

| Column        | Example          | Secret | Notes |
|---------------|------------------|--------|-------|
| `device_id`   | `MUM-BR-014`     | no     | Your unique handle for the device. Used in ledger, report, backup filename. |
| `site_name`   | `Mumbai Branch`  | no     | Human label for the report. Optional. |
| `mgmt_url`    | `192.168.0.1`    | no     | Current management IP to connect to. Defaults to `192.168.0.1` if blank. |
| `username`    | `admin`          | no     | Admin user. On factory units this is what gets *created* at first boot. |
| `password`    | `••••`           | **yes**| Admin password. Redacted everywhere. |

## WAN (Network → WAN)

| Column          | Example         | Secret | Notes |
|-----------------|-----------------|--------|-------|
| `wan_type`      | `Static IP`     | no     | One of `Static IP` / `Dynamic IP` / `PPPoE`. The fields below apply to Static IP. |
| `wan_ip`        | `203.0.113.10`  | no     | Static only. |
| `wan_mask`      | `255.255.255.248`| no    | Static only. |
| `wan_gateway`   | `203.0.113.9`   | no     | Static only. Must be in the same subnet as `wan_ip`. |
| `primary_dns`   | `1.1.1.1`       | no     | |
| `secondary_dns` | `8.8.8.8`       | no     | Optional. |

(For PPPoE you'll need `pppoe_user` / `pppoe_password` (secret) instead — add them to the CSV and
`COLUMN_MAP` if any sites use PPPoE.)

## LAN (Network → LAN)

| Column     | Example         | Secret | Notes |
|------------|-----------------|--------|-------|
| `lan_ip`   | `10.20.14.1`    | no     | Final LAN gateway IP. **Changing this disconnects the session** — applied last. |
| `lan_mask` | `255.255.255.0` | no     | |

## DHCP (Network → LAN → DHCP Server)

| Column        | Example          | Secret | Notes |
|---------------|------------------|--------|-------|
| `dhcp_start`  | `10.20.14.100`   | no     | Must be inside the **final** LAN subnet (`lan_ip`/`lan_mask`). |
| `dhcp_end`    | `10.20.14.200`   | no     | Must be inside the final LAN subnet and ≥ `dhcp_start`. |
| `dns_server`  | `10.20.14.1`     | no     | DNS handed to clients. Often `lan_ip` or a DNS forwarder. |

DHCP gateway is always `lan_ip` (not a separate column).

## IPsec — policy (VPN → IPSec → IPSec Policy)

| Column           | Example            | Secret | Notes |
|------------------|--------------------|--------|-------|
| `policy_name`    | `MUM-to-DC`        | no     | Also used to find/verify an existing policy on re-runs. |
| `remote_gateway` | `198.51.100.5`     | no     | Peer's public IP / FQDN. |
| `wan_interface`  | `WAN`              | no     | Which WAN the tunnel binds to. |
| `local_network`  | `10.20.14.0/24`    | no     | Usually the final LAN subnet. |
| `remote_network` | `10.99.0.0/24`     | no     | Must differ from `local_network`. |
| `pre_shared_key` | `••••`             | **yes**| Redacted everywhere. Must match the peer exactly. |

## IPsec — Phase 1 (IKE)

These are crypto parameters. They're usually identical across a deployment, so the skill carries
**defaults** and the CSV only needs them if a site differs. If a column is absent, the default is
used.

| Column          | Default      | Secret | Notes |
|-----------------|--------------|--------|-------|
| `exchange_mode` | `Main`       | no     | `Main` or `Aggressive`. **See the ID rule below.** |
| `ike_version`   | `IKEv1`      | no     | `IKEv1` or `IKEv2`. |
| `p1_encryption` | `aes256`     | no     | UI shows lowercase `aes256`. |
| `p1_auth`       | `sha256`     | no     | UI shows `sha256` (not "SHA2-256"). |
| `dh_group`      | `dh14`       | no     | UI shows `dh14`. |
| `p1_lifetime`   | `28800`      | no     | Seconds. |
| `dpd`           | `Enable`     | no     | Dead Peer Detection. |
| `local_id`      | *(peer IP)*  | no     | **If non-IP, exchange_mode must be `Aggressive`** — see below. |
| `remote_id`     | *(peer IP)*  | no     | Same rule. |

## IPsec — Phase 2 (IPsec proposal)

| Column          | Default   | Secret | Notes |
|-----------------|-----------|--------|-------|
| `protocol`      | `ESP`     | no     | |
| `p2_encryption` | `aes256`  | no     | |
| `p2_auth`       | `sha256`  | no     | |
| `pfs`           | `dh14`    | no     | The original runbook used `Disable`; prefer `dh14` to match Phase 1. Disabling PFS is a security downgrade. Must match the peer. |
| `p2_lifetime`   | `3600`    | no     | Seconds. Conventionally shorter than Phase 1. |

## Validation rules (enforced by `validate_devices.py`)

A row is `FAIL` if any of these are violated; `WARN` for advisory items.

- **FAIL** — required columns missing or empty (`device_id`, `username`, `password`, `lan_ip`,
  `lan_mask`, and for Static WAN: `wan_ip`/`wan_mask`/`wan_gateway`; for IPsec: `policy_name`,
  `remote_gateway`, `local_network`, `remote_network`, `pre_shared_key`).
- **FAIL** — any IP / mask not a valid address.
- **FAIL** — `wan_gateway` not in the `wan_ip`/`wan_mask` subnet (Static WAN).
- **FAIL** — `dhcp_start` or `dhcp_end` outside the `lan_ip`/`lan_mask` subnet, or `dhcp_end` <
  `dhcp_start`.
- **FAIL** — `local_network` == `remote_network`.
- **FAIL (the intern-doc bug)** — `exchange_mode` = `Main` while `local_id` or `remote_id` is set
  to a non-IP value. Main Mode + PSK identifies the peer by IP; a non-IP ID will not negotiate.
  Fix by setting `exchange_mode` = `Aggressive` or making the IDs the peer IPs.
- **WARN** — `pfs` = `Disable`/empty (security downgrade; prefer `dh14`).
- **WARN** — `secondary_dns` empty (allowed, just noted).
- **WARN** — `lan_ip` == `mgmt_url` (no LAN-IP change needed; the disconnect/reconnect step will
  be skipped — informational, not an error).
