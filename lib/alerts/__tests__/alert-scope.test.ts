import { describe, it, expect } from "vitest"
import {
  openAlertWhere,
  inboxAlertScope,
  excludeNonInboxAlerts,
  OPEN_ALERT_STATUSES,
} from "../alert-scope"

describe("alert-scope — canonical open-alert definition", () => {
  it("OPEN = new_alert + read (not resolved/dismissed)", () => {
    expect([...OPEN_ALERT_STATUSES]).toEqual(["new_alert", "read"])
  })

  it("openAlertWhere(facility) scopes by facilityId + portal + status + exclusions", () => {
    const where = openAlertWhere({ portalType: "facility", facilityId: "fac-1" })
    expect(where.facilityId).toBe("fac-1")
    expect(where.portalType).toBe("facility")
    expect(where.status).toEqual({ in: ["new_alert", "read"] })
    // Both OR-shaped exclusion fragments must be AND-composed (not spread).
    expect(Array.isArray(where.AND)).toBe(true)
    expect((where.AND as unknown[]).length).toBe(2)
    expect(where.vendorId).toBeUndefined()
  })

  it("openAlertWhere(vendor) scopes by vendorId, not facilityId", () => {
    const where = openAlertWhere({ portalType: "vendor", vendorId: "ven-1" })
    expect(where.vendorId).toBe("ven-1")
    expect(where.facilityId).toBeUndefined()
    expect(where.portalType).toBe("vendor")
  })

  it("excludeNonInboxAlerts returns the two OR-shaped fragments to AND-compose", () => {
    const frags = excludeNonInboxAlerts()
    expect(frags).toHaveLength(2)
    for (const f of frags) expect(Array.isArray(f.OR)).toBe(true)
  })

  it("inboxAlertScope has no status filter (caller adds its own)", () => {
    const scope = inboxAlertScope({ portalType: "facility", facilityId: "fac-1" })
    const json = JSON.stringify(scope)
    expect(json).not.toContain("status")
    expect(json).toContain("fac-1")
  })
})
