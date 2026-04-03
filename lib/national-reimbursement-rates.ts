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
 * Estimate reimbursement for a CPT code using national average rates.
 * Uses commercial average as default (most common payor type for ASC).
 */
export function estimateReimbursement(cptCode: string): number {
  const rates = nationalReimbursementRates[cptCode]
  if (!rates) return 0
  return rates.commercialAvg
}
