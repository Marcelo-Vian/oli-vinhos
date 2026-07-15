import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renderiza a loja OLI e seus pontos essenciais", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /OLI Vinhos/);
  assert.match(html, /Vinhos para/);
  assert.match(html, /retirada/i);
  assert.match(html, /WhatsApp/i);
});

test("mantém dados de contato centralizados e sem segredos", async () => {
  const [config, env, products] = await Promise.all([
    readFile(new URL("../app/data/store-config.ts", import.meta.url), "utf8"),
    readFile(new URL("../.env.example", import.meta.url), "utf8"),
    readFile(new URL("../app/data/products.ts", import.meta.url), "utf8"),
  ]);
  assert.match(config, /5511968669167/);
  assert.match(config, /olivinhos\.comercial@gmail\.com/);
  assert.match(env, /VITE_SUPABASE_PUBLISHABLE_KEY/);
  assert.doesNotMatch(env + products, /eyJ[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(env + products, /sb_secret_[A-Za-z0-9_-]+/);
  assert.equal((products.match(/product\("oli-/g) ?? []).length, 16);
});

test("workflow por e-mail exige confirmação e guarda somente o hash do token", async () => {
  const [actionFunction, notificationFunction, adminApp, storeApp, migration, shared] = await Promise.all([
    readFile(new URL("../supabase/functions/order-action/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/notify-order-customer/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/AdminApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/StoreApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715170000_order_email_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/_shared/order-workflow.ts", import.meta.url), "utf8"),
  ]);
  assert.match(actionFunction, /request\.method === "GET"/);
  assert.match(actionFunction, /<form method="post">/);
  assert.match(actionFunction, /cache-control": "no-store"/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /used_at is not null/);
  assert.match(migration, /grant execute on function public\.apply_order_email_action\(text\) to service_role/);
  assert.match(shared, /crypto\.getRandomValues/);
  assert.match(shared, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(shared, /customerNotificationEmail/);
  assert.match(actionFunction, /customerNotificationEmail\(currentOrder/);
  assert.match(notificationFunction, /\["master", "admin", "manager"\]/);
  assert.match(adminApp, /notify-order-customer/);
  assert.doesNotMatch(storeApp, /Enviar cópia por e-mail/);
  assert.doesNotMatch(migration, /11968669167/);
});
