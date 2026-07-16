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
  const [actionFunction, notificationFunction, adminApp, storeApp, migration, simplifiedMigration, reviewMigration, itemReviewMigration, shared] = await Promise.all([
    readFile(new URL("../supabase/functions/order-action/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/notify-order-customer/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/AdminApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/StoreApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715170000_order_email_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715190000_simplify_order_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715100000_payments_and_reviews.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715195000_reviews_by_order_item.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/_shared/order-workflow.ts", import.meta.url), "utf8"),
  ]);
  assert.match(actionFunction, /request\.method === "GET"/);
  assert.match(actionFunction, /Response\.redirect\(pageUrl\.toString\(\), 302\)/);
  assert.match(actionFunction, /format"\) !== "json"/);
  assert.match(actionFunction, /"content-type": "application\/json; charset=utf-8"/);
  assert.match(actionFunction, /cache-control": "no-store"/);
  assert.match(migration, /token_hash text not null unique/);
  assert.match(migration, /used_at is not null/);
  assert.match(migration, /grant execute on function public\.apply_order_email_action\(text\) to service_role/);
  assert.match(shared, /crypto\.getRandomValues/);
  assert.match(shared, /crypto\.subtle\.digest\("SHA-256"/);
  assert.match(shared, /customerNotificationEmail/);
  assert.match(shared, /order\.status === "pending" \|\| order\.status === "confirmed"\) return "preparing"/);
  assert.match(shared, /Avaliar produtos comprados/);
  assert.match(actionFunction, /customerNotificationEmail\(currentOrder/);
  assert.match(actionFunction, /p_customer_message: customerMessage \|\| null/);
  assert.match(notificationFunction, /\["master", "admin", "manager"\]/);
  assert.match(adminApp, /notify-order-customer/);
  assert.doesNotMatch(adminApp, /Object\.keys\(orderStatusLabel\)/);
  assert.doesNotMatch(storeApp, /Enviar cópia por e-mail/);
  assert.match(storeApp, /URLSearchParams\(window\.location\.search\)\.get\("conta"\) === "pedidos"/);
  assert.match(reviewMigration, /orders\.status = 'delivered'/);
  assert.match(reviewMigration, /order_items\.product_id = p_product_id/);
  assert.match(simplifiedMigration, /v_token\.action in \('confirm_order', 'preparing'\)/);
  assert.match(simplifiedMigration, /p_customer_message text default null/);
  assert.match(itemReviewMigration, /p_order_item_id uuid/);
  assert.match(itemReviewMigration, /item\.id = p_order_item_id/);
  assert.match(itemReviewMigration, /customer_order\.status = 'delivered'/);
  assert.match(storeApp, /p_order_item_id: orderItemId/);
  assert.match(storeApp, /review\.order_item_id\s*===\s*item\.id/);
  assert.doesNotMatch(storeApp, /Avaliar produtos deste pedido/);
  assert.doesNotMatch(migration, /11968669167/);
});

test("tela pública de confirmação usa a API segura sem expor HTML pela função", async () => {
  const [page, entry, reviewPage, reviewEntry, reviewFunction, reviewMigration, settingsMigration, adminApp, viteConfig] = await Promise.all([
    readFile(new URL("../static-site/pedido/acao/index.html", import.meta.url), "utf8"),
    readFile(new URL("../static-site/order-action.tsx", import.meta.url), "utf8"),
    readFile(new URL("../static-site/avaliacao/acao/index.html", import.meta.url), "utf8"),
    readFile(new URL("../static-site/review-action.tsx", import.meta.url), "utf8"),
    readFile(new URL("../supabase/functions/review-action/index.ts", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715193000_review_email_workflow.sql", import.meta.url), "utf8"),
    readFile(new URL("../supabase/migrations/20260715194000_workflow_email_setting.sql", import.meta.url), "utf8"),
    readFile(new URL("../app/admin/AdminApp.tsx", import.meta.url), "utf8"),
    readFile(new URL("../vite.pages.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(page, /order-action\.tsx/);
  assert.match(entry, /Sim, confirmar ação/);
  assert.match(entry, /format=json/);
  assert.match(entry, /method: "POST"/);
  assert.match(entry, /Mensagem ao cliente \(opcional\)/);
  assert.match(entry, /maxLength=\{500\}/);
  assert.match(entry, /JSON\.stringify\(\{ token, customerMessage \}\)/);
  assert.match(reviewPage, /review-action\.tsx/);
  assert.match(reviewEntry, /aprovar e publicar/);
  assert.match(reviewEntry, /rejeitar avaliação/);
  assert.match(reviewFunction, /apply_review_email_action/);
  assert.match(reviewMigration, /action in \('approve','reject'\)/);
  assert.match(reviewMigration, /where review_id = v_review\.id and used_at is null/);
  assert.match(settingsMigration, /v_role not in \('master', 'admin'\)/);
  assert.match(adminApp, /E-mail do workflow/);
  assert.match(adminApp, /set_workflow_email/);
  assert.match(viteConfig, /orderAction/);
  assert.match(viteConfig, /reviewAction/);
});
