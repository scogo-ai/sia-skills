---
name: scogo:serial-console-ops
description: "Use when an operator needs to drive a network device's serial/console port safely — log in, disable paging, run show/diagnostic commands, and make configuration changes with explicit confirmation. Covers Cisco IOS/NX-OS, Junos, FortiOS, PAN-OS, Aruba, MikroTik. Classifies read vs write, never invents credentials, and guards against lockout."
tags: [network, serial, console, tty, uart, rs-232, oob, out-of-band, vendor-neutral, enable-mode, config-mode, write-memory, commit]
when_to_use:
  - configure a switch over the serial console
  - access a device console port
  - drive a router or firewall serial CLI
  - run show/diagnostic commands over a serial connection
mutates: true
metadata:
  version: 1.0.0
author: scogo-ai
---
# Driving a serial console safely

You are driving a raw serial console through the `serial` MCP tools
(`list_ports`, `open`, `write`, `read`, `send`, `close`). The device's reply is a
byte stream with no "done" signal — you decide when a command finished by the
prompt you read back. You bring the device knowledge; these tools only move bytes.

## Connect
1. `list_ports` and pick the USB-serial adapter (FTDI / CP210x / CH340 / PL2303 by VID/PID).
2. `open` at **9600 8N1, no flow control** unless told otherwise.
3. Wake the console: `send` a `\r` with `until` matching a prompt or login, e.g. `[>#:]\s*$|[Ll]ogin:`.
4. Prefer **`send`** for every command (it writes, reads to the prompt, and strips the
   echo in one call). Pass the prompt you expect as `until`. Drop to `write`/`read`
   only for a `login:`/`Password:` exchange or to feed a space to `--More--`.

## Credentials
When the device asks `login:` / `Password:` or for an enable secret, **ask the operator
to type it** — never invent or guess a secret, never echo it back, never store it. Their
input goes to the device, not into this conversation.

## Disable paging first
So long output doesn't stall on `--More--`:
- Cisco IOS/NX-OS: `terminal length 0`
- Junos: `set cli screen-length 0`
- FortiOS: `config system console` → `set output standard` → `end`
If `--More--` still appears, `write` a single space.

## Before you send anything, classify it
- **Safe — just run it:** `show`, `display`, `get`, `ping`, `traceroute`, `dir`, and other read-only diagnostics.
- **Mutating — STOP, say what it changes, get an explicit yes:** entering config mode
  (`configure terminal`, `configure`, `edit`), `set`/`no`/`delete`, interface/ACL/routing
  edits, and especially **persistence**: `write memory`, `copy running-config startup-config`,
  `commit`, `save`.
- **Catastrophic — name exactly what it destroys and require an explicit yes:**
  `reload`, `erase` / `erase startup-config` / `write erase`, `format`, `delete flash:`.

## Don't lock yourself out
Never shut the management or console interface, never change console baud mid-session,
never remove your own access (VTY ACL, `no enable`) without explicit confirmation. Where
the platform supports it, prefer a dead-man's-switch so a bad change auto-reverts:
- Junos: `commit confirmed <minutes>`
- Cisco IOS: `reload in <minutes>` before risky changes, cancel with `reload cancel` after verifying.

## Vendor quick-reference (anchors, not a complete matrix)
- **Cisco IOS/IOS-XE:** `>` user, `#` enable (`enable`), `(config)#` config (`configure terminal` … `end`), save `write memory`.
- **Cisco NX-OS:** similar; `copy running-config startup-config`.
- **Junos:** `>` operational, `#` configure (`configure`), apply `commit` / `commit confirmed`.
- **FortiOS:** `config <area>` … `next`/`end`; no separate enable; `show`/`get` to read.
- **PAN-OS:** `>` operational, `#` configure (`configure`), apply `commit`.
- **Aruba AOS-CX:** `enable` → `configure` → `write memory`.
- **MikroTik RouterOS:** flat `/interface ...` paths; changes apply immediately — confirm before each.

## After a change
Re-`show` the relevant state to confirm the change landed, summarize what you did, and
only then offer to persist it. Persisting is always a separate, explicit step.
