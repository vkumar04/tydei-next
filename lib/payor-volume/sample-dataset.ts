/**
 * Built-in sample payor volume dataset (East Coast Data) so the Dividend/DCF
 * tab is demoable before any upload. Client-safe: the picker merges this with
 * the vendor's stored `PayorVolumeDataset` rows; it never touches the DB.
 */
import raw from "./sample-payor-volume.json"
import type { PayorProcedureGroup } from "./parse-payor-volume-rows"

export interface PayorVolumeDatasetView {
  /** DB row id, or the sample sentinel below. */
  id: string
  /** `facility:<id>` | `adhoc:<normalized name>` | the sample sentinel. */
  facilityKey: string
  facilityLabel: string
  /** True when tied to a connected Facility row. */
  connected: boolean
  fileName: string
  periods: string[]
  groups: PayorProcedureGroup[]
  totalAnnualizedVolume: number
  uploadedAt: string | null
}

export const SAMPLE_FACILITY_KEY = "sample:east-coast"

const data = raw as {
  source: string
  periods: string[]
  totalAnnualizedVolume: number
  groups: PayorProcedureGroup[]
}

export const SAMPLE_PAYOR_VOLUME_DATASET: PayorVolumeDatasetView = {
  id: SAMPLE_FACILITY_KEY,
  facilityKey: SAMPLE_FACILITY_KEY,
  facilityLabel: "Sample — East Coast Data",
  connected: false,
  fileName: data.source,
  periods: data.periods,
  groups: data.groups,
  totalAnnualizedVolume: data.totalAnnualizedVolume,
  uploadedAt: null,
}
