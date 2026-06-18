import { ImageResponse } from "next/og"

// Social share image (used for og:image and twitter:image). Brand mark +
// headline on the dark app background so links unfurl on-brand.
export const alt = "TYDEi — Healthcare Contract & Rebate Intelligence"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          padding: "80px",
          background:
            "radial-gradient(1000px 500px at 75% 0%, rgba(249,115,22,0.18), transparent), #0a0a0f",
          color: "#e5e7eb",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
          <div
            style={{
              width: 96,
              height: 96,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #c2410c 0%, #f97316 100%)",
              color: "#ffffff",
              fontSize: 56,
              fontWeight: 700,
              borderRadius: 24,
            }}
          >
            T
          </div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <span style={{ fontSize: 44, fontWeight: 700, color: "#ffffff" }}>
              TYDEi
            </span>
            <span style={{ fontSize: 24, color: "#9ca3af" }}>
              Healthcare Platform
            </span>
          </div>
        </div>

        <div
          style={{
            display: "flex",
            fontSize: 72,
            fontWeight: 700,
            color: "#ffffff",
            marginTop: 56,
            lineHeight: 1.1,
            maxWidth: 900,
          }}
        >
          Turn Healthcare Contracts Into Earnings
        </div>
        <div
          style={{
            display: "flex",
            fontSize: 30,
            color: "#9ca3af",
            marginTop: 28,
            maxWidth: 920,
          }}
        >
          Automated rebate tracking · per-case margins · AI contract extraction
        </div>
      </div>
    ),
    { ...size },
  )
}
