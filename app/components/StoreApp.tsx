"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  ArrowRight,
  Banknote,
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  Eye,
  EyeOff,
  Filter,
  Grape,
  Heart,
  History,
  KeyRound,
  LoaderCircle,
  LogOut,
  Mail,
  MapPin,
  Menu,
  Minus,
  Plus,
  QrCode,
  Search,
  ShoppingBag,
  Star,
  Trash2,
  UserRound,
  Wine,
  X,
} from "lucide-react";
import { CATALOG_PRODUCTS } from "../data/products";
import { STORE_CONFIG } from "../data/store-config";
import type { CartItem, CustomerOrder, CustomerProfile, OrderStatus, PaymentMethod, ProductReview, WineProduct } from "../data/types";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { assetUrl, sitePath } from "../lib/paths";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const norm = (value: string | null | undefined) => (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const currentPrice = (p: WineProduct) => p.promotional_price ?? p.normal_price;
const unique = (values: (string | null)[]) => [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));
const orderStatusLabel: Record<OrderStatus, string> = { pending: "Pendente", confirmed: "Confirmado", preparing: "Em separação", ready: "Pronto para retirada", delivered: "Entregue", canceled: "Cancelado" };
const paymentMethodLabel: Record<PaymentMethod, string> = { pix: "Pix", cash: "Dinheiro na retirada" };
const paymentStatusLabel = { pending: "Aguardando pagamento", paid: "Pago", expired: "Expirado", refunded: "Reembolsado", canceled: "Cancelado" } as const;

type Filters = {
  country: string;
  type: string;
  grape: string;
  producer: string;
  vintage: string;
  maxPrice: number;
  featured: boolean;
  promotion: boolean;
  available: boolean;
};

type ActionFeedback = { type: "ok" | "error"; text: string };

const initialFilters: Filters = { country: "", type: "", grape: "", producer: "", vintage: "", maxPrice: 150, featured: false, promotion: false, available: false };

