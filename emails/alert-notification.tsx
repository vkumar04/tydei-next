import { Button, Text } from "@react-email/components"

import { appUrl } from "@/lib/site-url"

import {
  Layout,
  MetaRow,
  SeverityBadge,
  button,
  colors,
  heading,
  paragraph,
} from "./_components/layout"

export interface AlertNotificationProps {
  title: string
  description: string | null
  severity: string
  alertType: string
  actionLink: string | null
  contractName?: string | null
  vendorName?: string | null
}

const TYPE_LABELS: Record<string, string> = {
  off_contract: "Off-Contract Spending",
  expiring_contract: "Expiring Contract",
  tier_threshold: "Tier Threshold",
  rebate_due: "Rebate Due",
  payment_due: "Payment Due",
  pricing_error: "Pricing Error",
  compliance: "Compliance",
}

export function typeLabel(alertType: string): string {
  return TYPE_LABELS[alertType] ?? alertType
}

export function subject(props: AlertNotificationProps): string {
  return `[TYDEi Alert] ${typeLabel(props.alertType)}: ${props.title}`
}

export default function AlertNotification({
  title = "Alert",
  description = null,
  severity = "medium",
  alertType = "compliance",
  actionLink = null,
  contractName,
  vendorName,
}: AlertNotificationProps) {
  return (
    <Layout title={`Alert: ${title}`} preview={`${typeLabel(alertType)}: ${title}`}>
      <Text style={heading}>{title}</Text>

      <Text style={{ margin: "0 0 16px", color: colors.muted, fontSize: "14px" }}>
        <SeverityBadge severity={severity} />
        <span style={{ marginLeft: "8px" }}>{typeLabel(alertType)}</span>
      </Text>

      {description ? <Text style={paragraph}>{description}</Text> : null}
      {contractName ? <MetaRow label="Contract" value={contractName} /> : null}
      {vendorName ? <MetaRow label="Vendor" value={vendorName} /> : null}

      {actionLink ? (
        <Button href={`${appUrl}${actionLink}`} style={{ ...button, marginTop: "12px" }}>
          View details
        </Button>
      ) : null}
    </Layout>
  )
}
