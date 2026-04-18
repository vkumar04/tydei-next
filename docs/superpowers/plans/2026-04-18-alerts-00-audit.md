# Alerts Rewrite — Subsystem 0 Audit

**Date:** 2026-04-18
**Spec:** `docs/superpowers/specs/2026-04-18-alerts-rewrite.md`
**Verdict:** **(b) No schema changes required.** Existing `Alert` model + enums already satisfy spec §3. This file documents the audit findings and gaps flagged for later subsystems.

---

## 1. Schema audit — `prisma/schema.prisma`

### Model `Alert` (lines 1009–1034)

```prisma
model Alert {
  id          String        @id @default(cuid())
  portalType  String
  alertType   AlertType
  title       String
  description String?
  severity    AlertSeverity @default(medium)
  status      AlertStatus   @default(new_alert)
  contractId  String?
  facilityId  String?
  vendorId    String?
  metadata    Json          @default("{}")
  actionLink  String?
  createdAt   DateTime      @default(now())
  readAt      DateTime?
  resolvedAt  DateTime?
  dismissedAt DateTime?

  contract Contract? @relation(fields: [contractId], references: [id])
  facility Facility? @relation("FacilityAlerts", fields: [facilityId], references: [id])
  vendor   Vendor?   @relation("VendorAlerts", fields: [vendorId], references: [id])

  @@index([facilityId])
  @@index([vendorId])
  @@index([status])
  @@index([alertType])
}
```

### Comparison vs spec §3

| Spec field           | Present? | Notes                                                                 |
| -------------------- | -------- | --------------------------------------------------------------------- |
| `id`                 | yes      | cuid; matches                                                         |
| `facilityId`         | yes      | Optional in tydei (spec shows required); preserved as-is additively.  |
| `type`               | yes (as `alertType`) | Field-renamed in code; enum matches                         |
| `severity`           | yes      | `AlertSeverity` enum values `high/medium/low` match spec              |
| `status`             | yes      | `AlertStatus` default `new_alert`; matches                            |
| `title`              | yes      | matches                                                               |
| `message` (spec)     | mapped to `description` | Semantically equivalent; renames do not require migration. |
| `metadata`           | yes      | `Json @default("{}")`; matches                                        |
| `createdAt`          | yes      | matches                                                               |
| `resolvedAt`         | yes      | matches                                                               |
| `dismissedAt`        | yes      | matches                                                               |
| `readAt`             | yes      | matches                                                               |
| extra: `portalType`  | ✅       | tydei-only; used to scope facility vs vendor portals                  |
| extra: `contractId`  | ✅       | FK indirection for convenience; tolerated by spec                     |
| extra: `vendorId`    | ✅       | same                                                                  |
| extra: `actionLink`  | ✅       | tydei-only; spec's "Route mapping" feature maps nicely here          |

### Enums

```prisma
enum AlertType {
  off_contract
  expiring_contract
  tier_threshold
  rebate_due
  payment_due
  pricing_error   // tydei extra
  compliance      // tydei extra
}

enum AlertSeverity { high medium low }
enum AlertStatus  { new_alert read resolved dismissed }
```

All 5 canonical alert types listed in spec §2 (`off_contract`, `expiring_contract`, `tier_threshold`, `rebate_due`, `payment_due`) exist. `pricing_error` and `compliance` are additional tydei types preserved from prior work — NOT in scope for subsystem 1 synthesizer but left in place.

**Conclusion: no schema changes required.**

---

## 2. `lib/actions/alerts.ts` — exports audit

Current exports (201 lines):

| Export                 | Purpose                                       | Spec gap                     |
| ---------------------- | --------------------------------------------- | ---------------------------- |
| `getAlerts(input)`     | List w/ facility-scoped filters, pagination   | OK for subsystem 2           |
| `getAlert(id)`         | Single alert + relations                      | OK                           |
| `getUnreadAlertCount`  | Badge count (by portalType)                   | OK for subsystem 5           |
| `markAlertRead(id)`    | new_alert → read                              | OK                           |
| `resolveAlert(id)`     | → resolved + AuditLog                         | OK                           |
| `dismissAlert(id)`     | → dismissed + AuditLog                        | OK                           |
| `bulkResolveAlerts`    | updateMany → resolved                         | OK (missing AuditLog entry)  |
| `bulkDismissAlerts`    | updateMany → dismissed                        | OK (missing AuditLog entry)  |
| `generateAlerts`       | Runs legacy `generate-alerts.ts` + notifs     | Replaced by subsystem 1      |

### Gaps flagged for later subsystems

1. **Missing `bulkMarkReadAlerts(ids)`** — spec subsystem 2 §feature-parity requires a "Mark Read" bulk action.
2. **Missing `markAllRead(facilityId)`** — header-level button per spec subsystem 2.
3. **Missing `synthesizeForFacility(facilityId)`** — server action to drive subsystem 1 engine. Delivered in a later subsystem (4) because persistence is explicitly out-of-scope for subsystem 1 per instructions.
4. **Bulk ops skip `AuditLog`** — spec subsystem 4 requires per-transition audit log entries. Bulk variants currently do not log per-alert.
5. **Legacy `generate-alerts.ts` is prisma-coupled.** Spec §subsystem-1 mandates a pure function. Subsystem 1 ships a new `lib/alerts/synthesizer.ts` alongside the legacy file; the legacy file remains in place until subsystem 4 cuts over server-action callers.
6. **`generateAlerts` has no "resolve stale" pass.** Spec §1 requires the rules engine to *both* create and resolve. Subsystem 1 synthesizer returns a `{ toCreate, toResolve }` delta shape to support this.

---

## 3. Decision log

- **(b) no schema migration** — confirmed. The existing model is a superset of spec §3.
- **Legacy `generate-alerts.ts`:** kept untouched this subsystem; will be deprecated in subsystem 4 when the server-action cutover happens.
- **`payment_due` data source:** no `CapitalPayment` / `PaymentSchedule` Prisma model exists today. Subsystem 1 defines the pure function's input shape for payment schedules so the synthesizer is ready when that data lands; today the caller simply passes `[]`.

---

## 4. Verification

```
bunx prisma validate       # passes (no changes)
bunx tsc --noEmit          # run as part of subsystem 1 commit
```
