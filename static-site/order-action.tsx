import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../app/order-action.css";

type ActionInfo = {
  ok: boolean;
  message?: string;
  used?: boolean;
  expired?: boolean;
  action?: string;
  actionLabel?: string;
  order?: {
    orderNumber: number;
    customerName: string;
    total: number;
    statusLabel: string;
  };
};

type ActionResult = ActionInfo & {
  completed?: boolean;
  orderNumber?: number;
  statusLabel?: string;
  customerNotified?: boolean;
  nextActionSent?: boolean;
  workflowCompleted?: boolean;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const endpoint = supabaseUrl ? `${supabaseUrl}/functions/v1/order-action` : "";
const isProduction = import.meta.env.VITE_APP_ENV === "production";
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function OrderActionPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const configurationError = !endpoint || !token
    ? { ok: false, message: "O link está incompleto ou o ambiente não foi configurado." }
    : null;
  const [info, setInfo] = useState<ActionInfo | null>(configurationError);
  const [result, setResult] = useState<ActionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [customerMessage, setCustomerMessage] = useState("");

  useEffect(() => {
    if (!endpoint || !token) return;
    const controller = new AbortController();
    fetch(`${endpoint}?format=json&token=${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ response, data: await response.json() as ActionInfo }))
      .then(({ data }) => setInfo(data))
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setInfo({ ok: false, message: "Não foi possível consultar este pedido. Tente novamente." });
      });
    return () => controller.abort();
  }, [token]);

  async function confirmAction() {
    if (!endpoint || !token || busy) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, customerMessage }),
      });
      const data = await response.json() as ActionResult;
      setResult(data);
    } catch {
      setResult({ ok: false, message: "Não foi possível confirmar a etapa. Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  const content = result ?? info;
  return <main className="action-card">
    <div className="action-brand">OLI VINHOS</div>
    {!isProduction && <div className="action-test">Ambiente de homologação</div>}
    {!content ? <div className="action-loading" role="status"><i/> Consultando pedido…</div>
      : result?.ok && result.completed ? <>
        <div className="action-success">✓</div>
        <h1>Pedido #{result.orderNumber} atualizado</h1>
        <p className="action-ok"><b>{result.actionLabel}</b> foi registrado com sucesso.</p>
        <p>Novo status: <b>{result.statusLabel}</b>.</p>
        <p>{result.workflowCompleted ? "O fluxo deste pedido foi concluído." : result.nextActionSent ? "A próxima etapa foi enviada por e-mail." : "A próxima etapa está disponível no painel administrativo."}</p>
        {result.customerNotified && <p className="action-note">O cliente também foi avisado por e-mail.</p>}
      </> : content.ok && content.order ? <>
        <h1>Pedido #{content.order.orderNumber}</h1>
        <p><b>{content.order.customerName}</b><br/>Total: {money.format(content.order.total)}<br/>Status atual: {content.order.statusLabel}</p>
        <p>{content.action === "cancel" ? <>Deseja realmente <b>cancelar este pedido</b>?</> : <>Deseja realmente executar a ação <b>{content.actionLabel}</b>?</>}</p>
        <label className="action-message">
          Mensagem ao cliente (opcional)
          <textarea
            rows={4}
            maxLength={500}
            value={customerMessage}
            onChange={(event) => setCustomerMessage(event.target.value)}
            placeholder={content.action === "cancel" ? "Ex.: o pedido foi cancelado conforme combinado." : "Ex.: informe horário, local ou outra orientação sobre esta etapa."}
          />
          <small>{customerMessage.length}/500 — use para informar horário, local ou outra orientação.</small>
        </label>
        <button type="button" className={`action-button ${content.action === "cancel" ? "danger" : ""}`} onClick={confirmAction} disabled={busy}>{busy ? "Confirmando…" : content.action === "cancel" ? "Sim, cancelar pedido" : "Sim, confirmar ação"}</button>
        <p className="action-muted">Nenhuma alteração acontece antes desta confirmação.</p>
      </> : <>
        <h1>{content.used ? "Ação já realizada" : content.expired ? "Link expirado" : "Link inválido"}</h1>
        <p className={content.used ? "action-ok" : "action-error"}>{content.message}</p>
      </>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><OrderActionPage/></React.StrictMode>);
