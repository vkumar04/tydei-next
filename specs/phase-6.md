# Phase 6 -- Contract Renewals + Rebate Optimizer + Settings

## Objective

Build contract renewal tracking with timeline views, the rebate optimization engine that identifies opportunities to maximize rebate tiers, and comprehensive settings pages for both facility and vendor portals. Rounds out the core experience.

## Dependencies

- Phase 5 (vendor portal complete, PO/invoice features for optimization context)

## Tech Stack

| Tool | Purpose |
|------|---------|
| Recharts | Rebate optimizer charts, renewal timeline |
| react-hook-form + Zod | Settings profile forms, team invite form |
| TanStack Table | Team members table |
| shadcn | Tabs, Switch, Progress, Dialog, Accordion |

---

## Server Actions

### `lib/actions/renewals.ts`

```typescript
"use server"

// Get contracts expiring within window
export async function getExpiringContracts(input: {
  facilityId?: string
  vendorId?: string
  windowDays: number // 30, 60, 90, 120
}): Promise<ExpiringContract[]>

// Get renewal summary for a contract
export async function getRenewalSummary(contractId: string): Promise<{
  contract: ContractWithVendor
  daysUntilExpiry: number
  totalSpend: number
  totalRebate: number
  tierAchieved: number
  renewalRecommendation: string
}>

// Initiate renewal (creates a draft copy of the contract with new dates)
export async function initiateRenewal(contractId: string): Promise<Contract>
```

### `lib/actions/rebate-optimizer.ts`

```typescript
"use server"

// Get optimization opportunities
export async function getRebateOpportunities(facilityId: string): Promise<RebateOpportunity[]>
// Each opportunity includes:
//   contractId, contractName, vendorName,
//   currentTier, nextTier, currentSpend,
//   nextTierThreshold, spendGap, projectedAdditionalRebate,
//   percentToNextTier

// Set spend target for a contract
export async function setSpendTarget(input: {
  contractId: string
  facilityId: string
  targetSpend: number
  targetDate: string
}): Promise<void>

// Get spend targets
export async function getSpendTargets(facilityId: string): Promise<SpendTarget[]>
```

### `lib/actions/settings.ts`

```typescript
"use server"

// ── Facility Settings ──

// Get facility profile
export async function getFacilityProfile(facilityId: string): Promise<FacilityProfile>

// Update facility profile
export async function updateFacilityProfile(facilityId: string, input: UpdateFacilityProfileInput): Promise<void>

// Get notification preferences
export async function getNotificationPreferences(facilityId: string): Promise<NotificationPreferences>

// Update notification preferences
export async function updateNotificationPreferences(facilityId: string, prefs: NotificationPreferences): Promise<void>

// Get team members
export async function getTeamMembers(organizationId: string): Promise<TeamMember[]>

// Invite team member
export async function inviteTeamMember(input: {
  organizationId: string
  email: string
  role: string
}): Promise<void>

// Remove team member
export async function removeTeamMember(memberId: string): Promise<void>

// Update team member role
export async function updateTeamMemberRole(memberId: string, role: string): Promise<void>

// Get feature flags
export async function getFeatureFlags(facilityId: string): Promise<FeatureFlag>

// Update feature flags
export async function updateFeatureFlags(facilityId: string, flags: Partial<FeatureFlag>): Promise<void>

// ── Vendor Settings ──

// Get vendor profile
export async function getVendorProfile(vendorId: string): Promise<VendorProfile>

// Update vendor profile
export async function updateVendorProfile(vendorId: string, input: UpdateVendorProfileInput): Promise<void>

// Get vendor team members
export async function getVendorTeamMembers(organizationId: string): Promise<VendorTeamMember[]>

// Invite vendor team member (with sub-role: admin, manager, rep)
export async function inviteVendorTeamMember(input: {
  organizationId: string
  email: string
  role: string
  subRole: VendorSubRole
}): Promise<void>
```

### `lib/actions/connections.ts`

