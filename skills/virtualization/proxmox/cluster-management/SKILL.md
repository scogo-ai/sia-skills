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
  version: 1.1.0
author: scogo-ai
---

# Proxmox VE Management Skill

This skill governs how an AI agent manages Proxmox Virtual Environment (PVE) clusters using the `pc` CLI (pve-cli, binary name `pc`). The CLI talks to the Proxmox REST API over HTTPS — nothing is installed on the cluster nodes, and the web UI / SSH are not needed for any operation covered here.

## 0. Installation & setup

If `pc` is already installed and configured, skip to [§1 Profiles and contexts](#1-profiles-and-contexts-multiple-servers). This section is for bringing a fresh machine (Windows / Linux / macOS) from zero to a working multi-server setup.

### 0.1 What you are installing

- **`pve-cli`** — the Go binary, installed command name **`pc`**. Source: https://github.com/ciroiriarte/pve-cli. Unofficial, community-maintained, not affiliated with Proxmox.
- It is a **remote REST client** — nothing is installed on the Proxmox cluster nodes. It talks to the PVE API over HTTPS (port 8006) using an API token.
- **Before you start:** on each Proxmox server, create an API token: **Datacenter → Permissions → API Tokens → root@pam → Add**. Note the full token string in the form `root@pam!<token-name>=<secret-uuid>`. Uncheck "Privilege Separation" if you want the token to inherit root's full permissions.

### 0.2 Install the binary

Pick **one** method per machine. The GitHub Releases method works on every platform and is the fastest; the OS-package methods give you `pc` managed by your system package manager.

#### A. macOS (this machine's method) — GitHub Releases binary

```sh
# Resolve the latest version dynamically (asset names are versioned).
VER=$(curl -fsSL https://api.github.com/repos/ciroiriarte/pve-cli/releases/latest | sed -nE 's/.*"tag_name": *"v([^"]+)".*/\1/p')
ARCH=$(uname -m)   # arm64 on Apple Silicon, x86_64 on Intel
[ "$ARCH" = "x86_64" ] && ARCH=amd64
mkdir -p ~/.local/bin
curl -fsSL "https://github.com/ciroiriarte/pve-cli/releases/download/v${VER}/pve-cli_${VER}_darwin_${ARCH}.tar.gz" | tar xz pc
install -m0755 pc ~/.local/bin/pc
xattr -dr com.apple.quarantine ~/.local/bin/pc 2>/dev/null || true   # clear macOS quarantine
pc version
```

> `~/.local/bin` is on macOS `$PATH` by default on recent systems. If `pc` is not found, add `export PATH="$HOME/.local/bin:$PATH"` to `~/.zshrc`.

#### B. Linux — GitHub Releases static binary (any distro, fastest)

```sh
VER=$(curl -fsSL https://api.github.com/repos/ciroiriarte/pve-cli/releases/latest | sed -nE 's/.*"tag_name": *"v([^"]+)".*/\1/p')
ARCH=$(uname -m)   # x86_64 or aarch64
[ "$ARCH" = "aarch64" ] && ARCH=arm64
curl -fsSL "https://github.com/ciroiriarte/pve-cli/releases/download/v${VER}/pve-cli_${VER}_linux_${ARCH}.tar.gz" | tar xz pc
sudo install -m0755 pc /usr/local/bin/pc
pc version
```

#### C. Linux — distro packages via OBS (managed upgrades)

Native `.deb`/`.rpm` packages are published on openSUSE's OBS. Supported: Debian 13, Ubuntu 24.04, Rocky 9/10, openSUSE Leap 15.6/16.0/Slowroll/Tumbleweed (x86_64 + aarch64). **For Debian 12 / Ubuntu 22.04 / any other distro, use method B instead** (stock Go < 1.22 blocks the native build; the static binary runs everywhere).

**Debian 13 / Ubuntu 24.04 (apt):**
```sh
# replace Debian_13 with xUbuntu_24.04 on Ubuntu
curl -fsSL https://download.opensuse.org/repositories/home:/ciriarte:/pve-cli/Debian_13/Release.key \
  | gpg --dearmor | sudo tee /usr/share/keyrings/pve-cli.gpg > /dev/null
echo 'deb [signed-by=/usr/share/keyrings/pve-cli.gpg] https://download.opensuse.org/repositories/home:/ciriarte:/pve-cli/Debian_13/ /' \
  | sudo tee /etc/apt/sources.list.d/pve-cli.list
sudo apt update && sudo apt install pve-cli
```

**Rocky / RHEL (dnf):**
```sh
# replace Rocky_10 with Rocky_9 as needed
sudo dnf install -y dnf-plugins-core
sudo dnf config-manager --add-repo \
  https://download.opensuse.org/repositories/home:/ciriarte:/pve-cli/Rocky_10/home:ciriarte:pve-cli.repo
sudo dnf install -y pve-cli
```

**openSUSE (zypper):**
```sh
# replace openSUSE_Leap_15.6 with your version
sudo zypper addrepo \
  https://download.opensuse.org/repositories/home:/ciriarte:/pve-cli/openSUSE_Leap_15.6/home:ciriarte:pve-cli.repo
sudo zypper --gpg-auto-import-keys refresh
sudo zypper install pve-cli
```

#### D. Windows — GitHub Releases zip

Download from PowerShell:
```powershell
$ProgressPreference='SilentlyContinue'
$rel = Invoke-RestMethod https://api.github.com/repos/ciroiriarte/pve-cli/releases/latest
$ver = $rel.tag_name.TrimStart('v')
$arch = if ([Environment]::Is64BitOperatingSystem) { 'amd64' } else { 'arm64' }
Invoke-WebRequest "$($rel.assets | ? name -eq "pve-cli_$($ver)_windows_$arch.zip").browser_download_url" -OutFile pc.zip
Expand-Archive pc.zip -DestinationPath $env:LOCALAPPDATA\pc -Force
# add to PATH for the current session:
$env:Path += ";$env:LOCALAPPDATA\pc"
# to make it permanent, run: setx PATH "$env:PATH;$env:LOCALAPPDATA\pc"
pc version
```

#### E. From source (any platform with Go ≥ 1.22)

```sh
git clone https://github.com/ciroiriarte/pve-cli && cd pve-cli
make build           # produces ./pc
sudo install -m0755 pc /usr/local/bin/pc   # or ~/.local/bin/pc
# or, without cloning: go install github.com/ciroiriarte/pve-cli/cmd/pc@latest
```

### 0.3 Configure profiles & contexts (the setup that takes the time)

After the binary is installed, create the config file holding all your Proxmox servers. The default location is `${XDG_CONFIG_HOME:-~/.config}/pve-cli/config.yaml` (on Windows: `%LOCALAPPDATA%\pve-cli\config.yaml`; override with the `PVE_CLI_CONFIG` env var).

**Recommended for AI agents: store tokens inline in the file** (mode 600) so commands run with no shell exports, no keyring, no prompts. `pc` will print a `plaintext secret in config` warning on each run — this is expected and harmless; it is the tradeoff for zero-prompt agent access.

Create the file with one `profile` + one `context` per Proxmox server:

```yaml
current_context: srv1
contexts:
  srv1: { profile: srv1 }
  srv2: { profile: srv2 }
profiles:
  srv1:
    provider: pve                                  # pve for a cluster, pdm for a PDM fleet
    server: https://10.10.60.13:8006
    auth:
      type: token                                  # token (recommended) or ticket
      token_id: "root@pam!sia-token"               # format: user@realm!tokenname
      secret: "50a1f38c-b866-4fd9-af1b-23c8fcb5e664"   # the token's secret UUID
    tls:
      verify: false                                # false for self-signed lab certs; prefer fingerprint pinning in production
    defaults:
      output: table
  srv2:
    provider: pve
    server: https://10.10.60.23:8006
    auth:
      type: token
      token_id: "root@pam!sia-token"
      secret: "5ac04fa8-2bca-4f0c-941a-db37fdb87aa4"
    tls:
      verify: false
    defaults:
      output: table
```

Then lock down permissions and verify each server:
```sh
chmod 600 ~/.config/pve-cli/config.yaml
pc --context srv1 config test-auth   # must print "probe: OK"
pc --context srv2 config test-auth
pc context list                     # * marks the default
```

**If `test-auth` returns `HTTP 401`**, the token secret is wrong/rotated on that server — regenerate it in the PVE UI (Datacenter → Permissions → API Tokens) and update the `secret:` value. **If it returns a TLS error**, keep `tls.verify: false` or pin the fingerprint with `pc auth login` (interactive, stores secret in the OS keyring instead of inline).

### 0.4 Alternative: interactive `pc auth login` (keyring instead of inline)

If you prefer secrets in the OS keyring (macOS Keychain / Secret Service / WinCred) over an inline plaintext file, run per server — it writes the profile, stores the secret, and pins the TLS fingerprint in one go:
```sh
pc auth login https://<host>:8006 --token-id 'root@pam!sia-token'   # prompts for the secret + trust prompt
```
**Caveat for agent-driven hosts:** the keyring may be absent or locked on headless machines/CI, which breaks non-interactive runs. The inline `secret:` approach in §0.3 is the reliable default for agents.

### 0.5 Verify the install is ready

```sh
command -v pc                         # binary on PATH
pc version                            # prints version + supported PVE releases
pc context list                       # all configured servers
pc --context srv1 config test-auth    # live auth check per server
pc --context srv1 node list           # first real management call
```

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

Do not assume these are the only servers — always run `pc context list` to discover the live set.

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

### 3.3 Create, clone, resize, migrate, template

```sh
pc --context srv1 vm create --node srv1-pve --name web-01 --cores 4 --memory 4096
pc --context srv1 vm clone 9001 200 --name web-02 --full --storage local-lvm --wait
pc --context srv1 vm config 200 --set cores=8 --set memory=8192   # modify config
pc --context srv1 vm resize 101 --disk scsi0 --size +10G
pc --context srv1 vm migrate 101 --target-node srv2-pve --online
pc --context srv1 vm template 101              # convert VM → template
```

### 3.4 Snapshots

```sh
pc --context srv1 vm snapshot list 101
pc --context srv1 vm snapshot create 101 pre-upgrade
pc --context srv1 vm snapshot rollback 101 pre-upgrade
pc --context srv1 vm snapshot delete 101 pre-upgrade
# cluster-wide:
pc --context srv1 snapshot list
pc --context srv1 snapshot prune --older-than 30d
```

### 3.5 Guest agent (in-guest visibility — requires agent installed)

```sh
pc --context srv1 vm agent ping 101            # is the agent alive?
pc --context srv1 vm agent osinfo 101          # OS distro/version/kernel
pc --context srv1 vm agent network 101         # guest NIC IPs
pc --context srv1 vm agent exec 101 -- /usr/bin/uptime
pc --context srv1 vm agent fstrim 101
```

### 3.6 Containers (LXC) — same grammar as VMs

```sh
pc --context srv1 ct list
pc --context srv1 ct show 201
pc --context srv1 ct start 201 ; pc --context srv1 ct stop 201 --yes
pc --context srv1 ct clone 201 202 --name sidecar
pc --context srv1 ct config 201 --set cores=2
pc --context srv1 ct snapshot create 201 pre-upgrade
```

### 3.7 Nodes

```sh
pc --context srv1 node show srv1-pve
pc --context srv1 node network                 # NICs
pc --context srv1 node service list            # pveproxy, pvedaemon, etc.
pc --context srv1 node service restart pveproxy
pc --context srv1 node apt updates             # pending package updates
pc --context srv1 node subscription            # subscription status
```

### 3.8 Storage & backups

```sh
pc --context srv1 storage status --node srv1-pve
pc --context srv1 storage prune-backups local --keep-last 7
pc --context srv1 backup create --vmid 101 --storage local --mode snapshot
pc --context srv1 backup list --storage local
pc --context srv1 backup job list              # scheduled backup jobs
pc --context srv1 backup job create --set vmid=101 --set storage=local --set mode=snapshot
```

### 3.9 Firewall (cluster / node / guest scope)

```sh
pc --context srv1 firewall rules                       # cluster scope
pc --context srv1 firewall rules --node srv1-pve        # node scope
pc --context srv1 firewall rules --vmid 101             # guest scope
pc --context srv1 firewall rule add --node srv1-pve -d type=in,proto=tcp,dport=443,action=ACCEPT,comment="HTTPS"
pc --context srv1 firewall rule delete --node srv1-pve <pos>
pc --context srv1 firewall ipset ; pc --context srv1 firewall aliases ; pc --context srv1 firewall options
```

### 3.10 Networking (SDN)

```sh
pc --context srv1 sdn zone list ; pc --context srv1 sdn vnet list ; pc --context srv1 sdn subnet list
pc --context srv1 sdn zone create --set zone=myzone --set type=simple
pc --context srv1 sdn vnet create --set vnet=myvnet --set zone=myzone
pc --context srv1 sdn apply                      # reload pending SDN config
```

### 3.11 High Availability

```sh
pc --context srv1 ha status
pc --context srv1 ha resource list ; pc --context srv1 ha groups
pc --context srv1 ha resource add --vmid 101 --group mygroup
pc --context srv1 ha resource remove 101
```

### 3.12 Ceph

```sh
pc --context srv1 ceph health ; pc --context srv1 ceph status
pc --context srv1 ceph osd-tree ; pc --context srv1 ceph pools
pc --context srv1 ceph pool create --node srv1-pve --set name=mydata --set pg_num=128
pc --context srv1 ceph osd out --node srv1-pve <osd-id>   # writes need --node
```

### 3.13 Access control (users, tokens, roles, ACLs)

```sh
pc --context srv1 access user list ; pc --context srv1 access roles ; pc --context srv1 access permissions
pc --context srv1 access token list root@pam
pc --context srv1 access acl list
pc --context srv1 access acl set --path /vms/101 --roles PVEVMAdmin --ids svc@pve
```

### 3.14 Tasks, pools, tags, PBS

```sh
pc --context srv1 task list ; pc --context srv1 task show <UPID> ; pc --context srv1 task log <UPID> ; pc --context srv1 task wait <UPID>
pc --context srv1 pool list ; pc --context srv1 pool create --pool dev
pc --context srv1 tag list ; pc --context srv1 tag add --vmid 101 --tag web
pc --context srv1 pbs remotes ; pc --context srv1 pbs status
```

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
