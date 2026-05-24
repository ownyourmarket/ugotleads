import Link from "next/link";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <Link
        href="/"
        className="text-sm text-muted-foreground hover:text-primary"
      >
        &larr; Back to home
      </Link>

      <article className="prose dark:prose-invert mt-8 max-w-none">
        <h1>Terms of Service</h1>
        <p className="text-sm text-muted-foreground">
          Last updated: May 10, 2026
        </p>

        <h2>1. Acceptance of Terms</h2>
        <p>
          By purchasing, downloading, or using LeadStack (&ldquo;the
          Service&rdquo;), you agree to be bound by these Terms of Service. If
          you do not agree, do not purchase or use the Service.
        </p>

        <h2>2. The Service</h2>
        <p>
          LeadStack is a self-hosted, one-time-purchase software codebase. You
          buy a license, receive access to the source code, and run it on
          infrastructure you control. We do not host your deployment, store
          your customer data, or provide a SaaS layer on top of the codebase.
        </p>

        <h2>3. Purchase, Payment &amp; No Refunds</h2>
        <p>
          LeadStack is sold as a one-time purchase. There is no subscription
          and no recurring fee charged by us.
        </p>
        <p>
          <strong>All sales are final. No refunds.</strong> Because the
          Service consists of source code delivered electronically, once
          access has been granted, the purchase cannot be reversed,
          partially refunded, or exchanged. Please review the public landing
          page, FAQ, and any pre-sale materials carefully before purchasing.
        </p>

        <h2>4. License &amp; Intellectual Property</h2>
        <p>
          On purchase you receive a non-transferable license to use, modify,
          and deploy the LeadStack codebase for your own business and your
          clients. You retain ownership of any modifications you make and any
          customer data you collect through your deployment. You may not
          resell or redistribute the unmodified codebase as a competing
          product.
        </p>

        <h2>5. Your Responsibilities</h2>
        <p>
          You are solely responsible for hosting, deploying, securing, and
          operating the Service, including maintaining accounts with
          third-party providers (database, payments, email, SMS, hosting) and
          paying their fees directly. You are responsible for complying with
          all laws applicable to your use, including data-protection,
          electronic-communications, and consumer-protection laws in the
          jurisdictions where you and your customers are located.
        </p>

        <h2>6. Disclaimer of Warranties</h2>
        <p>
          The Service is provided &ldquo;as is&rdquo; and &ldquo;as
          available&rdquo; without warranty of any kind, express or implied,
          including merchantability, fitness for a particular purpose, and
          non-infringement. We do not warrant that the Service will be
          uninterrupted, error-free, or fit for your particular use case.
        </p>

        <h2>7. Limitation of Liability</h2>
        <p>
          To the fullest extent permitted by law, we shall not be liable for
          any indirect, incidental, special, consequential, or punitive
          damages, or for any loss of profits, revenue, data, or goodwill,
          arising out of or related to your purchase or use of the Service.
          Our total aggregate liability for any claim shall not exceed the
          amount you paid for the Service.
        </p>

        <h2>8. Changes to Terms</h2>
        <p>
          We may update these Terms from time to time. We will post the
          updated Terms on this page with a new &ldquo;Last updated&rdquo;
          date. Your continued use of the Service after changes constitutes
          acceptance of the revised Terms.
        </p>

        <h2>9. Contact</h2>
        <p>
          For questions about these Terms, contact{" "}
          <a href="mailto:ambitious-hub@pm.me">ambitious-hub@pm.me</a>.
        </p>
      </article>
    </div>
  );
}
