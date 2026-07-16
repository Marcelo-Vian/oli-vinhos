import { createClient } from "npm:@supabase/supabase-js@^2.110.3";
import { actionLabels, createActionLink, customerNotificationEmail, hashToken, nextAction, sendTransactionalEmail, statusLabels, workflowEmail, type WorkflowAction, type WorkflowOrder } from "../_shared/order-workflow.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const actionPageUrl = Deno.env.get("ORDER_ACTION_PAGE_URL") ?? "";
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

async function requestInput(request: Request): Promise<{ token: string; customerMessage: string }> {
  if (request.method === "POST") {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const body = await request.json().catch(() => ({})) as { token?: string; customerMessage?: string };
      return { token: String(body.token ?? ""), customerMessage: String(body.customerMessage ?? "").trim() };
    }
    const form = await request.formData();
    return { token: String(form.get("token") ?? ""), customerMessage: String(form.get("customerMessage") ?? "").trim() };
  }
  return { token: new URL(request.url).searchParams.get("token") ?? "", customerMessage: "" };
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (!supabaseUrl || !serviceRoleKey) return json({ ok: false, message: "A configuração segura deste serviço está incompleta." }, 503);
  if (request.method !== "GET" && request.method !== "POST") return json({ ok: false, message: "Método não permitido." }, 405);

  const { token, customerMessage } = await requestInput(request);
  if (!token || token.length > 256) return json({ ok: false, message: "O endereço está incompleto ou foi alterado." }, 400);
  if (customerMessage.length > 500) return json({ ok: false, message: "A mensagem ao cliente deve ter no máximo 500 caracteres." }, 400);

  const requestUrl = new URL(request.url);
  if (request.method === "GET" && requestUrl.searchParams.get("format") !== "json" && actionPageUrl) {
    const pageUrl = new URL(actionPageUrl);
    pageUrl.searchParams.set("token", token);
    return Response.redirect(pageUrl.toString(), 302);
  }

  const tokenHash = await hashToken(token);
  if (request.method === "GET") {
    const { data, error } = await supabaseAdmin.from("order_email_actions")
      .select("action, expires_at, used_at, orders!inner(order_number, customer_name, total, status, payment_status)")
      .eq("token_hash", tokenHash).single();
    if (error || !data) return json({ ok: false, message: "Este link não foi encontrado." }, 404);
    if (data.used_at) return json({ ok: false, used: true, message: "Esta ação já foi realizada." });
    if (new Date(data.expires_at).getTime() < Date.now()) return json({ ok: false, expired: true, message: "Este link expirou. Atualize o pedido pelo painel administrativo." }, 410);
    const order = data.orders as unknown as { order_number: number; customer_name: string; total: number; status: string; payment_status: string };
    const action = data.action as WorkflowAction;
    return json({
      ok: true,
      action,
      actionLabel: actionLabels[action],
      order: {
        orderNumber: order.order_number,
        customerName: order.customer_name,
        total: Number(order.total),
        status: order.status,
        statusLabel: statusLabels[order.status] ?? order.status,
        paymentStatus: order.payment_status,
      },
    });
  }

  const { data, error } = await supabaseAdmin.rpc("apply_order_email_action", {
    p_token_hash: tokenHash,
    p_customer_message: customerMessage || null,
  });
  if (error || !data) return json({ ok: false, message: error?.message ?? "Não foi possível atualizar o pedido." }, 409);

  const order = data as WorkflowOrder & { action: WorkflowAction; authorized_email: string; customer_message?: string | null };
  const { data: detailedOrder } = await supabaseAdmin.from("orders").select("*, order_items(*)").eq("id", order.id).single();
  const currentOrder = (detailedOrder ?? order) as WorkflowOrder;
  let customerNotified = false;
  if (currentOrder.customer_email) {
    const notification = customerNotificationEmail(currentOrder, order.action === "confirm_payment" ? "payment" : "status", order.customer_message);
    const customerResult = await sendTransactionalEmail({ to: currentOrder.customer_email, ...notification });
    customerNotified = customerResult.sent;
  }

  const next = nextAction(currentOrder);
  let followUpSent = false;
  if (next) {
    const actionBaseUrl = Deno.env.get("ORDER_ACTION_BASE_URL") ?? `${supabaseUrl}/functions/v1/order-action`;
    const actionUrl = await createActionLink(supabaseAdmin, order.id, next, order.authorized_email, actionBaseUrl);
    const cancelUrl = await createActionLink(supabaseAdmin, order.id, "cancel", order.authorized_email, actionBaseUrl);
    const message = workflowEmail(currentOrder, next, actionUrl, cancelUrl);
    const sent = await sendTransactionalEmail({ to: order.authorized_email, ...message });
    followUpSent = sent.sent;
  }

  return json({
    ok: true,
    completed: true,
    action: order.action,
    actionLabel: actionLabels[order.action],
    orderNumber: order.order_number,
    status: order.status,
    statusLabel: statusLabels[order.status] ?? order.status,
    customerNotified,
    nextActionSent: followUpSent,
    workflowCompleted: !next,
  });
});
