import { withSupabase } from "npm:@supabase/server@^1";

const escapeHtml = (value: unknown) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    const { orderId } = await request.json().catch(() => ({ orderId: null })) as { orderId?: string | null };
    if (!orderId || !context.userClaims?.id) return Response.json({ message: "Pedido inválido." }, { status: 400 });

    const { data: order, error } = await context.supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", orderId)
      .single();
    if (error || !order) return Response.json({ message: "Pedido não encontrado." }, { status: 404 });

    const { data: caller } = await context.supabaseAdmin.from("profiles").select("role").eq("id", context.userClaims.id).single();
    if (order.user_id !== context.userClaims.id && caller?.role !== "admin") {
      return Response.json({ message: "Acesso negado." }, { status: 403 });
    }

    const apiKey = Deno.env.get("RESEND_API_KEY");
    const from = Deno.env.get("ORDER_FROM_EMAIL");
    const storeEmail = Deno.env.get("ORDER_TO_EMAIL") ?? "olivinhos.comercial@gmail.com";
    if (!apiKey || !from) return Response.json({ sent: false, reason: "not_configured" });

    const items = (order.order_items ?? []).map((item: { product_name: string; quantity: number; line_total: number }) =>
      `<tr><td style="padding:6px 0">${escapeHtml(item.quantity)}× ${escapeHtml(item.product_name)}</td><td style="padding:6px 0;text-align:right">R$ ${Number(item.line_total).toFixed(2).replace(".", ",")}</td></tr>`
    ).join("");
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#241c1b"><h1 style="color:#641b2b">Pedido OLI #${escapeHtml(order.order_number)}</h1><p><b>Cliente:</b> ${escapeHtml(order.customer_name)}<br><b>E-mail:</b> ${escapeHtml(order.customer_email)}<br><b>Telefone:</b> ${escapeHtml(order.customer_phone)}</p><table style="width:100%;border-collapse:collapse">${items}<tr style="border-top:1px solid #ddd"><td style="padding-top:12px"><b>Total</b></td><td style="padding-top:12px;text-align:right"><b>R$ ${Number(order.total).toFixed(2).replace(".", ",")}</b></td></tr></table><p><b>Retirada:</b> ${escapeHtml(order.pickup_date)} às ${escapeHtml(order.pickup_time).slice(0,5)}<br><b>Observações:</b> ${escapeHtml(order.notes || "Sem observações")}</p><p>O pedido aguarda confirmação de estoque e horário pela OLI Vinhos.</p></div>`;

    const send = (to: string, subject: string) => fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const responses = await Promise.all([
      send(storeEmail, `Novo pedido OLI #${order.order_number}`),
      send(order.customer_email, `Recebemos seu pedido OLI #${order.order_number}`),
    ]);
    if (responses.some((response) => !response.ok)) return Response.json({ sent: false, reason: "provider_error" }, { status: 502 });

    await context.supabaseAdmin.from("orders").update({ email_sent_at: new Date().toISOString() }).eq("id", order.id);
    return Response.json({ sent: true });
  }),
};
