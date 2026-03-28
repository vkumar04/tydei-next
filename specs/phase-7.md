# Phase 7 -- Landing Page + Auth Polish + Marketing

## Objective

Build the public-facing landing page, polish the authentication flows (login, sign-up with role selection and org creation, forgot/reset password, demo mode), and add any marketing pages. This phase can be built in parallel with Phases 2-6 since it only depends on Phase 1 auth.

## Dependencies

- Phase 1 (auth must exist for login/sign-up flows)

## Tech Stack

| Tool | Purpose |
|------|---------|
| next-themes | Theme toggle on landing page |
| Lucide React | Feature icons |
| shadcn | Card, Badge, Button, Input, Select, Separator |

---

## Server Actions

### `lib/actions/auth.ts` (extend)

```typescript
"use server"

// Sign up with org creation
export async function signUp(input: {
  name: string
  email: string
  password: string
  role: "facility" | "vendor"
  organizationName: string
}): Promise<{ user: User; organization: Organization }>

// Demo login (creates session for demo user by role)
export async function demoLogin(role: "facility" | "vendor" | "admin"): Promise<{ redirectTo: string }>

// Forgot password (sends reset email)
export async function forgotPassword(email: string): Promise<void>

// Reset password
export async function resetPassword(token: string, newPassword: string): Promise<void>
```

---

## Components

### Landing Page Components

#### `components/landing/navbar.tsx`

- **Props:** none
- **shadcn deps:** Button, Sheet (mobile menu)
- **Description:** Top navigation with logo, nav links (Features, About, Pricing), theme toggle, Login/Sign Up buttons. Responsive with Sheet menu on mobile. ~55 lines.

#### `components/landing/hero-section.tsx`

- **Props:** none
- **shadcn deps:** Button, Badge
- **Description:** Hero with gradient heading text ("Healthcare Contract Intelligence"), subheading, two CTA buttons (Facility Portal, Vendor Portal), and optional hero illustration/graphic. ~45 lines.

#### `components/landing/features-grid.tsx`

- **Props:** none
- **shadcn deps:** Card, CardHeader, CardTitle, CardDescription
- **Description:** Grid of feature cards with Lucide icons. Features: Contract Management, COG Data Import, Rebate Tracking, Alert System, Invoice Validation, AI-Powered Analysis. ~50 lines.

#### `components/landing/value-props.tsx`

- **Props:** none
- **shadcn deps:** Card
- **Description:** Two-column layout: facility benefits and vendor benefits. Each side lists 4-5 key value propositions. ~45 lines.

#### `components/landing/capabilities-section.tsx`

- **Props:** none
- **shadcn deps:** Accordion, AccordionItem
- **Description:** Expandable list of platform capabilities with descriptions. ~40 lines.

#### `components/landing/stats-bar.tsx`

- **Props:** none
- **shadcn deps:** none (plain Tailwind)
- **Description:** Horizontal bar showing platform stats (Facilities, Vendors, Contracts Managed). Uses animated counters. ~30 lines.

#### `components/landing/footer.tsx`

- **Props:** none
- **shadcn deps:** Separator
- **Description:** Footer with logo, column links (Product, Company, Legal), copyright. ~40 lines.

### Auth Components

#### `components/auth/login-form.tsx`

- **Props:** none
- **shadcn deps:** Card, Input, Button, Label, Separator
- **Description:** Email/password login form with validation, error display, "Forgot password?" link, and demo mode buttons (one per role). ~65 lines.

#### `components/auth/sign-up-form.tsx`

- **Props:** none
- **shadcn deps:** Card, Input, Button, Label, Select
- **Description:** Registration form with name, email, account type (facility/vendor), organization name, password, confirm password. Zod validation. ~70 lines.

#### `components/auth/forgot-password-form.tsx`

- **Props:** none
- **shadcn deps:** Card, Input, Button, Label
- **Description:** Email input to request password reset. Shows success message after submission. ~35 lines.

#### `components/auth/reset-password-form.tsx`

- **Props:** `{ token: string }`
- **shadcn deps:** Card, Input, Button, Label
- **Description:** New password + confirm password form. Uses token from URL. ~40 lines.

#### `components/auth/demo-login-buttons.tsx`

- **Props:** `{ onDemoLogin: (role: "facility" | "vendor" | "admin") => void; isLoading: boolean }`
- **shadcn deps:** Button, Separator
- **Description:** Three buttons for demo login (Facility, Vendor, Admin) with role icons. ~25 lines.

#### `components/auth/auth-card.tsx`

