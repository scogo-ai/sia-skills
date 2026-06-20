#!/usr/bin/env python3
"""Pre-flight validation for the ER605 device CSV.

Catches the row-level problems that would otherwise turn into half-configured routers
in the field, including the IKEv1-Main-Mode-with-non-IP-ID bug from the original runbook.
Reads the CSV, prints a per-row PASS / WARN / FAIL report, and exits non-zero if any row
FAILs. Never prints secret values.

Usage:
    python3 validate_devices.py devices.csv
    python3 validate_devices.py devices.csv --json   # machine-readable output

If the user's CSV uses different headers, edit COLUMN_MAP below — that is the only place
column names live. Keys are this skill's canonical names; values are the headers in the file.
"""

import argparse
import csv
import ipaddress
import json
import sys

# --- Edit this when reconciling against the user's actual CSV headers ------------------
# canonical_name -> actual header in the CSV file
COLUMN_MAP = {
    "device_id": "device_id",
    "site_name": "site_name",
    "mgmt_url": "mgmt_url",
    "username": "username",
    "password": "password",
    "wan_type": "wan_type",
    "wan_ip": "wan_ip",
    "wan_mask": "wan_mask",
    "wan_gateway": "wan_gateway",
    "primary_dns": "primary_dns",
    "secondary_dns": "secondary_dns",
    "lan_ip": "lan_ip",
    "lan_mask": "lan_mask",
    "dhcp_start": "dhcp_start",
    "dhcp_end": "dhcp_end",
    "dns_server": "dns_server",
    "policy_name": "policy_name",
    "remote_gateway": "remote_gateway",
    "wan_interface": "wan_interface",
    "local_network": "local_network",
    "remote_network": "remote_network",
    "pre_shared_key": "pre_shared_key",
    "exchange_mode": "exchange_mode",
    "ike_version": "ike_version",
    "local_id": "local_id",
    "remote_id": "remote_id",
    "pfs": "pfs",
}
# --------------------------------------------------------------------------------------

SECRET_FIELDS = {"password", "pre_shared_key"}

REQUIRED_ALWAYS = [
    "device_id", "username", "password",
    "lan_ip", "lan_mask",
    "policy_name", "remote_gateway", "local_network", "remote_network", "pre_shared_key",
]
REQUIRED_IF_STATIC_WAN = ["wan_ip", "wan_mask", "wan_gateway"]


def get(row, canonical):
    """Fetch a canonical field from a row via COLUMN_MAP; '' if absent."""
    header = COLUMN_MAP.get(canonical, canonical)
    return (row.get(header) or "").strip()


def is_ip(value):
    try:
        ipaddress.ip_address(value)
        return True
    except ValueError:
        return False


def is_netmask(value):
    try:
        # Accept dotted mask (255.255.255.0) by round-tripping through a /prefix.
        ipaddress.IPv4Network(f"0.0.0.0/{value}", strict=False)
        return True
    except (ValueError, ipaddress.NetmaskValueError):
        return False


def net_of(ip, mask):
    return ipaddress.IPv4Network(f"{ip}/{mask}", strict=False)


def parse_network(value):
    """Parse either CIDR (10.0.0.0/24) or bare IP into an IPv4Network/Address."""
    value = value.strip()
    if "/" in value:
        return ipaddress.ip_network(value, strict=False)
    return ipaddress.ip_address(value)


