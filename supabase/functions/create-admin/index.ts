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

    const body = await request.json().catch(() => null) as { email?: string; password?: string } | null;
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";

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
