/**
 * Inter-section strip showing the brand-name credibility signals — buyers
 * recognise these vendors and infer "real software, not a no-code wrapper".
 * Text-only on purpose: zero new dependencies, easy to swap to brand SVGs
 * later if a more polished look is desired.
 */
export function TechStackStrip() {
  const stack = [
    { name: "Firebase", tagline: "auth + database" },
    { name: "Stripe", tagline: "billing" },
    { name: "Resend", tagline: "email" },
    { name: "Twilio", tagline: "SMS" },
    { name: "Vercel", tagline: "hosting" },
  ];

  return (
    <section
      aria-label="Underlying technology stack"
      className="border-y bg-muted/20 py-10"
    >
      <div className="container mx-auto px-4">
        <p className="mb-6 text-center text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Built on the stack you already trust
        </p>
        <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-4">
          {stack.map((item) => (
            <div
              key={item.name}
              className="flex items-baseline gap-1.5 opacity-70 transition-opacity hover:opacity-100"
            >
              <span className="text-base font-semibold tracking-tight text-foreground/80">
                {item.name}
              </span>
              <span className="hidden text-[11px] text-muted-foreground sm:inline">
                {item.tagline}
              </span>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          You bring your own keys, pay providers directly, never get squeezed
          by a SaaS landlord.
        </p>
      </div>
    </section>
  );
}
