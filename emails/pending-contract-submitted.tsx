import { Button, Text } from "@react-email/components"

import { appUrl } from "@/lib/site-url"

import { Layout, MetaRow, button, colors, heading, paragraph } from "./_components/layout"

export interface PendingContractSubmittedProps {
  contractName: string
  vendorName: string
  facilityName?: string | null
  pendingId: string
}

export function subject({ vendorName }: PendingContractSubmittedProps): string {
  return `[TYDEi] ${vendorName} submitted a contract for review`
}

export default function PendingContractSubmitted({
  contractName = "Contract",
  vendorName = "Vendor",
  facilityName,
}: PendingContractSubmittedProps) {
  return (
    <Layout
      title={`New submission: ${contractName}`}
      preview={`${vendorName} submitted a contract for your review`}
    >
      <Text style={heading}>New contract submission from {vendorName}</Text>

      <Text style={paragraph}>
        <strong style={{ color: colors.ink }}>{vendorName}</strong> has submitted
        a contract for your review:
      </Text>

      <MetaRow label="Contract" value={contractName} />
      {facilityName ? <MetaRow label="Facility" value={facilityName} /> : null}

      <Button href={`${appUrl}/dashboard/contracts`} style={{ ...button, marginTop: "12px" }}>
        Review submission
      </Button>
    </Layout>
  )
}
