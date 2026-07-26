import { Button, Section, Text } from "@react-email/components"

import { appUrl } from "@/lib/site-url"

import {
  Layout,
  MetaRow,
  SeverityBadge,
  button,
  heading,
  paragraph,
} from "./_components/layout"

export interface RenewalReminderProps {
  contractName: string
  vendorName: string
  expirationDate: string
  contractId: string
  daysLeft: number
}

export function urgencyFor(daysLeft: number): "high" | "medium" | "low" {
  return daysLeft <= 30 ? "high" : daysLeft <= 60 ? "medium" : "low"
}

export function subject({ contractName, daysLeft }: RenewalReminderProps): string {
  return `[TYDEi] Contract "${contractName}" expires in ${daysLeft} days`
}

export default function RenewalReminder({
  contractName = "Contract",
  vendorName = "Vendor",
  expirationDate = "",
  contractId = "",
  daysLeft = 30,
}: RenewalReminderProps) {
  return (
    <Layout
      title="Renewal Reminder"
      preview={`${contractName} expires in ${daysLeft} days`}
    >
      <Text style={heading}>Contract expiring in {daysLeft} days</Text>

      <Section style={{ marginBottom: "16px" }}>
        <SeverityBadge severity={urgencyFor(daysLeft)} />
      </Section>

      <MetaRow label="Contract" value={contractName} />
      <MetaRow label="Vendor" value={vendorName} />
      <MetaRow label="Expires" value={expirationDate} />

      <Text style={{ ...paragraph, marginTop: "16px" }}>
        Review this contract and take action before it expires. Consider renewal
        terms, renegotiation, or sourcing alternatives.
      </Text>

      <Button href={`${appUrl}/dashboard/contracts/${contractId}`} style={button}>
        Review contract
      </Button>
    </Layout>
  )
}
