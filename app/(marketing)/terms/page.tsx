import type { Metadata } from "next"
import { LegalPage } from "@/components/marketing/legal-page"

export const metadata: Metadata = {
  title: "Terms of Service — TYDEi",
  description:
    "The terms and conditions governing access to and use of the TYDEi healthcare contract management platform.",
}

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms of Service"
      lastUpdated="June 17, 2026"
      intro="These Terms of Service govern your access to and use of the TYDEi platform. By using the service, you agree to these terms."
    >
      <h2>1. Agreement to Terms</h2>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) form a binding agreement
        between you and TYDEi. If you are entering into these Terms on behalf of an
        organization, you represent that you have authority to bind that
        organization. If you do not agree, do not use the service.
      </p>

      <h2>2. The Service</h2>
      <p>
        TYDEi provides software for managing healthcare contracts, pricing, rebate
        programs, purchasing data, and related analytics. We may add, change, or
        remove features over time to improve the platform.
      </p>

      <h2>3. Accounts and Eligibility</h2>
      <ul>
        <li>You must provide accurate account information and keep it current.</li>
        <li>
          You are responsible for safeguarding your credentials and for all
          activity that occurs under your account.
        </li>
        <li>
          You must notify us promptly of any unauthorized use or suspected security
          breach.
        </li>
      </ul>

      <h2>4. Customer Data</h2>
      <p>
        You retain all rights to the contracts, pricing, purchasing, and other data
        you submit to the platform (&ldquo;Customer Data&rdquo;). You grant TYDEi a
        limited license to host, process, and display Customer Data solely to
        provide and improve the service for you. You are responsible for ensuring you
        have the necessary rights to submit Customer Data and for its accuracy.
      </p>

      <h2>5. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Access data belonging to another tenant or attempt to bypass access controls.</li>
        <li>Reverse engineer, scrape, or disrupt the platform or its infrastructure.</li>
        <li>Upload malware or content that is unlawful, infringing, or harmful.</li>
        <li>Use the service to violate any applicable law or third-party rights.</li>
      </ul>

      <h2>6. Fees</h2>
      <p>
        If your use of the service is subject to a subscription or order form, you
        agree to pay the applicable fees described there. Except as required by law
        or expressly stated, fees are non-refundable.
      </p>

      <h2>7. Intellectual Property</h2>
      <p>
        The platform, including its software, design, and content (excluding
        Customer Data), is owned by TYDEi and protected by intellectual property
        laws. These Terms do not grant you any rights in the platform other than the
        limited right to use it as described.
      </p>

      <h2>8. Third-Party Services</h2>
      <p>
        The platform may integrate with third-party services. We are not responsible
        for third-party services, and your use of them may be subject to their own
        terms.
      </p>

      <h2>9. Disclaimers</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;
        without warranties of any kind, whether express or implied, including
        warranties of merchantability, fitness for a particular purpose, and
        non-infringement. Analytics, rebate calculations, and projections are
        provided for informational purposes and should be independently verified.
      </p>

      <h2>10. Limitation of Liability</h2>
      <p>
        To the maximum extent permitted by law, TYDEi will not be liable for any
        indirect, incidental, special, consequential, or punitive damages, or for any
        loss of profits or data, arising out of or related to your use of the
        service. Our aggregate liability is limited to the amounts you paid us in the
        twelve months preceding the claim.
      </p>

      <h2>11. Termination</h2>
      <p>
        You may stop using the service at any time. We may suspend or terminate your
        access if you breach these Terms or to protect the platform. Upon
        termination, your right to use the service ceases, and we will handle
        Customer Data in accordance with our Privacy Policy and any applicable
        agreement.
      </p>

      <h2>12. Governing Law</h2>
      <p>
        These Terms are governed by the laws of the State of Delaware, without regard
        to its conflict-of-laws rules. Disputes will be resolved in the courts
        located in Delaware, unless otherwise required by applicable law.
      </p>

      <h2>13. Changes to These Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes will be
        reflected by an updated &ldquo;Last updated&rdquo; date and, where
        appropriate, additional notice. Continued use of the service after changes
        take effect constitutes acceptance.
      </p>

      <h2>14. Contact Us</h2>
      <p>
        Questions about these Terms? Reach us at{" "}
        <a href="mailto:legal@tydei.com">legal@tydei.com</a> or through our{" "}
        <a href="/contact">contact page</a>.
      </p>
    </LegalPage>
  )
}
