---
name: scogo:netapp-reporting
description: "Use when an operator asks for a NetApp/ONTAP capacity, performance, or aggregate-utilisation report. Pulls metrics via the netapp MCP (Active IQ Unified Manager / ONTAP REST), produces a tabular summary plus the top capacity risks. Read-only — never mutates."
tags: [storage, netapp, reporting, capacity-planning, read-only]
compatibility: "ontap>=9.10"
metadata:
  version: 1.0.0
# allowed-tools is recorded for transparency only; the mutation gate still
# governs every call (binding contract §2.1). It never auto-grants anything.
allowed-tools: [netapp_get, netapp_list]
# Intentionally NOT paths-gated: capacity reporting is broadly useful and should
# stay always-listed rather than waiting for the operator to touch an ONTAP file.
---

# NetApp ONTAP Reporting

Use when the operator wants a point-in-time NetApp report — capacity, performance, or aggregate/volume utilisation. This skill is **read-only**: it issues only get/list calls. If you find yourself about to mutate anything, stop — that is a different skill (`scogo:netapp-snapmirror-config`).

## 1. Scope the report

Confirm three things before pulling anything:

- **Which cluster(s)?** If unspecified, target every cluster the netapp MCP exposes.
- **Which object level?** aggregate, SVM, or volume. Default to **cluster + aggregate** level.
- **Which metric family?** capacity vs performance. Default to **capacity**.

State the scope back to the operator in one line before you start, so a wrong assumption is caught early.

## 2. Detect the ONTAP version

Call the netapp MCP `system version` / cluster-info first. If ONTAP is **< 9.10**, the REST metric field names differ — consult `references/aiqum-metrics.md` for the field-name mapping and fall back to the legacy counters. (This is why `compatibility` opens at `ontap>=9.10`: older clusters still work, but with reduced fidelity, and the body branches accordingly.)

## 3. Pull metrics (read-only)

Issue the relevant get/list calls only. **Cap result volume.** For a volume-level report across a large cluster, page and summarise — do NOT dump every volume's raw counters into the transcript. A report is a summary, not a data export.

## 4. Compute the summary table

Produce, per aggregate: total / used / available, % used, and days-to-full (a linear fit on the last N AIQUM history samples when available). Flag any aggregate over **85% used** as a capacity risk.

| Aggregate | Total | Used | % Used | Days to full |
|-----------|------:|-----:|-------:|-------------:|
| …         |       |      |        |              |

## 5. Rank the risks

List the **top 5** capacity/performance risks (most-full aggregates, hottest volumes), each with the single number that justifies it. Brevity beats completeness here.

## 6. Report and stop

Print the table plus the ranked risks. Do **not** propose remediation (provisioning, SnapMirror, deletion) unless the operator explicitly asks — that crosses into a mutation workflow owned by a different skill.

## Notes

- Metric field names vary across ONTAP 9.10 → 9.14; the lookup table lives in `references/aiqum-metrics.md` and is loaded on demand (progressive disclosure — it costs no prompt tokens until you actually open it).
- AIQUM = NetApp **Active IQ Unified Manager**, the fleet monitoring/reporting product — not a per-array tool. Prefer AIQUM history for days-to-full; fall back to per-cluster REST when AIQUM is not configured.
