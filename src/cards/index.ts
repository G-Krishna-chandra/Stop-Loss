// Single-use virtual cards through Kernel's Link by Stripe wallet integration.
// Source: kernel.sh/docs integrations/wallets/stripe-link.md, vaults/fill.md.
// Card numbers never enter our app, logs, database, or model context: Kernel issues the card into its vault and
// fills it straight into the checkout page. We only see states, masks (last4), and per-field fill outcomes.
import Kernel from "@onkernel/sdk";

export type CardStatus = {
  provider: "link";
  // not_configured: no Kernel key. not_connected: no Link wallet yet. connecting: a hosted Link step is waiting.
  // connected: StopLoss can issue a single-use card per trial. error: the wallet needs attention.
  state: "not_configured" | "not_connected" | "connecting" | "connected" | "error";
  detail: string | null;
  // Where the user finishes connecting Link (a hosted Link page), when there is a step to do.
  action_url: string | null;
};

const VAULT = process.env.STOPLOSS_VAULT_NAME || "stoploss-user";
const WALLET_KEY = "link-wallet";

let client: Kernel | null = null;

// Retries off: the docs say never to retry authorize or fill automatically.
function kernel(): Kernel {
  if (!client) {
    client = new Kernel({
      apiKey: process.env.KERNEL_API_KEY,
      maxRetries: 0,
      ...(process.env.KERNEL_PROJECT_ID ? { projectID: process.env.KERNEL_PROJECT_ID } : {}),
    });
  }
  return client;
}

export function vaultName(): string {
  return VAULT;
}

async function vaultId(): Promise<string> {
  return (await kernel().vaults.upsert({ name: VAULT })).id;
}

type Item = Awaited<ReturnType<Kernel["vaults"]["items"]["retrieve"]>>;
type WalletItem = Extract<Item, { type: "wallet" }>;
type CardItem = Extract<Item, { type: "card" }>;

function actionUrl(item: { action?: { name: string } }): string | null {
  const a = item.action as { name: string; url?: string } | undefined;
  return a?.url ?? null;
}

async function findWallet(vault: string): Promise<WalletItem | null> {
  const items = await kernel().vaults.items.list(vault);
  // The API doesn't enforce one wallet per provider, so StopLoss keeps exactly one.
  const wallet = items.find((i): i is WalletItem => i.type === "wallet" && i.spec.provider === "link");
  return wallet ?? null;
}

export async function getCardStatus(): Promise<CardStatus> {
  if (!process.env.KERNEL_API_KEY) {
    return { provider: "link", state: "not_configured", detail: "KERNEL_API_KEY is not set.", action_url: null };
  }
  try {
    const wallet = await findWallet(await vaultId());
    if (!wallet) return { provider: "link", state: "not_connected", detail: null, action_url: null };
    const status = (wallet.state as { status: string }).status;
    if (status === "connected") return { provider: "link", state: "connected", detail: null, action_url: null };
    if (status === "pending_authorization") {
      return { provider: "link", state: "connecting", detail: "Finish connecting Link.", action_url: actionUrl(wallet) };
    }
    const reason = (wallet.state as { status_reason?: string }).status_reason;
    return {
      provider: "link",
      state: "error",
      detail: `Link wallet is ${status.replace("_", " ")}${reason ? `: ${reason}` : ""}.`,
      action_url: actionUrl(wallet),
    };
  } catch (err) {
    return { provider: "link", state: "error", detail: err instanceof Error ? err.message : "Kernel vault error.", action_url: null };
  }
}

// Creates the Link wallet if needed and returns the hosted Link page the user must open, or null when connected.
export async function connectWallet(): Promise<string | null> {
  const vault = await vaultId();
  let wallet = await findWallet(vault);
  if (!wallet) {
    wallet = (await kernel().vaults.items.upsert(WALLET_KEY, {
      id_or_name: vault,
      type: "wallet",
      spec: { provider: "link", authorization: { method: "oauth", client: { type: "kernel_managed" } } },
    })) as WalletItem;
  }
  if ((wallet.state as { status: string }).status === "connected") return null;
  return actionUrl(wallet);
}

async function paymentMethodId(vault: string): Promise<string> {
  const wallet = (await kernel().vaults.items.retrieve(WALLET_KEY, { id_or_name: vault, expand: ["payment_methods"] })) as WalletItem;
  const methods = wallet.expanded?.payment_methods ?? [];
  const usable = methods.filter((m) => (m.capabilities as { single_use_card?: { eligible?: boolean } }).single_use_card?.eligible !== false);
  const chosen = usable.find((m) => m.is_default) ?? usable[0];
  if (!chosen) throw new Error("Your Link wallet has no payment method that can issue a single-use card.");
  return chosen.id;
}

