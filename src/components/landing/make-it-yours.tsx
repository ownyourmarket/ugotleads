import {
  Globe,
  Image as ImageIcon,
  Mail,
  Palette,
  Tag,
  Wallet,
} from "lucide-react";

const swappables = [
  {
    icon: ImageIcon,
    label: "Your logo",
    body: "Your logo on every screen — login, dashboard, footer, even the preview when someone shares your link.",
  },
  {
    icon: Tag,
    label: "Your name",
    body: "Your name is the only name your customers ever see. Header, browser tab, email signatures — all yours.",
  },
  {
    icon: Globe,
    label: "Your domain",
    body: "Your URL on the address bar. Your DNS, your SSL — never a shared subdomain.",
  },
  {
    icon: Palette,
    label: "Your colors",
    body: "Pick your palette. Every screen takes the swap, end-to-end. We ship two colorways out of the box so you can see it happen.",
  },
  {
    icon: Wallet,
    label: "Your pricing",
    body: "Set your own plans. Monthly, annual, one-time, tiered — your call. The money flows directly to you.",
  },
  {
    icon: Mail,
    label: "Your sender",
    body: "Your inbox. Your phone number. Replies hit your team, never us.",
  },
];

export function MakeItYours() {
  return (
    <section id="make-it-yours" className="py-24">
      <div className="container mx-auto px-4">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-wide text-primary">
            Make it yours
          </p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tighter sm:text-5xl">
            It&apos;s a{" "}
            <span className="font-serif font-normal italic">
              business in a repo
            </span>
            .
          </h2>
          <p className="mt-4 text-lg text-muted-foreground lg:text-xl">
            On day one this is UGotLeads with your sub-account. By the end
            of week one it&apos;s your CRM, on your domain, with your name
            on every screen. No &ldquo;powered by&rdquo; badge, no SaaS
            landlord, no migration fees if you ever fork.
          </p>
        </div>

        <div className="mx-auto mt-16 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {swappables.map(({ icon: Icon, label, body }) => (
            <div
              key={label}
              className="group rounded-2xl border bg-card p-6 transition-all hover:-translate-y-0.5 hover:shadow-md"
            >
              <span className="mb-4 inline-flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="text-base font-semibold">{label}</h3>
              <p className="mt-1.5 text-sm text-muted-foreground lg:text-base">{body}</p>
            </div>
          ))}
        </div>

        <p className="mx-auto mt-10 max-w-2xl text-center text-sm text-muted-foreground lg:text-base">
          Your customers never see the word &ldquo;UGotLeads&rdquo;. Your
          data, your hosting, your billing — all in accounts you control.
          Your business. We just handed you the keys.
        </p>
      </div>
    </section>
  );
}
