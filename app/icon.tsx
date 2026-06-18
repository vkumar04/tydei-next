import { ImageResponse } from "next/og"

// Favicon generated from the canonical TYDEi brand mark (the "T" on the
// primary gradient) so the tab icon matches the in-app logo.
export const size = { width: 32, height: 32 }
export const contentType = "image/png"

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #c2410c 0%, #f97316 100%)",
          color: "#ffffff",
          fontSize: 22,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: 7,
        }}
      >
        T
      </div>
    ),
    { ...size },
  )
}
