import { createClient } from "npm:@supabase/supabase-js@^2.110.3";
import { hashToken } from "../_shared/order-workflow.ts";
import { reviewActionLabels, type ReviewAction } from "../_shared/review-workflow.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const actionPageUrl = Deno.env.get("REVIEW_ACTION_PAGE_URL") ?? "";
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

const responseHeaders = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type",
  "access-control-allow-methods": "GET, POST, OPTIONS",
};

function json(data: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: responseHeaders });
}

async function requestToken(request: Request): Promise<string> {
  if (request.method === "POST") {
    const body = await request.json().catch(() => ({})) as { token?: string };
    return String(body.token ?? "");
  }
  return new URL(request.url).searchParams.get("token") ?? "";
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, message: "A configuração segura deste serviço está incompleta." }, 503);
  if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, message: "Método não permitido." }, 405);

  const token = await requestToken(request);
  if (!token || token.length > 256) return json({ ok: false, message: "O endereço está incompleto ou foi alterado." }, 400);
  const requestUrl = new URL(request.url);
  if (request.method === "GET" && requestUrl.searchParams.get("format") !== "json" && actionPageUrl) {
    const pageUrl = new URL(actionPageUrl);
    pageUrl.searchParams.set("token", token);
    return Response.redirect(pageUrl.toString(), 302);
  }

  const tokenHash = await hashToken(token);
  if (request.method === "GET") {
    const { data: action, error } = await supabaseAdmin.from("review_email_actions")
      .select("review_id, action, expires_at, used_at")
      .eq("token_hash", tokenHash).single();
    if (error || !action) return json({ ok: false, message: "Este link não foi encontrado." }, 404);
    if (action.used_at) return json({ ok: false, used: true, message: "Esta decisão já foi registrada." });
    if (new Date(action.expires_at).getTime() < Date.now()) return json({ ok: false, expired: true, message: "Este link expirou. Modere a avaliação pelo painel administrativo." }, 410);
    const { data: review } = await supabaseAdmin.from("product_reviews")
      .select("customer_name, rating, comment, status, products(name)")
      .eq("id", action.review_id).single();
    if (!review) return json({ ok: false, message: "A avaliação não foi encontrada." }, 404);
    const product = Array.isArray(review.products) ? review.products[0] : review.products;
    const decision = action.action as ReviewAction;
    return json({
      ok: true,
      action: decision,
      actionLabel: reviewActionLabels[decision],
      review: {
        customerName: review.customer_name,
        productName: product?.name ?? "Produto OLI",
        rating: review.rating,
        comment: review.comment,
      },
    });
  }

  const { data, error } = await supabaseAdmin.rpc("apply_review_email_action", { p_token_hash: tokenHash });
  if (error || !data) return json({ ok: false, message: error?.message ?? "Não foi possível registrar a decisão." }, 409);
  const result = data as { action: ReviewAction; status: string; customer_name: string; product_name: string };
  return json({
    ok: true,
    completed: true,
    action: result.action,
    actionLabel: reviewActionLabels[result.action],
    status: result.status,
    customerName: result.customer_name,
    productName: result.product_name,
  });
});
