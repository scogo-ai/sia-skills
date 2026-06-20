# ER605 Configuration Completion Report

**Device:** {{device_id}} — {{site_name}}
**Date:** {{date}}
**Performed by:** {{operator}}
**Overall result:** {{overall_status}}  <!-- COMPLETED / COMPLETED WITH NOTES / NEEDS REVIEW -->

---

## 1. Device

| Field | Value |
|-------|-------|
| Model | {{model}} |
| Hardware version | {{hw_version}} |
| Firmware version | {{fw_version}} |
| Serial number | {{serial}} |
| Management IP (final) | {{lan_ip}} |

## 2. WAN

| Field | Value | Status |
|-------|-------|--------|
| Type | {{wan_type}} | {{wan_status}} |
| IP / Mask | {{wan_ip}} / {{wan_mask}} | |
| Gateway | {{wan_gateway}} | |
| DNS | {{primary_dns}}, {{secondary_dns}} | |

## 3. LAN & DHCP

| Field | Value |
|-------|-------|
| LAN IP / Mask | {{lan_ip}} / {{lan_mask}} |
| DHCP range | {{dhcp_start}} – {{dhcp_end}} |
| DHCP gateway / DNS | {{lan_ip}} / {{dns_server}} |
| DHCP status | {{dhcp_status}} |

## 4. IPsec VPN

| Field | Value |
|-------|-------|
| Policy | {{policy_name}} |
| Remote gateway | {{remote_gateway}} |
| Local / Remote network | {{local_network}} / {{remote_network}} |
| Pre-shared key | {{psk_masked}} (applied: {{psk_applied}}) |
| Phase 1 | {{ike_version}} / {{exchange_mode}} / {{p1_encryption}}-{{p1_auth}}-{{dh_group}}, lifetime {{p1_lifetime}}s, DPD {{dpd}} |
| Phase 2 | {{protocol}} / {{p2_encryption}}-{{p2_auth}}, PFS {{pfs}}, lifetime {{p2_lifetime}}s |
| **Phase 1 status** | {{phase1_status}} |
| **Phase 2 status** | {{phase2_status}} |
| **Tunnel status** | {{tunnel_status}} |

## 5. Connectivity validation

| Target | Result |
|--------|--------|
| Remote gateway ({{remote_gateway}}) | {{ping_gateway}} |
| Remote LAN gateway | {{ping_lan_gateway}} |
| Remote server / application | {{ping_server}} |

## 6. Backup

| Field | Value |
|-------|-------|
| Configuration backup | {{backup_file}} |

## 7. Notes / items needing attention

{{notes}}

---

### Success criteria

- [{{chk_wan}}] WAN connected
- [{{chk_lan}}] LAN configured
- [{{chk_dhcp}}] DHCP running
- [{{chk_vpn}}] IPsec tunnel connected (Phase 1 & 2 UP)
- [{{chk_reach}}] Remote network reachable
- [{{chk_backup}}] Configuration backup saved

*Secrets (admin password, pre-shared key) are intentionally redacted in this report.*
