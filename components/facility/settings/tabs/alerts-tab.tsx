"use client"

/**
 * Facility Settings — "Alerts" tab.
 *
 * Thin shell that hosts the EXISTING per-user renewal alert-settings form
 * (`components/facility/renewals/renewal-alert-settings-form.tsx`). The form
 * owns its own data fetching (`getRenewalAlertSettings`) and persistence
 * (`saveRenewalAlertSettings`) — this tab only provides the Card shell so it
 * matches the other Settings tabs. No logic is duplicated.
 */

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { RenewalAlertSettingsForm } from "@/components/facility/renewals/renewal-alert-settings-form"

export function AlertsTab() {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Contract Renewal Alerts</CardTitle>
        <CardDescription>
          Configure when and how you&apos;re reminded about expiring and
          renewing contracts.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <RenewalAlertSettingsForm />
      </CardContent>
    </Card>
  )
}
