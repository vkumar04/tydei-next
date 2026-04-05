/**
 * National average reimbursement rates by CPT code.
 *
 * Source: CMS Medicare Physician Fee Schedule 2025 Final Rule (published Dec 2024)
 * plus AAHKS data. Commercial rates are Medicare * typical 1.4-2.0x multiplier.
 * These are PHYSICIAN + FACILITY combined rates for ASC setting.
 *
 * Imported from the v0 prototype reference implementation.
 */

export const nationalReimbursementRates: Record<
  string,
  {
    medicare: number
    commercialAvg: number
    description: string
  }
> = {
  // Orthopedic - Joint Replacement
  "27447": { medicare: 10513, commercialAvg: 18923, description: "Total Knee Arthroplasty" },
  "27446": { medicare: 9800, commercialAvg: 17640, description: "Partial Knee Arthroplasty" },
  "27130": { medicare: 10708, commercialAvg: 19275, description: "Total Hip Arthroplasty" },

  // Shoulder
  "23472": { medicare: 8500, commercialAvg: 15300, description: "Total Shoulder Arthroplasty" },
  "29827": { medicare: 4200, commercialAvg: 7560, description: "Rotator Cuff Repair" },
  "29826": { medicare: 3800, commercialAvg: 6840, description: "Shoulder Decompression" },

  // Knee Arthroscopy
  "29881": { medicare: 3500, commercialAvg: 6300, description: "Knee Arthroscopy w/ Meniscectomy" },
  "29880": { medicare: 3200, commercialAvg: 5760, description: "Knee Arthroscopy w/ Chondroplasty" },
  "29882": { medicare: 3600, commercialAvg: 6480, description: "Knee Arthroscopy w/ Meniscus Repair" },
  "29888": { medicare: 4500, commercialAvg: 8100, description: "ACL Reconstruction" },
  "29873": { medicare: 2800, commercialAvg: 5040, description: "Knee Arthroscopy Diagnostic" },
  "29875": { medicare: 2500, commercialAvg: 4500, description: "Knee Arthroscopy Synovectomy" },
  "29877": { medicare: 2700, commercialAvg: 4860, description: "Knee Arthroscopy Debridement" },

  // Hip Arthroscopy
  "29914": { medicare: 4800, commercialAvg: 8640, description: "Hip Arthroscopy Femoroplasty" },
  "29916": { medicare: 5200, commercialAvg: 9360, description: "Hip Arthroscopy Labral Repair" },

  // Nerve
  "64721": { medicare: 2200, commercialAvg: 3960, description: "Carpal Tunnel Release (Neuroplasty)" },
  "64718": { medicare: 2400, commercialAvg: 4320, description: "Ulnar Nerve Transposition" },

  // Hardware Removal
  "20680": { medicare: 2800, commercialAvg: 5040, description: "Hardware Removal Deep" },
  "20670": { medicare: 1800, commercialAvg: 3240, description: "Hardware Removal Superficial" },

  // Hand/Wrist
  "25000": { medicare: 1800, commercialAvg: 3240, description: "Carpal Tunnel Release" },
  "25111": { medicare: 2200, commercialAvg: 3960, description: "Ganglion Cyst Excision" },

  // Spine
  "22630": { medicare: 12000, commercialAvg: 21600, description: "Lumbar Interbody Fusion" },
  "22612": { medicare: 11200, commercialAvg: 20160, description: "Posterior Lumbar Fusion" },
  "63047": { medicare: 7000, commercialAvg: 12600, description: "Lumbar Laminectomy" },
  "63030": { medicare: 5500, commercialAvg: 9900, description: "Lumbar Discectomy" },
  "22551": { medicare: 8500, commercialAvg: 15300, description: "Cervical Fusion" },
  "22633": { medicare: 12000, commercialAvg: 21600, description: "Lumbar Combined Fusion" },
  "62323": { medicare: 1800, commercialAvg: 3240, description: "Lumbar Epidural Injection" },
  "64483": { medicare: 1500, commercialAvg: 2700, description: "Transforaminal Epidural" },
  "64493": { medicare: 1200, commercialAvg: 2160, description: "Facet Joint Injection" },

  // Hip fracture/pinning
  "27236": { medicare: 7200, commercialAvg: 12960, description: "Hip Pinning/ORIF" },
  "27698": { medicare: 3800, commercialAvg: 6840, description: "Ankle Repair/Ligament" },
  "27096": { medicare: 1200, commercialAvg: 2160, description: "Hip Injection" },
  "27860": { medicare: 3500, commercialAvg: 6300, description: "Ankle Arthroscopy" },
  "27245": { medicare: 7500, commercialAvg: 13500, description: "Intertrochanteric Fracture" },

  // Foot/Ankle
  "28296": { medicare: 4800, commercialAvg: 8640, description: "Bunionectomy" },
  "28285": { medicare: 3600, commercialAvg: 6480, description: "Hammertoe Correction" },
  "27904": { medicare: 3200, commercialAvg: 5760, description: "Ankle Arthrodesis" },
  "29848": { medicare: 2800, commercialAvg: 5040, description: "Wrist Arthroscopy" },

  // GI/General Surgery
  "49505": { medicare: 3200, commercialAvg: 5760, description: "Inguinal Hernia Repair" },
  "49650": { medicare: 4500, commercialAvg: 8100, description: "Lap Inguinal Hernia" },
  "47562": { medicare: 4800, commercialAvg: 8640, description: "Lap Cholecystectomy" },
  "43239": { medicare: 3500, commercialAvg: 6300, description: "EGD with Biopsy" },
  "45378": { medicare: 2800, commercialAvg: 5040, description: "Colonoscopy Diagnostic" },
  "45380": { medicare: 3200, commercialAvg: 5760, description: "Colonoscopy with Biopsy" },
  "45385": { medicare: 3500, commercialAvg: 6300, description: "Colonoscopy Polypectomy" },

  // Eye Surgery
  "66984": { medicare: 2200, commercialAvg: 3960, description: "Cataract Surgery" },
  "67028": { medicare: 1800, commercialAvg: 3240, description: "Intravitreal Injection" },

  // Urology
  "52000": { medicare: 2500, commercialAvg: 4500, description: "Cystoscopy" },
  "52601": { medicare: 4200, commercialAvg: 7560, description: "TURP" },

  // Cardiac
  "33533": { medicare: 15000, commercialAvg: 27000, description: "CABG Single Vessel" },
  "33405": { medicare: 18000, commercialAvg: 32400, description: "Aortic Valve Replacement" },
  "33430": { medicare: 16000, commercialAvg: 28800, description: "Mitral Valve Repair" },
  "33361": { medicare: 20000, commercialAvg: 36000, description: "TAVR" },
  "33426": { medicare: 17000, commercialAvg: 30600, description: "Mitral Valve Replacement" },

  // Neurosurgery
  "61510": { medicare: 12000, commercialAvg: 21600, description: "Craniotomy" },

  // Spine - additional
  "22856": { medicare: 14000, commercialAvg: 25200, description: "Cervical Disc Arthroplasty" },
  "22558": { medicare: 13000, commercialAvg: 23400, description: "Anterior Lumbar Fusion" },
}

