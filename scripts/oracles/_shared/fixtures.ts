// scripts/oracles/_shared/fixtures.ts
/**
 * Fixture path + demo identifier resolution for oracles.
 *
 * Paths come from env vars with local-machine fallbacks. Demo facility
 * is looked up by NAME at runtime — never by cuid (CLAUDE.md primer:
 * "IDs regenerate on every bun run db:seed").
 */
import { prisma } from "@/lib/db"

export interface FixturePaths {
  arthrexCogCsv: string
  arthrexPricingXlsx: string
  /** Optional — only used by oracles that compare against Charles's
   *  exact desktop files. Most oracles should rely on DB seed data. */
  desktopRoot: string
}

export const FIXTURES: FixturePaths = {
  arthrexCogCsv:
    process.env.ORACLE_ARTHREX_COG ??
    "/Users/vickkumar/Desktop/experiment COG vendor short NEW.csv",
  arthrexPricingXlsx:
    process.env.ORACLE_ARTHREX_PRICING ??
    "/Users/vickkumar/Desktop/Cogsart01012024 Price file.xlsx",
  desktopRoot: process.env.ORACLE_DESKTOP_ROOT ?? "/Users/vickkumar/Desktop",
}

export const DEMO_FACILITY_NAME =
  process.env.ORACLE_DEMO_FACILITY ?? "Lighthouse Surgical Center"

/**
 * Resolve the demo facility's id by name. Throws if not found so
 * oracles fail loudly instead of silently checking against the wrong
 * facility.
 */
export async function getDemoFacilityId(): Promise<string> {
  const f = await prisma.facility.findFirst({
    where: { name: DEMO_FACILITY_NAME },
    select: { id: true },
  })
  if (!f) {
    throw new Error(
      `Demo facility "${DEMO_FACILITY_NAME}" not found. Set ORACLE_DEMO_FACILITY or run \`bun run db:seed\`.`,
    )
  }
  return f.id
}
