import { test as base, expect } from "@playwright/test"
import type { Page } from "@playwright/test"

const STREAM_SETTLE_TIMEOUT_MS = 5_000

export async function waitForStreamedSegments(page: Page): Promise<void> {
  await page
    .waitForFunction(() => !document.querySelector('div[hidden][id^="S:"]'), undefined, {
      timeout: STREAM_SETTLE_TIMEOUT_MS,
    })
    .catch(() => undefined)
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page)
    page.goto = async (url, options) => {
      const response = await goto(url, options)
      await waitForStreamedSegments(page)
      return response
    }
    await use(page)
  },
})

export { expect }