```typescript
"use server"

// Get connections for facility or vendor
export async function getConnections(input: {
  facilityId?: string
  vendorId?: string
  status?: ConnectionStatus
}): Promise<Connection[]>

// Send connection invite
export async function sendConnectionInvite(input: {
  fromType: "facility" | "vendor"
  fromId: string
  fromName: string
  toEmail: string
  toName: string
  message?: string
}): Promise<Connection>

// Accept connection
export async function acceptConnection(connectionId: string): Promise<void>

// Reject connection
export async function rejectConnection(connectionId: string): Promise<void>

// Remove connection
export async function removeConnection(connectionId: string): Promise<void>
```

---

## Components

### Renewal Components

#### `components/facility/renewals/renewal-timeline.tsx`

- **Props:** `{ contracts: ExpiringContract[] }`
- **shadcn deps:** Card, Badge, Progress, ScrollArea
- **Description:** Timeline view of expiring contracts grouped by window (30/60/90/120 days). Each card shows contract name, vendor, days until expiry, spend summary, renewal button. ~70 lines.

#### `components/facility/renewals/renewal-summary-card.tsx`

- **Props:** `{ summary: RenewalSummary }`
- **shadcn deps:** Card, Badge, Progress, Button
- **Description:** Detailed summary for a single expiring contract (spend, rebate, tier achieved, recommendation). ~45 lines.

#### `components/facility/renewals/renewal-initiate-dialog.tsx`

- **Props:** `{ contract: ContractWithVendor; open: boolean; onOpenChange: (open: boolean) => void; onInitiate: () => Promise<void> }`
- **shadcn deps:** Dialog, Calendar, Button
- **Description:** Dialog to set new dates and initiate renewal (creates draft contract). ~40 lines.

#### `components/vendor/renewals/vendor-renewal-pipeline.tsx`

- **Props:** `{ contracts: ExpiringContract[] }`
- **shadcn deps:** Card, Badge, Progress, Tabs
- **Description:** Vendor view of their renewal pipeline with strategy planning. ~55 lines.

### Rebate Optimizer Components

#### `components/facility/rebate-optimizer/opportunity-list.tsx`

- **Props:** `{ opportunities: RebateOpportunity[] }`
- **shadcn deps:** Card, Progress, Badge, Button
- **Description:** List of optimization opportunities sorted by potential rebate value. ~50 lines.

#### `components/facility/rebate-optimizer/opportunity-card.tsx`

- **Props:** `{ opportunity: RebateOpportunity; onSetTarget: () => void }`
- **shadcn deps:** Card, Progress, Badge, Button
- **Description:** Single opportunity card showing current vs next tier, spend gap, projected additional rebate. ~40 lines.

#### `components/facility/rebate-optimizer/optimizer-chart.tsx`

- **Props:** `{ opportunities: RebateOpportunity[] }`
- **shadcn deps:** uses ChartCard
- **Description:** Bar chart visualization: current spend vs. tier thresholds per contract. Recharts BarChart with reference lines at tier boundaries. ~45 lines.

#### `components/facility/rebate-optimizer/spend-target-dialog.tsx`

- **Props:** `{ opportunity: RebateOpportunity; open: boolean; onOpenChange: (open: boolean) => void; onSave: (target: number, date: string) => Promise<void> }`
- **shadcn deps:** Dialog, Input, Calendar, Popover, Button
- **Description:** Set spend target amount and date for a contract. ~40 lines.

### Settings Components

#### `components/facility/settings/profile-form.tsx`

- **Props:** `{ facility: FacilityProfile; onSave: (data: UpdateFacilityProfileInput) => Promise<void> }`
- **shadcn deps:** Card, Input, Select, Button, Textarea
- **Description:** Facility profile editing form (name, address, type, contact info). ~60 lines.

#### `components/facility/settings/notification-settings.tsx`

- **Props:** `{ preferences: NotificationPreferences; onSave: (prefs: NotificationPreferences) => Promise<void> }`
- **shadcn deps:** Card, Switch, Label
- **Description:** Toggle switches for each alert type notification (email, in-app). ~45 lines.

