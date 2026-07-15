import { withSupabase } from "npm:@supabase/server@^1";
import { sendTransactionalEmail, workflowRecipient } from "../_shared/order-workflow.ts";
import { createReviewActionLink, reviewModerationEmail, type ReviewForModeration } from "../_shared/review-workflow.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    const { reviewId } = await request.json().catch(() => ({ reviewId: null })) as { reviewId?: string | null };
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const { data: verifiedAuth } = token ? await context.supabaseAdmin.auth.getUser(token) : { data: { user: null } };
    const callerId = verifiedAuth.user?.id;
    if (!reviewId || !callerId) return Response.json({ sent: false, message: "Avaliação inválida." }, { status: 400 });

    const { data, error } = await context.supabaseAdmin
      .from("product_reviews")
      .select("id, user_id, customer_name, rating, comment, status, products(name)")
      .eq("id", reviewId)
      .single();
    if (error || !data) return Response.json({ sent: false, message: "Avaliação não encontrada." }, { status: 404 });
    if (data.user_id !== callerId) return Response.json({ sent: false, message: "Acesso negado." }, { status: 403 });
    if (data.status !== "pending") return Response.json({ sent: false, message: "Esta avaliação já foi moderada." }, { status: 409 });

    const managerEmail = await workflowRecipient(context.supabaseAdmin);
    const baseUrl = Deno.env.get("REVIEW_ACTION_BASE_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/review-action`;
    const approveUrl = await createReviewActionLink(context.supabaseAdmin, reviewId, "approve", managerEmail, baseUrl);
    const rejectUrl = await createReviewActionLink(context.supabaseAdmin, reviewId, "reject", managerEmail, baseUrl);
    const message = reviewModerationEmail(data as unknown as ReviewForModeration, approveUrl, rejectUrl);
    const result = await sendTransactionalEmail({ to: managerEmail, ...message });
    return Response.json(result);
  }),
};
