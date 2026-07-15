import type { SupabaseClient } from "npm:@supabase/supabase-js@^2.110.3";

export type WorkflowAction = "confirm_payment" | "confirm_order" | "preparing" | "ready" | "delivered";

export type WorkflowOrder = {
  id: string;
  order_number: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  total: number;
  payment_method: "pix" | "cash";
  payment_status: string;
  status: string;
  pickup_date: string;
  pickup_time: string;
  order_items?: Array<{ product_name: string; quantity: number; line_total: number }>;
};

export const actionLabels: Record<WorkflowAction, string> = {
  confirm_payment: "Confirmar pagamento Pix",
  confirm_order: "Confirmar pedido",
  preparing: "Iniciar separação",
  ready: "Marcar pronto para retirada",
  delivered: "Confirmar entrega ao cliente",
};

export const statusLabels: Record<string, string> = {
  pending: "Pendente",
  confirmed: "Confirmado",
  preparing: "Em separação",
  ready: "Pronto para retirada",
  delivered: "Entregue",
  canceled: "Cancelado",
};

export function nextAction(order: WorkflowOrder): WorkflowAction | null {
  if (order.status === "canceled" || order.status === "delivered") return null;
  if (order.payment_method === "pix" && order.payment_status === "pending") return "confirm_payment";
  if (order.status === "pending") return "confirm_order";
  if (order.status === "confirmed") return "preparing";
  if (order.status === "preparing") return "ready";
  if (order.status === "ready") return "delivered";
  return null;
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function createActionLink(
  supabaseAdmin: SupabaseClient,
  orderId: string,
  action: WorkflowAction,
  authorizedEmail: string,
  baseUrl: string,
): Promise<string> {
  const token = randomToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await supabaseAdmin.from("order_email_actions").delete()
    .eq("order_id", orderId).eq("action", action).is("used_at", null);
  const { error } = await supabaseAdmin.from("order_email_actions").insert({
    order_id: orderId,
    action,
    token_hash: tokenHash,
    authorized_email: authorizedEmail,
    expires_at: expiresAt,
  });
  if (error) throw new Error(`Não foi possível criar o link operacional: ${error.message}`);
  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

function senderEmail(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return match?.[1] ?? value;
}

export async function sendTransactionalEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const resendApiKey = Deno.env.get("RESEND_API_KEY");
  const brevoApiKey = Deno.env.get("BREVO_API_KEY");
  const from = Deno.env.get("ORDER_FROM_EMAIL");
  if ((!resendApiKey && !brevoApiKey) || !from) return { sent: false, reason: "not_configured" };

  if (brevoApiKey) {
    const response = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "api-key": brevoApiKey },
      body: JSON.stringify({
        sender: { name: "OLI Vinhos", email: senderEmail(from) },
        to: [{ email: input.to }],
        subject: input.subject,
        htmlContent: input.html,
        textContent: input.text,
        tags: ["pedido-oli"],
      }),
    });
    return response.ok ? { sent: true } : { sent: false, reason: "provider_error" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${resendApiKey}`, "User-Agent": "oli-vinhos-homolog/1.0" },
    body: JSON.stringify({ from, to: [input.to], subject: input.subject, html: input.html, text: input.text }),
  });
  return response.ok ? { sent: true } : { sent: false, reason: "provider_error" };
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function money(value: number): string {
  return `R$ ${Number(value).toFixed(2).replace(".", ",")}`;
}

export function workflowEmail(order: WorkflowOrder, action: WorkflowAction | null, actionUrl?: string): { subject: string; html: string; text: string } {
  const items = (order.order_items ?? []).map((item) =>
    `<tr><td style="padding:6px 0">${escapeHtml(item.quantity)}× ${escapeHtml(item.product_name)}</td><td style="padding:6px 0;text-align:right">${money(item.line_total)}</td></tr>`
  ).join("");
  const button = action && actionUrl
    ? `<p style="margin:24px 0"><a href="${escapeHtml(actionUrl)}" style="display:inline-block;background:#701b31;color:#fff;text-decoration:none;padding:14px 20px;font-weight:bold">${escapeHtml(actionLabels[action])}</a></p><p style="font-size:12px;color:#766">O link expira em 7 dias e abre uma tela de confirmação antes de alterar o pedido.</p>`
    : `<p style="background:#e5f2e9;color:#245b3b;padding:12px"><b>Fluxo concluído.</b> Nenhuma ação operacional está pendente.</p>`;
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#241c1b"><p style="color:#701b31;letter-spacing:2px">OLI VINHOS · HOMOLOGAÇÃO</p><h1>Pedido #${escapeHtml(order.order_number)}</h1><p><b>${escapeHtml(order.customer_name)}</b><br>${escapeHtml(order.customer_email)}<br>${escapeHtml(order.customer_phone)}</p><table style="width:100%;border-collapse:collapse">${items}<tr style="border-top:1px solid #ddd"><td style="padding-top:12px"><b>Total</b></td><td style="padding-top:12px;text-align:right"><b>${money(order.total)}</b></td></tr></table><p><b>Status:</b> ${escapeHtml(statusLabels[order.status] ?? order.status)}<br><b>Pagamento:</b> ${order.payment_method === "pix" ? "Pix" : "Dinheiro na retirada"} — ${escapeHtml(order.payment_status === "paid" ? "Pago" : "Pendente")}<br><b>Retirada:</b> ${escapeHtml(order.pickup_date)} às ${escapeHtml(order.pickup_time).slice(0,5)}</p>${button}</div>`;
  const text = `OLI Vinhos - homologação\nPedido #${order.order_number}\nCliente: ${order.customer_name}\nTotal: ${money(order.total)}\nStatus: ${statusLabels[order.status] ?? order.status}${action && actionUrl ? `\n${actionLabels[action]}: ${actionUrl}` : "\nFluxo concluído."}`;
  return { subject: `[Homologação] Pedido OLI #${order.order_number} — ${statusLabels[order.status] ?? order.status}`, html, text };
}