- **Props:** `{ title: string; description?: string; children: ReactNode; footer?: ReactNode }`
- **shadcn deps:** Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter
- **Description:** Reusable centered card wrapper for auth pages. Logo at top. ~25 lines.

---

## Pages

### Landing Page

#### `app/(marketing)/page.tsx`

- **Route:** `/`
- **Layout:** Marketing layout (no sidebar)
- **Auth:** None required
- **Data loading:** None (static content)
- **Content:** Navbar + HeroSection + FeaturesGrid + ValueProps + CapabilitiesSection + StatsBar + Footer
- **Lines:** ~40 lines

#### `app/(marketing)/layout.tsx`

- **Route:** Marketing route group
- **Layout:** Minimal -- just providers, no sidebar
- **Auth:** None
- **Lines:** ~15 lines

### Auth Pages

#### `app/(auth)/login/page.tsx`

- **Route:** `/login`
- **Auth:** Redirect to dashboard if already authenticated
- **Content:** AuthCard + LoginForm
- **Lines:** ~20 lines

#### `app/(auth)/sign-up/page.tsx`

- **Route:** `/sign-up`
- **Auth:** Redirect to dashboard if already authenticated
- **Content:** AuthCard + SignUpForm
- **Lines:** ~20 lines

#### `app/(auth)/sign-up-success/page.tsx`

- **Route:** `/sign-up-success`
- **Auth:** None
- **Content:** AuthCard + success message + "Check your email" instructions + back to login link
- **Lines:** ~20 lines

#### `app/(auth)/error/page.tsx`

- **Route:** `/auth/error`
- **Auth:** None
- **Content:** AuthCard + error message + retry button
- **Lines:** ~20 lines

#### `app/(auth)/forgot-password/page.tsx`

- **Route:** `/forgot-password`
- **Auth:** None
- **Content:** AuthCard + ForgotPasswordForm
- **Lines:** ~20 lines

#### `app/(auth)/reset-password/page.tsx`

- **Route:** `/reset-password`
- **Auth:** None (uses token from search params)
- **Content:** AuthCard + ResetPasswordForm
- **Lines:** ~25 lines

---

## File Checklist

### Server Actions
- [ ] `lib/actions/auth.ts` (extend with signUp, demoLogin, forgotPassword, resetPassword)

### Landing Components
- [ ] `components/landing/navbar.tsx`
- [ ] `components/landing/hero-section.tsx`
- [ ] `components/landing/features-grid.tsx`
- [ ] `components/landing/value-props.tsx`
- [ ] `components/landing/capabilities-section.tsx`
- [ ] `components/landing/stats-bar.tsx`
- [ ] `components/landing/footer.tsx`

### Auth Components
- [ ] `components/auth/login-form.tsx`
- [ ] `components/auth/sign-up-form.tsx`
- [ ] `components/auth/forgot-password-form.tsx`
- [ ] `components/auth/reset-password-form.tsx`
- [ ] `components/auth/demo-login-buttons.tsx`
- [ ] `components/auth/auth-card.tsx`

### Pages
- [ ] `app/(marketing)/page.tsx`
- [ ] `app/(marketing)/layout.tsx`
- [ ] `app/(auth)/login/page.tsx`
- [ ] `app/(auth)/sign-up/page.tsx`
- [ ] `app/(auth)/sign-up-success/page.tsx`
- [ ] `app/(auth)/error/page.tsx`
- [ ] `app/(auth)/forgot-password/page.tsx`
- [ ] `app/(auth)/reset-password/page.tsx`

### Validators
- [ ] `lib/validators/auth.ts` -- SignUpInput, LoginInput, ForgotPasswordInput, ResetPasswordInput

---

## Acceptance Criteria

1. Landing page renders with hero, features grid, value propositions, capabilities, stats bar, and footer
2. Landing page is fully responsive (mobile, tablet, desktop)
3. Dark mode is the default; theme toggle works on landing page
4. Navbar links scroll to sections or navigate to login/sign-up
5. Login form validates email/password and displays errors
6. Demo login buttons create sessions and redirect to correct portal
7. Sign-up form requires name, email, role selection, org name, and password
8. Successful sign-up redirects to sign-up-success page
9. Forgot password sends reset email and shows success message
10. Reset password form validates matching passwords and updates password
11. Already-authenticated users are redirected away from auth pages
12. Auth error page shows generic error with retry option
13. All pages are THIN (15-40 lines for auth pages, ~40 lines for landing)
14. Glass-card effects render correctly in dark mode on landing page
