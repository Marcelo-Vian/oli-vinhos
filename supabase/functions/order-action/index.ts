import { createClient } from "npm:@supabase/supabase-js@^2.110.3";
import { actionLabels, createActionLink, escapeHtml, hashToken, nextAction, sendTransactionalEmail, statusLabels, workflowEmail, type WorkflowAction, type WorkflowOrder } from "../_shared/order-workflow.ts";

const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

function page(title: string, content: string, status = 200): Response {
  return new Response(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)} — OLI Vinhos</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f3eee8;color:#251718;font-family:Arial,sans-serif;padding:20px}.card{width:min(540px,100%);background:#fff;border:1px solid #d9cec2;padding:38px}.brand{color:#701b31;letter-spacing:2px;font-size:12px}.test{background:#fff3d8;color:#6d4a0a;padding:10px;font-size:13px}h1{font-family:Georgia,serif;font-size:36px;font-weight:500;margin:18px 0}p{line-height:1.55}.button{display:block;width:100%;border:0;background:#701b31;color:#fff;text-align:center;text-decoration:none;padding:15px 18px;font-weight:bold;cursor:pointer;margin-top:24px}.muted{font-size:12px;color:#776b66}.ok{background:#e2f1e7;color:#27553a;padding:12px}.error{background:#f8e1e5;color:#8d2639;padding:12px}</style></head><body><main class="card"><div class="brand">OLI VINHOS</div><div class="test">Ambiente de homologação</div>${content}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" } });
}

async function tokenFromRequest(request: Request): Promise<string> {
  if (request.method === "POST") {
    const form = await request.formData();
    return String(form.get("token") ?? "");
  }
  return new URL(request.url).searchParams.get("token") ?? "";
}

Deno.serve(async (request) => {
  if (!supabaseUrl || !serviceRoleKey) return page("Configuração incompleta", `<h1>Serviço indisponível</h1><p class="error">A configuração segura deste serviço está incompleta.</p>`, 503);
  if (request.method !== "GET" && request.method !== "POST") return new Response("Method not allowed", { status: 405, headers: { Allow: "GET, POST" } });

  const token = await tokenFromRequest(request);
  if (!token || token.length > 256) return page("Link inválido", `<h1>Link inválido</h1><p class="error">O endereço está incompleto ou foi alterado.</p>`, 400);
  const tokenHash = await hashToken(token);

  if (request.method === "GET") {
    const { data, error } = await supabaseAdmin.from("order_email_actions")
      .select("action, expires_at, used_at, orders!inner(order_number, customer_name, total, status, payment_status)")
      .eq("token_hash", tokenHash).single();
    if (error || !data) return page("Link inválido", `<h1>Link inválido</h1><p class="error">Este link não foi encontrado.</p>`, 404);
    if (data.used_at) return page("Ação concluída", `<h1>Ação já realizada</h1><p class="ok">Este link já foi utilizado e não alterará o pedido novamente.</p>`);
    if (new Date(data.expires_at).getTime() < Date.now()) return page("Link expirado", `<h1>Link expirado</h1><p class="error">Abra o painel administrativo para atualizar o pedido.</p>`, 410);
    const order = data.orders as unknown as { order_number: number; customer_name: string; total: number; status: string; payment_status: string };
    const action = data.action as WorkflowAction;
    return page(actionLabels[action], `<h1>Pedido #${escapeHtml(order.order_number)}</h1><p><b>${escapeHtml(order.customer_name)}</b><br>Total: R$ ${Number(order.total).toFixed(2).replace(".", ",")}<br>Status atual: ${escapeHtml(statusLabels[order.status] ?? order.status)}</p><p>Deseja realmente executar a ação <b>${escapeHtml(actionLabels[action])}</b>?</p><form method="post"><input type="hidden" name="token" value="${escapeHtml(token)}"><button class="button" type="submit">Sim, confirmar ação</button></form><p class="muted">Nenhuma alteração acontece antes desta confirmação.</p>`);
  }

  const { data, error } = await supabaseAdmin.rpc("apply_order_email_action", { p_token_hash: tokenHash });
  if (error || !data) return page("Não foi possível concluir", `<h1>Ação não realizada</h1><p class="error">${escapeHtml(error?.message ?? "Não foi possível atualizar o pedido.")}</p>`, 409);

  const order = data as WorkflowOrder & { action: WorkflowAction; authorized_email: string };
  const { data: detailedOrder } = await supabaseAdmin.from("orders").select("*, order_items(*)").eq("id", order.id).single();
  const currentOrder = (detailedOrder ?? order) as WorkflowOrder;
  const next = nextAction(currentOrder);
  let followUpSent = false;
  if (next) {
    const actionBaseUrl = Deno.env.get("ORDER_ACTION_BASE_URL") ?? `${supabaseUrl}/functions/v1/order-action`;
    const actionUrl = await createActionLink(supabaseAdmin, order.id, next, order.authorized_email, actionBaseUrl);
    const message = workflowEmail(currentOrder, next, actionUrl);
    const sent = await sendTransactionalEmail({ to: order.authorized_email, ...message });
    followUpSent = sent.sent;
  }

  return page("Ação concluída", `<h1>Pedido #${escapeHtml(order.order_number)} atualizado</h1><p class="ok"><b>${escapeHtml(actionLabels[order.action])}</b> foi registrado com sucesso.</p><p>Novo status: <b>${escapeHtml(statusLabels[order.status] ?? order.status)}</b>${next ? `<br>${followUpSent ? "A próxima etapa foi enviada por e-mail." : "A próxima etapa está pronta, mas o envio de e-mail ainda não foi configurado."}` : "<br>O fluxo deste pedido foi concluído."}</p>`);
});
