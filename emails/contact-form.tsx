import { Section, Text } from "@react-email/components"

import { Layout, MetaRow, colors, heading } from "./_components/layout"

export interface ContactFormProps {
  name: string
  email: string
  company?: string | null
  message: string
}

export function subject({ name }: ContactFormProps): string {
  return `New contact form message from ${name}`
}

export default function ContactForm({
  name = "",
  email = "",
  company,
  message = "",
}: ContactFormProps) {
  return (
    <Layout
      title="New contact form submission"
      preview={`${name} sent a message via the TYDEi contact form`}
      footer="transactional"
    >
      <Text style={heading}>New contact form submission</Text>

      <MetaRow label="Name" value={name} />
      <MetaRow label="Email" value={email} />
      {company ? <MetaRow label="Company" value={company} /> : null}

      <Section
        style={{
          backgroundColor: colors.subtle,
          borderRadius: "8px",
          padding: "16px",
          marginTop: "16px",
        }}
      >
        <Text
          style={{
            margin: "0 0 6px",
            color: colors.muted,
            fontSize: "12px",
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.4px",
          }}
        >
          Message
        </Text>
        {/* React escapes this — the old string template hand-rolled
            escapeHtml() to avoid injecting attacker-controlled markup
            into the support inbox. */}
        <Text
          style={{
            margin: 0,
            color: colors.body,
            fontSize: "15px",
            lineHeight: "1.6",
            whiteSpace: "pre-wrap",
          }}
        >
          {message}
        </Text>
      </Section>
    </Layout>
  )
}
