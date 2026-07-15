import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../app/order-action.css";

type ReviewInfo = {
  ok: boolean;
  message?: string;
  used?: boolean;
  expired?: boolean;
  action?: "approve" | "reject";
  actionLabel?: string;
  review?: {
    customerName: string;
    productName: string;
    rating: number;
    comment: string | null;
  };
};

type ReviewResult = ReviewInfo & {
  completed?: boolean;
  status?: string;
  customerName?: string;
  productName?: string;
};

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? import.meta.env.NEXT_PUBLIC_SUPABASE_URL;
const endpoint = supabaseUrl ? `${supabaseUrl}/functions/v1/review-action` : "";

function ReviewActionPage() {
  const token = new URLSearchParams(window.location.search).get("token") ?? "";
  const [info, setInfo] = useState<ReviewInfo | null>(!endpoint || !token ? { ok: false, message: "O link está incompleto ou a homologação não foi configurada." } : null);
  const [result, setResult] = useState<ReviewResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!endpoint || !token) return;
    const controller = new AbortController();
    fetch(`${endpoint}?format=json&token=${encodeURIComponent(token)}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.json() as Promise<ReviewInfo>)
      .then(setInfo)
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setInfo({ ok: false, message: "Não foi possível consultar esta avaliação." });
      });
    return () => controller.abort();
  }, [token]);

  async function confirmAction() {
    if (!endpoint || !token || busy) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      setResult(await response.json() as ReviewResult);
    } catch {
      setResult({ ok: false, message: "Não foi possível registrar a decisão. Tente novamente." });
    } finally {
      setBusy(false);
    }
  }

  const content = result ?? info;
  return <main className="action-card">
    <div className="action-brand">OLI VINHOS</div>
    <div className="action-test">Ambiente de homologação</div>
    {!content ? <div className="action-loading" role="status"><i/> Consultando avaliação…</div>
      : result?.ok && result.completed ? <>
        <div className="action-success">✓</div>
        <h1>Decisão registrada</h1>
        <p className="action-ok"><b>{result.actionLabel}</b> foi concluído.</p>
        <p>A avaliação de <b>{result.customerName}</b> sobre <b>{result.productName}</b> ficou como <b>{result.status === "approved" ? "publicada" : "rejeitada"}</b>.</p>
      </> : content.ok && content.review ? <>
        <h1>{content.actionLabel}</h1>
        <p><b>{content.review.productName}</b><br/>Cliente: {content.review.customerName}</p>
        <p className="review-action-stars">{"★".repeat(content.review.rating)}{"☆".repeat(5 - content.review.rating)}</p>
        <blockquote>{content.review.comment || "Sem comentário."}</blockquote>
        <p>Deseja realmente <b>{content.action === "approve" ? "publicar" : "rejeitar"}</b> esta avaliação?</p>
        <button type="button" className={`action-button ${content.action === "reject" ? "danger" : ""}`} onClick={confirmAction} disabled={busy}>{busy ? "Registrando…" : `Sim, ${content.action === "approve" ? "aprovar e publicar" : "rejeitar avaliação"}`}</button>
        <p className="action-muted">Nenhuma alteração acontece antes desta confirmação.</p>
      </> : <>
        <h1>{content.used ? "Decisão já registrada" : content.expired ? "Link expirado" : "Link inválido"}</h1>
        <p className={content.used ? "action-ok" : "action-error"}>{content.message}</p>
      </>}
  </main>;
}

createRoot(document.getElementById("root")!).render(<React.StrictMode><ReviewActionPage/></React.StrictMode>);
