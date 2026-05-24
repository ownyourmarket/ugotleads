import "server-only";

import { emailIsConfigured, sendEmail } from "@/lib/comms/resend";

interface WelcomeEmailParams {
  to: string;
  /** Buyer's auto-enrolled affiliate code. Present only on the leadstack
   *  variant; null on buyer clones — the email then omits the affiliate
   *  P.S. entirely. */
  affiliateCode?: string | null;
}

/**
 * Sends the post-purchase welcome email to a LeadStack buyer.
 *
 * Triggered from the Stripe webhook on `checkout.session.completed`. The
 * webhook handler is responsible for idempotency — call this only once
 * per session via the `purchases/{sessionId}` guard.
 *
 * Deliberately offer-agnostic: no wave labels, no specific bonus months,
 * no time-bound promo references. The body stays valid whether the
 * buyer paid full price, the Founders cohort price, or used a coupon —
 * only the dollar amount (pulled live from Stripe) and the optional
 * affiliate P.S. vary.
 *
 * Returns the Resend message ID on success, or null when email is not
 * configured (so the webhook can log + continue without throwing).
 */
export async function sendFoundersWelcomeEmail({
  to,
  affiliateCode,
}: WelcomeEmailParams): Promise<string | null> {
  if (!emailIsConfigured()) {
    console.warn(
      "[welcome-email] Resend not configured — skipping welcome email send",
    );
    return null;
  }

  const subject = `Welcome to LeadStack — your access is on the way`;

  const affiliatePsText = affiliateCode
    ? `

P.S. You're now an affiliate. Earn commission on every LeadStack purchase
you refer.

Your code:      ${affiliateCode}
Your link:      https://leadstack.dev/?ref=${affiliateCode}
Dashboard:      https://leadstack.dev/affiliate/login
`
    : "";

  const text = `Welcome to LeadStack.

Within 24 hours we'll email you your private GitHub repo access and
onboarding details. Watch for a message from notifications@leadstack.dev
(check spam if you don't see it).

Have a question before then? Open the chat widget at leadstack.dev — we
usually reply within a few hours.

Join the Founders community
---------------------------

Other LeadStack founders trade wins, code patterns, and client stories
inside our private Skool community. Free for all founders — join here:

https://www.skool.com/ambitious

Thanks for backing LeadStack.

— The LeadStack team
${affiliatePsText}`;

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>Welcome to LeadStack</title>
</head>
<body style="margin:0;padding:0;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;color:#0a0a0a;">
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f6f7f9;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="560" style="max-width:560px;background:#ffffff;border-radius:14px;border:1px solid #e8e8ec;overflow:hidden;">
          <tr>
            <td style="padding:32px 32px 8px 32px;">
              <h1 style="margin:0;font-size:22px;line-height:1.3;font-weight:600;letter-spacing:-0.01em;">Welcome to LeadStack.</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 8px 32px;">
              <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#1a1a22;">
                Within 24 hours we'll email you your private GitHub repo access and onboarding details. Watch for a message from <strong>notifications@leadstack.dev</strong> &mdash; check spam if you don't see it.
              </p>
              <p style="margin:0;font-size:15px;line-height:1.6;color:#1a1a22;">
                Have a question before then? Open the chat widget at <a href="https://leadstack.dev" style="color:#5b5bd6;text-decoration:none;">leadstack.dev</a> &mdash; we usually reply within a few hours.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 32px 0 32px;">
              <a href="https://www.skool.com/ambitious" style="display:block;text-decoration:none;color:inherit;">
                <div style="background:linear-gradient(135deg,#eef0ff 0%,#fdeaf6 100%);border:1px solid #e2dcfc;border-radius:10px;padding:18px 20px;">
                  <p style="margin:0 0 4px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#5b5bd6;">
                    Join the Founders community
                  </p>
                  <p style="margin:0 0 8px 0;font-size:14px;line-height:1.55;color:#1a1a22;">
                    Trade wins, code patterns, and client stories with other LeadStack founders inside our private Skool. Free for all founders.
                  </p>
                  <p style="margin:0;font-size:13px;font-weight:500;color:#5b5bd6;">
                    skool.com/ambitious &rarr;
                  </p>
                </div>
              </a>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 32px 32px 32px;">
              <p style="margin:16px 0 0 0;font-size:14px;line-height:1.55;color:#6b6b75;">
                Thanks for backing LeadStack.<br />
                &mdash; The LeadStack team
              </p>
            </td>
          </tr>
          ${
            affiliateCode
              ? `<tr>
            <td style="padding:0 32px 32px 32px;">
              <div style="background:linear-gradient(135deg,#eef0ff 0%,#fdeaf6 100%);border:1px solid #e2dcfc;border-radius:10px;padding:18px 20px;">
                <p style="margin:0 0 6px 0;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:0.08em;color:#5b5bd6;">
                  P.S. &middot; You're now an affiliate
                </p>
                <p style="margin:0 0 12px 0;font-size:14px;line-height:1.55;color:#1a1a22;">
                  Earn commission on every LeadStack purchase you refer.
                </p>
                <p style="margin:0;font-size:13px;line-height:1.6;color:#3a3a44;">
                  Your code: <code style="background:#ffffff;padding:2px 6px;border-radius:4px;border:1px solid #e2dcfc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;">${affiliateCode}</code><br />
                  Your link: <a href="https://leadstack.dev/?ref=${affiliateCode}" style="color:#5b5bd6;text-decoration:none;word-break:break-all;">https://leadstack.dev/?ref=${affiliateCode}</a><br />
                  Dashboard: <a href="https://leadstack.dev/affiliate/login" style="color:#5b5bd6;text-decoration:none;">leadstack.dev/affiliate/login</a> (sign in with this email)
                </p>
              </div>
            </td>
          </tr>`
              : ""
          }
        </table>
        <p style="margin:16px 0 0 0;font-size:11px;color:#9a9aa3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
          You're receiving this because you purchased LeadStack at leadstack.dev.
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`;

  try {
    const result = await sendEmail({ to, subject, text, html });
    return result.id;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[welcome-email] Resend send failed to ${to}: ${message}`);
    return null;
  }
}
