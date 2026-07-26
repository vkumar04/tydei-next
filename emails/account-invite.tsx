import { Button, Link, Section, Text } from "@react-email/components"

import { Layout, colors, button, heading, paragraph } from "./_components/layout"

export interface AccountInviteProps {
  /** Set-password link (a reset-password token minted at creation). */
  url: string
  userName: string
  /** Who created the account, for context. */
  invitedByName?: string | null
  /** "Facility" | "Vendor" | "Admin" — what they'll be able to do. */
  roleLabel?: string | null
  /** Organisations they were granted access to, if any. */
  organizations?: string[]
}

export const subject = "Your TYDEi account is ready — choose a password"

/**
 * Sent when an operator creates an account from the admin portal.
 *
 * The admin no longer sets a password (they'd have to communicate it out of
 * band, and would know it afterwards). Instead the account is created with no
 * credential and this link lets the person set their own — better-auth's
 * reset flow mints the credential on first use.
 */
export default function AccountInvite({
  url = "https://tydei.com",
  userName = "there",
  invitedByName,
  roleLabel,
  organizations = [],
}: AccountInviteProps) {
  return (
    <Layout
      title="Your TYDEi account is ready"
      preview="Choose a password to activate your TYDEi account"
      footer="transactional"
    >
      <Text style={heading}>Welcome to TYDEi, {userName}</Text>
      <Text style={paragraph}>
        {invitedByName ? `${invitedByName} has created` : "An administrator has created"}{" "}
        an account for you. Choose a password below and you&apos;re in.
      </Text>

      {(roleLabel || organizations.length > 0) && (
        <Section
          style={{
            backgroundColor: colors.subtle,
            borderRadius: "8px",
            padding: "14px 16px",
            marginBottom: "20px",
          }}
        >
          {roleLabel ? (
            <Text style={{ margin: 0, color: colors.body, fontSize: "14px" }}>
              <strong style={{ color: colors.ink }}>Access:</strong> {roleLabel}
            </Text>
          ) : null}
          {organizations.length > 0 ? (
            <Text
              style={{
                margin: roleLabel ? "6px 0 0" : 0,
                color: colors.body,
                fontSize: "14px",
              }}
            >
              <strong style={{ color: colors.ink }}>
                {organizations.length === 1 ? "Organization" : "Organizations"}:
              </strong>{" "}
              {organizations.join(", ")}
            </Text>
          ) : null}
        </Section>
      )}

      <Button href={url} style={button}>
        Choose your password
      </Button>

      <Text style={{ ...paragraph, margin: "24px 0 0", fontSize: "13px" }}>
        This link is valid for 7 days. If it expires, use &quot;Forgot
        password&quot; on the sign-in page to get a new one.
      </Text>

      <Text style={{ margin: "16px 0 0", color: colors.faint, fontSize: "12px" }}>
        Button not working? Paste this into your browser:
        <br />
        <Link href={url} style={{ color: colors.primary, wordBreak: "break-all" }}>
          {url}
        </Link>
      </Text>
    </Layout>
  )
}
