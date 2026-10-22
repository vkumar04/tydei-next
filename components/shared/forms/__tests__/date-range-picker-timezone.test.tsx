import { afterEach, describe, it, expect } from "vitest"
import { renderToString } from "react-dom/server"
import { DateRangePicker } from "@/components/shared/forms/date-range-picker"

const originalTz = process.env.TZ

afterEach(() => {
  process.env.TZ = originalTz
})

function renderIn(tz: string) {
  process.env.TZ = tz
  return renderToString(
    <DateRangePicker
      dateRange={{ from: "2026-07-22", to: "2026-10-22" }}
      onDateRangeChange={() => {}}
    />,
  )
}

describe("DateRangePicker date-only strings", () => {
  it.each(["UTC", "America/Los_Angeles", "Pacific/Kiritimati"])(
    "shows the calendar day it was given in %s",
    (tz) => {
      const html = renderIn(tz)
      expect(html).toContain("Jul 22, 2026")
      expect(html).toContain("Oct 22, 2026")
    },
  )
})
