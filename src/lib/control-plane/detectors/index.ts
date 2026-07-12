import "server-only";

import type {
  ControlPlaneDomain,
  Detector,
  DetectorContext,
  DetectorResult,
} from "../types";
import { sortIssues } from "../types";
import { productsDetector } from "./products";
import { fulfillmentDetector } from "./fulfillment";
import { partnersDetector } from "./partners";
import { commissionsDetector } from "./commissions";
import { creditsDetector } from "./credits";
import { byokDetector } from "./byok";
import { partnerEventsDetector } from "./partner-events";

export const DETECTORS: Detector[] = [
  productsDetector,
  fulfillmentDetector,
  partnersDetector,
  commissionsDetector,
  creditsDetector,
  byokDetector,
  partnerEventsDetector,
];

/**
 * Run all detectors (or one domain's), concurrently, and return a
 * deterministic severity-first issue list. A single detector failure fails
 * the whole call — the route wrapper turns it into INTERNAL_ERROR rather
 * than silently under-reporting.
 */
export async function runDetectors(
  ctx: DetectorContext,
  domain?: ControlPlaneDomain,
): Promise<DetectorResult> {
  const selected = domain ? DETECTORS.filter((d) => d.domain === domain) : DETECTORS;
  const results = await Promise.all(selected.map((d) => d.run(ctx)));
  return {
    issues: sortIssues(results.flatMap((r) => r.issues)),
    truncated: results.some((r) => r.truncated),
  };
}
