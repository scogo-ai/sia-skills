---
name: scogo:proxmox-cluster-management
description: "Use when an operator needs to manage a Proxmox VE cluster through the `pc` CLI (pve-cli) instead of the web UI or SSH — listing, creating, cloning, resizing, or migrating VMs and containers, taking snapshots, running backups, checking node and storage health, editing firewall or SDN rules, managing HA and Ceph, or reaching any Proxmox REST API endpoint directly. Covers multi-server profile setup so the agent targets the correct cluster, JSON output for scripting, and safety rules for destructive operations."
tags: [virtualization, proxmox, pve, vm, lxc, admin, devops, infrastructure, cli]
when_to_use:
  - manage VMs or LXC containers on a Proxmox VE cluster
  - take snapshots, run backups, or check node/storage status on Proxmox
  - configure Proxmox firewall, SDN, HA, or Ceph via the pc CLI
  - set up pc/pve-cli profiles for one or more Proxmox servers
mutates: true
metadata:
  version: 1.2.0
author: scogo-ai
---

# Proxmox VE Management Skill

This skill governs how an AI agent manages Proxmox Virtual Environment (PVE) clusters using the `pc` CLI (pve-cli, binary name `pc`). The CLI talks to the Proxmox REST API over HTTPS — nothing is installed on the cluster nodes, and the web UI / SSH are not needed for any operation covered here.

## 0. Installation & setup

**State-check first:** run `command -v pc && pc context list`. If `pc` is on `PATH` and at least one context is listed, it's already installed and configured — skip to [§1 Profiles and contexts](#1-profiles-and-contexts-multiple-servers).

If not, read [references/INSTALLATION.md](references/INSTALLATION.md) for the full walkthrough: installing the `pc` binary on macOS/Linux/Windows, creating an API token on each Proxmox server, and writing the multi-server `config.yaml` (contexts + profiles). Come back here once `pc --context <name> config test-auth` prints `probe: OK`.

## 1. Profiles and contexts (multiple servers)

More than one Proxmox server may be configured. **Always determine which server to target before running commands.** Profiles are named contexts in the config file.

### Discover available servers

```sh
pc context list          # lists all contexts; * marks the current default
pc config view           # full config (secrets redacted) — shows server URLs
```

### Target a specific server

Two equivalent patterns — pick based on whether you need one command or a series:

```sh
# (A) Explicit per command — safest, no state to reset:
pc --context srv1 node list
pc --context srv2 vm list

# (B) Switch the default context for a run, then restore it:
pc context use srv2
pc vm list               # now hits srv2
pc context use srv1      # restore previous default when done
```

**Agent rule:** If a task names a server (e.g. "on srv2"), use `--context <name>` explicitly rather than switching the default — this avoids leaving the default changed for the next task. Only use `pc context use` when issuing many commands against one server in a single run, and always restore the prior default at the end.

### Adding a new server later

Append a new profile + context block to `~/.config/pve-cli/config.yaml`:

```yaml
contexts:
  srv3: { profile: srv3 }
profiles:
  srv3:
    provider: pve
    server: https://<IP>:8006
    auth:
      type: token
      token_id: "root@pam!<token-name>"
      secret: "<token-secret-uuid>"
    tls:
      verify: false
    defaults:
      output: table
```

Then verify with `pc --context srv3 config test-auth`.

### Current configured servers (as of skill authoring)

| Context | IP            | Node name   | Notes                       |
|---------|---------------|-------------|-----------------------------|
| srv1    | 10.10.60.13   | srv1-pve    | PVE 9.0.3                   |
| srv2    | 10.10.60.23   | srv2-pve    |                             |

This table can go stale — treat `pc context list` as the live source of truth.

## 2. Output formats (for scripting and parsing)

`pc` auto-detects TTY: human-readable tables when interactive, JSON when piped. Force a format with `-o`:

```sh
pc vm list                    # table (human)
pc vm list -o json            # JSON (always, even on TTY)
pc vm list -o json | jq '.[].name'
pc vm list -c vmid -c name -c status -o value   # headerless columns for awk/xargs
pc vm list -o yaml
```

**Agent preference:** use `-o json` and pipe through `jq` for reliable parsing; use the table form only when showing output to a human.

## 3. Top admin & DevOps command reference

Grouped by domain. All examples use `--context srv1`; swap for the target server. Replace `<vmid>` / `<node>` with real values.

### 3.1 Inventory & overview (read-only, start here)

```sh
pc --context srv1 node list            # cluster nodes, CPU/mem/uptime
pc --context srv1 guest list           # all VMs + containers, unified
pc --context srv1 vm list              # VMs only
pc --context srv1 vm list --status running
pc --context srv1 ct list              # containers only
pc --context srv1 storage list         # storage pools + usage
pc --context srv1 storage content      # ISOs, templates, backups
pc --context srv1 task list            # recent cluster tasks (UPIDs)
```

