// For the voice assistant: find a product's site and what its free trial looks like, before signing up.
import { findOfficialSite, lookupWebTerms } from "@/terms";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const product = new URL(req.url).searchParams.get("product")?.trim();
  if (!product) return Response.json({ error: "Pass ?product=" }, { status: 400 });
  const site = await findOfficialSite(product).catch(() => null);
  if (!site) return Response.json({ product, found: false });
  const domain = new URL(site.url).hostname.replace(/^www\./, "");
  const terms = await lookupWebTerms(product, domain).catch(() => null);
  return Response.json({
    product,
    found: true,
    website: site.url,
    free_trial: terms?.has_trial === false ? "no (free plan only)" : terms?.has_trial ? "yes" : "unknown",
    trial_days: terms?.trial_days ?? null,
    plan: terms?.plan_name ?? null,
    price_after_trial:
      terms?.renewal_price_cents != null ? `$${(terms.renewal_price_cents / 100).toFixed(2)}${terms.billing_period ? "/" + terms.billing_period : ""}` : null,
    cancel_policy: terms?.cancel_policy ?? null,
  });
}
