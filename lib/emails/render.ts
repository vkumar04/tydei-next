import { render } from "@react-email/render"
import { createElement, type ReactElement } from "react"

import AccountInvite, {
  subject as accountInviteSubject,
  type AccountInviteProps,
} from "@/emails/account-invite"
import AlertNotification, {
  subject as alertSubject,
  type AlertNotificationProps,
} from "@/emails/alert-notification"
import ChangeEmailConfirmation, {
  subject as changeEmailSubject,
  type ChangeEmailConfirmationProps,
} from "@/emails/change-email-confirmation"
import ContactForm, {
  subject as contactSubject,
  type ContactFormProps,
} from "@/emails/contact-form"
import PendingContractDecisionEmail, {
  subject as pendingDecisionSubject,
  type PendingContractDecisionProps,
} from "@/emails/pending-contract-decision"
import PendingContractSubmitted, {
  subject as pendingSubmittedSubject,
  type PendingContractSubmittedProps,
} from "@/emails/pending-contract-submitted"
import RenewalReminder, {
  subject as renewalSubject,
  type RenewalReminderProps,
} from "@/emails/renewal-reminder"
import ResetPassword, {
  subject as resetPasswordSubject,
  type ResetPasswordProps,
} from "@/emails/reset-password"
import TeamInvite, {
  subject as teamInviteSubject,
  type TeamInviteProps,
} from "@/emails/team-invite"
import VerifyEmail, {
  subject as verifyEmailSubject,
  type VerifyEmailProps,
} from "@/emails/verify-email"
import WeeklyDigest, {
  subject as weeklyDigestSubject,
  type WeeklyDigestProps,
} from "@/emails/weekly-digest"

/**
 * The ONE place React Email components are turned into the
 * `{ subject, html }` pair that `sendEmail` takes.
 *
 * Every builder returns that same shape, so call sites are unchanged from
 * the string-template era they replaced. Each template owns its own subject
 * line (exported as `subject` next to the component) so the copy and the
 * markup can't drift apart.
 *
 * `render()` is async — it awaits React's server renderer — so every builder
 * here is async and call sites must await them.
 */

export interface RenderedEmail {
  subject: string
  html: string
  /** Plain-text alternative. Improves deliverability and spam scoring. */
  text: string
}

async function build(element: ReactElement, subject: string): Promise<RenderedEmail> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ])
  return { subject, html, text }
}

export function alertNotificationEmail(props: AlertNotificationProps) {
  return build(createElement(AlertNotification, props), alertSubject(props))
}

export function renewalReminderEmail(
  contract: Omit<RenewalReminderProps, "daysLeft">,
  daysLeft: number,
) {
  const props: RenewalReminderProps = { ...contract, daysLeft }
  return build(createElement(RenewalReminder, props), renewalSubject(props))
}

export function weeklyDigestEmail(props: WeeklyDigestProps) {
  return build(createElement(WeeklyDigest, props), weeklyDigestSubject(props))
}

export function teamInviteEmail(props: TeamInviteProps) {
  return build(createElement(TeamInvite, props), teamInviteSubject(props))
}

export function pendingContractSubmittedEmail(props: PendingContractSubmittedProps) {
  return build(createElement(PendingContractSubmitted, props), pendingSubmittedSubject(props))
}

export function pendingContractDecisionEmail(props: PendingContractDecisionProps) {
  return build(createElement(PendingContractDecisionEmail, props), pendingDecisionSubject(props))
}

export function resetPasswordEmail(props: ResetPasswordProps) {
  return build(createElement(ResetPassword, props), resetPasswordSubject)
}

export function verifyEmailEmail(props: VerifyEmailProps) {
  return build(createElement(VerifyEmail, props), verifyEmailSubject)
}

export function contactFormEmail(props: ContactFormProps) {
  return build(createElement(ContactForm, props), contactSubject(props))
}

export function accountInviteEmail(props: AccountInviteProps) {
  return build(createElement(AccountInvite, props), accountInviteSubject)
}

export function changeEmailConfirmationEmail(props: ChangeEmailConfirmationProps) {
  return build(createElement(ChangeEmailConfirmation, props), changeEmailSubject)
}