### 3.2 VM lifecycle & configuration

```sh
pc --context srv1 vm show 101                  # full config + live status
pc --context srv1 vm status 101                # runtime status only
pc --context srv1 vm config 101                # raw config (--set to modify)
pc --context srv1 vm start 101                 # start (waits by default)
pc --context srv1 vm shutdown 101              # graceful ACPI shutdown
pc --context srv1 vm stop 101 --yes            # hard stop (destructive → --yes)
pc --context srv1 vm reboot 101
pc --context srv1 vm reset 101 --yes           # hard reset
pc --context srv1 vm suspend 101 ; pc --context srv1 vm resume 101
pc --context srv1 vm delete 101 --yes          # delete (destructive)
```

### 3.3 Everything else: create/clone/migrate, snapshots, containers, nodes, storage, firewall, SDN, HA, Ceph, access control, tasks/pools/tags/PBS

Read [references/COMMAND-REFERENCE.md](references/COMMAND-REFERENCE.md) for the full command grammar for these domains — it's the same `--context <name> <noun> <verb>` pattern shown above, just enumerated per domain so you don't have to guess flag names.

## 4. The escape hatches (full API coverage)

When no curated command fits, reach any of the 675 PVE endpoints two ways.

### `pc raw` — schema-driven discovery (preferred when exploring)

Walks the live API tree, so you don't need to memorize exact paths:

```sh
pc --context srv1 raw                                    # top-level segments
pc --context srv1 raw nodes                              # /nodes children
pc --context srv1 raw nodes srv1-pve qemu 100 status current    # GET, shows params
pc --context srv1 raw nodes srv1-pve qemu 100 config --method POST -d cores=4
pc --context srv1 raw nodes srv1-pve qemu --help         # describe endpoint methods + params
```

### `pc api` — direct call by path

Faster when you already know the path:

```sh
pc --context srv1 api GET /cluster/resources
pc --context srv1 api GET /nodes/srv1-pve/qemu
pc --context srv1 api POST /nodes/srv1-pve/qemu/100/status/start   # mutating → prompts (use --yes in scripts)
pc --context srv1 api POST /nodes/srv1-pve/qemu/100/config --data cores=4 --data memory=4096
```

## 5. Safety & destructive operations

- **Confirm before mutating.** Destructive commands (`stop`, `reset`, `delete`, `rollback`, `rule delete`, `osd out`, etc.) prompt by default. In scripts pass `--yes`, but an agent acting for a human **must state what it is about to do and why, then proceed only on confirmation** — unless `--yolo` / an approved runbook is in effect.
- **Prefer `shutdown` over `stop`.** `shutdown` is graceful (ACPI); `stop` is a hard power-cut.
- **Always include `--context`.** A wrong context silently targets a different cluster. Treat `--context` as the first flag on every command.
- **Verify before acting.** Before a mutating op, run a read (`vm show`, `vm status`) to confirm the target VMID/name matches intent.
- **Snapshots before risky changes.** `vm snapshot create <vmid> pre-<change>` before config edits, migrations, or upgrades.
- **Long tasks:** mutating ops support `--wait` (default), `--no-wait`, `--wait-timeout`. For batch work, `--no-wait` then poll with `pc task wait <UPID>`.
- **The `plaintext secret in config` warning** on each run is expected (tokens stored inline for agent-friendly, zero-prompt access). It is not an error.

## 6. Standard operating procedure for an agent

1. **Discover servers:** `pc context list` — pick the context the task names, or ask the operator which server if ambiguous.
2. **Survey current state** (read-only) before changing anything: `node list`, `vm list`/`guest list`, `vm show <id>`.
3. **Plan** the change; if destructive, snapshot first and state intent to the operator.
4. **Execute** with explicit `--context` and `--yes` only when intentionally bypassing prompts.
5. **Verify** the result: re-run the relevant read command; for async tasks, `pc task show/wait <UPID>`.
6. **Report** what changed, on which server, in one or two sentences.

## 7. Quick troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `HTTP 401` / `authentication failed` | token secret wrong/rotated on that server | regenerate token in PVE UI (Datacenter → Permissions → API Tokens), update `secret:` under that profile in config, `pc --context <x> config test-auth` |
| `HTTP 403` / permission denied | token lacks privilege on the path | grant ACL/role, or check token's "privilege separation" setting |
| TLS / certificate error | self-signed cert not trusted | profile already sets `tls.verify: false`; if still failing add `--insecure` or pin `--tls-fingerprint` |
| `connection refused` / timeout | server unreachable or 8006 blocked | `nc -z <ip> 8006` to check reachability |
| command not found `pc` | not on PATH | `export PATH="$HOME/.local/bin:$PATH"` |

Always verify a fix with `pc --context <x> config test-auth`.