/**
 * Fallback reimbursement estimates by CPT code range when the exact code
 * is not in the table.  Based on CMS ASC payment groupings.
 */
function estimateByRange(cptCode: string): number {
  const code = parseInt(cptCode, 10)
  if (isNaN(code)) return 0

  // Musculoskeletal (20000-29999)
  if (code >= 20000 && code < 22000) return 3500   // General ortho procedures
  if (code >= 22000 && code < 23000) return 12000   // Spine
  if (code >= 23000 && code < 25000) return 5000    // Shoulder/arm
  if (code >= 25000 && code < 27000) return 3000    // Forearm/hand
  if (code >= 27000 && code < 28000) return 6000    // Hip/knee/leg
  if (code >= 28000 && code < 29000) return 4000    // Foot/ankle
  if (code >= 29000 && code < 30000) return 4500    // Arthroscopy/endoscopy

  // Respiratory (30000-32999)
  if (code >= 30000 && code < 33000) return 3500

  // Cardiovascular (33000-37999)
  if (code >= 33000 && code < 38000) return 15000

  // Digestive (40000-49999)
  if (code >= 40000 && code < 50000) return 4500

  // Urinary (50000-53999)
  if (code >= 50000 && code < 54000) return 4000

  // Nervous system (61000-64999)
  if (code >= 61000 && code < 65000) return 5000

  // Eye (65000-68999)
  if (code >= 65000 && code < 69000) return 2500

  return 0
}

/**
 * Estimate reimbursement for a CPT code using national average rates.
 * Supports payor-specific multipliers:
 *   - "commercial" or undefined → commercial average (default)
 *   - "medicare" → base Medicare rate (commercialAvg / 1.8)
 *   - "medicaid" → Medicare rate × 0.72
 *   - "self_pay" → commercialAvg × 2.2
 *
 * Falls back to range-based estimate when exact code is not in the table.
 */
export function estimateReimbursement(cptCode: string, payorType?: string): number {
  const rates = nationalReimbursementRates[cptCode]
  const commercialAvg = rates ? rates.commercialAvg : estimateByRange(cptCode)

  if (!commercialAvg) return 0

  switch (payorType) {
    case "medicare":
      return Math.round((commercialAvg / 1.8) * 100) / 100
    case "medicaid":
      return Math.round((commercialAvg / 1.8) * 0.72 * 100) / 100
    case "self_pay":
      return Math.round(commercialAvg * 2.2 * 100) / 100
    case "commercial":
    default:
      return commercialAvg
  }
}
