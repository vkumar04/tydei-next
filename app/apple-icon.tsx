import { ImageResponse } from "next/og"

// Apple touch icon — same TYDEi brand mark, sized for iOS home screen.
export const size = { width: 180, height: 180 }
export const contentType = "image/png"

export default function AppleIcon() {
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
          fontSize: 120,
          fontWeight: 700,
          fontFamily: "sans-serif",
          borderRadius: 40,
        }}
      >
        T
      </div>
    ),
    { ...size },
  )
}
