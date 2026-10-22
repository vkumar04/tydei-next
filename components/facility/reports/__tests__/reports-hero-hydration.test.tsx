import { describe, it, expect } from "vitest"
import { renderToString } from "react-dom/server"
import { ReportsHero } from "@/components/facility/reports/reports-hero"

function render(lastSentAt: string | null) {
  return renderToString(
    <ReportsHero
      contractCount={3}
      vendorCount={2}
      activeSchedules={1}
      totalSchedules={1}
      lastSentAt={lastSentAt}
      priceDiscrepancyHref="/dashboard/reports/price-discrepancy"
      onOpenScheduledReports={() => {}}
    />,
  )
}

describe("ReportsHero server render", () => {
  it("leaves the clock-relative Last Sent value to the client", () => {
    const html = render(new Date(Date.now() - 37_000).toISOString())
    expect(html).toContain("Last Sent")
    expect(html).not.toMatch(/\d+(s|m|h|d|mo|y) ago/)
  })

  it("renders no relative time when nothing has been sent", () => {
    expect(render(null)).not.toMatch(/ ago/)
  })
})
