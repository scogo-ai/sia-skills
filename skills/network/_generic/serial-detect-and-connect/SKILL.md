---
name: scogo:serial-detect-and-connect
description: "Use when an operator needs to make first contact with a switch, router, firewall, or AP over a freshly plugged-in serial console cable. Walks through port discovery on macOS/Linux/Windows (the /dev/cu.* or COMx port), opening at 9600 8N1, waking the console safely, draining stale prompts, and the two MCP-specific failure modes seen in production (CR-byte escaping in send, stale-prompt early-match in read/send). Complements scogo:serial-console-ops (the broader runbook) by being the strict, fail-safe initial-connect procedure."
tags: [network, serial, console, device-onboarding, fail-safe, network-ops]
when_to_use:
  - operator just plugged a USB-serial cable into the workstation
  - operator asks to talk to a switch, router, firewall, or AP over serial
  - operator hands over a /dev/cu.* or COMx port and asks how to reach the device
  - the serial MCP connection is failing, returning garbage, or stalling on prompts
mutates: false
metadata:
  version: 1.0.0
author: scogo-ai
---

# Serial device: detect, open, and verify (fail-safe)

You are about to drive a raw serial console through the `serial` MCP tools
(`list_ports`, `open`, `write`, `read`, `send`, `close`). The device's reply
is a byte stream with no "done" signal — you decide a command finished by
the prompt you read back. This skill is the **initial-connect** path. Once
you're in and verified, hand off to `scogo:serial-console-ops` for the
classification / mutating / catastrophic command rules.

> Field-tested against a Cisco Catalyst WS-C2960-24TC-L (IOS 15.0(2)SE11) over
> an FTDI FT232R (VID 0403 / PID 6001) on macOS 14.x. The failure modes called
> out below are the ones that actually bit us on that rig.

**Mindset:** be paranoid. After every tool call, look at the *result*, not
just the absence of an error. Many failures on serial look like "got
something back" but are actually "got my own keystrokes echoed back."

---

## 0. Pre-flight sanity (5 seconds, no tools)

Before you even list ports, ask the operator two things if they weren't
already stated:

1. **What is on the other end of the cable?** (Cisco IOS / NX-OS / Junos /
   FortiOS / PAN-OS / Aruba / MikroTik / other) — affects default prompt
   and whether you need to disable vendor-specific paging.
2. **Are credentials required, or are you already at an enable/admin
   prompt?** Never type a password through this conversation — see
   `scogo:serial-console-ops` § Credentials. If a `login:` /
   `Password:` appears, **stop and ask**.

If the operator says "just connect, you'll see", proceed and identify
from the prompt and `show version` output.

---

## 1. Find the serial port

### macOS (preferred order)

```bash
ls -la /dev/cu.usb* /dev/cu.SLAB* /dev/cu.wch* /dev/cu.FTDI* 2>/dev/null
```

- Use `/dev/cu.*` (call-out), not `/dev/tty.*` (call-in). On macOS the
  call-out device is the right one for talking to a DCE device like a
  switch console.
- Common patterns: `/dev/cu.usbserial-<SERIAL>` (FTDI/CP210x),
  `/dev/cu.SLAB_USBtoUART` (Silicon Labs CP210x),
  `/dev/cu.wchusbserial*` (CH340/CH341),
  `/dev/cu.usbmodem*` (some Prolific / generic).
- If you see both `cu.X` and `tty.X`, use `cu.X`.

Then confirm via the MCP — it gives you VID/PID/manufacturer, which is
the only reliable way to know which chip you're on:

```
serial__list_ports
```

What you want to see: a single line with `manufacturer` populated
(`FTDI`, `Silicon Labs`, `Prolific`, `QinHeng Electronics` for CH340,
etc.) and a stable `serial_number`. If the list is empty or shows only
`debug-console` / `Bluetooth-Incoming-Port` / audio devices, the cable
isn't recognized — check USB connection, drivers, and that no other
process owns the port (`lsof | grep /dev/cu.usbserial-XXXX`).

### Linux

```bash
ls -l /dev/ttyUSB* /dev/ttyACM* 2>/dev/null
# optional: udevadm info -a -n /dev/ttyUSB0 | head -30
```

- Prefer `/dev/ttyUSB0` (FTDI/CP210x/CH340) or `/dev/ttyACM0` (CDC ACM,
  e.g. some Prolific and built-in MCU boards).
- If you get "permission denied", either `sudo` or add the operator to
  the `dialout` group.

### Windows

