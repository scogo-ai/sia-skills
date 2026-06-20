# IPsec parameters — ER605, with the corrections the original runbook got wrong

This is the detail behind step 5 of the workflow. Read it before filling Phase 1.

## The one that silently breaks tunnels: Main Mode + custom ID

IKEv1 has two Phase-1 exchange modes:

- **Main Mode** — the peer's identity (ID payload) is sent **after** the Diffie-Hellman key is
  derived, in encrypted messages 5–6. With a **pre-shared key**, the responder must therefore look
  up which PSK to use by the only thing it knows that early: the peer's **source IP address**.
  Consequence: in Main Mode + PSK, the peer ID effectively *must be the IP address*. A custom
  Local/Remote ID of FQDN, email, or key-id type **will not negotiate**.
- **Aggressive Mode** — the ID is sent in the clear in the very first packet, so the responder can
  select the PSK by ID. This is what you use when you need non-IP identifiers (e.g. dynamic-IP
  peers identified by FQDN).

The original runbook set **Main Mode** *and* custom `Local ID` / `Remote ID`. That combination
fails. Resolution, pick one:

1. **Keep Main Mode** and set `local_id` / `remote_id` to the actual peer **IP addresses** (or
   leave them at the IP default). Preferred when both ends have static public IPs.
2. **Switch to Aggressive Mode** if a side has a dynamic IP and must be identified by FQDN. Note
   Aggressive Mode leaks the ID and is weaker against offline PSK cracking — use a long, random PSK.

`validate_devices.py` flags Main + non-IP ID as `FAIL`. Don't override it without fixing one of the
two ends.

## Phase 1 (IKE) — recommended values

| Field         | Value     | Why |
|---------------|-----------|-----|
| Exchange Mode | `Main`    | Stronger; valid because IDs are the peer IPs (see above). |
| IKE Version   | `IKEv1`   | Matches the existing peer config. IKEv2 is also supported by the ER605 if both ends use it. |
| Encryption    | `aes256`  | UI shows lowercase. |
| Authentication| `sha256`  | UI labels it `sha256`, **not** "SHA2-256" — match the literal value. |
| DH Group      | `dh14`    | 2048-bit MODP. |
| Lifetime      | `28800`   | 8 h, conventional for Phase 1. |
| DPD           | `Enable`  | Detects a dead peer and tears down/re-keys. |

On the ER605 these often appear as a combined proposal string like `sha256-aes256-dh14`. If the UI
presents a proposal dropdown rather than separate fields, pick the proposal matching these three.

## Phase 2 (IPsec) — recommended values

| Field         | Value     | Why |
|---------------|-----------|-----|
| Protocol      | `ESP`     | Encryption + integrity. |
| Encryption    | `aes256`  | |
| Authentication| `sha256`  | |
| PFS           | `dh14`    | The runbook disabled PFS. **Don't.** PFS gives each rekey a fresh DH exchange, so compromise of one key doesn't expose past/future sessions. Set it to `dh14` to match Phase 1 — *provided the remote peer also enables PFS with the same group*, or the tunnel won't establish. |
| Lifetime      | `3600`    | 1 h, conventionally shorter than Phase 1. |

## Both ends must agree

A tunnel only comes up if Phase 1 and Phase 2 proposals, PSK, PFS setting, and the local/remote
network selectors **match on both peers**. If you change PFS or an algorithm here, the far side must
match. When a tunnel won't reach "Phase 2 UP", a mismatch in one of these is the usual cause — read
the IPsec status/log on the ER605 and mark the device `needs_review` rather than reporting success.

## Quick reference: what each value looks like in the UI

- Encryption: `aes128`, `aes192`, `aes256`, `3des`, `des`
- Auth: `md5`, `sha1`, `sha256`, `sha384`, `sha512`
- DH / PFS group: `dh1`, `dh2`, `dh5`, `dh14`, `dh15`, `dh16`, … plus `none` (PFS off)
