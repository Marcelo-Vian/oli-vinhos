import { withSupabase } from "npm:@supabase/server@^1";

type AccessRole = "customer" | "manager" | "admin" | "master";
type Action = "create" | "reset_password" | "delete" | "set_role" | "update_user";
type RequestBody = {
  action?: Action;
  userId?: string;
  email?: string;
  password?: string;
  role?: AccessRole;
  fullName?: string;
  phone?: string;
};

const validEmail = /^\S+@\S+\.\S+$/;

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") {
      return Response.json({ message: "Método não permitido." }, { status: 405 });
    }

    const claims = context.userClaims as { sub?: string; id?: string } | undefined;
    const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
    const { data: verifiedAuth } = token ? await context.supabaseAdmin.auth.getUser(token) : { data: { user: null } };
    const callerId = verifiedAuth.user?.id ?? claims?.sub ?? claims?.id;
    const callerEmail = verifiedAuth.user?.email?.trim().toLowerCase() ?? "";
    const masterEmail = Deno.env.get("MASTER_EMAIL")?.trim().toLowerCase() ?? "";
    const isMasterIdentity = Boolean(masterEmail && callerEmail === masterEmail);

    if (!callerId) {
      return Response.json({ message: "Usuário não autenticado." }, { status: 401 });
    }

    // O proprietário é reconhecido pela identidade autenticada e seu papel é
    // reparado automaticamente caso o perfil tenha sido criado com outro papel.
    if (isMasterIdentity) {
      const { error: masterProfileError } = await context.supabaseAdmin
        .from("profiles")
        .upsert({ id: callerId, email: callerEmail, role: "master" }, { onConflict: "id" });
      if (masterProfileError) {
        return Response.json({ message: "Não foi possível confirmar o acesso MASTER." }, { status: 500 });
      }
    }

    const { data: callerProfile, error: callerError } = await context.supabaseAdmin
      .from("profiles")
      .select("role")
      .eq("id", callerId)
      .single();
    const callerRole: AccessRole | null = isMasterIdentity ? "master" : (callerProfile?.role as AccessRole | undefined) ?? null;

    if ((callerError && !isMasterIdentity) || !callerRole || !["master", "admin", "manager"].includes(callerRole)) {
      return Response.json({ message: "Seu perfil não possui permissão para controlar acessos." }, { status: 403 });
    }

    const body = await request.json().catch(() => null) as RequestBody | null;
    const action = body?.action ?? "create";
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";
    const role: AccessRole = body?.role ?? "manager";

    if (callerRole === "manager" && action !== "create") {
      return Response.json({ message: "Gestores podem cadastrar outros gestores, mas não alterar acessos existentes." }, { status: 403 });
    }

    if (action === "update_user") {
      if (callerRole !== "master") return Response.json({ message: "Somente o MASTER pode editar usuários." }, { status: 403 });
      if (!body?.userId) return Response.json({ message: "Usuário inválido." }, { status: 400 });
      if (!validEmail.test(email)) return Response.json({ message: "Informe um e-mail válido." }, { status: 400 });
      if (!["customer", "manager", "admin"].includes(role)) return Response.json({ message: "Perfil de acesso inválido." }, { status: 400 });
      if (password && password.length < 8) return Response.json({ message: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });

      const { data: target } = await context.supabaseAdmin.from("profiles").select("role").eq("id", body.userId).single();
      if (!target) return Response.json({ message: "Usuário não encontrado." }, { status: 404 });
      if (target.role === "master") return Response.json({ message: "O perfil MASTER não pode ser alterado por esta tela." }, { status: 403 });

      const fullName = body.fullName?.trim() ?? "";
      const phone = body.phone?.trim() ?? "";
      const authChanges: { email: string; email_confirm: boolean; password?: string; user_metadata: Record<string, string> } = {
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, phone },
      };
      if (password) authChanges.password = password;

      const { error: authError } = await context.supabaseAdmin.auth.admin.updateUserById(body.userId, authChanges);
      if (authError) return Response.json({ message: authError.message }, { status: 400 });
      const { error: profileError } = await context.supabaseAdmin
        .from("profiles")
        .update({ email, full_name: fullName || null, phone: phone || null, role })
        .eq("id", body.userId);
      if (profileError) return Response.json({ message: profileError.message }, { status: 400 });
      return Response.json({ id: body.userId, email, role, updated: true });
    }

    if (action === "reset_password") {
      if (!body?.userId) return Response.json({ message: "Membro da equipe inválido." }, { status: 400 });
      if (password.length < 8) return Response.json({ message: "A nova senha deve ter pelo menos 8 caracteres." }, { status: 400 });
      const { data: target } = await context.supabaseAdmin.from("profiles").select("role,email").eq("id", body.userId).single();
      if (!target || !["admin", "manager", "master"].includes(target.role)) return Response.json({ message: "Membro da equipe não encontrado." }, { status: 404 });
      if (target.role === "master") return Response.json({ message: "A senha do MASTER só pode ser alterada pela própria conta." }, { status: 403 });
      const { error: updateError } = await context.supabaseAdmin.auth.admin.updateUserById(body.userId, { password });
      if (updateError) return Response.json({ message: updateError.message }, { status: 400 });
      return Response.json({ id: body.userId, email: target.email, updated: true });
    }

    if (action === "delete") {
      if (!body?.userId) return Response.json({ message: "Membro da equipe inválido." }, { status: 400 });
      if (body.userId === callerId) return Response.json({ message: "Você não pode remover o próprio acesso." }, { status: 400 });
      const { data: target } = await context.supabaseAdmin.from("profiles").select("role,email").eq("id", body.userId).single();
      if (!target || !["admin", "manager", "master"].includes(target.role)) return Response.json({ message: "Membro da equipe não encontrado." }, { status: 404 });
      if (target.role === "master") return Response.json({ message: "O acesso MASTER é protegido e não pode ser removido." }, { status: 403 });
      if (target.role === "admin") {
        const { count } = await context.supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
        if ((count ?? 0) <= 1) return Response.json({ message: "É necessário manter pelo menos um administrador geral." }, { status: 400 });
      }
      const { error: deleteError } = await context.supabaseAdmin.auth.admin.deleteUser(body.userId);
      if (deleteError) return Response.json({ message: deleteError.message }, { status: 400 });
      return Response.json({ id: body.userId, email: target.email, deleted: true });
    }

    if (action === "set_role") {
      if (!body?.userId || !["admin", "manager"].includes(role)) return Response.json({ message: "Perfil de acesso inválido." }, { status: 400 });
      if (body.userId === callerId) return Response.json({ message: "Você não pode alterar o próprio perfil de acesso." }, { status: 400 });
      const { data: target } = await context.supabaseAdmin.from("profiles").select("role,email").eq("id", body.userId).single();
      if (!target || !["admin", "manager", "master"].includes(target.role)) return Response.json({ message: "Membro da equipe não encontrado." }, { status: 404 });
      if (target.role === "master") return Response.json({ message: "O perfil MASTER é protegido e não pode ser alterado." }, { status: 403 });
      if (target.role === "admin" && role === "manager") {
        const { count } = await context.supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("role", "admin");
        if ((count ?? 0) <= 1) return Response.json({ message: "É necessário manter pelo menos um administrador geral." }, { status: 400 });
      }
      const { error: roleError } = await context.supabaseAdmin.from("profiles").update({ role }).eq("id", body.userId);
      if (roleError) return Response.json({ message: roleError.message }, { status: 400 });
      return Response.json({ id: body.userId, email: target.email, role, updated: true });
    }

    if (action !== "create") return Response.json({ message: "Ação inválida." }, { status: 400 });
    if (!["admin", "manager"].includes(role)) return Response.json({ message: "Perfil de acesso inválido." }, { status: 400 });
    if (callerRole === "manager" && role !== "manager") return Response.json({ message: "Gestores só podem cadastrar outros gestores." }, { status: 403 });
    if (!validEmail.test(email)) return Response.json({ message: "Informe um e-mail válido." }, { status: 400 });
    if (password.length < 8) return Response.json({ message: "A senha temporária deve ter pelo menos 8 caracteres." }, { status: 400 });

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
      .upsert({ id: created.user.id, role, email });
    if (profileError) {
      await context.supabaseAdmin.auth.admin.deleteUser(created.user.id);
      return Response.json({ message: "Não foi possível conceder o acesso administrativo." }, { status: 500 });
    }

    return Response.json({ id: created.user.id, email: created.user.email, role });
  }),
};