- The MCP usually surfaces ports as `COM3`, `COM4`, etc. Pick the one
  the USB-serial adapter created (check Device Manager → Ports
  (COM & LPT)). Note the number; the MCP takes the same string.

---

## 2. Open the port

Defaults — use these unless the operator tells you otherwise:

| Field | Value | Why |
|---|---|---|
| `baud_rate` | **9600** | Cisco default; matches almost every console port shipped in the last 20 years. |
| `data_bits` | **8** | Universal default. |
| `parity` | **none** | Universal default. |
| `stop_bits` | **1** | Universal default. |
| `flow_control` | **none** | Console ports don't assert RTS/CTS in normal use; hardware flow control causes more stalls than it prevents. |

> **When to deviate from 9600:** if the device console has been
> reconfigured to a non-default speed (a previous admin ran
> `conf t → line con 0 → speed 115200` and `write mem`), you'll see
> either a blank screen or "garbage characters." If 9600 gives garbage,
> try 19200, then 38400, then 115200 in that order. Document the
> non-default in your session notes — the operator will need to know.

Call:

```
serial__open(baud_rate=9600, data_bits=8, parity="none",
             stop_bits=1, flow_control="none", port="<path>")
```

Capture the `connection_id` — every later call needs it. **If the
adapter enumerates as a different `/dev/cu.*` after a replug, the old
connection_id is dead**; close it and re-open.

---

## 3. Wake the console — and do it the *right* way

This is where most failed sessions die. The goal is to (a) get a clean
prompt in the read buffer, (b) avoid stuffing the input buffer with
literal text, and (c) avoid matching a stale prompt too early on the
next call.

### 3.1 Use the actual CR byte, not the escape sequence

The `serial__send` tool's `data` parameter **does not interpret `\r` /
`\n` as CR/LF**. It sends the literal characters `\` and `r`. We hit
this in production — every "wake" call came back as the literal text
`\r` echoed by the device, and the device was waiting for a real
carriage return that never arrived.

**Workaround:** use `serial__write` with `encoding: "hex"` and append
`0d` (CR) explicitly.

```
# Wake the console with a real CR:
serial__write(connection_id, data="0d", encoding="hex")
```

Encode commands the same way — convert the command text to its hex
bytes, then append `0d` (CR) and send. For example, the command
`show version` is the byte sequence
`73 68 6f 77 20 76 65 72 73 69 6f 6e 0d` — that's
`"73686f772076657273696f6e0d"` as a hex string.

`serial__write` returns `bytes_written`; the device's response comes
back on the *next* call. Use `serial__read` to consume it.

### 3.2 Drain the buffer before your first real command

Waking with `\r` often leaves an extra prompt already sitting in the
buffer. If your next `read`'s `until` regex matches that *stale*
prompt instantly, the call returns empty output and you think the
command did nothing. Rule of thumb: if a reply comes back empty when
you expected output, you matched a stale prompt — drain and resend.

```
# After waking, drain with one read that times out on silence:
serial__read(connection_id, quiet_ms=500, timeout_ms=3000)
```

If you got back garbage (echo of your input, or `?????` characters),
just drain again. The TTY is in line-edit mode; nothing was actually
executed.

---

## 4. Read with a *specific* prompt, not a bare one

A common mistake:

```
# ❌ Too eager — matches (config)#, (config-if)#, anything ending in #:
until = "[>#]\\s*$"
```

This causes the early-match problem: between `conf t` and the next
command, the device prints `(config)#` and your read returns
immediately with `data: ""`. Then the config block you sent in
parallel was actually applied, but you can't tell from the output.

**Use a hostname-anchored prompt** — by the time you're past the wake,
the device has printed `hostname#` or `hostname(config)#` and you can
hard-code it (or at least require the hostname prefix):

```
# ✅ Anchored — only matches the top-level enable prompt:
until = "<hostname>#[ ]?$"        # e.g. "SCOGO_SW1#[ ]?$"
until = "<hostname>\\(config\\)#[ ]?$"   # e.g. "SCOGO_SW1(config)#[ ]?$"
```

If you don't yet know the hostname, use a *non-greedy* full-line match
that excludes the parenthesised sub-prompts:

```
# ✅ Config-submodes usually have "(" in the prompt; enable doesn't:
until = "^[^()\\s]+#[ ]?$"   # bare "SCOGO_SW1#" — not "(config-if)#"
```

### 4.1 If the read times out without matching

Drain with a longer `quiet_ms` and look at what you got. Common cases:

