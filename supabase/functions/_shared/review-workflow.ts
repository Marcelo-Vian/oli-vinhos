import type { SupabaseClient } from "npm:@supabase/supabase-js@^2.110.3";
import { escapeHtml, hashToken, randomToken } from "./order-workflow.ts";

export type ReviewAction = "approve" | "reject";

export const reviewActionLabels: Record<ReviewAction, string> = {
  approve: "Aprovar e publicar",
  reject: "Rejeitar avaliação",
};

export type ReviewForModeration = {
  id: string;
  customer_name: string;
  rating: number;
  comment: string | null;
  status: string;
  products?: { name?: string } | Array<{ name?: string }> | null;
};

function productName(review: ReviewForModeration): string {
  if (Array.isArray(review.products)) return review.products[0]?.name ?? "Produto OLI";
  return review.products?.name ?? "Produto OLI";
}

export async function createReviewActionLink(
  supabaseAdmin: SupabaseClient,
  reviewId: string,
  action: ReviewAction,
  authorizedEmail: string,
  baseUrl: string,
): Promise<string> {
  const token = randomToken();
  const tokenHash = await hashToken(token);
  await supabaseAdmin.from("review_email_actions").delete()
    .eq("review_id", reviewId).eq("action", action).is("used_at", null);
  const { error } = await supabaseAdmin.from("review_email_actions").insert({
    review_id: reviewId,
    action,
    token_hash: tokenHash,
    authorized_email: authorizedEmail,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw new Error(`Não foi possível criar o link de moderação: ${error.message}`);
  const url = new URL(baseUrl);
  url.searchParams.set("token", token);
  return url.toString();
}

export function reviewModerationEmail(
  review: ReviewForModeration,
  approveUrl: string,
  rejectUrl: string,
): { subject: string; html: string; text: string } {
  const name = productName(review);
  const stars = "★".repeat(review.rating) + "☆".repeat(5 - review.rating);
  const comment = review.comment?.trim() || "Sem comentário.";
  const html = `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#241c1b"><p style="color:#701b31;letter-spacing:2px">OLI VINHOS · HOMOLOGAÇÃO</p><h1>Nova avaliação para moderar</h1><div style="background:#f3eee8;padding:18px;margin:20px 0"><b>${escapeHtml(name)}</b><p style="color:#9b641f;font-size:22px;margin:10px 0">${stars}</p><p><b>Cliente:</b> ${escapeHtml(review.customer_name)}</p><p style="white-space:pre-wrap">${escapeHtml(comment)}</p></div><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding-right:6px"><a href="${escapeHtml(approveUrl)}" style="display:block;background:#27553a;color:#fff;text-decoration:none;padding:14px;text-align:center;font-weight:bold">Aprovar e publicar</a></td><td style="padding-left:6px"><a href="${escapeHtml(rejectUrl)}" style="display:block;background:#8d2639;color:#fff;text-decoration:none;padding:14px;text-align:center;font-weight:bold">Rejeitar avaliação</a></td></tr></table><p style="font-size:12px;color:#766">Os links expiram em 7 dias, exigem confirmação e só podem ser utilizados uma vez.</p></div>`;
  const text = `OLI Vinhos - homologação\nNova avaliação para moderar\nProduto: ${name}\nCliente: ${review.customer_name}\nNota: ${review.rating}/5\nComentário: ${comment}\nAprovar e publicar: ${approveUrl}\nRejeitar: ${rejectUrl}`;
  return { subject: `[Homologação] Avaliação de ${review.customer_name} — ${name}`, html, text };
}
