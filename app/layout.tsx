import type { Metadata, Viewport } from "next"
import { Inter, Geist_Mono } from "next/font/google"
import { Providers } from "@/components/providers"
import { siteUrl } from "@/lib/site-url"
import "./globals.css"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
})

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
})

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "TYDEi — Healthcare Contract & Rebate Intelligence",
    template: "%s · TYDEi",
  },
  description:
    "The contract, rebate, and case-costing intelligence platform for healthcare supply chains. Automate rebate tracking, see true per-case margins, extract contract terms with AI, and let vendors manage their own data.",
  applicationName: "TYDEi Platform",
  authors: [{ name: "TYDEi" }],
  creator: "TYDEi",
  publisher: "TYDEi",
  keywords: [
    "healthcare contract management",
    "rebate tracking",
    "rebate management software",
    "case costing",
    "payor contract reimbursement",
    "GPO contract compliance",
    "vendor contract portal",
    "medical supply chain analytics",
    "true margin analysis",
    "off-contract spend",
    "ASC contract management",
    "AI contract extraction",
  ],
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    siteName: "TYDEi Platform",
    title: "TYDEi — Turn Healthcare Contracts Into Earnings",
    description:
      "Automate rebate tracking, cost every case, extract contract terms with AI, and let vendors manage their own data — one platform for the whole contract lifecycle.",
    url: siteUrl,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "TYDEi — Healthcare Contract & Rebate Intelligence",
    description:
      "Automate rebate tracking, cost every case, and extract contract terms with AI. The contract intelligence platform for healthcare supply chains.",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  category: "technology",
}

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8fafc" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0f" },
  ],
  width: "device-width",
  initialScale: 1,
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} ${geistMono.variable} font-sans antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
