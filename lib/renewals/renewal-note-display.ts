/**
 * Pure presentational helpers for renewal-note timeline rendering.
 *
 * Split out of the client component so unit tests can exercise them
 * without pulling `"use server"` action imports (which transitively
 * construct Stripe / Prisma clients at module load).
 */

/**
 * Derives the 1–2 letter initials shown in the author avatar.
 *
 * Prefers the display name's word initials (first two words), falls
 * back to the first two characters of the author id for legacy rows
 * whose `author.name` is null. Always uppercase; never empty — returns
 * `"??"` only as a pathological fallback.
 */
export function authorInitials(
  authorName: string | null | undefined,
  authorId: string,
): string {
  const trimmed = (authorName ?? "").trim()
  if (trimmed.length > 0) {
    const parts = trimmed.split(/\s+/).filter((p) => p.length > 0)
    const letters = parts.slice(0, 2).map((p) => p[0]).join("")
    if (letters.length > 0) return letters.toUpperCase()
  }
  const prefix = authorId.slice(0, 2)
  return (prefix.length > 0 ? prefix : "??").toUpperCase()
}

/**
 * Returns the display name for a note author. Falls back to a stable
 * generic label when the relation is missing rather than leaking the
 * raw user id into the UI.
 */
export function authorDisplayName(
  authorName: string | null | undefined,
): string {
  const trimmed = (authorName ?? "").trim()
  return trimmed.length > 0 ? trimmed : "Team member"
}
