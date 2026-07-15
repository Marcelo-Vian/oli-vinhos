import { withSupabase } from "npm:@supabase/server@^1";
import { createActionLink, escapeHtml, money, nextAction, sendTransactionalEmail, workflowEmail, type WorkflowOrder } from "../_shared/order-workflow.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    const { orderId } = await request.json().catch(() => ({ orderId: null })) as { orderId?: string | null };
    const claims = context.userClaims as { sub?: string; id?: string } | undefined;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const { data: verifiedAuth } = token ? await context.supabaseAdmin.auth.getUser(token) : { data: { user: null } };
    const callerId = verifiedAuth.user?.id ?? claims?.sub ?? claims?.id;
    if (!orderId || !callerId) return Response.json({ message: "Pedido inválido." }, { status: 400 });

    const { data: order, error } = await context.supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .single();
    if (error || !order) return Response.json({ message: "Pedido não encontrado." }, { status: 404 });

    const { data: caller } = await context.supabaseAdmin.from("profiles").select("role").eq("id", callerId).single();
    if (order.user_id !== callerId && !["master", "admin", "manager"].includes(caller?.role ?? "")) {
      return Response.json({ message: "Acesso negado." }, { status: 403 });
    }

    const managerEmail = Deno.env.get("ORDER_TO_EMAIL") ?? "marcelo.vian@gmail.com";
    const actionBaseUrl = Deno.env.get("ORDER_ACTION_BASE_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/order-action`;
    const workflowOrder = order as WorkflowOrder;
    const action = nextAction(workflowOrder);
    const actionUrl = action ? await createActionLink(context.supabaseAdmin, order.id, action, managerEmail, actionBaseUrl) : undefined;
    const managerMessage = workflowEmail(workflowOrder, action, actionUrl);
    const managerResult = await sendTransactionalEmail({ to: managerEmail, ...managerMessage });

    const customerItems = (order.order_items ?? []).map((item: { product_name: string; quantity: number; line_total: number }) =>
      `<tr><td style="padding:6px 0">${escapeHtml(item.quantity)}× ${escapeHtml(item.product_name)}</td><td style="padding:6px 0;text-align:right">${money(item.line_total)}</td></tr>`
    ).join("");
    const customerHtml = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#241c1b"><h1 style="color:#701b31">Pedido OLI #${escapeHtml(order.order_number)}</h1><p>Recebemos seu pedido.</p><table style="width:100%;border-collapse:collapse">${customerItems}<tr style="border-top:1px solid #ddd"><td style="padding-top:12px"><b>Total</b></td><td style="padding-top:12px;text-align:right"><b>${money(order.total)}</b></td></tr></table><p><b>Pagamento:</b> ${order.payment_method === "pix" ? "Pix" : "Dinheiro na retirada"}<br><b>Retirada:</b> ${escapeHtml(order.pickup_date)} às ${escapeHtml(order.pickup_time).slice(0,5)}</p><p>O pedido aguarda confirmação da OLI Vinhos.</p></div>`;
    if (order.customer_email && order.customer_email !== managerEmail && managerResult.sent) {
      await sendTransactionalEmail({
        to: order.customer_email,
        subject: `Recebemos seu pedido OLI #${order.order_number}`,
        html: customerHtml,
        text: `Recebemos seu pedido OLI #${order.order_number}. Total: ${money(order.total)}. Retirada em ${order.pickup_date} às ${String(order.pickup_time).slice(0,5)}.`,
      });
    }

    if (managerResult.sent) {
      await context.supabaseAdmin.from("orders").update({ email_sent_at: new Date().toISOString() }).eq("id", order.id);
    }
    return Response.json(managerResult);
  }),
};
