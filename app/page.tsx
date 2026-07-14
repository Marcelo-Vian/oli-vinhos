import type { Metadata } from "next";
import StoreApp from "./components/StoreApp";

export const metadata: Metadata = {
  title: "OLI Vinhos | Catálogo 2026",
  description: "Vinhos selecionados para retirada local. Monte seu pedido e envie pelo WhatsApp.",
};

export default function Home() {
  return <StoreApp />;
}

