// ─── Shared Layout ──────────────────────────────────────────────

function layout(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1);">
          <!-- Header -->
          <tr>
            <td style="background-color:#18181b;padding:24px 32px;">
              <span style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.5px;">TYDEi</span>
              <span style="color:#a1a1aa;font-size:14px;margin-left:8px;">Platform</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:32px;">
              ${body}
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;border-top:1px solid #e4e4e7;color:#71717a;font-size:12px;">
              <p style="margin:0;">You are receiving this because you have email notifications enabled in your TYDEi settings.</p>
              <p style="margin:8px 0 0;">To update your preferences, visit <a href="${process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tydei.com"}/dashboard/settings" style="color:#2563eb;text-decoration:none;">Notification Settings</a>.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`
}

// ─── Severity Badge ─────────────────────────────────────────────

function severityBadge(severity: string): string {
  const colors: Record<string, { bg: string; text: string }> = {
    high: { bg: "#fef2f2", text: "#dc2626" },
    medium: { bg: "#fffbeb", text: "#d97706" },
    low: { bg: "#f0fdf4", text: "#16a34a" },
  }
  const c = colors[severity] ?? colors.medium
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;background-color:${c.bg};color:${c.text};font-size:12px;font-weight:600;text-transform:uppercase;">${severity}</span>`
}

// ─── Alert Notification ─────────────────────────────────────────

interface AlertEmailInput {
  title: string
  description: string | null
  severity: string
  alertType: string
  actionLink: string | null
  contractName?: string | null
  vendorName?: string | null
}

export function alertNotificationEmail(alert: AlertEmailInput): {
  subject: string
  html: string
} {
  const typeLabels: Record<string, string> = {
    off_contract: "Off-Contract Spending",
    expiring_contract: "Expiring Contract",
    tier_threshold: "Tier Threshold",
    rebate_due: "Rebate Due",
    payment_due: "Payment Due",
    pricing_error: "Pricing Error",
    compliance: "Compliance",
  }

  const typeLabel = typeLabels[alert.alertType] ?? alert.alertType
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tydei.com"

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">${alert.title}</h2>
    <p style="margin:0 0 16px;color:#71717a;font-size:14px;">
      ${severityBadge(alert.severity)}
      <span style="margin-left:8px;">${typeLabel}</span>
    </p>
    ${alert.description ? `<p style="margin:0 0 16px;color:#3f3f46;font-size:15px;line-height:1.6;">${alert.description}</p>` : ""}
    ${alert.contractName ? `<p style="margin:0 0 4px;color:#71717a;font-size:13px;"><strong>Contract:</strong> ${alert.contractName}</p>` : ""}
    ${alert.vendorName ? `<p style="margin:0 0 16px;color:#71717a;font-size:13px;"><strong>Vendor:</strong> ${alert.vendorName}</p>` : ""}
    ${alert.actionLink ? `<a href="${appUrl}${alert.actionLink}" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;margin-top:8px;">View Details</a>` : ""}
  `

  return {
    subject: `[TYDEi Alert] ${typeLabel}: ${alert.title}`,
    html: layout(`Alert: ${alert.title}`, body),
  }
}

// ─── Renewal Reminder ───────────────────────────────────────────

interface RenewalReminderInput {
  contractName: string
  vendorName: string
  expirationDate: string
  contractId: string
}

export function renewalReminderEmail(
  contract: RenewalReminderInput,
  daysLeft: number
): { subject: string; html: string } {
  const urgency =
    daysLeft <= 30 ? "high" : daysLeft <= 60 ? "medium" : "low"
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tydei.com"

  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">Contract Expiring in ${daysLeft} Days</h2>
    <p style="margin:0 0 16px;">${severityBadge(urgency)}</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td style="padding:8px 0;color:#71717a;font-size:13px;width:120px;">Contract</td>
        <td style="padding:8px 0;color:#18181b;font-size:14px;font-weight:500;">${contract.contractName}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#71717a;font-size:13px;">Vendor</td>
        <td style="padding:8px 0;color:#18181b;font-size:14px;">${contract.vendorName}</td>
      </tr>
      <tr>
        <td style="padding:8px 0;color:#71717a;font-size:13px;">Expires</td>
        <td style="padding:8px 0;color:#18181b;font-size:14px;">${contract.expirationDate}</td>
      </tr>
    </table>
    <p style="margin:0 0 16px;color:#3f3f46;font-size:15px;line-height:1.6;">
      Review this contract and take action before it expires. Consider renewal terms, renegotiation, or sourcing alternatives.
    </p>
    <a href="${appUrl}/dashboard/contracts/${contract.contractId}" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Review Contract</a>
  `

  return {
    subject: `[TYDEi] Contract "${contract.contractName}" expires in ${daysLeft} days`,
    html: layout("Renewal Reminder", body),
  }
}

