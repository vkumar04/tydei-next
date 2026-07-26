import { Button, Link, Text } from "@react-email/components"

import { Layout, colors, button, heading, paragraph } from "./_components/layout"

export interface ResetPasswordProps {
  url: string
  userName?: string | null
}

export const subject = "Reset your TYDEi password"

export default function ResetPassword({
  url = "https://tydei.com",
  userName,
}: ResetPasswordProps) {
  return (
    <Layout
      title="Reset your password"
      preview="Reset your TYDEi password"
      footer="transactional"
    >
      <Text style={heading}>Reset your password</Text>
      <Text style={paragraph}>
        {userName ? `Hi ${userName} — we` : "We"} received a request to reset
        the password for your TYDEi account. Click below to choose a new one.
      </Text>

      <Button href={url} style={button}>
        Reset password
      </Button>

      <Text style={{ ...paragraph, margin: "24px 0 0", fontSize: "13px" }}>
        This link expires in 1 hour and can only be used once. If you
        didn&apos;t request a password reset, you can ignore this email — your
        password will stay the same.
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