def validate_row(row):
    """Return (status, messages) where status is PASS|WARN|FAIL."""
    fails, warns = [], []

    # Required-field presence
    for f in REQUIRED_ALWAYS:
        if not get(row, f):
            fails.append(f"missing required field: {f}")

    wan_type = get(row, "wan_type").lower()
    is_static = "static" in wan_type
    if is_static:
        for f in REQUIRED_IF_STATIC_WAN:
            if not get(row, f):
                fails.append(f"Static WAN but missing: {f}")

    # IP / mask format
    for f in ("mgmt_url", "wan_ip", "wan_gateway", "primary_dns", "secondary_dns",
              "lan_ip", "dhcp_start", "dhcp_end", "dns_server"):
        v = get(row, f)
        if v and not is_ip(v):
            fails.append(f"{f} is not a valid IP: {v!r}")
    for f in ("wan_mask", "lan_mask"):
        v = get(row, f)
        if v and not is_netmask(v):
            fails.append(f"{f} is not a valid netmask: {v!r}")

    # WAN gateway must sit in the WAN subnet
    if is_static:
        wan_ip, wan_mask, wan_gw = get(row, "wan_ip"), get(row, "wan_mask"), get(row, "wan_gateway")
        if all((wan_ip, wan_mask, wan_gw)) and is_ip(wan_ip) and is_netmask(wan_mask) and is_ip(wan_gw):
            if ipaddress.ip_address(wan_gw) not in net_of(wan_ip, wan_mask):
                fails.append(f"wan_gateway {wan_gw} not in WAN subnet {net_of(wan_ip, wan_mask)}")

    # DHCP pool must be inside the FINAL LAN subnet, ordered correctly
    lan_ip, lan_mask = get(row, "lan_ip"), get(row, "lan_mask")
    if lan_ip and lan_mask and is_ip(lan_ip) and is_netmask(lan_mask):
        lan_net = net_of(lan_ip, lan_mask)
        start, end = get(row, "dhcp_start"), get(row, "dhcp_end")
        for label, v in (("dhcp_start", start), ("dhcp_end", end)):
            if v and is_ip(v) and ipaddress.ip_address(v) not in lan_net:
                fails.append(f"{label} {v} outside LAN subnet {lan_net}")
        if start and end and is_ip(start) and is_ip(end):
            if ipaddress.ip_address(end) < ipaddress.ip_address(start):
                fails.append(f"dhcp_end {end} < dhcp_start {start}")

    # Local vs remote network must differ
    ln, rn = get(row, "local_network"), get(row, "remote_network")
    if ln and rn:
        try:
            if parse_network(ln) == parse_network(rn):
                fails.append(f"local_network == remote_network ({ln})")
        except ValueError:
            fails.append(f"local_network/remote_network not parseable: {ln!r} / {rn!r}")

    # THE BUG: IKEv1 Main Mode + non-IP ID will not negotiate
    mode = get(row, "exchange_mode").lower() or "main"   # default Main
    ikev = get(row, "ike_version").lower() or "ikev1"     # default IKEv1
    for idf in ("local_id", "remote_id"):
        idv = get(row, idf)
        if idv and "ikev1" in ikev and mode.startswith("main") and not is_ip(idv):
            fails.append(
                f"{idf}={idv!r} is non-IP but exchange_mode=Main (IKEv1): tunnel will not "
                f"negotiate. Use Aggressive mode, or set {idf} to the peer IP."
            )

    # PFS off — advisory
    pfs = get(row, "pfs").lower()
    if pfs in ("", "disable", "disabled", "none", "off"):
        warns.append("PFS disabled/unset — security downgrade; prefer dh14 (must match peer)")

    if not get(row, "secondary_dns"):
        warns.append("secondary_dns empty (allowed)")

    # LAN-IP change vs current mgmt IP — informational
    mgmt = get(row, "mgmt_url") or "192.168.0.1"
    if lan_ip and lan_ip == mgmt:
        warns.append("lan_ip == mgmt_url: no LAN-IP change, reconnect step will be skipped")

    if fails:
        return "FAIL", fails + warns
    if warns:
        return "WARN", warns
    return "PASS", []


def main():
    ap = argparse.ArgumentParser(description="Validate the ER605 device CSV.")
    ap.add_argument("csv_path")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = ap.parse_args()

    try:
        with open(args.csv_path, newline="", encoding="utf-8-sig") as fh:
            rows = list(csv.DictReader(fh))
    except FileNotFoundError:
        print(f"ERROR: file not found: {args.csv_path}", file=sys.stderr)
        return 2

    if not rows:
        print("ERROR: CSV has no data rows", file=sys.stderr)
        return 2

    # Surface header-mapping problems early.
    headers = set(rows[0].keys())
    mapped_missing = [c for c in REQUIRED_ALWAYS
                      if COLUMN_MAP.get(c, c) not in headers]
    if mapped_missing:
        print("ERROR: these canonical columns are not present in the CSV (edit COLUMN_MAP):",
              file=sys.stderr)
        for c in mapped_missing:
            print(f"  - {c} -> expected header {COLUMN_MAP.get(c, c)!r}", file=sys.stderr)
        return 2

    results, n_fail, n_warn = [], 0, 0
    for i, row in enumerate(rows, 1):
        status, msgs = validate_row(row)
        dev = get(row, "device_id") or f"row{i}"
        results.append({"row": i, "device_id": dev, "status": status, "messages": msgs})
        n_fail += status == "FAIL"
        n_warn += status == "WARN"

    if args.json:
        print(json.dumps({"results": results,
                          "summary": {"total": len(rows), "fail": n_fail, "warn": n_warn}},
                         indent=2))
    else:
        for r in results:
            mark = {"PASS": "✓", "WARN": "!", "FAIL": "✗"}[r["status"]]
            print(f"{mark} [{r['status']}] {r['device_id']} (row {r['row']})")
            for m in r["messages"]:
                print(f"      - {m}")
        print(f"\n{len(rows)} rows: {len(rows) - n_fail - n_warn} pass, {n_warn} warn, {n_fail} fail")
        if n_fail:
            print("Fix or quarantine FAIL rows before deploying.")

    return 1 if n_fail else 0


if __name__ == "__main__":
    sys.exit(main())
