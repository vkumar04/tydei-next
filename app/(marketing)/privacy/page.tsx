import type { Metadata } from "next"
import { LegalPage } from "@/components/marketing/legal-page"

export const metadata: Metadata = {
  title: "Privacy Policy",
  description:
    "How TYDEi collects, uses, protects, and shares information across its healthcare contract management platform.",
  alternates: { canonical: "/privacy" },
}

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      lastUpdated="June 17, 2026"
      intro="This Privacy Policy explains how TYDEi handles information when you use our healthcare contract management platform and related services."
    >
      <p>
        TYDEi (&ldquo;TYDEi,&rdquo; &ldquo;we,&rdquo; &ldquo;us,&rdquo; or
        &ldquo;our&rdquo;) provides software that helps healthcare facilities and
        their vendors manage contracts, pricing, rebates, and compliance. We take
        the privacy and security of the information entrusted to us seriously. This
        policy describes what we collect, how we use it, and the choices you have.
      </p>

      <h2>1. Information We Collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li>
          <strong>Account information</strong> — name, work email, organization,
          role, and authentication credentials.
        </li>
        <li>
          <strong>Business data you upload</strong> — contracts, pricing files,
          cost-of-goods (COG) and purchase data, rebate terms, and related
          documents.
        </li>
        <li>
          <strong>Communications</strong> — messages you send us through support
          channels or the contact form.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Usage and device data</strong> — log data, IP address, browser
          type, and interactions with the platform, used to operate and secure the
          service.
        </li>
        <li>
          <strong>Cookies</strong> — strictly necessary cookies for
          authentication and session management. We do not use advertising cookies.
        </li>
      </ul>

      <h2>2. How We Use Information</h2>
      <ul>
        <li>To provide, maintain, and improve the platform and its features.</li>
        <li>To authenticate users and enforce tenant isolation between organizations.</li>
        <li>To compute analytics, rebate accruals, and compliance metrics on your data.</li>
        <li>To respond to support requests and send service-related communications.</li>
        <li>To detect, prevent, and address security incidents, fraud, and abuse.</li>
        <li>To comply with legal obligations.</li>
      </ul>

      <h2>3. Protected Health Information (PHI)</h2>
      <p>
        Where TYDEi processes Protected Health Information on behalf of a covered
        entity or business associate as defined under HIPAA, we do so only as
        permitted by a written Business Associate Agreement (BAA). We apply
        administrative, physical, and technical safeguards designed to protect such
        information and limit its use to the purposes described in that agreement.
      </p>

      <h2>4. How We Share Information</h2>
      <p>We do not sell your personal information. We share information only:</p>
      <ul>
        <li>
          <strong>Within your organization&rsquo;s tenant</strong> and with the
          counterparties you explicitly connect with (for example, a facility and
          its vendor on a shared contract).
        </li>
        <li>
          <strong>With service providers (subprocessors)</strong> who help us run
          the platform — such as cloud hosting, database, and transactional email
          providers — under contractual confidentiality and security obligations.
        </li>
        <li>
          <strong>For legal reasons</strong>, when required by law or to protect the
          rights, safety, and security of TYDEi, our users, or the public.
        </li>
        <li>
          <strong>In a business transfer</strong>, such as a merger or acquisition,
          subject to the protections of this policy.
        </li>
      </ul>

      <h2>5. Data Retention</h2>
      <p>
        We retain information for as long as your account is active or as needed to
        provide the service, comply with legal obligations, resolve disputes, and
        enforce our agreements. You may request deletion of your data subject to
        applicable retention requirements.
      </p>

      <h2>6. Security</h2>
      <p>
        We use industry-standard measures including encryption in transit, access
        controls, and strict per-tenant data scoping. No method of transmission or
        storage is completely secure, but we work continuously to protect your
        information and to notify affected parties of incidents as required by law.
      </p>

      <h2>7. Your Rights and Choices</h2>
      <p>
        Depending on your location, you may have the right to access, correct,
        export, or delete your personal information, and to object to or restrict
        certain processing. To exercise these rights, contact us using the details
        below; we will respond consistent with applicable law.
      </p>

      <h2>8. Changes to This Policy</h2>
      <p>
        We may update this policy from time to time. When we do, we will revise the
        &ldquo;Last updated&rdquo; date above and, where appropriate, provide
        additional notice.
      </p>

      <h2>9. Contact Us</h2>
      <p>
        Questions about this policy or your data? Reach us at{" "}
        <a href="mailto:privacy@tydei.com">privacy@tydei.com</a> or through our{" "}
        <a href="/contact">contact page</a>.
      </p>
    </LegalPage>
  )
}
