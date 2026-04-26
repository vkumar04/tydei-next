/**
 * Charles audit Iter3-B1 / Iter3-B2 regression suite (CRITICAL,
 * confirmed exploits).
 *
 *  - Iter3-B1 — `notifyVendorOfPendingDecision` previously took
 *    `vendorId` from the wire under requireAuth() only, so a vendor
 *    user (Stryker) wrote a fake "Submission approved" notification
 *    + email into Medtronic's inbox. The fix derives `vendorId` from
 *    the PendingContract row and verifies the caller is a member of
 *    the FACILITY org that owns the row.
 *
 *  - Iter3-B2 — `createInAppNotifications` previously accepted
 *    arbitrary `userIds` + `title` + `actionUrl` from the wire and
 *    was used to plant a phishing notification in a foreign user's
 *    inbox. The fix moves the helper to a non-"use server" module
 *    (`lib/notifications/in-app-helper.ts`) and removes the
 *    Server-Action surface entirely. This test asserts the import
 *    is no longer exported from `lib/actions/notifications/in-app`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const {
  pendingFindUniqueOrThrowMock,
  facilityFindUniqueMock,
  vendorFindUniqueMock,
  notificationCreateManyMock,
  requireFacilityMock,
  requireAuthMock,
} = vi.hoisted(() => ({
  pendingFindUniqueOrThrowMock: vi.fn(),
  facilityFindUniqueMock: vi.fn(),
  vendorFindUniqueMock: vi.fn(),
  notificationCreateManyMock: vi.fn().mockResolvedValue({ count: 1 }),
  requireFacilityMock: vi.fn(),
  requireAuthMock: vi.fn(),
}))

vi.mock("@/lib/db", () => ({
  prisma: {
    pendingContract: { findUniqueOrThrow: pendingFindUniqueOrThrowMock },
    facility: { findUnique: facilityFindUniqueMock },
    vendor: { findUnique: vendorFindUniqueMock },
    notification: { createMany: notificationCreateManyMock },
  },
}))
vi.mock("@/lib/actions/auth", () => ({
  requireFacility: requireFacilityMock,
  requireAuth: requireAuthMock,
}))
vi.mock("@/lib/email", () => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("@/lib/email-templates", () => ({
  alertNotificationEmail: () => ({ subject: "", html: "" }),
  renewalReminderEmail: () => ({ subject: "", html: "" }),
  weeklyDigestEmail: () => ({ subject: "", html: "" }),
  pendingContractSubmittedEmail: () => ({ subject: "", html: "" }),
  pendingContractDecisionEmail: () => ({ subject: "", html: "" }),
}))
vi.mock("@/lib/actions/settings", () => ({
  getNotificationPreferences: vi.fn().mockResolvedValue({ emailEnabled: false }),
}))

import { notifyVendorOfPendingDecision } from "@/lib/actions/notifications"

beforeEach(() => {
  vi.clearAllMocks()
  notificationCreateManyMock.mockResolvedValue({ count: 1 })
  vendorFindUniqueMock.mockResolvedValue({
    organization: {
      members: [{ user: { id: "vendor-user-1", email: "vu@example.com" } }],
    },
  })
})

describe("notifyVendorOfPendingDecision — Iter3-B1", () => {
  it("rejects when the caller's facility does not own the pending contract", async () => {
    requireFacilityMock.mockResolvedValue({
      facility: { id: "fac-attacker" },
      user: { id: "u-1" },
    })
    pendingFindUniqueOrThrowMock.mockResolvedValue({
      vendorId: "vendor-victim",
      facilityId: "fac-victim",
    })

    await expect(
      notifyVendorOfPendingDecision({
        contractName: "SPOOF-FROM-STRYKER",
        vendorName: "Medtronic",
        facilityName: "Lighthouse",
        pendingId: "pc-victim",
        decision: "approved",
      }),
    ).rejects.toThrow(/different facility/i)

    // Critically: no notification rows or emails were written.
    expect(notificationCreateManyMock).not.toHaveBeenCalled()
  })

  it("succeeds when the caller is a member of the facility that owns the pending contract", async () => {
    requireFacilityMock.mockResolvedValue({
      facility: { id: "fac-owner" },
      user: { id: "u-1" },
    })
    pendingFindUniqueOrThrowMock.mockResolvedValue({
      vendorId: "vendor-real",
      facilityId: "fac-owner",
    })

    await notifyVendorOfPendingDecision({
      contractName: "Real Contract",
      vendorName: "Medtronic",
      facilityName: "Lighthouse",
      pendingId: "pc-real",
      decision: "approved",
      approvedContractId: "c-1",
    })

    // We don't need to wait for the void-promise email path; the in-app
    // create is fired synchronously inside the action body.
    expect(notificationCreateManyMock).toHaveBeenCalled()
    const callArgs = notificationCreateManyMock.mock.calls[0][0]
    // vendorId is derived from the row, NOT taken from input — so the
    // recipient is the org members of vendor-real.
    expect(callArgs.data[0].userId).toBe("vendor-user-1")
  })

  it("derives vendorId from the pending row even if input shape attempts to spoof", async () => {
    requireFacilityMock.mockResolvedValue({
      facility: { id: "fac-owner" },
      user: { id: "u-1" },
    })
    pendingFindUniqueOrThrowMock.mockResolvedValue({
      vendorId: "vendor-from-row",
      facilityId: "fac-owner",
    })

    // Even if some legacy caller pretends to pass `vendorId`, the typed
    // signature no longer accepts it AND the runtime ignores it.
    await notifyVendorOfPendingDecision({
      contractName: "X",
      vendorName: "X",
      pendingId: "pc-x",
      decision: "rejected",
      reviewNotes: null,
    })

    // The vendor lookup must have used the row's vendorId.
    expect(vendorFindUniqueMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "vendor-from-row" } }),
    )
  })
})

describe("createInAppNotifications — Iter3-B2 (export removed)", () => {
  it("is no longer exported from lib/actions/notifications/in-app", async () => {
    const mod = await import("@/lib/actions/notifications/in-app")
    // The Server-Action surface has been removed. Internal callers
    // import `createInAppNotificationsInternal` from
    // `@/lib/notifications/in-app-helper` instead.
    expect(
      (mod as Record<string, unknown>).createInAppNotifications,
    ).toBeUndefined()
  })

  it("the new internal helper writes Notification rows", async () => {
    const { createInAppNotificationsInternal } = await import(
      "@/lib/notifications/in-app-helper"
    )
    notificationCreateManyMock.mockResolvedValueOnce({ count: 2 })
    const result = await createInAppNotificationsInternal({
      userIds: ["u-1", "u-2"],
      type: "pending_contract_approved",
      title: "Approved",
    })
    expect(result.created).toBe(2)
    expect(notificationCreateManyMock).toHaveBeenCalledOnce()
  })

  it("the new internal helper short-circuits empty userIds without a DB call", async () => {
    const { createInAppNotificationsInternal } = await import(
      "@/lib/notifications/in-app-helper"
    )
    const result = await createInAppNotificationsInternal({
      userIds: [],
      type: "x",
      title: "x",
    })
    expect(result.created).toBe(0)
    expect(notificationCreateManyMock).not.toHaveBeenCalled()
  })
})
