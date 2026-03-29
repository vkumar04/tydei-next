import type { PrismaClient } from "@prisma/client"
import type { Facilities } from "./health-systems"
import type { Vendors } from "./vendors"
import type { Contracts } from "./contracts"

export async function seedAlerts(
  prisma: PrismaClient,
  deps: { facilities: Facilities; vendors: Vendors; contracts: Contracts }
) {
  const { facilities: f, vendors: v, contracts: c } = deps

  const alerts = [
    // --- Expiring Contract (5) ---
    { portalType: "facility", alertType: "expiring_contract" as const, title: "Contract Expiring: Medtronic Biologics", description: "Medtronic Biologics Agreement expires in 6 months. Begin renewal negotiations.", severity: "high" as const, facilityId: f.heritageRegional.id, contractId: c.medtronicBio.id, actionLink: "/dashboard/contracts" },
    { portalType: "facility", alertType: "expiring_contract" as const, title: "Contract Expiring: Arthrex Austin", description: "Arthrex Arthroscopy agreement at Austin Spine & Joint expires in 6 months.", severity: "high" as const, facilityId: f.austinSpine.id, contractId: c.arthrexAustin.id, actionLink: "/dashboard/contracts" },
    { portalType: "vendor", alertType: "expiring_contract" as const, title: "Contract Renewal: Medtronic Biologics", description: "Biologics agreement with Heritage Regional expiring in 6 months.", severity: "high" as const, vendorId: v.medtronic.id, contractId: c.medtronicBio.id },
    { portalType: "vendor", alertType: "expiring_contract" as const, title: "Contract Renewal: Arthrex Austin", description: "Arthroscopy agreement at Austin Spine & Joint Center expiring soon.", severity: "medium" as const, vendorId: v.arthrex.id, contractId: c.arthrexAustin.id },
    { portalType: "facility", alertType: "expiring_contract" as const, title: "Expired: Smith & Nephew Wound Care", description: "S&N Wound Care contract expired. Operating without contract pricing.", severity: "high" as const, facilityId: f.heritageRegional.id, contractId: c.snWound.id },

    // --- Off-Contract (5) ---
    { portalType: "facility", alertType: "off_contract" as const, title: "Off-Contract Purchase: Conmed", description: "3 Conmed purchases at Summit General detected without active contract.", severity: "high" as const, facilityId: f.summitGeneral.id },
    { portalType: "facility", alertType: "off_contract" as const, title: "Off-Contract Purchase: NuVasive", description: "NuVasive spine supplies purchased at Summit without finalized contract.", severity: "medium" as const, facilityId: f.summitGeneral.id },
    { portalType: "facility", alertType: "off_contract" as const, title: "Off-Contract: Zimmer Biomet at Rocky Mountain", description: "2 Oxford Partial Knee purchases at Rocky Mountain without contract.", severity: "high" as const, facilityId: f.rockyMountain.id },
    { portalType: "facility", alertType: "off_contract" as const, title: "Off-Contract: Hologic at Summit", description: "Hologic ThinPrep test kits purchased at Summit without contract pricing.", severity: "low" as const, facilityId: f.summitGeneral.id },
    { portalType: "vendor", alertType: "off_contract" as const, title: "Uncontracted Sales: Rocky Mountain", description: "Zimmer Biomet products sold at Rocky Mountain without active agreement.", severity: "medium" as const, vendorId: v.zimmerBiomet.id },

    // --- Tier Threshold (4) ---
    { portalType: "facility", alertType: "tier_threshold" as const, title: "Approaching Tier 2: Stryker Joint", description: "Stryker Joint Replacement spend is 85% toward Tier 2 ($500K threshold).", severity: "medium" as const, facilityId: f.lighthouseSurgical.id, contractId: c.strykerJoint.id, actionLink: "/dashboard/contracts" },
    { portalType: "facility", alertType: "tier_threshold" as const, title: "Tier 2 Achieved: DePuy Trauma", description: "DePuy Synthes Trauma spend crossed $300K — Tier 2 rebate rate now active.", severity: "low" as const, facilityId: f.summitGeneral.id, contractId: c.depuyTrauma.id },
    { portalType: "facility", alertType: "tier_threshold" as const, title: "Near Tier 2: Zimmer Biomet Knee", description: "Zimmer Biomet Persona Knee spend at 92% of $400K Tier 2 threshold.", severity: "medium" as const, facilityId: f.heritageRegional.id, contractId: c.zbKnee.id },
    { portalType: "vendor", alertType: "tier_threshold" as const, title: "Customer Near Tier 3: Stryker Joint", description: "Lighthouse Surgical approaching Tier 3 ($1M) on Joint Replacement.", severity: "low" as const, vendorId: v.stryker.id, contractId: c.strykerJoint.id },

    // --- Rebate Due (3) ---
    { portalType: "facility", alertType: "rebate_due" as const, title: "Q4 Rebate Due: Medtronic Spine", description: "Medtronic Spine volume rebate of $12,500 due for Q4.", severity: "medium" as const, facilityId: f.lighthouseCommunity.id, contractId: c.medtronicSpine.id },
    { portalType: "facility", alertType: "rebate_due" as const, title: "Q4 Rebate Due: Stryker Joint", description: "Stryker Joint Replacement rebate of $18,750 due for Q4.", severity: "medium" as const, facilityId: f.lighthouseSurgical.id, contractId: c.strykerJoint.id },
    { portalType: "vendor", alertType: "rebate_due" as const, title: "Rebate Payment Due: Lighthouse", description: "Q4 spend rebate of $18,750 due to Lighthouse Surgical Center.", severity: "medium" as const, vendorId: v.stryker.id, contractId: c.strykerJoint.id },

    // --- Pricing Error (3) ---
    { portalType: "facility", alertType: "pricing_error" as const, title: "Invoice Variance: DePuy ATTUNE Knee", description: "Invoice price $4,500 exceeds contract price $4,200 (7.1% variance).", severity: "high" as const, facilityId: f.summitGeneral.id, contractId: c.depuyTrauma.id },
    { portalType: "facility", alertType: "pricing_error" as const, title: "Invoice Variance: Integra DuraGen", description: "DuraGen Plus invoiced at $1,380 vs contract $1,250 (10.4% variance).", severity: "high" as const, facilityId: f.lighthouseCommunity.id, contractId: c.integraDural.id },
    { portalType: "vendor", alertType: "pricing_error" as const, title: "Pricing Discrepancy Flagged", description: "Lighthouse Community flagged DuraGen Plus pricing — review invoice.", severity: "medium" as const, vendorId: v.integra.id, contractId: c.integraDural.id },
  ]

  for (const alert of alerts) {
    await prisma.alert.create({ data: alert })
  }

  console.log(`  Alerts: ${alerts.length}`)

  return alerts.length
}
