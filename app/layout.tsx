import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./customer.css";

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#251017" };

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;
  return {
    title: { default: "OLI Vinhos", template: "%s | OLI Vinhos" },
    description: "Catálogo de vinhos com pedidos para retirada pelo WhatsApp.",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "OLI Vinhos — vinhos para bons encontros", description: "Explore o catálogo 2026 e envie seu pedido para retirada pelo WhatsApp.", type: "website", images: [{ url: `${origin}/og.png`, width: 1731, height: 909, alt: "OLI Vinhos — vinhos para bons encontros" }] },
    twitter: { card: "summary_large_image", title: "OLI Vinhos", description: "Vinhos para bons encontros. Catálogo 2026 com retirada local.", images: [`${origin}/og.png`] },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="pt-BR"><body>{children}</body></html>;
}
