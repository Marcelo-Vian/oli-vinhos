import { withSupabase } from "npm:@supabase/server@^1";

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") {
      return Response.json({ message: "Método não permitido." }, { status: 405 });
    }

    const callerId = context.userClaims?.id;
    if (!callerId) {
      return Response.json({ message: "Usuário não autenticado." }, { status: 401 });
    }

    const { data: callerProfile, error: callerError } = await context.supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();

    if (callerError || callerProfile?.role !== "admin") {
      return Response.json({ message: "Somente administradores podem criar novos acessos." }, { status: 403 });
    }

    const body = await request.json().catch(() => null) as { action?: "create" | "reset_password" | "delete"; userId?: string; email?: string; password?: string } | null;
    const action = body?.action ?? "create";
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";

    if (action === "reset_password") {
      if (!body?.userId) return Response.json({ message: "Administrador inválido." }, { status: 400 });
      if (password.length < 8) return Response.json({ message: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });
      const { data: target } = await context.supabaseAdmin.from("profiles").select("role,email").eq("id", body.userId).single();
      if (target?.role !== "admin") return Response.json({ message: "Administrador não encontrado." }, { status: 404 });
      const { error: updateError } = await context.supabaseAdmin.auth.admin.updateUserById(body.userId, { password });
      if (updateError) return Response.json({ message: updateError.message }, { status: 400 });
      return Response.json({ id: body.userId, email: target.email, updated: true });
    }

    if (action === "delete") {
      if (!body?.userId) return Response.json({ message: "Administrador inválido." }, { status: 400 });
      if (body.userId === callerId) return Response.json({ message: "Você não pode remover o próprio acesso." }, { status: 400 });
      const { data: target } = await context.supabaseAdmin.from("profiles").select("role,email").eq("id", body.userId).single();
      if (target?.role !== "admin") return Response.json({ message: "Administrador não encontrado." }, { status: 404 });
      const { count } = await context.supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
      if ((count ?? 0) <= 1) return Response.json({ message: "É necessário manter pelo menos um administrador." }, { status: 400 });
      const { error: deleteError } = await context.supabaseAdmin.auth.admin.deleteUser(body.userId);
      if (deleteError) return Response.json({ message: deleteError.message }, { status: 400 });
      return Response.json({ id: body.userId, email: target.email, deleted: true });
    }

    if (action !== "create") return Response.json({ message: "Ação inválida." }, { status: 400 });

    if (!/^\S+@\S+\.\S+$/.test(email)) {
      return Response.json({ message: "Informe um e-mail válido." }, { status: 400 });
    }
    if (password.length < 8) {
      return Response.json({ message: "A senha temporária deve ter pelo menos 8 caracteres." }, { status: 400 });
    }

    const { data: created, error: createError } = await context.supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });

    if (createError || !created.user) {
      return Response.json({ message: createError?.message ?? "Não foi possível criar o usuário." }, { status: 400 });
    }

    const { error: profileError } = await context.supabaseAdmin
      .from("profiles")
      .upsert({ id: created.user.id, role: "admin" });

    if (profileError) {
      await context.supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return Response.json({ message: "Não foi possível conceder o acesso administrativo." }, { status: 500 });
    }

    return Response.json({ id: created.user.id, email: created.user.email });
  }),
};
