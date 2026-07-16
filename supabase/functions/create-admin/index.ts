import { withSupabase } from "npm:@supabase/server@^1";
import { createClient } from "npm:@supabase/supabase-js@^2";

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
const maxRequestBytes = 16 * 1024;
const roleRank: Record<AccessRole, number> = { customer: 0, manager: 1, admin: 2, master: 3 };
const staffRoles: AccessRole[] = ["manager", "admin", "master"];
const editableRoles: AccessRole[] = ["customer", "manager", "admin"];

function canControl(caller: AccessRole, target: AccessRole) {
  return roleRank[caller] > roleRank[target];
}

function errorResponse(message: string, status = 400) {
  return Response.json({ message }, { status });
}

export default {
  fetch: withSupabase({ auth: "user" }, async (request, context) => {
    if (request.method !== "POST") return errorResponse("Método não permitido.", 405);
    const contentLength = Number(request.headers.get("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > maxRequestBytes) {
      return errorResponse("Solicitação muito grande.", 413);
    }

    const claims = context.userClaims as { sub?: string; id?: string; email?: string } | undefined;
    const callerId = claims?.sub ?? claims?.id;
    const callerEmail = claims?.email?.trim().toLowerCase() ?? "";
    if (!callerId) return errorResponse("Usuário não autenticado.", 401);

    // Usa explicitamente a chave administrativa provisionada pelo Supabase.
    // Isso evita que operações administrativas herdem por engano o RLS do usuário.
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SUPABASE_SECRET_KEY");
    if (!supabaseUrl || !adminKey) {
      console.error("create-admin: SUPABASE_URL ou chave administrativa ausente");
      return errorResponse("A função administrativa não está configurada corretamente.", 500);
    }
    const admin = createClient(supabaseUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: callerProfile, error: callerError } = await admin
      .from("profiles")
      .select("role,email")
      .eq("id", callerId)
      .single();
    if (callerError) {
      console.error("create-admin: falha ao ler perfil do solicitante", callerError);
      return errorResponse("Não foi possível validar o seu perfil de acesso.", 500);
    }

    const masterEmail = Deno.env.get("MASTER_EMAIL")?.trim().toLowerCase() ?? "";
    const isMasterIdentity = Boolean(masterEmail && callerEmail === masterEmail);
    const storedRole = callerProfile?.role as AccessRole | undefined;
    const callerRole: AccessRole | null = isMasterIdentity ? "master" : storedRole && staffRoles.includes(storedRole) ? storedRole : null;
    if (!callerRole) return errorResponse("Seu perfil não possui permissão administrativa.", 403);

    const body = await request.json().catch(() => null) as RequestBody | null;
    const action = body?.action ?? "create";
    const email = body?.email?.trim().toLowerCase() ?? "";
    const password = body?.password ?? "";
    const requestedRole: AccessRole = body?.role ?? "manager";
    if (email.length > 254) return errorResponse("O e-mail informado é muito longo.");
    if (password.length > 128) return errorResponse("A senha informada é muito longa.");
    if ((body?.fullName?.trim().length ?? 0) > 120) return errorResponse("O nome deve ter no máximo 120 caracteres.");
    if ((body?.phone?.trim().length ?? 0) > 30) return errorResponse("O telefone deve ter no máximo 30 caracteres.");

    if (action === "update_user") {
      if (!body?.userId) return errorResponse("Usuário inválido.");
      if (!validEmail.test(email)) return errorResponse("Informe um e-mail válido.");
      if (!editableRoles.includes(requestedRole)) return errorResponse("Perfil de acesso inválido.");
      if (password && password.length < 8) return errorResponse("A nova senha deve ter pelo menos 8 caracteres.");

      const { data: target, error: targetError } = await admin
        .from("profiles")
        .select("role,email,full_name,phone")
        .eq("id", body.userId)
        .single();
      if (targetError || !target) return errorResponse("Usuário não encontrado.", 404);
      const targetRole = target.role as AccessRole;
      if (!canControl(callerRole, targetRole)) return errorResponse("Você só pode editar usuários abaixo do seu nível de acesso.", 403);
      if (roleRank[requestedRole] >= roleRank[callerRole]) return errorResponse("Você não pode atribuir um perfil igual ou superior ao seu.", 403);

      const fullName = body.fullName?.trim() ?? "";
      const phone = body.phone?.trim() ?? "";
      const authChanges: { email: string; email_confirm: boolean; password?: string; user_metadata: Record<string, string> } = {
        email,
        email_confirm: true,
        user_metadata: { full_name: fullName, phone },
      };
      if (password) authChanges.password = password;

      const { error: authError } = await admin.auth.admin.updateUserById(body.userId, authChanges);
      if (authError) {
        console.error("create-admin: falha ao atualizar Auth", authError);
        return errorResponse(authError.message);
      }
      const { error: profileError } = await admin
        .from("profiles")
        .update({ email, full_name: fullName || null, phone: phone || null, role: requestedRole })
        .eq("id", body.userId);
      if (profileError) {
        console.error("create-admin: falha ao atualizar perfil", profileError);
        return errorResponse(`A conta foi atualizada, mas o perfil falhou (${profileError.code}).`, 500);
      }
      return Response.json({ id: body.userId, email, role: requestedRole, updated: true });
    }

    if (action === "reset_password") {
      if (!body?.userId) return errorResponse("Membro da equipe inválido.");
      if (password.length < 8) return errorResponse("A nova senha deve ter pelo menos 8 caracteres.");
      const { data: target } = await admin.from("profiles").select("role,email").eq("id", body.userId).single();
      if (!target || !staffRoles.includes(target.role as AccessRole)) return errorResponse("Membro da equipe não encontrado.", 404);
      if (!canControl(callerRole, target.role as AccessRole)) return errorResponse("Você só pode alterar a senha de acessos abaixo do seu nível.", 403);
      const { error } = await admin.auth.admin.updateUserById(body.userId, { password });
      if (error) { console.error("create-admin: falha ao redefinir senha", error); return errorResponse(error.message); }
      return Response.json({ id: body.userId, email: target.email, updated: true });
    }

    if (action === "delete") {
      if (!body?.userId) return errorResponse("Membro da equipe inválido.");
      if (body.userId === callerId) return errorResponse("Você não pode remover o próprio acesso.");
      const { data: target } = await admin.from("profiles").select("role,email").eq("id", body.userId).single();
      if (!target || !staffRoles.includes(target.role as AccessRole)) return errorResponse("Membro da equipe não encontrado.", 404);
      if (!canControl(callerRole, target.role as AccessRole)) return errorResponse("Você só pode remover acessos abaixo do seu nível.", 403);
      const { error } = await admin.auth.admin.deleteUser(body.userId);
      if (error) { console.error("create-admin: falha ao excluir usuário", error); return errorResponse(error.message); }
      return Response.json({ id: body.userId, email: target.email, deleted: true });
    }

    if (action === "set_role") {
      if (!body?.userId || !editableRoles.includes(requestedRole)) return errorResponse("Perfil de acesso inválido.");
      if (body.userId === callerId) return errorResponse("Você não pode alterar o próprio perfil de acesso.");
      const { data: target } = await admin.from("profiles").select("role,email").eq("id", body.userId).single();
      if (!target || !staffRoles.includes(target.role as AccessRole)) return errorResponse("Membro da equipe não encontrado.", 404);
      if (!canControl(callerRole, target.role as AccessRole)) return errorResponse("Você só pode alterar acessos abaixo do seu nível.", 403);
      if (roleRank[requestedRole] >= roleRank[callerRole]) return errorResponse("Você não pode atribuir um perfil igual ou superior ao seu.", 403);
      const { error } = await admin.from("profiles").update({ role: requestedRole }).eq("id", body.userId);
      if (error) { console.error("create-admin: falha ao alterar papel", error); return errorResponse(`Não foi possível alterar o perfil (${error.code}).`); }
      return Response.json({ id: body.userId, email: target.email, role: requestedRole, updated: true });
    }

    if (action !== "create") return errorResponse("Ação inválida.");
    if (!["admin", "manager"].includes(requestedRole)) return errorResponse("Perfil de acesso inválido.");
    if (callerRole === "manager" && requestedRole !== "manager") return errorResponse("Gestores só podem cadastrar outros gestores.", 403);
    if (!validEmail.test(email)) return errorResponse("Informe um e-mail válido.");
    if (password.length < 8) return errorResponse("A senha temporária deve ter pelo menos 8 caracteres.");

    const { data: created, error: createError } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (createError || !created.user) {
      console.error("create-admin: falha ao criar usuário no Auth", createError);
      return errorResponse(createError?.message ?? "Não foi possível criar o usuário.");
    }

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: created.user.id, role: requestedRole, email }, { onConflict: "id" });
    if (profileError) {
      console.error("create-admin: falha ao conceder perfil", profileError);
      await admin.auth.admin.deleteUser(created.user.id);
      return errorResponse(`Não foi possível conceder o perfil (${profileError.code}).`, 500);
    }

    return Response.json({ id: created.user.id, email: created.user.email, role: requestedRole });
  }),
};
