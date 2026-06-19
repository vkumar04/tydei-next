/**
 * Canonical access-tier permission matrix (Settings/Users feature).
 *
 * ONE source of truth for "what can a user of tier X do". Pure + DB-free
 * so it unit-tests trivially and can be evaluated on both server and
 * client. Server gates live in `lib/actions/auth-permissions.ts`
 * (`requireCan` / `requireCanMutate`); client affordances read the same
 * matrix via the tier passed down from the server.
 *
 * Three tiers, nesting `super ⊃ advanced ⊃ user`:
 *   super    — full access, including Settings.
 *   advanced — every write EXCEPT Settings + member management.
 *   user     — read-only everywhere (can view, cannot mutate).
 *
 * This is deliberately a repo-native matrix, NOT better-auth's
 * `createAccessControl`. The org plugin is kept minimal here (joins off,
 * no `Session.activeOrganizationId` column) precisely because its fuller
 * feature set 500'd session reads; re-coupling permission checks to that
 * surface would risk the same failure class for zero benefit at 3 tiers.
 *
 * The `AccessTier` union mirrors the Prisma `AccessTier` enum value-for-
 * value; keep them in sync.
 */

export type AccessTier = "super" | "advanced" | "user"

export type AccessSide = "facility" | "vendor"

/**
 * Capability keys. `mutate` is the generic "can perform any write" used by
 * the read-only gate; the `settings.*` / `members.manage` keys are the
 * Settings-only capabilities that separate Advanced from Super.
 */
export type Permission =
  | "settings.view" // see the Settings area at all
  | "settings.manage" // mutate any settings surface (profile/org/feature flags)
  | "members.manage" // invite / change roles / change access tiers
  | "mutate" // generic write (imports, contract create/edit, etc.)

export interface AccessContext {
  tier: AccessTier
  side: AccessSide
  /** Reserved for future per-division tiers; unused by the matrix today. */
  divisionId?: string | null
}

const SUPER: ReadonlySet<Permission> = new Set<Permission>([
  "settings.view",
  "settings.manage",
  "members.manage",
  "mutate",
])

// Advanced: everything EXCEPT the Settings + member-management surface.
const ADVANCED: ReadonlySet<Permission> = new Set<Permission>(["mutate"])

// User: read-only. No write capability of any kind.
const USER: ReadonlySet<Permission> = new Set<Permission>([])

const MATRIX: Record<AccessTier, ReadonlySet<Permission>> = {
  super: SUPER,
  advanced: ADVANCED,
  user: USER,
}

/**
 * The one capability check. Returns true iff a user of `ctx.tier` may
 * perform `perm`. Unknown tiers fall through to the most restrictive
 * (read-only) set.
 */
export function can(perm: Permission, ctx: AccessContext): boolean {
  return (MATRIX[ctx.tier] ?? USER).has(perm)
}

/** Convenience: can this tier mutate tenant data at all? */
export function canMutate(tier: AccessTier): boolean {
  return (MATRIX[tier] ?? USER).has("mutate")
}

/** Convenience: can this tier see + manage the Settings area? */
export function canManageSettings(tier: AccessTier): boolean {
  return (MATRIX[tier] ?? USER).has("settings.manage")
}

/** Human-readable label for UI (Members tab Access column, tooltips). */
export const ACCESS_TIER_LABELS: Record<AccessTier, string> = {
  super: "Super User",
  advanced: "Advanced User",
  user: "User (read-only)",
}

export const ACCESS_TIERS: readonly AccessTier[] = ["super", "advanced", "user"]
