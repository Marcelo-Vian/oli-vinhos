import { withSupabase } from "npm:@supabase/server@^1";
import { createActionLink, customerNotificationEmail, nextAction, sendTransactionalEmail, workflowEmail, workflowRecipient, type WorkflowOrder } from "../_shared/order-workflow.ts";

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
    const isStaff = ["master", "admin", "manager"].includes(caller?.role ?? "");
    if (order.user_id !== callerId && !isStaff) {
      return Response.json({ message: "Acesso negado." }, { status: 403 });
    }

    // O cliente dispara este endpoint logo após criar o pedido. Reservar o envio
    // de forma atômica impede replay da chamada e spam para a loja/cliente.
    const sendStartedAt = new Date().toISOString();
    let customerReservedSend = false;
    if (!isStaff) {
      const { data: reservation, error: reservationError } = await context.supabaseAdmin
        .from("orders")
        .update({ email_sent_at: sendStartedAt })
        .eq("id", order.id)
        .is("email_sent_at", null)
        .select("id")
        .maybeSingle();
      if (reservationError) {
        console.error("send-order-email: falha ao reservar envio", reservationError);
        return Response.json({ sent: false, message: "Não foi possível iniciar a notificação." }, { status: 500 });
      }
      if (!reservation) {
        return Response.json({ sent: true, customerSent: true, alreadySent: true });
      }
      customerReservedSend = true;
    }

    const managerEmail = await workflowRecipient(context.supabaseAdmin);
    const actionBaseUrl = Deno.env.get("ORDER_ACTION_BASE_URL") ?? `${Deno.env.get("SUPABASE_URL")}/functions/v1/order-action`;
    const workflowOrder = order as WorkflowOrder;
    const action = nextAction(workflowOrder);
    const actionUrl = action ? await createActionLink(context.supabaseAdmin, order.id, action, managerEmail, actionBaseUrl) : undefined;
    const managerMessage = workflowEmail(workflowOrder, action, actionUrl);
    const managerResult = await sendTransactionalEmail({ to: managerEmail, ...managerMessage });

    let customerSent = false;
    if (order.customer_email) {
      const customerMessage = customerNotificationEmail(workflowOrder, "received");
      const customerResult = await sendTransactionalEmail({ to: order.customer_email, ...customerMessage });
      customerSent = customerResult.sent;
    }

    if (managerResult.sent && !customerReservedSend) {
      await context.supabaseAdmin.from("orders").update({ email_sent_at: sendStartedAt }).eq("id", order.id);
    } else if (!managerResult.sent && customerReservedSend) {
      await context.supabaseAdmin.from("orders").update({ email_sent_at: null }).eq("id", order.id).eq("email_sent_at", sendStartedAt);
    }
    return Response.json({ ...managerResult, customerSent });
  }),
};
