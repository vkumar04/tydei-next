import { Button, Section, Text } from "@react-email/components"

import { appUrl } from "@/lib/site-url"

import { Layout, StatTile, button, colors, heading } from "./_components/layout"

export interface WeeklyDigestProps {
  facilityName: string
  newAlerts: number
  activeContracts: number
  expiringContracts: number
  totalSpend: number
  rebatesEarned: number
  offContractSpend: number
}

export function subject({ facilityName }: WeeklyDigestProps): string {
  return `[TYDEi] Weekly Summary for ${facilityName}`
}

const fmt = (n: number) =>
  `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

const spacerRow = (
  <tr>
    <td colSpan={3} height={8} />
  </tr>
)

export default function WeeklyDigest({
  facilityName = "Your facility",
  newAlerts = 0,
  activeContracts = 0,
  expiringContracts = 0,
  totalSpend = 0,
  rebatesEarned = 0,
  offContractSpend = 0,
}: WeeklyDigestProps) {
  return (
    <Layout title="Weekly Digest" preview={`Weekly summary for ${facilityName}`}>
      <Text style={{ ...heading, marginBottom: "4px" }}>Weekly summary</Text>
      <Text style={{ margin: "0 0 24px", color: colors.muted, fontSize: "14px" }}>
        {facilityName}
      </Text>

      <Section>
        <table
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          role="presentation"
          style={{ marginBottom: "24px" }}
        >
          <tbody>
            <tr>
              <StatTile label="New alerts" value={newAlerts} />
              <td width={8} />
              <StatTile label="Active contracts" value={activeContracts} />
            </tr>
            {spacerRow}
            <tr>
              <StatTile label="Expiring soon" value={expiringContracts} />
              <td width={8} />
              <StatTile label="Rebates earned" value={fmt(rebatesEarned)} />
            </tr>
            {spacerRow}
            <tr>
              <StatTile label="Total spend" value={fmt(totalSpend)} />
              <td width={8} />
              <StatTile
                label="Off-contract spend"
                value={fmt(offContractSpend)}
                tone="danger"
              />
            </tr>
          </tbody>
        </table>
      </Section>

      <Button href={`${appUrl}/dashboard`} style={button}>
        Go to dashboard
      </Button>
    </Layout>
  )
}
