/**
 * Next.js instrumentation hook — runs once per server cold start. We use
 * it to fire a single liveness ping to gitpage so the upstream team knows
 * this deployment is alive, and so the website-builder UI gets the
 * agency-subscription status cached for its first render.
 *
 * Only runs on the Node.js runtime — the heartbeat depends on
 * firebase-admin, which can't run on the Edge runtime where the
 * middleware lives.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Defer the import so Edge bundles never see firebase-admin.
  const { sendHeartbeat } = await import("./src/lib/gitpage/heartbeat");

  // Fire-and-forget. The 5s timeout inside sendHeartbeat protects us if
  // gitpage is slow; we never want the heartbeat to block boot.
  void sendHeartbeat().catch((err) => {
    console.warn("[instrumentation] gitpage heartbeat threw", err);
  });
}