- **Empty**: the device isn't sending anything. Check the cable
  orientation (Cisco console cables are *rollover*, not straight or
  crossover), check the baud rate (see §2), check that the device is
  powered on.
- **Your own input echoed back, no command output**: the device
  hasn't received a CR. You sent a command but the line is sitting in
  the device's input buffer in line-edit mode. Send `0d` explicitly
  via `serial__write(encoding="hex")`.
- **Garbage characters**: baud-rate mismatch. Try 19200 / 38400 /
  115200.

---

## 5. Verify you actually have a working session

Don't trust a single successful command. Run a two-command sanity:

1. A read-only command that produces multi-line output:
   - Cisco IOS / NX-OS: `show version`
   - Junos: `show version`
   - FortiOS: `get system status`
   - PAN-OS: `show system info`
   - Aruba AOS-CX: `show system`
2. A paging-disabling command (if applicable):
   - Cisco IOS / NX-OS: `terminal length 0`
   - Junos: `set cli screen-length 0`
   - FortiOS: `config system console` → `set output standard` → `end`

If `show version` returns a clean platform banner with model + serial +
uptime, you have a working session. If `--More--` appears (paging on),
send a single space via `serial__write(encoding="hex", data="20")` to
page through, or set `terminal length 0` first and re-run.

---

## 6. After verification — hand off to the runbook

You are now at a known-good prompt on a known device. From here, the
rules in `scogo:serial-console-ops` apply:

- **Classify before sending** — safe (show / ping) / mutating
  (configure terminal, set, no) / catastrophic (reload, write erase,
  format).
- **Re-`show` after every change** to confirm the change landed.
- **Persistence is a separate step** — `write memory` /
  `copy run start` requires explicit operator consent. Never bundle
  it into a config change.
- **Don't lock yourself out** — no edits to the console line, VTY
  ACL, enable secret, or AAA config without the operator naming the
  change.

---

## Failure-mode cheat sheet

| Symptom | Most likely cause | Fix |
|---|---|---|
| `list_ports` returns nothing for the adapter | Cable not seated / driver missing / port held by another process | Re-plug USB, check `lsof \| grep cu.usb*`, install FTDI VCP driver on Windows |
| `open` succeeds but `read` returns empty | Stale prompt in the buffer; `until` matched it | Drain with `read(quiet_ms=500)`, then retry |
| `read` returns your own command as echoed text | CR byte never sent — line sitting in TTY line-edit | Send `0d` explicitly via `write(encoding="hex")` |
| `read` returns `\\r` as two literal characters | You used `data="\\r"` through `send` — escape not interpreted | Switch to `write(encoding="hex", data="0d")` |
| Garbage characters in `read` output | Baud-rate mismatch | Try 19200, 38400, 115200 |
| `--More--` prompt blocks output | Paging on | `terminal length 0` (IOS/NX-OS), then re-run |
| `read` returns immediately with empty data after a config block | `until` matched an intermediate `(config)#` prompt | Use hostname-anchored regex; drain and verify with `show run` |
| `login:` or `Password:` appears | Device requires credentials | **Stop.** Ask the operator. Never type a secret through the conversation. |
| `% Invalid input detected at '^' marker.` | The device received multiple lines concatenated and tried to parse them as one | Send one command per `write`, wait for prompt, send the next. Or accept that the input is one malformed line, fix it, and resend. |
| `% Ambiguous command` | Command is truncated or you dropped characters | Re-type; the device is fine |

---

## Closing the session

When the operator is done:

```
serial__close(connection_id)
```

**Don't close prematurely.** If you close while the operator still
expects to read output, the next `read` fails. Conversely, if you
walk away from a session without closing, the port stays open and no
one else can use the adapter.

If the device is left in a partial-config state (i.e., changes were
made but not saved), call this out explicitly to the operator — those
changes are in RAM only and will be lost on reload.

---

## Quick reference card

```
1. list_ports                         # find the adapter, confirm VID/PID
2. open(port=…, baud=9600, 8N1, none) # connection_id
3. write("0d", encoding="hex")        # wake with real CR
4. read(quiet_ms=500)                 # drain stale prompt
5. write("<cmd-hex>0d", encoding="hex")   # one command
6. read(until="<hostname>#[ ]?$")     # wait for top-level prompt
7. terminal length 0 + show version   # disable paging + verify
8. …work…
9. close(connection_id)               # release the port
```

If anything in step 1–7 doesn't behave as expected, the failure-mode
cheat sheet above covers the cases we hit in production. When in
doubt: drain, re-send, and look at what the device is *actually*
saying.