#### `components/shared/settings/team-table.tsx`

- **Props:** `{ members: TeamMember[]; onRemove: (id: string) => void; onRoleChange: (id: string, role: string) => void; isAdmin: boolean }`
- **shadcn deps:** Table, Avatar, Badge, Select, Button, DropdownMenu
- **Description:** Team members table with avatar, name, email, role selector, remove action. Shared by both portals. ~55 lines.

#### `components/shared/settings/invite-member-dialog.tsx`

- **Props:** `{ open: boolean; onOpenChange: (open: boolean) => void; onInvite: (email: string, role: string) => Promise<void>; roles: { value: string; label: string }[] }`
- **shadcn deps:** Dialog, Input, Select, Button
- **Description:** Invite team member dialog with email and role selection. ~35 lines.

#### `components/facility/settings/feature-flags-panel.tsx`

- **Props:** `{ flags: FeatureFlag; onToggle: (flag: keyof FeatureFlag, value: boolean) => void }`
- **shadcn deps:** Card, Switch, Label
- **Description:** Feature flag toggles for purchase orders, AI agent, case costing, etc. ~35 lines.

#### `components/vendor/settings/vendor-profile-form.tsx`

- **Props:** `{ vendor: VendorProfile; onSave: (data: UpdateVendorProfileInput) => Promise<void> }`
- **shadcn deps:** Card, Input, Button, Textarea
- **Description:** Vendor profile form (company name, logo URL, contact info, divisions). ~55 lines.

#### `components/vendor/settings/connection-manager.tsx`

- **Props:** `{ connections: Connection[]; pendingInvites: Connection[]; onAccept: (id: string) => void; onReject: (id: string) => void; onRemove: (id: string) => void; onInvite: (email: string, name: string) => void }`
- **shadcn deps:** Card, Badge, Button, Dialog, Input
- **Description:** Facility connection manager for vendor settings. Shows active connections, pending invites, invite form. ~70 lines.

---

## Pages

### Facility Pages

#### `app/(facility)/dashboard/renewals/page.tsx`

- **Route:** `/dashboard/renewals`
- **Auth:** facility role
- **Data loading:** TanStack Query `getExpiringContracts()`
- **Content:** PageHeader + RenewalTimeline + RenewalInitiateDialog
- **Lines:** ~40 lines

#### `app/(facility)/dashboard/rebate-optimizer/page.tsx`

- **Route:** `/dashboard/rebate-optimizer`
- **Auth:** facility role
- **Data loading:** TanStack Query `getRebateOpportunities()`
- **Content:** PageHeader + OptimizerChart + OpportunityList + SpendTargetDialog
- **Lines:** ~50 lines

#### `app/(facility)/dashboard/settings/page.tsx` (extend from Phase 3 stub)

- **Route:** `/dashboard/settings`
- **Auth:** facility role
- **Data loading:** TanStack Query for profile, prefs, team, flags
- **Content:** PageHeader + Tabs (Profile, Notifications, Vendors, Team, Feature Flags). Each tab renders its component.
- **Lines:** ~60 lines

### Vendor Pages

#### `app/(vendor)/renewals/page.tsx`

- **Route:** `/vendor/renewals`
- **Auth:** vendor role
- **Data loading:** TanStack Query `getExpiringContracts({ vendorId })`
- **Content:** PageHeader + VendorRenewalPipeline
- **Lines:** ~30 lines

#### `app/(vendor)/settings/page.tsx`

- **Route:** `/vendor/settings`
- **Auth:** vendor role
- **Data loading:** TanStack Query for vendor profile, team, connections
- **Content:** PageHeader + Tabs (Profile, Team, Notifications, Connections). Each tab renders its component.
- **Lines:** ~55 lines

### Loading States

- [ ] `app/(facility)/dashboard/renewals/loading.tsx`
- [ ] `app/(facility)/dashboard/rebate-optimizer/loading.tsx`
- [ ] `app/(vendor)/renewals/loading.tsx`

---

## Query Keys

