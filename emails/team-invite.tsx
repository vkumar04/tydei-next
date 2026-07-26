import { Button, Section, Text } from "@react-email/components"

import { Layout, colors, button, heading, paragraph } from "./_components/layout"

export interface TeamInviteProps {
  inviterName: string
  orgName: string
  inviteUrl: string
  /** Optional role label, e.g. "Admin" — shown when the caller knows it. */
  roleLabel?: string
}

export function subject({ inviterName, orgName }: TeamInviteProps): string {
  return `${inviterName} invited you to ${orgName} on TYDEi`
}

export default function TeamInvite({
  inviterName = "A teammate",
  orgName = "your organization",
  inviteUrl = "https://tydei.com",
  roleLabel,
}: TeamInviteProps) {
  return (
    <Layout
      title="Team Invitation"
      preview={`${inviterName} invited you to join ${orgName} on TYDEi`}
      footer="transactional"
    >
      <Text style={heading}>You&apos;ve been invited</Text>
      <Text style={paragraph}>
        <strong style={{ color: colors.ink }}>{inviterName}</strong> has invited
        you to join <strong style={{ color: colors.ink }}>{orgName}</strong> on
        TYDEi, the healthcare supply chain management platform.
      </Text>

      {roleLabel ? (
        <Section
          style={{
            backgroundColor: colors.accent,
            borderRadius: "8px",
            padding: "12px 16px",
            marginBottom: "20px",
          }}
        >
          <Text style={{ margin: 0, color: colors.accentInk, fontSize: "14px" }}>
            You&apos;ll join as <strong>{roleLabel}</strong>.
          </Text>
        </Section>
      ) : null}

      <Text style={paragraph}>
        TYDEi helps healthcare organizations manage vendor contracts, track
        spend, optimize rebates, and reduce costs.
      </Text>

      <Button href={inviteUrl} style={button}>
        Accept invitation
      </Button>

      <Text style={{ margin: "24px 0 0", color: colors.faint, fontSize: "12px" }}>
        This invitation expires in 7 days. If you did not expect it, you can
        safely ignore this email.
      </Text>
    </Layout>
  )
}
