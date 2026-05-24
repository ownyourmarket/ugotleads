import { NextResponse } from "next/server";
import { LANDING_VARIANT } from "@/config/landing";
import { findAffiliateByEmail } from "@/lib/affiliate/account";
import { signMagicLinkToken } from "@/lib/affiliate/magic-link";
import { emailIsConfigured, sendEmail } from "@/lib/comms/resend";

export const dynamic = "force-dynamic";

/**
 * Request a magic-link email for affiliate login. Anonymous POST.
 *
 * Always returns the same generic response regardless of whether the email
 * matches an affiliate — prevents enumeration of who is/isn't an affiliate.
 *
 * Real send happens only when an affiliate doc exists for the email. If
 * not, we silently no-op but return success so the UX is identical.
 */
export async function POST(request: Request) {
  if (LANDING_VARIANT !== "leadstack") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email" },
      { status: 400 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://leadstack.dev";

  try {
    const affiliate = await findAffiliateByEmail(email);
    if (affiliate && affiliate.status === "active" && emailIsConfigured()) {
      const token = signMagicLinkToken(affiliate.id, affiliate.email);
      const link = `${appUrl}/api/affiliate/login/verify?token=${encodeURIComponent(token)}`;

      await sendEmail({
        to: affiliate.email,
        subject: "Sign in to your LeadStack affiliate dashboard",
        text: `Hi,

Click the link below to sign in to your LeadStack affiliate dashboard.
The link expires in 15 minutes and can only be used once.

${link}

If you didn't request this, you can safely ignore it — your account
isn't affected.

— LeadStack
`,
        html: `<!DOCTYPE html>
<html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#1a1a22;line-height:1.6;">
  <h1 style="font-size:20px;font-weight:600;margin:0 0 16px;">Sign in to your affiliate dashboard</h1>
  <p style="margin:0 0 24px;color:#3a3a44;">Click the button below to sign in. The link expires in 15 minutes.</p>
  <p style="margin:0 0 24px;">
    <a href="${link}" style="display:inline-block;background:#5b5bd6;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:500;">Sign in to dashboard</a>
  </p>
  <p style="margin:24px 0 0;font-size:12px;color:#9a9aa3;">If you didn't request this, you can safely ignore it.</p>
</body></html>`,
      });
    }
  } catch (err) {
    // Log internally but never expose to caller — same generic success
    // response either way to prevent enumeration timing leaks.
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`[affiliate/login] Send failed: ${message}`);
  }

  return NextResponse.json({
    ok: true,
    message: "If an affiliate account exists for that email, we've sent a sign-in link.",
  });
}
