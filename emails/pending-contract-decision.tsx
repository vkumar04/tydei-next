import { Button, Section, Text } from "@react-email/components"

import { appUrl } from "@/lib/site-url"

import { Layout, MetaRow, button, colors, heading } from "./_components/layout"

export type PendingContractDecision =
  | "approved"
  | "rejected"
  | "revision_requested"

export interface PendingContractDecisionProps {
  contractName: string
  vendorName: string
  facilityName?: string | null
  pendingId: string
  decision: PendingContractDecision
  reviewNotes?: string | null
}

export function decisionLabel(decision: PendingContractDecision): string {
  return decision === "approved"
    ? "approved"
    : decision === "rejected"
      ? "rejected"
      : "needs revision"
}

export function subject({
  decision,
  contractName,
}: PendingContractDecisionProps): string {
  return `[TYDEi] Submission ${decisionLabel(decision)}: ${contractName}`
}

export default function PendingContractDecisionEmail({
  contractName = "Contract",
  facilityName,
  pendingId = "",
  decision = "approved",
  reviewNotes,
}: PendingContractDecisionProps) {
  const label = decisionLabel(decision)

  return (
    <Layout
      title={`Submission ${label}`}
      preview={`Your submission "${contractName}" was ${label}`}
    >
      <Text style={heading}>Your contract submission was {label}</Text>

      <MetaRow label="Contract" value={contractName} />
      {facilityName ? <MetaRow label="Facility" value={facilityName} /> : null}

      {reviewNotes ? (
        <Section
          style={{
            backgroundColor: colors.subtle,
            borderLeft: `3px solid ${colors.border}`,
            borderRadius: "6px",
            padding: "14px 16px",
            margin: "16px 0",
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
            Reviewer notes
          </Text>
          <Text
            style={{
              margin: 0,
              color: colors.body,
              fontSize: "15px",
              lineHeight: "1.6",
              whiteSpace: "pre-wrap",
            }}
          >
            {reviewNotes}
          </Text>
        </Section>
      ) : null}

      <Button
        href={`${appUrl}/vendor/contracts/pending/${pendingId}/edit`}
        style={{ ...button, marginTop: "12px" }}
      >
        View submission
      </Button>
    </Layout>
  )
}
