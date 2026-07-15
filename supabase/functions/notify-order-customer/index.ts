import { withSupabase } from "npm:@supabase/server@^1";
import { customerNotificationEmail, sendTransactionalEmail, type CustomerNotificationKind, type WorkflowOrder } from "../_shared/order-workflow.ts";

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    const body = await request.json().catch(() => ({})) as { orderId?: string; kind?: CustomerNotificationKind };
    const kind = body.kind === "payment" ? "payment" : "status";
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const { data: verifiedAuth } = token ? await context.supabaseAdmin.auth.getUser(token) : { data: { user: null } };
    const callerId = verifiedAuth.user?.id;
    if (!body.orderId || !callerId) return Response.json({ sent: false, message: "Solicitação inválida." }, { status: 400 });

    const { data: caller } = await context.supabaseAdmin.from("profiles").select("role").eq("id", callerId).single();
    if (!["master", "admin", "manager"].includes(caller?.role ?? "")) {
      return Response.json({ sent: false, message: "Acesso negado." }, { status: 403 });
    }

    const { data: order, error } = await context.supabaseAdmin
      .from("orders")
      .select("*, order_items(*)")
      .eq("id", body.orderId)
      .single();
    if (error || !order) return Response.json({ sent: false, message: "Pedido não encontrado." }, { status: 404 });
    if (!order.customer_email) return Response.json({ sent: false, message: "Cliente sem e-mail cadastrado." });

    const message = customerNotificationEmail(order as WorkflowOrder, kind);
    const result = await sendTransactionalEmail({ to: order.customer_email, ...message });
    return Response.json(result);
  }),
};
