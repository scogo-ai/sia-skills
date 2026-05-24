# AIQUM / ONTAP metric field mapping (9.10 → 9.14)

This lookup table is loaded **on demand** by `scogo:netapp-reporting` (progressive
disclosure). It maps the report's conceptual metrics to the concrete REST field
names, which drift across ONTAP releases. Use the column that matches the version
detected in step 2 of the skill.

## Capacity / space

| Concept                    | ONTAP 9.10 REST field                | ONTAP 9.12+ REST field                  |
|----------------------------|--------------------------------------|------------------------------------------|
| Aggregate used %           | `space.used_percent`                 | `space.block_storage.used_percent`       |
| Aggregate total bytes      | `space.size`                         | `space.block_storage.size`               |
| Aggregate available bytes  | `space.available`                    | `space.block_storage.available`          |
| Volume used %              | `space.used_percent`                 | `space.used_percent`                     |
| Snapshot reserve used      | `space.snapshot.used`                | `space.snapshot.used`                    |

## Performance

| Concept                    | ONTAP 9.10 REST field                | ONTAP 9.12+ REST field                  |
|----------------------------|--------------------------------------|------------------------------------------|
| Volume IOPS (total)        | `metric.iops.total`                  | `statistics.iops_raw.total`              |
| Volume throughput (total)  | `metric.throughput.total`            | `statistics.throughput_raw.total`        |
| Volume latency (total)     | `metric.latency.total`               | `statistics.latency_raw.total`           |

## Days-to-full basis

| Concept                    | Source                               | Notes                                    |
|----------------------------|--------------------------------------|------------------------------------------|
| Days-to-full (preferred)   | AIQUM capacity history series        | Linear fit over the last N samples       |
| Days-to-full (fallback)    | `space.available` + sampled history  | Lower fidelity; note this in the report  |

## Notes

- On **ONTAP < 9.10** the `statistics.*_raw.*` counters are absent; use the
  `metric.*` family and flag the report as "legacy-counter fidelity".
- AIQUM REST (`/api/...`) and ONTAP REST (`/api/storage/...`) are distinct
  surfaces. Prefer AIQUM for fleet-wide history; use ONTAP REST per cluster when
  AIQUM is not configured.
- These field names are illustrative of the 9.10→9.14 drift pattern; always
  confirm against the live cluster's REST schema (`/api/docs`) before relying on
  a field in automation.
