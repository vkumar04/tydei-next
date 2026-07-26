import { Button, Link, Text } from "@react-email/components"

import { Layout, colors, button, heading, paragraph } from "./_components/layout"

export interface VerifyEmailProps {
  url: string
  userName?: string | null
}

export const subject = "Verify your email address"

export default function VerifyEmail({
  url = "https://tydei.com",
  userName,
}: VerifyEmailProps) {
  return (
    <Layout
      title="Verify your email"
      preview="Confirm your email address to finish setting up TYDEi"
      footer="transactional"
    >
      <Text style={heading}>Confirm your email address</Text>
      <Text style={paragraph}>
        {userName ? `Welcome, ${userName}. ` : "Welcome to TYDEi. "}
        Verify your email address to activate your account and sign in.
      </Text>

      <Button href={url} style={button}>
        Verify email address
      </Button>

      <Text style={{ ...paragraph, margin: "24px 0 0", fontSize: "13px" }}>
        Sign-in requires a verified address, so this step is needed before you
        can access your account.
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
