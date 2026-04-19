/**
 * RFC 5545 iCalendar (.ics) generator for contract renewal events.
 *
 * Pure, zero-dependency implementation. Produces a VCALENDAR body with
 * one all-day VEVENT per renewal, CRLF line endings, and proper
 * line folding (octet-based wrap at 75 bytes).
 *
 * See: https://datatracker.ietf.org/doc/html/rfc5545
 */

export interface RenewalEvent {
  contractId: string
  contractName: string
  vendorName: string
  /** ISO-8601 string or Date for the contract expiration (all-day). */
  expirationDate: string | Date
  daysRemaining: number
}

const CRLF = "\r\n"
const PRODID = "-//Tydei//Tydei Renewals//EN"
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tydei.com"

/**
 * Escape a TEXT value per RFC 5545 §3.3.11.
 * Order matters: backslash first, then commas/semicolons, then newlines.
 */
function escapeText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n")
}

/**
 * Format a Date (or ISO string) as an all-day DATE value (YYYYMMDD) in UTC.
 * Per RFC 5545 §3.3.4, DATE values have no time component.
 */
function formatDate(input: string | Date): string {
  const d = input instanceof Date ? input : new Date(input)
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0")
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0")
  const dd = d.getUTCDate().toString().padStart(2, "0")
  return `${yyyy}${mm}${dd}`
}

/**
 * Format a Date as a UTC DATE-TIME value (YYYYMMDDTHHMMSSZ) per §3.3.5.
 * Used for DTSTAMP / CREATED / LAST-MODIFIED.
 */
function formatDateTimeUtc(d: Date): string {
  const yyyy = d.getUTCFullYear().toString().padStart(4, "0")
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0")
  const dd = d.getUTCDate().toString().padStart(2, "0")
  const hh = d.getUTCHours().toString().padStart(2, "0")
  const mi = d.getUTCMinutes().toString().padStart(2, "0")
  const ss = d.getUTCSeconds().toString().padStart(2, "0")
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`
}

/**
 * Fold a single content line to ≤75 octets per RFC 5545 §3.1.
 * Continuation lines start with a single whitespace character.
 * Operates on UTF-8 byte length — multi-byte chars are never split.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const bytes = encoder.encode(line)
  if (bytes.length <= 75) return line

  const decoder = new TextDecoder()
  const out: string[] = []
  let i = 0
  let first = true
  while (i < bytes.length) {
    // First line max 75 octets; continuation lines max 74 octets (leading space
    // brings the on-wire line to 75).
    const max = first ? 75 : 74
    let end = Math.min(i + max, bytes.length)
    // Don't split a UTF-8 continuation byte (0b10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end -= 1
    }
    const chunk = decoder.decode(bytes.slice(i, end))
    out.push(first ? chunk : ` ${chunk}`)
    first = false
    i = end
  }
  return out.join(CRLF)
}

function buildEvent(event: RenewalEvent, stamp: string): string[] {
  const uid = `renewal-${event.contractId}@tydei.app`
  const dtstart = formatDate(event.expirationDate)
  const summary = escapeText(
    `Contract renewal: ${event.contractName} (${event.vendorName})`,
  )
  const description = escapeText(
    [
      `${event.daysRemaining} day${event.daysRemaining === 1 ? "" : "s"} remaining until expiration.`,
      `Vendor: ${event.vendorName}`,
      `Contract: ${BASE_URL}/contracts/${event.contractId}`,
    ].join("\n"),
  )
  const url = `${BASE_URL}/contracts/${event.contractId}`

  return [
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;VALUE=DATE:${dtstart}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    `URL:${url}`,
    "STATUS:CONFIRMED",
    "TRANSP:TRANSPARENT",
    "END:VEVENT",
  ].map(foldLine)
}

/**
 * Produce an RFC 5545 VCALENDAR body listing every renewal as an all-day
 * VEVENT. Returns a single string with CRLF line endings ready to serve
 * as `text/calendar`.
 */
export function generateRenewalsICS(renewals: RenewalEvent[]): string {
  const stamp = formatDateTimeUtc(new Date())
  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Tydei Contract Renewals",
    "X-WR-CALDESC:Upcoming contract renewals tracked in Tydei",
  ].map(foldLine)

  for (const event of renewals) {
    lines.push(...buildEvent(event, stamp))
  }

  lines.push(foldLine("END:VCALENDAR"))
  return lines.join(CRLF) + CRLF
}