// ─── Weekly Digest ──────────────────────────────────────────────

interface WeeklyDigestStats {
  facilityName: string
  newAlerts: number
  activeContracts: number
  expiringContracts: number
  totalSpend: number
  rebatesEarned: number
  offContractSpend: number
}

export function weeklyDigestEmail(stats: WeeklyDigestStats): {
  subject: string
  html: string
} {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.tydei.com"
  const fmt = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

  const body = `
    <h2 style="margin:0 0 4px;font-size:20px;color:#18181b;">Weekly Summary</h2>
    <p style="margin:0 0 24px;color:#71717a;font-size:14px;">${stats.facilityName}</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
      <tr>
        <td width="50%" style="padding:12px;background-color:#f4f4f5;border-radius:6px;vertical-align:top;">
          <p style="margin:0;color:#71717a;font-size:12px;text-transform:uppercase;">New Alerts</p>
          <p style="margin:4px 0 0;color:#18181b;font-size:24px;font-weight:700;">${stats.newAlerts}</p>
        </td>
        <td width="8"></td>
        <td width="50%" style="padding:12px;background-color:#f4f4f5;border-radius:6px;vertical-align:top;">
          <p style="margin:0;color:#71717a;font-size:12px;text-transform:uppercase;">Active Contracts</p>
          <p style="margin:4px 0 0;color:#18181b;font-size:24px;font-weight:700;">${stats.activeContracts}</p>
        </td>
      </tr>
      <tr><td colspan="3" height="8"></td></tr>
      <tr>
        <td width="50%" style="padding:12px;background-color:#f4f4f5;border-radius:6px;vertical-align:top;">
          <p style="margin:0;color:#71717a;font-size:12px;text-transform:uppercase;">Expiring Soon</p>
          <p style="margin:4px 0 0;color:#18181b;font-size:24px;font-weight:700;">${stats.expiringContracts}</p>
        </td>
        <td width="8"></td>
        <td width="50%" style="padding:12px;background-color:#f4f4f5;border-radius:6px;vertical-align:top;">
          <p style="margin:0;color:#71717a;font-size:12px;text-transform:uppercase;">Rebates Earned</p>
          <p style="margin:4px 0 0;color:#18181b;font-size:24px;font-weight:700;">${fmt(stats.rebatesEarned)}</p>
        </td>
      </tr>
      <tr><td colspan="3" height="8"></td></tr>
      <tr>
        <td width="50%" style="padding:12px;background-color:#f4f4f5;border-radius:6px;vertical-align:top;">
          <p style="margin:0;color:#71717a;font-size:12px;text-transform:uppercase;">Total Spend</p>
          <p style="margin:4px 0 0;color:#18181b;font-size:24px;font-weight:700;">${fmt(stats.totalSpend)}</p>
        </td>
        <td width="8"></td>
        <td width="50%" style="padding:12px;background-color:#f4f4f5;border-radius:6px;vertical-align:top;">
          <p style="margin:0;color:#71717a;font-size:12px;text-transform:uppercase;">Off-Contract Spend</p>
          <p style="margin:4px 0 0;color:#dc2626;font-size:24px;font-weight:700;">${fmt(stats.offContractSpend)}</p>
        </td>
      </tr>
    </table>

    <a href="${appUrl}/dashboard" style="display:inline-block;padding:10px 24px;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Go to Dashboard</a>
  `

  return {
    subject: `[TYDEi] Weekly Summary for ${stats.facilityName}`,
    html: layout("Weekly Digest", body),
  }
}

// ─── Team Invite ────────────────────────────────────────────────

export function teamInviteEmail(
  inviterName: string,
  orgName: string,
  inviteUrl: string
): { subject: string; html: string } {
  const body = `
    <h2 style="margin:0 0 8px;font-size:20px;color:#18181b;">You've Been Invited</h2>
    <p style="margin:0 0 24px;color:#3f3f46;font-size:15px;line-height:1.6;">
      <strong>${inviterName}</strong> has invited you to join <strong>${orgName}</strong> on TYDEi, the healthcare supply chain management platform.
    </p>
    <p style="margin:0 0 24px;color:#3f3f46;font-size:15px;line-height:1.6;">
      TYDEi helps healthcare organizations manage vendor contracts, track spend, optimize rebates, and reduce costs.
    </p>
    <a href="${inviteUrl}" style="display:inline-block;padding:12px 32px;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">Accept Invitation</a>
    <p style="margin:24px 0 0;color:#a1a1aa;font-size:12px;">This invitation expires in 7 days. If you did not expect this invitation, you can safely ignore this email.</p>
  `

  return {
    subject: `${inviterName} invited you to ${orgName} on TYDEi`,
    html: layout("Team Invitation", body),
  }
}