export default function StoreApp() {
  const [products, setProducts] = useState<WineProduct[]>(CATALOG_PRODUCTS);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(hasSupabaseConfig));
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState("featured");
  const [filterOpen, setFilterOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [detail, setDetail] = useState<WineProduct | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [formError, setFormError] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [myReviews, setMyReviews] = useState<ProductReview[]>([]);
  const [authOpen, setAuthOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [accountLoading, setAccountLoading] = useState(false);
  const [checkoutAfterLogin, setCheckoutAfterLogin] = useState(false);
  const [accountAfterLogin, setAccountAfterLogin] = useState(() =>
    typeof window !== "undefined" && new URLSearchParams(window.location.search).get("conta") === "pedidos"
  );
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [completedOrder, setCompletedOrder] = useState<CustomerOrder | null>(null);
  const [completedMessage, setCompletedMessage] = useState("");
  const [emailNotice, setEmailNotice] = useState("");
  const [favoriteIds, setFavoriteIds] = useState<string[]>([]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = localStorage.getItem("oli-vinhos-cart");
        if (saved) setCart(JSON.parse(saved));
      } catch { /* keep an empty cart */ }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.from("product_reviews").select("*").eq("status", "approved").order("created_at", { ascending: false })
      .then(({ data }) => setReviews((data ?? []) as ProductReview[]));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try { setFavoriteIds(JSON.parse(localStorage.getItem("oli-vinhos-favorites") ?? "[]")); }
      catch { setFavoriteIds([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem("oli-vinhos-favorites", JSON.stringify(favoriteIds));
  }, [favoriteIds]);

  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("oli-vinhos-cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    supabase.from("products").select("*").eq("active", true).order("name").then(({ data, error }) => {
      if (!active) return;
      if (error || !data?.length) {
        setDataMessage("O catálogo online está temporariamente indisponível. Exibimos a versão verificada do catálogo PDF.");
      } else {
        setProducts(data as WineProduct[]);
      }
      setLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!session) {
        setProfile(null); setOrders([]); setMyReviews([]);
        if (accountAfterLogin) setAuthOpen(true);
        return;
      }
      loadAccount();
      if (checkoutAfterLogin) { setAuthOpen(false); setCheckoutOpen(true); setCheckoutAfterLogin(false); }
      if (accountAfterLogin) {
        setAuthOpen(false);
        setAccountOpen(true);
        setAccountAfterLogin(false);
        const url = new URL(window.location.href);
        url.searchParams.delete("conta");
        url.searchParams.delete("pedido");
        window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [session, checkoutAfterLogin, accountAfterLogin]);

  const options = useMemo(() => ({
    countries: unique(products.map((p) => p.country)),
    types: unique(products.map((p) => p.type)),
    grapes: unique(products.map((p) => p.grape)),
    producers: unique(products.map((p) => p.producer)),
    vintages: [...new Set(products.map((p) => p.vintage).filter(Boolean) as number[])].sort((a, b) => b - a),
  }), [products]);

  const visible = useMemo(() => {
    const q = norm(query);
    const matches = products.filter((p) => {
      const searchable = [p.name, p.grape, p.grape_composition, p.country, p.region, p.producer, p.type, p.description, p.pairing].map(norm).join(" ");
      return p.active && (!q || searchable.includes(q))
        && (!filters.country || p.country === filters.country)
        && (!filters.type || p.type === filters.type)
        && (!filters.grape || p.grape === filters.grape)
        && (!filters.producer || p.producer === filters.producer)
        && (!filters.vintage || String(p.vintage) === filters.vintage)
        && currentPrice(p) <= filters.maxPrice
        && (!filters.featured || p.featured)
        && (!filters.promotion || p.promotional_price !== null)
        && (!filters.available || p.quantity_available === null || p.quantity_available > 0);
    });
    return matches.sort((a, b) => {
      if (sort === "price-asc") return currentPrice(a) - currentPrice(b);
      if (sort === "price-desc") return currentPrice(b) - currentPrice(a);
      if (sort === "name") return a.name.localeCompare(b.name, "pt-BR");
      if (sort === "recent") return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      return Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name, "pt-BR");
    });
  }, [products, query, filters, sort]);

  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const total = cart.reduce((sum, item) => sum + currentPrice(item.product) * item.quantity, 0);

  function addToCart(product: WineProduct, quantity = 1) {
    if (product.quantity_available === 0) return;
    setCart((items) => {
      const found = items.find((item) => item.product.id === product.id);
      if (!found) return [...items, { product, quantity: Math.min(quantity, product.quantity_available ?? quantity) }];
      return items.map((item) => item.product.id === product.id
        ? { ...item, quantity: Math.min(item.quantity + quantity, product.quantity_available ?? 99) }
        : item);
    });
    setCartOpen(true);
  }

  function setQuantity(id: string, quantity: number) {
    setCart((items) => items.flatMap((item) => {
      if (item.product.id !== id) return [item];
      if (quantity < 1) return [];
      return [{ ...item, quantity: Math.min(quantity, item.product.quantity_available ?? 99) }];
    }));
  }

  function toggleFavorite(id: string) {
    setFavoriteIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  }

  async function loadAccount(): Promise<ActionFeedback> {
    if (!supabase || !session) return { type: "error", text: "Sua sessão não está disponível. Entre novamente." };
    setAccountLoading(true);
    const [profileResult, ordersResult, reviewsResult] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", session.user.id).single(),
      supabase.from("orders").select("*, order_items(*), order_status_history(*), payment_status_history(*)").order("created_at", { ascending: false }),
      supabase.from("product_reviews").select("*").eq("user_id", session.user.id).order("created_at", { ascending: false }),
    ]);
    if (profileResult.data) setProfile(profileResult.data as CustomerProfile);
    if (ordersResult.data) {
      const nextOrders = (ordersResult.data as CustomerOrder[]).map((order) => ({
        ...order,
         order_items: order.order_items ?? [],
         order_status_history: [...(order.order_status_history ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
         payment_status_history: [...(order.payment_status_history ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
       }));
       setOrders(nextOrders);
     }
    if (reviewsResult.data) setMyReviews(reviewsResult.data as ProductReview[]);
    setAccountLoading(false);
    if (profileResult.error || ordersResult.error || reviewsResult.error) return { type: "error", text: "Não foi possível atualizar todos os dados da sua conta." };
    return { type: "ok", text: "Dados atualizados." };
  }

  async function saveProfile(event: React.FormEvent<HTMLFormElement>): Promise<ActionFeedback> {
    event.preventDefault();
    if (!supabase || !session) return { type: "error", text: "Sua sessão expirou. Entre novamente." };
    const data = new FormData(event.currentTarget);
    const fullName = String(data.get("full_name") ?? "").trim(); const phone = String(data.get("phone") ?? "").trim();
    if (!fullName || !phone) return { type: "error", text: "Preencha o nome e o telefone." };
    const { error } = await supabase.from("profiles").update({ full_name: fullName, phone }).eq("id", session.user.id);
    if (error) return { type: "error", text: `Não foi possível salvar: ${error.message}` };
    setProfile((current) => current ? { ...current, full_name: fullName, phone } : current);
    return { type: "ok", text: "Dados pessoais salvos com sucesso." };
  }

  async function submitReview(productId: string, rating: number, comment: string): Promise<ActionFeedback> {
    if (!supabase || !session) return { type: "error", text: "Entre novamente para avaliar." };
    const { data, error } = await supabase.rpc("submit_product_review", { p_product_id: productId, p_rating: rating, p_comment: comment });
    if (error) return { type: "error", text: error.message };
    const submitted = data as ProductReview | null;
    const moderationEmail = submitted?.id
      ? await supabase.functions.invoke("send-review-moderation-email", { body: { reviewId: submitted.id } })
      : null;
    await loadAccount();
    if (!moderationEmail || moderationEmail.error || !moderationEmail.data?.sent) {
      return { type: "error", text: "A avaliação foi salva, mas o e-mail de moderação não pôde ser enviado. Ela continua disponível no painel administrativo." };
    }
    return { type: "ok", text: "Avaliação enviada para moderação. A equipe recebeu os botões para aprovar ou rejeitar por e-mail." };
  }

  function openCheckout() {
    setCartOpen(false);
    if (!session) { setCheckoutAfterLogin(true); setAuthOpen(true); return; }
    setCheckoutOpen(true);
  }

  async function sendOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session) { setCheckoutOpen(false); setCheckoutAfterLogin(true); setAuthOpen(true); return; }
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    const date = String(data.get("date") ?? "").trim();
    const time = String(data.get("time") ?? "").trim();
    const paymentMethod = String(data.get("payment_method") ?? "") as PaymentMethod;
    if (!name || !phone || !date || !time || !["pix", "cash"].includes(paymentMethod)) {
      setFormError("Preencha os dados de retirada e escolha Pix ou dinheiro.");
      return;
    }
    setFormError(""); setOrderSubmitting(true); setEmailNotice("");
    const whatsappWindow = window.open("about:blank", "_blank");
    const { data: created, error } = await supabase.rpc("create_order", {
      p_customer_name: name,
      p_customer_phone: phone,
      p_pickup_date: date,
      p_pickup_time: time,
      p_notes: String(data.get("notes") ?? ""),
      p_items: cart.map((item) => ({ product_id: item.product.id, quantity: item.quantity })),
      p_payment_method: paymentMethod,
    });
    if (error || !created) {
      whatsappWindow?.close(); setOrderSubmitting(false); setFormError(error?.message ?? "Não foi possível registrar o pedido."); return;
    }
    const orderRecord = created as CustomerOrder;
    const lines = [`Olá! Acabei de registrar o pedido OLI #${orderRecord.order_number}:`, ""];
    cart.forEach((item, index) => {
      const unit = currentPrice(item.product);
      lines.push(`${index + 1}. ${item.product.name}`, `Quantidade: ${item.quantity}`, `Valor unitário: ${money.format(unit)}`, `Subtotal: ${money.format(unit * item.quantity)}`, "");
    });
    lines.push(`Total do pedido: ${money.format(Number(orderRecord.total))}`, `Pagamento: ${paymentMethodLabel[paymentMethod]}`, "", `Cliente: ${name}`, `E-mail: ${session.user.email}`, `Telefone: ${phone}`, `Data desejada para retirada: ${date}`, `Horário aproximado: ${time}`, `Observações: ${String(data.get("notes") ?? "") || "Sem observações"}`, "", "O pedido, o estoque e o horário de retirada aguardam confirmação da loja.");
    const message = lines.join("\n");
    if (whatsappWindow) whatsappWindow.location.href = `https://wa.me/${STORE_CONFIG.whatsappInternational}?text=${encodeURIComponent(message)}`;
    const emailResult = await supabase.functions.invoke("send-order-email", { body: { orderId: orderRecord.id } });
    setEmailNotice(emailResult.data?.customerSent ? "Você receberá por e-mail a confirmação e cada atualização do pedido." : "O pedido foi salvo. Você também pode acompanhar todas as etapas em Minha conta.");
    setCompletedOrder({ ...orderRecord, order_items: [], order_status_history: [] });
    setCompletedMessage(message); setCart([]); setCheckoutOpen(false); setOrderSubmitting(false); await loadAccount();
  }

  return (
    <div className="site-shell">
      <div className="announcement"><span>Curadoria independente • retirada local</span><strong>Preços e estoque dependem de confirmação</strong></div>
      <header className="header">
        <a className="brand" href="#top" aria-label="OLI Vinhos - início"><span>OLI</span><small>VINHOS</small></a>
        <nav aria-label="Navegação principal"><a href="#catalogo">Catálogo</a><a href="#como-funciona">Como funciona</a><a href="#contato">Contato</a></nav>
        <div className="header-actions">
          <button className="icon-button mobile-menu" onClick={() => setMenuOpen(true)} aria-label="Abrir menu"><Menu size={20}/></button>
          <button className="account-button" onClick={() => session ? setAccountOpen(true) : setAuthOpen(true)}><UserRound size={18}/><span>{session ? "Minha conta" : "Entrar"}</span></button>
          <button className="cart-button" onClick={() => setCartOpen(true)}><ShoppingBag size={19}/><span>Carrinho</span>{cartCount > 0 && <b>{cartCount}</b>}</button>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Catálogo 2026 • seleção especial</p>
            <h1>Vinhos para<br/><em>bons encontros.</em></h1>
            <p className="hero-text">Rótulos escolhidos para transformar refeições, conversas e pequenas celebrações em memórias.</p>
            <div className="hero-cta"><a href="#catalogo" className="primary-button">Explorar catálogo <ArrowRight size={18}/></a><span><Check size={16}/> Pedido salvo e acompanhado online</span></div>
          </div>
          <div className="hero-art" aria-label="Garrafa de vinho em destaque">
            <div className="year-stamp">20<br/>26</div>
            <div className="wine-orbit"><span>SELEÇÃO</span><span>CURADORIA</span><span>RETIRADA</span></div>
            <img src={assetUrl("/products/7colores-gran-reserva-pinot-noir-semillon.webp")} alt="7Colores Gran Reserva Pinot Noir e Sémillon" />
            <div className="hero-note"><small>EM DESTAQUE</small><strong>7Colores<br/>Gran Reserva</strong><span>Chile • 2021</span></div>
          </div>
        </section>

        <section className="promise-strip" aria-label="Diferenciais"><div><Wine/><span><b>16 rótulos</b><small>Extraídos do catálogo OLI</small></span></div><div><Grape/><span><b>4 países</b><small>Origens para descobrir</small></span></div><div><MapPin/><span><b>Retirada local</b><small>Após confirmação da loja</small></span></div></section>

        <section className="catalog-section" id="catalogo">
          <div className="section-heading"><div><p className="eyebrow">Encontre seu vinho</p><h2>Escolha pelo seu momento</h2></div><p>Explore por estilo, origem ou uva. Todos os valores seguem exatamente o catálogo fornecido.</p></div>
          <div className="category-row">
            {options.types.map((type) => <button key={type} className={filters.type === type ? "active" : ""} onClick={() => setFilters((f) => ({ ...f, type: f.type === type ? "" : type }))}><span>{type === "Tinto" ? "●" : type === "Branco" ? "○" : "◐"}</span>{type}</button>)}
            <button className={filters.promotion ? "active" : ""} onClick={() => setFilters((f) => ({ ...f, promotion: !f.promotion }))}><span>%</span>Ofertas</button>
          </div>
          {dataMessage && <div className="data-notice"><CircleAlert size={17}/>{dataMessage}</div>}
          <div className="catalog-toolbar">
            <label className="search-box"><Search size={19}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Busque por vinho, uva, país..." aria-label="Buscar vinhos"/>{query && <button onClick={() => setQuery("")} aria-label="Limpar busca"><X size={17}/></button>}</label>
            <button className="filter-trigger" onClick={() => setFilterOpen(true)}><Filter size={18}/> Filtros</button>
            <label className="sort-select">Ordenar<select value={sort} onChange={(e) => setSort(e.target.value)}><option value="featured">Destaques</option><option value="price-asc">Menor preço</option><option value="price-desc">Maior preço</option><option value="name">Nome A-Z</option><option value="recent">Mais recentes</option></select><ChevronDown size={16}/></label>
          </div>
          <div className="catalog-layout">
            <FilterPanel options={options} filters={filters} setFilters={setFilters} mobile={false}/>
            <div className="products-area">
              <div className="results-line"><span>{visible.length} {visible.length === 1 ? "vinho encontrado" : "vinhos encontrados"}</span><button onClick={() => { setFilters(initialFilters); setQuery(""); }}>Limpar filtros</button></div>
              {loading ? <div className="loading-grid">{[1,2,3,4,5,6].map((n) => <div key={n} className="skeleton-card"/>)}</div>
              : visible.length === 0 ? <div className="empty-state"><Wine size={40}/><h3>Nenhum vinho encontrado</h3><p>Tente ampliar a faixa de preço ou remover algum filtro.</p><button className="secondary-button" onClick={() => { setFilters(initialFilters); setQuery(""); }}>Limpar filtros</button></div>
              : <div className="product-grid">{visible.map((p) => <ProductCard key={p.id} product={p} reviews={reviews.filter((review) => review.product_id === p.id)} favorite={favoriteIds.includes(p.id)} onFavorite={() => toggleFavorite(p.id)} onDetail={() => { setDetail(p); setDetailQty(1); }} onAdd={() => addToCart(p)}/>)}</div>}
            </div>
          </div>
        </section>

        <section className="pickup-section" id="como-funciona">
          <div className="pickup-intro"><p className="eyebrow">Simples e pessoal</p><h2>Seu vinho, separado<br/>com cuidado.</h2><p>Pedidos disponíveis somente para retirada no local.</p></div>
          <div className="steps"><div><b>01</b><h3>Escolha</h3><p>Explore o catálogo e adicione seus rótulos ao carrinho.</p></div><div><b>02</b><h3>Registre</h3><p>Entre na sua conta, escolha a retirada e envie o resumo pelo WhatsApp.</p></div><div><b>03</b><h3>Acompanhe</h3><p>Consulte o histórico e o andamento do pedido em Minha conta.</p></div></div>
          <div className="pickup-alert"><CircleAlert size={21}/><p><strong>Atenção</strong> Preços, estoque e horário de retirada dependem de confirmação pelo WhatsApp. Não realizamos entrega.</p></div>
        </section>

        <section className="contact-section" id="contato"><div><p className="eyebrow">Fale com a OLI</p><h2>Uma boa escolha<br/>começa com conversa.</h2></div><div className="contact-links"><a href={`https://wa.me/${STORE_CONFIG.whatsappInternational}`} target="_blank" rel="noreferrer"><span><strong>WhatsApp</strong><small>{STORE_CONFIG.contactName}: {STORE_CONFIG.whatsappDisplay}</small></span><ArrowRight/></a><a href={`mailto:${STORE_CONFIG.email}`}><span><strong>E-mail</strong><small>{STORE_CONFIG.email}</small></span><ArrowRight/></a></div></section>
      </main>

      <footer><div className="footer-brand"><span>OLI</span><small>VINHOS</small></div><p>Curadoria para bons encontros.<br/>Pedidos somente para retirada.</p><div><a href="#catalogo">Catálogo</a><a href="#como-funciona">Retirada</a><a href={sitePath("/admin/")}>Área administrativa</a></div><div><a href={`mailto:${STORE_CONFIG.email}`}><Mail size={15}/>{STORE_CONFIG.email}</a><a href={`https://wa.me/${STORE_CONFIG.whatsappInternational}`}>{STORE_CONFIG.whatsappDisplay}</a></div><small className="copyright">© 2026 OLI Vinhos</small></footer>
      <a className="whatsapp-float" href={`https://wa.me/${STORE_CONFIG.whatsappInternational}`} target="_blank" rel="noreferrer" aria-label="Falar com a OLI Vinhos pelo WhatsApp">WA</a>

      {filterOpen && <div className="drawer-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setFilterOpen(false)}><aside className="mobile-filter drawer"><div className="drawer-head"><h2>Filtros</h2><button onClick={() => setFilterOpen(false)} aria-label="Fechar filtros"><X/></button></div><FilterPanel options={options} filters={filters} setFilters={setFilters} mobile/><button className="primary-button wide" onClick={() => setFilterOpen(false)}>Ver {visible.length} vinhos</button></aside></div>}
      {menuOpen && <div className="drawer-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setMenuOpen(false)}><aside className="mobile-nav drawer"><div className="drawer-head"><div><p>NAVEGAÇÃO</p><h2>Menu</h2></div><button onClick={() => setMenuOpen(false)} aria-label="Fechar menu"><X/></button></div><nav><a href="#catalogo" onClick={() => setMenuOpen(false)}>Catálogo</a><a href="#como-funciona" onClick={() => setMenuOpen(false)}>Como funciona</a><a href="#contato" onClick={() => setMenuOpen(false)}>Contato</a><button onClick={() => { setMenuOpen(false); if (session) setAccountOpen(true); else setAuthOpen(true); }}><UserRound/> {session ? "Minha conta" : "Entrar ou cadastrar"}</button></nav></aside></div>}
      {cartOpen && <CartDrawer cart={cart} total={total} onClose={() => setCartOpen(false)} onQuantity={setQuantity} onClear={() => setCart([])} onCheckout={openCheckout}/>}
      {detail && <ProductModal product={detail} reviews={reviews.filter((review) => review.product_id === detail.id)} quantity={detailQty} setQuantity={setDetailQty} onClose={() => setDetail(null)} onAdd={() => { addToCart(detail, detailQty); setDetail(null); }}/>}
      {checkoutOpen && <CheckoutModal total={total} cart={cart} error={formError} profile={profile} email={session?.user.email ?? ""} submitting={orderSubmitting} onClose={() => setCheckoutOpen(false)} onSubmit={sendOrder}/>}
      {authOpen && <CustomerAuthModal onClose={() => { setAuthOpen(false); setCheckoutAfterLogin(false); setAccountAfterLogin(false); }}/>}
      {accountOpen && session && <CustomerAccountModal profile={profile} orders={orders} reviews={myReviews} loading={accountLoading} onRefresh={loadAccount} onSaveProfile={saveProfile} onSubmitReview={submitReview} onClose={() => setAccountOpen(false)} onSignOut={async () => { await supabase?.auth.signOut(); setAccountOpen(false); }}/>}
      {completedOrder && <OrderSuccessModal order={completedOrder} message={completedMessage} emailNotice={emailNotice} onClose={() => setCompletedOrder(null)} onAccount={() => { setCompletedOrder(null); setAccountOpen(true); }}/>}
    </div>
  );
}

function ProductCard({ product, reviews, favorite, onFavorite, onDetail, onAdd }: { product: WineProduct; reviews: ProductReview[]; favorite: boolean; onFavorite: () => void; onDetail: () => void; onAdd: () => void }) {
  const unavailable = product.quantity_available === 0;
  const rating = reviews.length ? reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length : 0;
  return <article className="product-card">
    <div className="product-media">
      <div className="badges">{product.promotional_price !== null && <span className="sale">OFERTA</span>}{product.low_stock && <span>POUCAS UNIDADES</span>}{product.featured && <span>DESTAQUE</span>}</div>
      <button className={`heart ${favorite ? "active" : ""}`} onClick={onFavorite} aria-pressed={favorite} aria-label={`${favorite ? "Remover" : "Adicionar"} ${product.name} ${favorite ? "dos" : "aos"} favoritos`}><Heart size={18}/></button>
      <img src={assetUrl(product.image_url ?? "/products/placeholder.webp")} alt={`Garrafa do vinho ${product.name}`} loading="lazy"/>
    </div>
    <div className="product-body"><p className="product-origin">{[product.country, product.region].filter(Boolean).join(" • ")}</p><h3>{product.name}</h3><p className="product-meta">{[product.type, product.grape, product.vintage].filter(Boolean).join(" · ")}</p>{reviews.length > 0 && <div className="product-rating"><Star fill="currentColor"/><b>{rating.toFixed(1)}</b><span>{reviews.length} avaliação(ões)</span></div>}
      <div className="price-row"><div>{product.promotional_price !== null && <del>{money.format(product.normal_price)}</del>}<strong>{money.format(currentPrice(product))}</strong></div><span className={unavailable ? "unavailable" : "available"}>{unavailable ? "Indisponível" : product.quantity_available === null ? "Sob confirmação" : "Disponível"}</span></div>
      <div className="card-actions"><button onClick={onDetail} className="detail-button">Ver detalhes</button><button onClick={onAdd} disabled={unavailable} className="add-button" aria-label={`Adicionar ${product.name} ao carrinho`}><Plus/> Adicionar</button></div>
    </div>
  </article>;
}

function FilterPanel({ options, filters, setFilters, mobile }: { options: { countries: string[]; types: string[]; grapes: string[]; producers: string[]; vintages: number[] }; filters: Filters; setFilters: React.Dispatch<React.SetStateAction<Filters>>; mobile: boolean }) {
  const select = (label: string, key: keyof Filters, values: (string | number)[]) => values.length ? <label className="filter-field"><span>{label}</span><select value={String(filters[key])} onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}><option value="">Todos</option>{values.map((v) => <option key={v} value={v}>{v}</option>)}</select><ChevronDown size={15}/></label> : null;
  return <aside className={`filter-panel ${mobile ? "inside-drawer" : "desktop-filter"}`}><div className="filter-title"><h3>Filtrar por</h3><button onClick={() => setFilters(initialFilters)}>Limpar</button></div>{select("País", "country", options.countries)}{select("Tipo", "type", options.types)}{select("Uva", "grape", options.grapes)}{select("Produtor", "producer", options.producers)}{select("Safra", "vintage", options.vintages)}<label className="price-filter"><span>Até <b>{money.format(filters.maxPrice)}</b></span><input type="range" min="30" max="150" step="10" value={filters.maxPrice} onChange={(e) => setFilters((f) => ({ ...f, maxPrice: Number(e.target.value) }))}/><div><small>R$ 30</small><small>R$ 150</small></div></label><div className="check-filters"><label><input type="checkbox" checked={filters.featured} onChange={(e) => setFilters((f) => ({ ...f, featured: e.target.checked }))}/><span/>Destaques</label><label><input type="checkbox" checked={filters.promotion} onChange={(e) => setFilters((f) => ({ ...f, promotion: e.target.checked }))}/><span/>Em promoção</label><label><input type="checkbox" checked={filters.available} onChange={(e) => setFilters((f) => ({ ...f, available: e.target.checked }))}/><span/>Disponíveis</label></div></aside>;
}

function CartDrawer({ cart, total, onClose, onQuantity, onClear, onCheckout }: { cart: CartItem[]; total: number; onClose: () => void; onQuantity: (id: string, q: number) => void; onClear: () => void; onCheckout: () => void }) {
  return <div className="drawer-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><aside className="cart-drawer drawer" aria-label="Carrinho"><div className="drawer-head"><div><p>SEU PEDIDO</p><h2>Carrinho</h2></div><button onClick={onClose} aria-label="Fechar carrinho"><X/></button></div>{cart.length === 0 ? <div className="empty-cart"><ShoppingBag size={44}/><h3>Seu carrinho está vazio</h3><p>Escolha um rótulo para começar.</p><button className="primary-button" onClick={onClose}>Ver catálogo</button></div> : <><div className="cart-items">{cart.map((item) => <div className="cart-item" key={item.product.id}><img src={assetUrl(item.product.image_url)} alt=""/><div><h3>{item.product.name}</h3><small>{item.product.volume} • {item.product.vintage}</small><strong>{money.format(currentPrice(item.product))}</strong><div className="quantity"><button onClick={() => onQuantity(item.product.id, item.quantity - 1)} aria-label="Diminuir quantidade">{item.quantity === 1 ? <Trash2 size={15}/> : <Minus size={15}/>}</button><span>{item.quantity}</span><button onClick={() => onQuantity(item.product.id, item.quantity + 1)} aria-label="Aumentar quantidade"><Plus size={15}/></button></div></div><b>{money.format(currentPrice(item.product) * item.quantity)}</b></div>)}</div><button className="clear-cart" onClick={onClear}>Limpar carrinho</button><div className="cart-summary"><p><span>Subtotal</span><strong>{money.format(total)}</strong></p><small><CircleAlert size={15}/> Este pedido será preparado somente para retirada no local.</small><button className="primary-button wide" onClick={onCheckout}>Continuar pedido <ArrowRight size={18}/></button><p className="confirmation-note">Estoque e horário sujeitos à confirmação.</p></div></>}</aside></div>;
}

function ProductModal({ product, reviews, quantity, setQuantity, onClose, onAdd }: { product: WineProduct; reviews: ProductReview[]; quantity: number; setQuantity: (q: number) => void; onClose: () => void; onAdd: () => void }) {
  const fields = [["Produtor", product.producer], ["Origem", [product.region, product.country].filter(Boolean).join(", ")], ["Tipo", product.type], ["Uva", product.grape], ["Composição", product.grape_composition], ["Safra", product.vintage], ["Volume", product.volume], ["Teor alcoólico", product.alcohol_content], ["Classificação", product.classification], ["Serviço", product.service_temperature]].filter(([, v]) => v);
  return <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="product-modal"><button className="modal-close" onClick={onClose} aria-label="Fechar detalhes"><X/></button><div className="modal-media"><img src={assetUrl(product.image_url)} alt={`Garrafa de ${product.name}`}/></div><div className="modal-content"><p className="eyebrow">{product.country} • {product.type}</p><h2>{product.name}</h2><p className="modal-price">{product.promotional_price !== null && <del>{money.format(product.normal_price)}</del>}<strong>{money.format(currentPrice(product))}</strong></p>{product.description && <p className="modal-description">{product.description}</p>}<dl>{fields.map(([k,v]) => <div key={String(k)}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{product.pairing && <div className="pairing"><Grape/><div><strong>Harmonização</strong><p>{product.pairing}</p></div></div>}{reviews.length > 0 && <section className="review-list"><h3>Avaliações verificadas</h3>{reviews.map((review)=><article key={review.id}><div><span>{"★".repeat(review.rating)}{"☆".repeat(5-review.rating)}</span><b>{review.customer_name}</b></div>{review.comment&&<p>{review.comment}</p>}</article>)}</section>}<div className="modal-buy"><div className="quantity"><button onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus/></button><span>{quantity}</span><button onClick={() => setQuantity(Math.min(product.quantity_available ?? 99, quantity + 1))}><Plus/></button></div><button className="primary-button" onClick={onAdd} disabled={product.quantity_available === 0}>Adicionar • {money.format(currentPrice(product) * quantity)}</button></div><small className="stock-copy">{product.quantity_available === null ? "Disponibilidade confirmada pela loja no WhatsApp." : `${product.quantity_available} unidade(s) disponível(is).`}</small></div></div></div>;
}

function CheckoutModal({ total, cart, error, profile, email, submitting, onClose, onSubmit }: { total: number; cart: CartItem[]; error: string; profile: CustomerProfile | null; email: string; submitting: boolean; onClose: () => void; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-overlay"><div className="checkout-modal"><button className="modal-close" onClick={onClose} aria-label="Fechar"><X/></button><p className="eyebrow">Última etapa</p><h2>Pagamento e retirada</h2><p>Não realizamos entrega. Escolha a forma de pagamento e o horário desejado para retirada.</p><form onSubmit={onSubmit}><div className="form-row"><label>Nome completo *<input name="name" required autoFocus defaultValue={profile?.full_name ?? ""}/></label><label>Telefone *<input name="phone" type="tel" required defaultValue={profile?.phone ?? ""}/></label></div><label>E-mail da conta<input value={email} readOnly/></label><div className="form-row"><label>Data desejada *<input name="date" type="date" required min={new Date().toISOString().slice(0,10)}/></label><label>Horário aproximado *<input name="time" type="time" required/></label></div><fieldset className="payment-options"><legend>Forma de pagamento *</legend><label><input type="radio" name="payment_method" value="pix" required/><span><QrCode/><b>Pix</b><small>Na homologação, nenhum valor real será movimentado.</small></span></label><label><input type="radio" name="payment_method" value="cash" required/><span><Banknote/><b>Dinheiro na retirada</b><small>Pague ao receber o pedido no local.</small></span></label></fieldset><label>Observações<textarea name="notes" rows={3} placeholder="Alguma preferência ou observação?"/></label>{error && <div className="form-error"><CircleAlert size={16}/>{error}</div>}<div className="order-preview"><span>{cart.reduce((s,i) => s+i.quantity,0)} item(ns)</span><strong>{money.format(total)}</strong></div><button className="primary-button wide" type="submit" disabled={submitting}>{submitting ? <><LoaderCircle className="spin"/> Registrando pedido…</> : <>Registrar e enviar pedido <ArrowRight size={18}/></>}</button><small>Pedido, estoque e horário dependem da confirmação da loja. Retirada somente no local.</small></form></div></div>;
}

function CustomerAuthModal({ onClose }: { onClose: () => void }) {
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) { setFeedback({ type: "error", text: "A conexão com a área de clientes não está disponível. Atualize a página e tente novamente." }); return; }
    const data = new FormData(event.currentTarget); setBusy(true); setFeedback(null);
    const email = String(data.get("email") ?? ""); const password = String(data.get("password") ?? "");
    if (mode === "login") {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setFeedback({ type: "error", text: "E-mail ou senha inválidos." }); else onClose();
    } else {
      if (password.length < 8) { setFeedback({ type: "error", text: "A senha deve ter pelo menos 8 caracteres." }); setBusy(false); return; }
      const confirmation = String(data.get("confirmation") ?? "");
      if (password !== confirmation) { setFeedback({ type: "error", text: "A confirmação da senha não confere." }); setBusy(false); return; }
      const { data: result, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: `${window.location.origin}${sitePath("/")}`, data: { full_name: String(data.get("full_name") ?? ""), phone: String(data.get("phone") ?? "") } } });
      if (error) setFeedback({ type: "error", text: error.message }); else if (result.session) onClose(); else setFeedback({ type: "ok", text: "Cadastro recebido. Confira seu e-mail para confirmar a conta e depois faça login." });
    }
    setBusy(false);
  }
  return <div className="modal-overlay"><div className="auth-modal"><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar" disabled={busy}><X/></button><div className="auth-brand"><Wine/> OLI <span>CLIENTES</span></div><p className="eyebrow">{mode === "login" ? "Sua conta" : "Novo cliente"}</p><h2>{mode === "login" ? "Entrar" : "Criar cadastro"}</h2><p>{mode === "login" ? "Acompanhe pedidos e consulte seu histórico." : "Cadastre-se para registrar e acompanhar seus pedidos."}</p><form onSubmit={submit}>{mode === "signup" && <><label>Nome completo<input name="full_name" required disabled={busy}/></label><label>Telefone<input name="phone" type="tel" required disabled={busy}/></label></>}<label>E-mail<input name="email" type="email" required autoComplete="email" disabled={busy}/></label><label>Senha<CustomerPasswordInput name="password" required minLength={8} autoComplete={mode === "login" ? "current-password" : "new-password"} disabled={busy}/></label>{mode === "signup" && <label>Confirmar senha<CustomerPasswordInput name="confirmation" required minLength={8} autoComplete="new-password" disabled={busy}/></label>}{feedback && <ActionMessage feedback={feedback}/>}<button type="submit" className="primary-button wide" disabled={busy}>{busy ? <><LoaderCircle className="spin"/> Aguarde…</> : mode === "login" ? "Entrar" : "Criar conta"}</button></form><button type="button" className="auth-switch" disabled={busy} onClick={() => { setMode(mode === "login" ? "signup" : "login"); setFeedback(null); }}>{mode === "login" ? "Ainda não tenho cadastro" : "Já tenho cadastro"}</button></div></div>;
}

function ActionMessage({ feedback }: { feedback: ActionFeedback }) {
  return <div className={`form-feedback ${feedback.type}`} role="status">{feedback.type === "ok" ? <Check size={17}/> : <CircleAlert size={17}/>}<span>{feedback.text}</span></div>;
}

function CustomerPasswordInput({ name, minLength, required = false, autoComplete, disabled = false }: { name:string; minLength?:number; required?:boolean; autoComplete?:string; disabled?:boolean }) {
  const [visible,setVisible]=useState(false);
  return <span className="customer-password"><input name={name} type={visible?"text":"password"} minLength={minLength} required={required} autoComplete={autoComplete} disabled={disabled}/><button type="button" onClick={()=>setVisible((value)=>!value)} disabled={disabled} aria-label={visible?"Ocultar senha":"Revelar senha"} title={visible?"Ocultar senha":"Revelar senha"}>{visible?<EyeOff/>:<Eye/>}</button></span>;
}

function CustomerAccountModal({ profile, orders, reviews, loading, onRefresh, onSaveProfile, onSubmitReview, onClose, onSignOut }: { profile: CustomerProfile | null; orders: CustomerOrder[]; reviews: ProductReview[]; loading: boolean; onRefresh: () => Promise<ActionFeedback>; onSaveProfile: (e: React.FormEvent<HTMLFormElement>) => Promise<ActionFeedback>; onSubmitReview: (productId:string,rating:number,comment:string)=>Promise<ActionFeedback>; onClose: () => void; onSignOut: () => Promise<void> | void }) {
  const [tab, setTab] = useState<"orders" | "profile">("orders");
  const [profileFeedback, setProfileFeedback] = useState<ActionFeedback | null>(null);
  const [passwordFeedback, setPasswordFeedback] = useState<ActionFeedback | null>(null);
  const [refreshFeedback, setRefreshFeedback] = useState<ActionFeedback | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [passwordBusy, setPasswordBusy] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [reviewing, setReviewing] = useState<{ productId:string; productName:string } | null>(null);
  const [copiedPixOrderId, setCopiedPixOrderId] = useState<string | null>(null);
  async function copyPix(order:CustomerOrder) {
    if (!order.pix_copy_paste) return;
    try {
      await navigator.clipboard.writeText(order.pix_copy_paste);
      setCopiedPixOrderId(order.id);
      window.setTimeout(() => setCopiedPixOrderId((current)=>current===order.id?null:current), 3000);
    } catch {
      setRefreshFeedback({ type:"error", text:"Não foi possível copiar automaticamente. Selecione o código e copie manualmente." });
    }
  }
  async function saveProfileForm(event: React.FormEvent<HTMLFormElement>) {
    setProfileBusy(true); setProfileFeedback(null);
    const result = await onSaveProfile(event);
    setProfileFeedback(result); setProfileBusy(false);
  }
  async function refreshAccount() {
    setRefreshFeedback(null);
    const result = await onRefresh();
    setRefreshFeedback(result);
  }
  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) { setPasswordFeedback({ type: "error", text: "A conexão não está disponível. Atualize a página e tente novamente." }); return; }
    if (passwordBusy) return; const form = event.currentTarget; const data = new FormData(form); const password = String(data.get("password") ?? "");
    setPasswordFeedback(null);
    if (password.length < 8) { setPasswordFeedback({ type: "error", text: "Use pelo menos 8 caracteres." }); return; }
    setPasswordBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setPasswordBusy(false);
    if (error) setPasswordFeedback({ type: "error", text: `Não foi possível alterar a senha: ${error.message}` });
    else { form.reset(); setPasswordFeedback({ type: "ok", text: "Senha alterada com sucesso." }); }
  }
  return <><div className="drawer-overlay"><aside className="account-drawer drawer"><div className="drawer-head"><div><p>ÁREA DO CLIENTE</p><h2>Minha conta</h2></div><button type="button" onClick={onClose} aria-label="Fechar"><X/></button></div><div className="account-tabs"><button type="button" className={tab === "orders" ? "active" : ""} onClick={() => setTab("orders")}><History/> Pedidos</button><button type="button" className={tab === "profile" ? "active" : ""} onClick={() => setTab("profile")}><UserRound/> Meus dados</button></div>{tab === "orders" ? <div className="account-content"><div className="account-title"><h3>Histórico de pedidos</h3><button type="button" onClick={refreshAccount} disabled={loading} aria-label="Atualizar pedidos" title="Atualizar pedidos"><LoaderCircle className={loading ? "spin" : ""}/></button></div>{refreshFeedback&&<ActionMessage feedback={refreshFeedback}/>} {loading ? <p className="account-empty">Carregando pedidos…</p> : orders.length === 0 ? <div className="account-empty"><ShoppingBag/><h3>Nenhum pedido ainda</h3><p>Seus próximos pedidos aparecerão aqui.</p></div> : orders.map((order) => <article className="customer-order" key={order.id}><div className="customer-order-head"><div><small>Pedido</small><strong>#{order.order_number}</strong></div><span className={`order-status ${order.status}`}>{orderStatusLabel[order.status]}</span></div><p>{dateTime.format(new Date(order.created_at))} • Retirada {new Date(`${order.pickup_date}T12:00:00`).toLocaleDateString("pt-BR")} às {order.pickup_time.slice(0,5)}</p><div className="customer-order-items">{order.order_items.map((item) => { const existing=reviews.find((review)=>review.product_id===item.product_id); return <div key={item.id}><span>{item.quantity}× {item.product_name}</span><b>{money.format(Number(item.line_total))}</b>{order.status === "delivered" && item.product_id && <button type="button" className="review-action" onClick={()=>setReviewing({productId:item.product_id!,productName:item.product_name})}>{existing?`Avaliação ${existing.status === "approved"?"publicada":existing.status === "rejected"?"rejeitada":"em análise"}`:"Avaliar produto"}</button>}</div>})}</div><div className="customer-order-total"><span>Total</span><strong>{money.format(Number(order.total))}</strong></div><div className={`customer-payment ${order.payment_status}`}><span>{paymentMethodLabel[order.payment_method] ?? order.payment_method}</span><b>{paymentStatusLabel[order.payment_status]}</b>{order.payment_method === "pix" && order.pix_copy_paste && order.payment_status === "pending" && <button type="button" onClick={()=>copyPix(order)} className={copiedPixOrderId===order.id?"copied":""}><Copy/>{copiedPixOrderId===order.id?"Código Pix copiado!":"Copiar Pix de homologação"}</button>}</div>{copiedPixOrderId===order.id&&<div className="copy-feedback" role="status"><Check/> Código Pix copiado para a área de transferência.</div>}<div className="status-timeline">{order.order_status_history.map((history) => <div key={history.id}><i/><span><b>{orderStatusLabel[history.status]}</b><small>{dateTime.format(new Date(history.created_at))}{history.note ? ` • ${history.note}` : ""}</small></span></div>)}</div>{order.status === "delivered" && order.order_items.some((item)=>item.product_id) && <button type="button" className="review-order-action" onClick={()=>{const item=order.order_items.find((candidate)=>candidate.product_id&&!reviews.some((review)=>review.product_id===candidate.product_id))??order.order_items.find((candidate)=>candidate.product_id);if(item?.product_id)setReviewing({productId:item.product_id,productName:item.product_name});}}><Star/> Avaliar produtos deste pedido</button>}</article>)}</div> : <div className="account-content"><form className="account-form" onSubmit={saveProfileForm}><h3>Dados pessoais</h3><label>Nome completo<input name="full_name" defaultValue={profile?.full_name ?? ""} required disabled={profileBusy}/></label><label>E-mail<input value={profile?.email ?? ""} readOnly/></label><label>Telefone<input name="phone" type="tel" defaultValue={profile?.phone ?? ""} required disabled={profileBusy}/></label>{profileFeedback&&<ActionMessage feedback={profileFeedback}/>}<button className="primary-button" type="submit" disabled={profileBusy}>{profileBusy?<><LoaderCircle className="spin"/> Salvando…</>:"Salvar dados"}</button></form><form className="account-form" onSubmit={changePassword}><h3><KeyRound/> Alterar senha</h3><label>Nova senha<CustomerPasswordInput name="password" minLength={8} required autoComplete="new-password" disabled={passwordBusy}/></label>{passwordFeedback&&<ActionMessage feedback={passwordFeedback}/>}<button className="secondary-button" type="submit" disabled={passwordBusy}>{passwordBusy?<><LoaderCircle className="spin"/> Atualizando…</>:"Atualizar senha"}</button></form></div>}<div className="account-footer"><button type="button" disabled={signOutBusy} onClick={async()=>{setSignOutBusy(true);await onSignOut();}}><LogOut/> {signOutBusy?"Saindo…":"Sair da conta"}</button></div></aside></div>{reviewing&&<ReviewModal target={reviewing} existing={reviews.find((review)=>review.product_id===reviewing.productId)} onClose={()=>setReviewing(null)} onSubmit={onSubmitReview}/>}</>;
}

function ReviewModal({ target, existing, onClose, onSubmit }: { target:{productId:string;productName:string}; existing?:ProductReview; onClose:()=>void; onSubmit:(productId:string,rating:number,comment:string)=>Promise<ActionFeedback> }) {
  const [feedback,setFeedback]=useState<ActionFeedback|null>(null); const [busy,setBusy]=useState(false);
  async function submit(event:React.FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;const data=new FormData(form);setBusy(true);setFeedback(null);const result=await onSubmit(target.productId,Number(data.get("rating")),String(data.get("comment")??""));setFeedback(result);setBusy(false);if(result.type==="ok")form.reset();}
  return <div className="modal-overlay review-overlay"><form className="review-modal" onSubmit={submit}><button type="button" className="modal-close" onClick={onClose} aria-label="Fechar" disabled={busy}><X/></button><p className="eyebrow">Compra verificada</p><h2>Avaliar produto</h2><p>{target.productName}</p><fieldset className="star-rating"><legend>Sua nota</legend>{[5,4,3,2,1].map((value)=><label key={value}><input type="radio" name="rating" value={value} required defaultChecked={existing?.rating===value}/><span>{value} <Star fill="currentColor"/></span></label>)}</fieldset><label>Comentário<textarea name="comment" rows={4} defaultValue={existing?.comment??""} placeholder="Conte como foi sua experiência."/></label>{feedback&&<ActionMessage feedback={feedback}/>}<button className="primary-button wide" type="submit" disabled={busy}>{busy?"Enviando…":"Enviar avaliação"}</button><small>A avaliação será publicada após a moderação da OLI.</small></form></div>;
}

function OrderSuccessModal({ order, message, emailNotice, onClose, onAccount }: { order: CustomerOrder; message: string; emailNotice: string; onClose: () => void; onAccount: () => void }) {
  const [pixCopied,setPixCopied]=useState(false);
  const whatsapp = `https://wa.me/${STORE_CONFIG.whatsappInternational}?text=${encodeURIComponent(message)}`;
  const copyPix = async () => { if (!order.pix_copy_paste) return; await navigator.clipboard.writeText(order.pix_copy_paste); setPixCopied(true); window.setTimeout(()=>setPixCopied(false),3000); };
  return <div className="modal-overlay"><div className="order-success"><button className="modal-close" onClick={onClose} aria-label="Fechar"><X/></button><div className="success-icon"><Check/></div><p className="eyebrow">Pedido registrado</p><h2>Pedido #{order.order_number}</h2><p>Recebemos seu pedido no valor de <strong>{money.format(Number(order.total))}</strong>. Ele está pendente e aguardando confirmação da OLI Vinhos.</p><section className={`success-payment ${order.payment_method}`}><div>{order.payment_method === "pix" ? <QrCode/> : <Banknote/>}<span><small>Forma de pagamento</small><b>{paymentMethodLabel[order.payment_method]}</b></span></div>{order.payment_method === "cash" ? <p>Pague em dinheiro no momento da retirada.</p> : <><p><strong>Pix de homologação:</strong> isto é apenas um teste. Não efetue nenhum pagamento real.</p>{order.pix_copy_paste&&<button type="button" onClick={copyPix} className={pixCopied?"copied":""}>{pixCopied?<Check/>:<Copy/>}{pixCopied?"Código Pix copiado!":"Copiar código Pix de teste"}</button>}{pixCopied&&<div className="copy-feedback" role="status"><Check/> Código Pix copiado para a área de transferência.</div>}</>}</section><small>{emailNotice}</small><div className="order-send-actions"><a className="primary-button" href={whatsapp} target="_blank" rel="noreferrer">Abrir pedido no WhatsApp</a></div><button className="account-history-link" onClick={onAccount}>Acompanhar em Minha conta <ArrowRight/></button></div></div>;
}
