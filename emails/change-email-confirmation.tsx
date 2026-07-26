import { Button, Link, Section, Text } from "@react-email/components"

import { Layout, colors, button, heading, paragraph } from "./_components/layout"

export interface ChangeEmailConfirmationProps {
  url: string
  newEmail: string
  userName?: string | null
}

export const subject = "Approve your TYDEi email change"

/**
 * Sent to the user's CURRENT address when they request an email change.
 *
 * This is the account-takeover guard: someone who hijacks a live session
 * cannot silently move the account to their own address, because the
 * change is not even proposed to the new address until the current owner
 * clicks through here.
 */
export default function ChangeEmailConfirmation({
  url = "https://tydei.com",
  newEmail = "",
  userName,
}: ChangeEmailConfirmationProps) {
  return (
    <Layout
      title="Approve your email change"
      preview={`Approve changing your TYDEi email to ${newEmail}`}
      footer="transactional"
    >
      <Text style={heading}>Approve this email change</Text>
      <Text style={paragraph}>
        {userName ? `${userName}, a` : "A"} request was made to change the email
        address on your TYDEi account to:
      </Text>

      <Section
        style={{
          backgroundColor: colors.subtle,
          borderRadius: "8px",
          padding: "14px 16px",
          marginBottom: "20px",
        }}
      >
        <Text
          style={{ margin: 0, color: colors.ink, fontSize: "15px", fontWeight: 600 }}
        >
          {newEmail}
        </Text>
      </Section>

      <Text style={paragraph}>
        Approve it below. We&apos;ll then send a verification link to the new
        address — the change only takes effect once that link is clicked too.
      </Text>

      <Button href={url} style={button}>
        Approve email change
      </Button>

      <Text style={{ ...paragraph, margin: "24px 0 0", fontSize: "13px" }}>
        <strong style={{ color: colors.ink }}>
          If you didn&apos;t request this, do not click the button.
        </strong>{" "}
        Your address stays as it is, and you should change your password —
        someone may have access to your account.
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