export type CardRequest = {
  // One card per run: the key makes issuing idempotent, so a resumed run never authorizes a second card.
  key: string;
  merchantName: string;
  // Exact https origin of the checkout page. Link only lets the card be filled on this origin.
  merchantUrl: string;
  // Cap in cents. A trial normally charges $0 or a small verification, so a $1 cap means a renewal can't go through.
  amountCents: number;
  context: string;
};

export type CardProgress =
  | { state: "awaiting_approval"; approvalUrl: string | null; last4: string | null }
  | { state: "ready"; last4: string | null }
  | { state: "failed"; detail: string };

function cardProgress(card: CardItem): CardProgress {
  const st = card.state as { status: string; status_reason?: string; masks?: { last4?: string } };
  const last4 = st.masks?.last4 ?? null;
  if (st.status === "ready") return { state: "ready", last4 };
  if (st.status === "requested" || st.status === "pending_authorization") {
    return { state: "awaiting_approval", approvalUrl: actionUrl(card), last4 };
  }
  return { state: "failed", detail: `The card is ${st.status.replace("_", " ")}${st.status_reason ? `: ${st.status_reason}` : ""}.` };
}

// Creates the card for this run and asks Link to approve it, once. Later calls only report progress.
export async function requestCard(req: CardRequest): Promise<CardProgress> {
  const vault = await vaultId();
  let card: CardItem | null = null;
  try {
    card = (await kernel().vaults.items.retrieve(req.key, { id_or_name: vault })) as CardItem;
  } catch {
    card = null;
  }
  if (!card) {
    card = (await kernel().vaults.items.upsert(req.key, {
      id_or_name: vault,
      type: "card",
      spec: {
        provider: "link",
        wallet: WALLET_KEY,
        payment_method_id: await paymentMethodId(vault),
        amount: req.amountCents,
        currency: "usd",
        merchant_name: req.merchantName.slice(0, 255),
        merchant_url: req.merchantUrl,
        context: req.context.padEnd(100, "."),
      },
    })) as CardItem;
  }
  const st = (card.state as { status: string }).status;
  if (st === "requested" && card.available_operations.some((o) => o.type === "authorize")) {
    card = (await kernel().vaults.items.performOperation(req.key, { id_or_name: vault, type: "authorize" })) as CardItem;
  }
  return cardProgress(card);
}

// One bounded wait (up to `seconds`) for the user's Link approval.
export async function waitForCard(key: string, seconds: number): Promise<CardProgress> {
  const vault = await vaultId();
  const card = (await kernel().vaults.items.retrieve(key, { id_or_name: vault, wait: Math.min(60, seconds) })) as CardItem;
  return cardProgress(card);
}

export type CardField = "number" | "expiration" | "exp_month" | "exp_year" | "cvc" | "billing_name" | "billing_postal_code";
export type CardBinding = { field: CardField; selector: string };

// Fills the approved card into the checkout. Never retried: a failed or unknown result is reported as is.
export async function fillCard(input: {
  key: string;
  browserId: string;
  pageUrl: string;
  bindings: CardBinding[];
}): Promise<{ status: "completed" | "failed" | "unknown"; detail: string }> {
  const vault = await vaultId();
  const card = (await kernel().vaults.items.retrieve(input.key, { id_or_name: vault })) as CardItem;
  if (!card.available_operations.some((o) => o.type === "fill")) {
    return { status: "failed", detail: "The card can't be filled yet." };
  }
  const attempt = (bindings: CardBinding[]) =>
    kernel().vaults.items.performOperation(input.key, {
      id_or_name: vault,
      type: "fill",
      browser_id: input.browserId,
      page_url: input.pageUrl,
      fields: bindings.map((b) => (b.field === "expiration" ? { ...b, format: "MM/YY" as const } : b)),
      timeout_ms: 15000,
    });
  let result;
  try {
    result = await attempt(input.bindings);
  } catch (err) {
    // A missing billing value fails before any browser write, so one retry without billing fields is safe.
    const message = err instanceof Error ? err.message : String(err);
    if (!/field_unavailable/i.test(message)) return { status: "unknown", detail: message };
    const cardOnly = input.bindings.filter((b) => !b.field.startsWith("billing_"));
    try {
      result = await attempt(cardOnly);
    } catch (err2) {
      return { status: "unknown", detail: err2 instanceof Error ? err2.message : String(err2) };
    }
  }
  const r = result as { type: string; status: "completed" | "failed" | "unknown"; fields?: { field?: string; status?: string }[] };
  const fields = (r.fields ?? []).map((f) => `${f.field ?? "field"}: ${f.status ?? "?"}`).join(", ");
  return { status: r.status, detail: fields || r.status };
}
