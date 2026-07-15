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

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    const brevoApiKey = Deno.env.get("BREVO_API_KEY");
    const from = Deno.env.get("ORDER_FROM_EMAIL");
    const storeEmail = Deno.env.get("ORDER_TO_EMAIL") ?? "olivinhos.comercial@gmail.com";
    if ((!resendApiKey && !brevoApiKey) || !from) return Response.json({ sent: false, reason: "not_configured" });

    const items = (order.order_items ?? []).map((item: { product_name: string; quantity: number; line_total: number }) =>
      `<tr><td style="padding:6px 0">${escapeHtml(item.quantity)}× ${escapeHtml(item.product_name)}</td><td style="padding:6px 0;text-align:right">R$ ${Number(item.line_total).toFixed(2).replace(".", ",")}</td></tr>`
    ).join("");
    const paymentMethod = order.payment_method === "pix" ? "Pix" : "Dinheiro na retirada";
    const paymentStatus = order.payment_status === "paid" ? "Pago" : "Pendente";
    const testNotice = order.payment_provider === "homologation" ? `<p style="background:#fff3d8;padding:10px"><b>Pix de homologação:</b> não efetue pagamento real.</p>` : "";
    const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#241c1b"><h1 style="color:#641b2b">Pedido OLI #${escapeHtml(order.order_number)}</h1><p><b>Cliente:</b> ${escapeHtml(order.customer_name)}<br><b>E-mail:</b> ${escapeHtml(order.customer_email)}<br><b>Telefone:</b> ${escapeHtml(order.customer_phone)}</p><table style="width:100%;border-collapse:collapse">${items}<tr style="border-top:1px solid #ddd"><td style="padding-top:12px"><b>Total</b></td><td style="padding-top:12px;text-align:right"><b>R$ ${Number(order.total).toFixed(2).replace(".", ",")}</b></td></tr></table><p><b>Pagamento:</b> ${escapeHtml(paymentMethod)} — ${escapeHtml(paymentStatus)}<br><b>Retirada:</b> ${escapeHtml(order.pickup_date)} às ${escapeHtml(order.pickup_time).slice(0,5)}<br><b>Observações:</b> ${escapeHtml(order.notes || "Sem observações")}</p>${testNotice}<p>O pedido aguarda confirmação de estoque e horário pela OLI Vinhos.</p></div>`;

    const recipients = [...new Set([storeEmail, order.customer_email].filter(Boolean))];
    let sent = false;
    if (brevoApiKey) {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": brevoApiKey },
        body: JSON.stringify({
          sender: { name: "OLI Vinhos", email: from },
          replyTo: { name: "OLI Vinhos", email: storeEmail },
          to: recipients.map((email) => ({ email })),
          subject: `Pedido OLI #${order.order_number}`,
          htmlContent: html,
          textContent: `Pedido OLI #${order.order_number}\nCliente: ${order.customer_name}\nTotal: R$ ${Number(order.total).toFixed(2).replace(".", ",")}\nPagamento: ${paymentMethod} — ${paymentStatus}\nRetirada: ${order.pickup_date} às ${String(order.pickup_time).slice(0,5)}`,
          tags: ["pedido-oli"],
        }),
      });
      sent = response.ok;
    } else if (resendApiKey) {
      const send = (to: string, subject: string) => fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}` },
        body: JSON.stringify({ from, to: [to], subject, html }),
      });
      const responses = await Promise.all(recipients.map((to) => send(to, to === storeEmail ? `Novo pedido OLI #${order.order_number}` : `Recebemos seu pedido OLI #${order.order_number}`)));
      sent = responses.every((response) => response.ok);
    }
    if (!sent) return Response.json({ sent: false, reason: "provider_error" }, { status: 502 });

    await context.supabaseAdmin.from("orders").update({ email_sent_at: new Date().toISOString() }).eq("id", order.id);
    return Response.json({ sent: true });
  }),
};
