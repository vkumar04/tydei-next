import type { ReactNode } from "react"

interface LegalPageProps {
  title: string
  /** Human-readable last-updated date, e.g. "June 17, 2026". */
  lastUpdated: string
  /** Short framing sentence under the title. */
  intro?: string
  children: ReactNode
}

/**
 * Shared shell for the public legal/policy pages (Privacy, Terms). Provides a
 * centered reading column and consistent typographic rhythm for the prose.
 * The project doesn't use @tailwindcss/typography, so heading/paragraph/list
 * styling is applied here via descendant selectors and reused by every page.
 */
export function LegalPage({ title, lastUpdated, intro, children }: LegalPageProps) {
  return (
    <article className="container mx-auto max-w-3xl px-4 py-16 md:py-24">
      <header className="mb-10 border-b pb-8">
        <h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">Last updated {lastUpdated}</p>
        {intro && <p className="mt-4 text-lg text-muted-foreground">{intro}</p>}
      </header>

      <div
        className="
          space-y-6 text-muted-foreground leading-relaxed
          [&_h2]:mt-10 [&_h2]:mb-3 [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:text-foreground
          [&_h3]:mt-6 [&_h3]:mb-2 [&_h3]:text-base [&_h3]:font-semibold [&_h3]:text-foreground
          [&_p]:mb-4
          [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-6
          [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4
          [&_strong]:text-foreground
        "
      >
        {children}
      </div>

      <p className="mt-12 rounded-xl border bg-muted/30 p-4 text-sm text-muted-foreground">
        This page is provided as a template and does not constitute legal advice.
        Please have your own counsel review and adapt it before relying on it.
      </p>
    </article>
  )
}
