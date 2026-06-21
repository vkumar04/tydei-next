import { z } from "zod"

/**
 * Shared pagination field shape for list-filter schemas:
 * `{ page: int ≥1 optional, pageSize: int ≥1 ≤maxPageSize optional }`.
 *
 * Each list validator picks its own `maxPageSize` (the row cap that surface
 * is willing to serve in one page). Returns the raw field object so callers
 * spread it into their own `z.object({ ... })` alongside their filters.
 */
export function createPaginationSchema(maxPageSize: number) {
  return {
    page: z.number().int().min(1).optional(),
    pageSize: z.number().int().min(1).max(maxPageSize).optional(),
  }
}
