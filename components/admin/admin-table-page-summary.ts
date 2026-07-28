/**
 * The sentence under the admin Vendors / Facilities tables.
 *
 * Both consoles used to render ONE server page (`pageSize: 20`) with no pager,
 * so in production ranks 21–200 of 200 vendors were unreachable from the admin
 * UI entirely — including "Stryker" at rank 176, which holds one of the two
 * live production contracts. The 2026-07-27/28 passes fixed the stat cards
 * above the table and then added a "Showing the first 20 of 201" note, which
 * labelled the cap honestly but still left those rows unreachable. A labelled
 * cap beats a silent one; a pager beats both.
 *
 * So this helper is the label for a REAL page, and every number in it comes
 * from the server response that produced the rows — never from the length of
 * the array the client is holding. Same contract as `describeVendorPage`
 * (components/facility/settings/tabs/vendors-tab.tsx), deliberately: the two
 * sentences describe the same kind of thing and should read the same way.
 *
 * Pure and dependency-free so it can be unit-tested without the component's
 * server-action module graph.
 */

export interface AdminTablePageSummaryInput {
  /** Rows actually rendered right now (the page). Never the total. */
  rowCount: number
  /** Page the server served, 1-based and already clamped into range. */
  page: number
  pageSize: number
  /** Rows matching the active search, across ALL pages. */
  total: number
  /** Rows in the console's whole scope, ignoring the search. */
  catalogTotal: number
  /** The search the SERVER applied — not the one being typed. */
  search: string
  /** e.g. ["vendor", "vendors"]. */
  noun: readonly [singular: string, plural: string]
}

export function describeAdminTablePage(input: AdminTablePageSummaryInput): string {
  const { rowCount, page, pageSize, total, catalogTotal } = input
  const [singular, plural] = input.noun
  const search = input.search.trim()
  const noun = total === 1 ? singular : plural
  // The two counts pluralise independently: a one-vendor console that matched
  // nothing must not read "searched all 1 vendors".
  const catalogNoun = catalogTotal === 1 ? singular : plural

  if (total === 0) {
    return search
      ? `No ${plural} match “${search}” — searched all ${catalogTotal.toLocaleString()} ${catalogNoun}.`
      : `No ${plural} yet.`
  }

  if (rowCount === 0) {
    // `total` and the rows come from two round trips; a delete landing between
    // them leaves a non-empty total with an empty page. Say so rather than
    // deriving a backwards range ("Showing 21–20") from two disagreeing numbers.
    return `No ${plural} on page ${page.toLocaleString()} — ${total.toLocaleString()} ${noun} in total.`
  }

  const first = (page - 1) * pageSize + 1
  const last = first + rowCount - 1
  const range = `Showing ${first.toLocaleString()}–${last.toLocaleString()} of ${total.toLocaleString()} ${noun}`

  return search
    ? `${range} matching “${search}” (of ${catalogTotal.toLocaleString()} total)`
    : range
}

/**
 * The second sentence, and the reason it exists: sorting and the per-column
 * filters live in TanStack Table and therefore only ever see the rows the
 * server sent. Search does NOT — it runs in Postgres over the whole scope. A
 * console that pages server-side while filtering client-side has to say which
 * control does which, or "0 results" reads as "none exist" when it means "none
 * on this page".
 *
 * Returns null when there is only one page, because then the two scopes are the
 * same set and the caveat would be noise.
 */
export function describeAdminTableControlScope(input: {
  rowCount: number
  pageCount: number
  catalogTotal: number
  noun: readonly [singular: string, plural: string]
}): string | null {
  const { rowCount, pageCount, catalogTotal } = input
  const [, plural] = input.noun
  if (pageCount <= 1) return null
  return (
    `Sorting and the column filters apply to the ${rowCount.toLocaleString()} ` +
    `${rowCount === 1 ? "row" : "rows"} on this page; search covers all ` +
    `${catalogTotal.toLocaleString()} ${plural}.`
  )
}