```typescript
renewals: {
  expiring: (entityId: string, windowDays: number) =>
    ["renewals", "expiring", entityId, windowDays],
  summary: (contractId: string) => ["renewals", "summary", contractId],
},
rebateOptimizer: {
  opportunities: (facilityId: string) =>
    ["rebateOptimizer", "opportunities", facilityId],
  spendTargets: (facilityId: string) =>
    ["rebateOptimizer", "spendTargets", facilityId],
},
settings: {
  facilityProfile: (facilityId: string) => ["settings", "facilityProfile", facilityId],
  vendorProfile: (vendorId: string) => ["settings", "vendorProfile", vendorId],
  notifications: (entityId: string) => ["settings", "notifications", entityId],
  team: (orgId: string) => ["settings", "team", orgId],
  featureFlags: (facilityId: string) => ["settings", "featureFlags", facilityId],
  connections: (entityId: string) => ["settings", "connections", entityId],
},
```

---

## File Checklist

### Server Actions
- [ ] `lib/actions/renewals.ts`
- [ ] `lib/actions/rebate-optimizer.ts`
- [ ] `lib/actions/settings.ts`
- [ ] `lib/actions/connections.ts`

### Renewal Components
- [ ] `components/facility/renewals/renewal-timeline.tsx`
- [ ] `components/facility/renewals/renewal-summary-card.tsx`
- [ ] `components/facility/renewals/renewal-initiate-dialog.tsx`
- [ ] `components/vendor/renewals/vendor-renewal-pipeline.tsx`

### Rebate Optimizer Components
- [ ] `components/facility/rebate-optimizer/opportunity-list.tsx`
- [ ] `components/facility/rebate-optimizer/opportunity-card.tsx`
- [ ] `components/facility/rebate-optimizer/optimizer-chart.tsx`
- [ ] `components/facility/rebate-optimizer/spend-target-dialog.tsx`

### Settings Components
- [ ] `components/facility/settings/profile-form.tsx`
- [ ] `components/facility/settings/notification-settings.tsx`
- [ ] `components/facility/settings/feature-flags-panel.tsx`
- [ ] `components/shared/settings/team-table.tsx`
- [ ] `components/shared/settings/invite-member-dialog.tsx`
- [ ] `components/vendor/settings/vendor-profile-form.tsx`
- [ ] `components/vendor/settings/connection-manager.tsx`

### Pages
- [ ] `app/(facility)/dashboard/renewals/page.tsx`
- [ ] `app/(facility)/dashboard/rebate-optimizer/page.tsx`
- [ ] `app/(facility)/dashboard/settings/page.tsx` (extend)
- [ ] `app/(vendor)/renewals/page.tsx`
- [ ] `app/(vendor)/settings/page.tsx`
- [ ] All loading.tsx files

### Validators
- [ ] `lib/validators/settings.ts` -- UpdateFacilityProfileInput, UpdateVendorProfileInput, NotificationPreferences
- [ ] `lib/validators/connections.ts` -- SendConnectionInviteInput

---

## Acceptance Criteria

1. Renewals page shows contracts grouped by expiry window (30/60/90/120 days)
2. Each renewal card shows days until expiry, spend summary, and tier achieved
3. "Initiate Renewal" creates a draft copy of the contract with new dates
4. Vendor renewal pipeline shows their expiring contracts with strategy planning
5. Rebate optimizer loads all contracts with rebate tiers and calculates opportunities
6. Opportunities are sorted by potential value (highest first)
7. Bar chart shows current spend vs tier thresholds
8. Setting a spend target persists and shows progress tracking
9. Facility settings has 5 tabs: Profile, Notifications, Vendors, Team, Feature Flags
10. Profile form saves updated facility info
11. Notification toggles persist per alert type
12. Team table shows members with role management and invite capability
13. Feature flag toggles enable/disable POs, AI agent, case costing
14. Vendor settings has 4 tabs: Profile, Team, Notifications, Connections
15. Connection manager shows active, pending, and invite functionality
16. All pages are THIN (30-80 lines)
