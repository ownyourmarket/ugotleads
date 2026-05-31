import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Output file tracing — include SOUL.md files in the Vercel serverless bundle.
   *
   * Next.js traces imports statically at build time to decide which files each
   * serverless function needs. `buildAgentSystemPrompt` reads SOUL.md files via
   * `fs.readFile` with a runtime-constructed path, so the static tracer never
   * sees them and they are excluded from the bundle by default. The function
   * would throw ENOENT in production on first call.
   *
   * `outputFileTracingIncludes` is the official escape hatch for files that are
   * read dynamically at runtime. The glob is narrow — only SOUL markdown files
   * are included, not the entire soul/ directory or project root.
   *
   * The `/**` key applies the include to every route/function in the build.
   * Scoping it to a single API route would be premature — the prompt builder
   * may eventually be called from Server Actions or multiple routes.
   *
   * Docs: https://nextjs.org/docs/app/api-reference/config/next-config-js/outputFileTracingIncludes
   */
  outputFileTracingIncludes: {
    "/**": ["./soul/**/*.md"],
  },

  async headers() {
    return [
      {
        // The web-chat embed iframe target — must be loadable cross-
        // origin from any buyer's site. CSP frame-ancestors '*' is the
        // explicit way to allow that; without it, some hosts (and the
        // Vercel default in certain configs) inject X-Frame-Options
        // DENY/SAMEORIGIN which would block third-party iframes.
        source: "/embed/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors *;",
          },
          // Suppress the legacy header in case anything upstream tries
          // to add it. (Vercel doesn't by default but belt-and-braces.)
          { key: "X-Frame-Options", value: "ALLOWALL" },
        ],
      },
      {
        // Widget loader: long-cache and serve to any origin so the
        // <script> tag works on any buyer's site.
        source: "/widget.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=300, s-maxage=300" },
          { key: "Access-Control-Allow-Origin", value: "*" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
