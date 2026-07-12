import { APP_URL } from "./config.js";
import { getIdToken } from "./auth.js";

// Returns { ok, output?, creditsCharged?, model?, error?, status, currentBalance?, required?, upsell?, missingVariables?, missingGems? }
export async function runSkill(subAccountId, skillId, variables) {
  const token = await getIdToken();
  if (!token) return { ok: false, status: 401, error: "Not signed in." };
  let res;
  try {
    res = await fetch(`${APP_URL}/api/sub-accounts/${subAccountId}/promptexpert/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ skillId, variables }),
    });
  } catch { return { ok: false, status: 0, error: "Network error — please try again." }; }
  const body = await res.json().catch(() => ({}));
  if (res.ok) return { ok: true, status: 200, ...body };
  return { ok: false, status: res.status, ...body };
}
