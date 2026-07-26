import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components"
import type { ReactNode } from "react"

import { appUrl } from "@/lib/site-url"

/**
 * The one shell every TYDEi email renders inside.
 *
 * Theme: these hex values are the app's own design tokens from
 * `app/globals.css`, converted from oklch. Email clients don't support
 * CSS variables or oklch(), so the conversion has to be baked in here —
 * this file is the single place that happens. If the brand palette
 * changes in globals.css, re-convert and update `colors` below.
 *
 *   --primary          oklch(0.57 0.1902 32)      -> #cf3a21
 *   --accent           oklch(0.9204 0.0203 238.7) -> #d9e7f1
 *   --foreground       oklch(0.2809 0 0)          -> #292929
 *   --muted-foreground oklch(0.4999 0.0154 251.7) -> #5d646c
 *   --border           oklch(0.9209 0.0035 247.9) -> #e3e5e7
 *   --background       oklch(0.9846 0.0017 247.8) -> #f9fafb
 *   dark surface       oklch(0.2188 0.0148 248.5) -> #151b21
 */

export const colors = {
  primary: "#cf3a21",
  primaryHover: "#f76046",
  ink: "#292929",
  body: "#3f4650",
  muted: "#5d646c",
  faint: "#9aa1a9",
  border: "#e3e5e7",
  surface: "#f9fafb",
  subtle: "#f4f5f6",
  accent: "#d9e7f1",
  accentInk: "#204177",
  dark: "#151b21",
  white: "#ffffff",
  danger: "#cf3a21",
} as const

export const button = {
  display: "inline-block",
  padding: "12px 28px",
  backgroundColor: colors.primary,
  color: colors.white,
  fontSize: "14px",
  fontWeight: 600,
  textDecoration: "none",
  borderRadius: "8px",
} as const

export const heading = {
  margin: "0 0 8px",
  fontSize: "20px",
  color: colors.ink,
  fontWeight: 700,
  letterSpacing: "-0.3px",
} as const

export const paragraph = {
  margin: "0 0 16px",
  color: colors.body,
  fontSize: "15px",
  lineHeight: "1.6",
} as const

export const metaLine = {
  margin: "0 0 8px",
  color: colors.muted,
  fontSize: "14px",
} as const

const FONT_STACK =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"

interface LayoutProps {
  /** Inbox preview line. Falls back to the title when omitted. */
  preview?: string
  title: string
  children: ReactNode
  /**
   * Transactional mail (password reset, verification, invitations) is not
   * governed by notification preferences, so it must not carry the
   * "change your preferences" footer — that would be misleading.
   */
  footer?: "preferences" | "transactional"
}

export function Layout({
  preview,
  title,
  children,
  footer = "preferences",
}: LayoutProps) {
  return (
    <Html lang="en">
      <Head />
      <Preview>{preview ?? title}</Preview>
      <Body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: colors.surface,
          fontFamily: FONT_STACK,
        }}
      >
        <Section style={{ padding: "32px 16px" }}>
          <Container
            style={{
              width: "600px",
              maxWidth: "100%",
              backgroundColor: colors.white,
              borderRadius: "12px",
              overflow: "hidden",
              border: `1px solid ${colors.border}`,
              padding: 0,
            }}
          >
            {/* Brand bar — mirrors the in-app mark: rounded square in
                primary with a white "T", wordmark alongside. */}
            <Section style={{ backgroundColor: colors.dark, padding: "20px 32px" }}>
              <table cellPadding={0} cellSpacing={0} role="presentation">
                <tbody>
                  <tr>
                    <td style={{ paddingRight: "12px", verticalAlign: "middle" }}>
                      <div
                        style={{
                          width: "36px",
                          height: "36px",
                          backgroundColor: colors.primary,
                          borderRadius: "10px",
                          textAlign: "center",
                          lineHeight: "36px",
                          color: colors.white,
                          fontSize: "17px",
                          fontWeight: 700,
                        }}
                      >
                        T
                      </div>
                    </td>
                    <td style={{ verticalAlign: "middle" }}>
                      <Text
                        style={{
                          margin: 0,
                          color: colors.white,
                          fontSize: "19px",
                          fontWeight: 700,
                          letterSpacing: "-0.4px",
                          lineHeight: "20px",
                        }}
                      >
                        TYDEi
                      </Text>
                      <Text
                        style={{
                          margin: 0,
                          color: colors.faint,
                          fontSize: "12px",
                          lineHeight: "16px",
                        }}
                      >
                        Healthcare supply chain
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            <Section style={{ padding: "32px" }}>{children}</Section>

            <Hr style={{ borderColor: colors.border, margin: 0 }} />
            <Section style={{ padding: "20px 32px", backgroundColor: colors.subtle }}>
              {footer === "preferences" ? (
                <>
                  <Text style={{ margin: 0, color: colors.muted, fontSize: "12px" }}>
                    You are receiving this because you have email notifications
                    enabled in your TYDEi settings.
                  </Text>
                  <Text
                    style={{ margin: "6px 0 0", color: colors.muted, fontSize: "12px" }}
                  >
                    <Link
                      href={`${appUrl}/dashboard/settings`}
                      style={{ color: colors.primary, textDecoration: "none" }}
                    >
                      Update notification preferences
                    </Link>
                  </Text>
                </>
              ) : (
                <Text style={{ margin: 0, color: colors.muted, fontSize: "12px" }}>
                  This is an automated message from TYDEi. If you weren&apos;t
                  expecting it, you can safely ignore this email.
                </Text>
              )}
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  )
}

/** Pill used for alert severity and renewal urgency. */
export function SeverityBadge({ severity }: { severity: string }) {
  const palette: Record<string, { bg: string; text: string }> = {
    high: { bg: "#fdeceb", text: "#cf3a21" },
    medium: { bg: "#fff7ed", text: "#c2410c" },
    low: { bg: "#eef6f0", text: "#15803d" },
  }
  const c = palette[severity] ?? palette.medium
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: "999px",
        backgroundColor: c.bg,
        color: c.text,
        fontSize: "11px",
        fontWeight: 700,
        textTransform: "uppercase",
        letterSpacing: "0.4px",
      }}
    >
      {severity}
    </span>
  )
}

/** Label/value row used by the renewal and pending-contract templates. */
export function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <Text style={metaLine}>
      <strong style={{ color: colors.ink }}>{label}:</strong> {value}
    </Text>
  )
}

/** Stat tile used by the weekly digest. */
export function StatTile({
  label,
  value,
  tone = "default",
}: {
  label: string
  value: string | number
  tone?: "default" | "danger"
}) {
  return (
    <td
      width="50%"
      style={{
        padding: "14px",
        backgroundColor: colors.subtle,
        borderRadius: "8px",
        verticalAlign: "top",
      }}
    >
      <Text
        style={{
          margin: 0,
          color: colors.muted,
          fontSize: "11px",
          textTransform: "uppercase",
          letterSpacing: "0.4px",
          fontWeight: 600,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          margin: "4px 0 0",
          color: tone === "danger" ? colors.danger : colors.ink,
          fontSize: "24px",
          fontWeight: 700,
        }}
      >
        {value}
      </Text>
    </td>
  )
}
