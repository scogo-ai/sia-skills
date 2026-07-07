# Installing and configuring `pc` (pve-cli)

Read this only when `pc` is not yet installed/configured on the current machine. If it is, go back to SKILL.md §1.

## Contents

- [What you are installing](#what-you-are-installing)
- [Install the binary](#install-the-binary)
- [Configure profiles & contexts](#configure-profiles--contexts-the-setup-that-takes-the-time)
- [Alternative: interactive `pc auth login`](#alternative-interactive-pc-auth-login-keyring-instead-of-inline)
- [Verify the install is ready](#verify-the-install-is-ready)

## What you are installing

- **`pve-cli`** — the Go binary, installed command name **`pc`**. Source: https://github.com/ciroiriarte/pve-cli. Unofficial, community-maintained, not affiliated with Proxmox.
- It is a **remote REST client** — nothing is installed on the Proxmox cluster nodes. It talks to the PVE API over HTTPS (port 8006) using an API token.
- **Before you start:** on each Proxmox server, create an API token: **Datacenter → Permissions → API Tokens → root@pam → Add**. Note the full token string in the form `root@pam!<token-name>=<secret-uuid>`. Uncheck "Privilege Separation" if you want the token to inherit root's full permissions.

## Install the binary

Pick **one** method per machine. The GitHub Releases method works on every platform and is the fastest; the OS-package methods give you `pc` managed by your system package manager.

### A. macOS — GitHub Releases binary

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

### B. Linux — GitHub Releases static binary (any distro, fastest)

```sh
VER=$(curl -fsSL https://api.github.com/repos/ciroiriarte/pve-cli/releases/latest | sed -nE 's/.*"tag_name": *"v([^"]+)".*/\1/p')
ARCH=$(uname -m)   # x86_64 or aarch64
[ "$ARCH" = "aarch64" ] && ARCH=arm64
curl -fsSL "https://github.com/ciroiriarte/pve-cli/releases/download/v${VER}/pve-cli_${VER}_linux_${ARCH}.tar.gz" | tar xz pc
sudo install -m0755 pc /usr/local/bin/pc
pc version
```

### C. Linux — distro packages via OBS (managed upgrades)

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

### D. Windows — GitHub Releases zip

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

### E. From source (any platform with Go ≥ 1.22)

```sh
git clone https://github.com/ciroiriarte/pve-cli && cd pve-cli
make build           # produces ./pc
sudo install -m0755 pc /usr/local/bin/pc   # or ~/.local/bin/pc
# or, without cloning: go install github.com/ciroiriarte/pve-cli/cmd/pc@latest
```

## Configure profiles & contexts (the setup that takes the time)

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

## Alternative: interactive `pc auth login` (keyring instead of inline)

If you prefer secrets in the OS keyring (macOS Keychain / Secret Service / WinCred) over an inline plaintext file, run per server — it writes the profile, stores the secret, and pins the TLS fingerprint in one go:
```sh
pc auth login https://<host>:8006 --token-id 'root@pam!sia-token'   # prompts for the secret + trust prompt
```
**Caveat for agent-driven hosts:** the keyring may be absent or locked on headless machines/CI, which breaks non-interactive runs. The inline `secret:` approach above is the reliable default for agents.

## Verify the install is ready

```sh
command -v pc                         # binary on PATH
pc version                            # prints version + supported PVE releases
pc context list                       # all configured servers
pc --context srv1 config test-auth    # live auth check per server
pc --context srv1 node list           # first real management call
```

Once this passes, return to SKILL.md §1 to target the right server for the task at hand.
