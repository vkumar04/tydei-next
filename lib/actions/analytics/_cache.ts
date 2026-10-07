"use server"

import { revalidateTag, updateTag } from "next/cache"
import {
  contractAnalyticsTag,
  facilityAnalyticsTag,
  vendorAnalyticsTag,
} from "./_cached"

function bust(tag: string): void {
  try {
    updateTag(tag)
  } catch {
    revalidateTag(tag, { expire: 0 })
  }
}

export async function invalidateContractAnalytics(contractId: string): Promise<void> {
  bust(contractAnalyticsTag(contractId))
}

export async function invalidateFacilityAnalytics(facilityId: string): Promise<void> {
  bust(facilityAnalyticsTag(facilityId))
}

export async function invalidateVendorAnalytics(vendorId: string): Promise<void> {
  bust(vendorAnalyticsTag(vendorId))
}
