import { Section, Text } from "@react-email/components"

import { Layout, colors, heading, paragraph } from "./_components/layout"

export interface AdminEmailChangedProps {
  userName: string
  previousEmail: string
  newEmail: string
  changedByName?: string | null
}

export const subject = "The email on your TYDEi account was changed"

/**
 * Sent to the PREVIOUS address after an administrator changes the email on an
 * account.
 *
 * The self-service change is double-gated — the current address approves, then
 * the new address verifies. An admin-initiated change cannot be, since the
 * point is to fix an address the owner may not control. That makes "change the
 * email, then use forgot-password" a complete account takeover, so the former
 * owner is told out-of-band that it happened and given something to do about
 * it. This mail is the only signal they get; it should read as an alert.
 */
export default function AdminEmailChanged({
  userName = "there",
  previousEmail = "",
  newEmail = "",
  changedByName,
}: AdminEmailChangedProps) {
  return (
    <Layout
      title="Your account email was changed"
      preview="An administrator changed the email address on your TYDEi account"
      footer="transactional"
    >
      <Text style={heading}>Your account email was changed</Text>
      <Text style={paragraph}>
        {userName ? `${userName}, an` : "An"} administrator
        {changedByName ? ` (${changedByName})` : ""} changed the email address
        on your TYDEi account.
      </Text>

      <Section
        style={{
          backgroundColor: colors.subtle,
          borderRadius: "8px",
          padding: "14px 16px",
          marginBottom: "20px",
        }}
      >
        <Text style={{ margin: 0, color: colors.muted, fontSize: "13px" }}>
          Was
        </Text>
        <Text style={{ margin: "2px 0 10px", color: colors.ink, fontSize: "15px" }}>
          {previousEmail}
        </Text>
        <Text style={{ margin: 0, color: colors.muted, fontSize: "13px" }}>
          Now
        </Text>
        <Text style={{ margin: "2px 0 0", color: colors.ink, fontSize: "15px", fontWeight: 600 }}>
          {newEmail}
        </Text>
      </Section>

      <Text style={paragraph}>
        Sign-in now uses the new address, and any sessions that were open have
        been signed out.
      </Text>

      <Text
        style={{
          margin: 0,
          padding: "14px 16px",
          borderRadius: "8px",
          backgroundColor: "#fdeceb",
          color: colors.danger,
          fontSize: "14px",
          lineHeight: "1.6",
        }}
      >
        <strong>If you didn&apos;t expect this, act now.</strong> Whoever holds
        the new address can reset the password and take over the account.
        Contact your administrator immediately.
      </Text>
    </Layout>
  )
}
