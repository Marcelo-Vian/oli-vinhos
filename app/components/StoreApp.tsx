"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Filter,
  Grape,
  Heart,
  Mail,
  MapPin,
  Menu,
  Minus,
  Plus,
  Search,
  ShoppingBag,
  Trash2,
  Wine,
  X,
} from "lucide-react";
import { CATALOG_PRODUCTS } from "../data/products";
import { STORE_CONFIG } from "../data/store-config";
import type { CartItem, WineProduct } from "../data/types";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { assetUrl, sitePath } from "../lib/paths";

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const norm = (value: string | null | undefined) => (value ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const currentPrice = (p: WineProduct) => p.promotional_price ?? p.normal_price;
const unique = (values: (string | null)[]) => [...new Set(values.filter(Boolean) as string[])].sort((a, b) => a.localeCompare(b, "pt-BR"));

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

const initialFilters: Filters = { country: "", type: "", grape: "", producer: "", vintage: "", maxPrice: 150, featured: false, promotion: false, available: false };

export default function StoreApp() {
  const [products, setProducts] = useState<WineProduct[]>(CATALOG_PRODUCTS);
  const [dataMessage, setDataMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(hasSupabaseConfig));
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [sort, setSort] = useState("featured");
  const [filterOpen, setFilterOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [detail, setDetail] = useState<WineProduct | null>(null);
  const [detailQty, setDetailQty] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [checkoutOpen, setCheckoutOpen] = useState(false);
  const [formError, setFormError] = useState("");

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

  function sendOrder(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const name = String(data.get("name") ?? "").trim();
    const phone = String(data.get("phone") ?? "").trim();
    const date = String(data.get("date") ?? "").trim();
    const time = String(data.get("time") ?? "").trim();
    if (!name || !phone || !date || !time) {
      setFormError("Preencha nome, telefone, data e horário aproximado.");
      return;
    }
    setFormError("");
    const lines = ["Olá! Gostaria de solicitar o seguinte pedido para retirada:", ""];
    cart.forEach((item, index) => {
      const unit = currentPrice(item.product);
      lines.push(`${index + 1}. ${item.product.name}`, `Quantidade: ${item.quantity}`, `Valor unitário: ${money.format(unit)}`, `Subtotal: ${money.format(unit * item.quantity)}`, "");
    });
    lines.push(`Total do pedido: ${money.format(total)}`, "", `Cliente: ${name}`, `Telefone: ${phone}`, `Data desejada para retirada: ${date}`, `Horário aproximado: ${time}`, `Observações: ${String(data.get("notes") ?? "") || "Sem observações"}`, "", "Estou ciente de que o pedido, o estoque e o horário de retirada dependem da confirmação da loja.");
    window.open(`https://wa.me/${STORE_CONFIG.whatsappInternational}?text=${encodeURIComponent(lines.join("\n"))}`, "_blank", "noopener,noreferrer");
  }

  return (
    <div className="site-shell">
      <div className="announcement"><span>Curadoria independente • retirada local</span><strong>Preços e estoque dependem de confirmação</strong></div>
      <header className="header">
        <a className="brand" href="#top" aria-label="OLI Vinhos - início"><span>OLI</span><small>VINHOS</small></a>
        <nav aria-label="Navegação principal"><a href="#catalogo">Catálogo</a><a href="#como-funciona">Como funciona</a><a href="#contato">Contato</a></nav>
        <div className="header-actions">
          <button className="icon-button mobile-menu" aria-label="Abrir menu"><Menu size={20}/></button>
          <button className="cart-button" onClick={() => setCartOpen(true)}><ShoppingBag size={19}/><span>Carrinho</span>{cartCount > 0 && <b>{cartCount}</b>}</button>
        </div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <p className="eyebrow">Catálogo 2026 • seleção especial</p>
            <h1>Vinhos para<br/><em>bons encontros.</em></h1>
            <p className="hero-text">Rótulos escolhidos para transformar refeições, conversas e pequenas celebrações em memórias.</p>
            <div className="hero-cta"><a href="#catalogo" className="primary-button">Explorar catálogo <ArrowRight size={18}/></a><span><Check size={16}/> Pedido direto pelo WhatsApp</span></div>
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
              : <div className="product-grid">{visible.map((p) => <ProductCard key={p.id} product={p} onDetail={() => { setDetail(p); setDetailQty(1); }} onAdd={() => addToCart(p)}/>)}</div>}
            </div>
          </div>
        </section>

        <section className="pickup-section" id="como-funciona">
          <div className="pickup-intro"><p className="eyebrow">Simples e pessoal</p><h2>Seu vinho, separado<br/>com cuidado.</h2><p>Pedidos disponíveis somente para retirada no local.</p></div>
          <div className="steps"><div><b>01</b><h3>Escolha</h3><p>Explore o catálogo e adicione seus rótulos ao carrinho.</p></div><div><b>02</b><h3>Envie</h3><p>Informe os dados de retirada e envie o pedido pelo WhatsApp.</p></div><div><b>03</b><h3>Confirme</h3><p>Aguarde a confirmação de estoque e horário antes de retirar.</p></div></div>
          <div className="pickup-alert"><CircleAlert size={21}/><p><strong>Atenção</strong> Preços, estoque e horário de retirada dependem de confirmação pelo WhatsApp. Não realizamos entrega.</p></div>
        </section>

        <section className="contact-section" id="contato"><div><p className="eyebrow">Fale com a OLI</p><h2>Uma boa escolha<br/>começa com conversa.</h2></div><div className="contact-links"><a href={`https://wa.me/${STORE_CONFIG.whatsappInternational}`} target="_blank" rel="noreferrer"><span><strong>WhatsApp</strong><small>{STORE_CONFIG.contactName}: {STORE_CONFIG.whatsappDisplay}</small></span><ArrowRight/></a><a href={`mailto:${STORE_CONFIG.email}`}><span><strong>E-mail</strong><small>{STORE_CONFIG.email}</small></span><ArrowRight/></a></div></section>
      </main>

      <footer><div className="footer-brand"><span>OLI</span><small>VINHOS</small></div><p>Curadoria para bons encontros.<br/>Pedidos somente para retirada.</p><div><a href="#catalogo">Catálogo</a><a href="#como-funciona">Retirada</a><a href={sitePath("/admin/")}>Área administrativa</a></div><div><a href={`mailto:${STORE_CONFIG.email}`}><Mail size={15}/>{STORE_CONFIG.email}</a><a href={`https://wa.me/${STORE_CONFIG.whatsappInternational}`}>{STORE_CONFIG.whatsappDisplay}</a></div><small className="copyright">© 2026 OLI Vinhos</small></footer>
      <a className="whatsapp-float" href={`https://wa.me/${STORE_CONFIG.whatsappInternational}`} target="_blank" rel="noreferrer" aria-label="Falar com a OLI Vinhos pelo WhatsApp">WA</a>

      {filterOpen && <div className="drawer-overlay" role="presentation" onMouseDown={(e) => e.target === e.currentTarget && setFilterOpen(false)}><aside className="mobile-filter drawer"><div className="drawer-head"><h2>Filtros</h2><button onClick={() => setFilterOpen(false)} aria-label="Fechar filtros"><X/></button></div><FilterPanel options={options} filters={filters} setFilters={setFilters} mobile/><button className="primary-button wide" onClick={() => setFilterOpen(false)}>Ver {visible.length} vinhos</button></aside></div>}
      {cartOpen && <CartDrawer cart={cart} total={total} onClose={() => setCartOpen(false)} onQuantity={setQuantity} onClear={() => setCart([])} onCheckout={() => setCheckoutOpen(true)}/>}      
      {detail && <ProductModal product={detail} quantity={detailQty} setQuantity={setDetailQty} onClose={() => setDetail(null)} onAdd={() => { addToCart(detail, detailQty); setDetail(null); }}/>}      
      {checkoutOpen && <CheckoutModal total={total} cart={cart} error={formError} onClose={() => setCheckoutOpen(false)} onSubmit={sendOrder}/>}      
    </div>
  );
}

function ProductCard({ product, onDetail, onAdd }: { product: WineProduct; onDetail: () => void; onAdd: () => void }) {
  const unavailable = product.quantity_available === 0;
  return <article className="product-card">
    <div className="product-media">
      <div className="badges">{product.promotional_price !== null && <span className="sale">OFERTA</span>}{product.low_stock && <span>POUCAS UNIDADES</span>}{product.featured && <span>DESTAQUE</span>}</div>
      <button className="heart" aria-label={`Favoritar ${product.name}`}><Heart size={18}/></button>
      <img src={assetUrl(product.image_url ?? "/products/placeholder.webp")} alt={`Garrafa do vinho ${product.name}`} loading="lazy"/>
    </div>
    <div className="product-body"><p className="product-origin">{[product.country, product.region].filter(Boolean).join(" • ")}</p><h3>{product.name}</h3><p className="product-meta">{[product.type, product.grape, product.vintage].filter(Boolean).join(" · ")}</p>
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

function ProductModal({ product, quantity, setQuantity, onClose, onAdd }: { product: WineProduct; quantity: number; setQuantity: (q: number) => void; onClose: () => void; onAdd: () => void }) {
  const fields = [["Produtor", product.producer], ["Origem", [product.region, product.country].filter(Boolean).join(", ")], ["Tipo", product.type], ["Uva", product.grape], ["Composição", product.grape_composition], ["Safra", product.vintage], ["Volume", product.volume], ["Teor alcoólico", product.alcohol_content], ["Classificação", product.classification], ["Serviço", product.service_temperature]].filter(([, v]) => v);
  return <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}><div className="product-modal"><button className="modal-close" onClick={onClose} aria-label="Fechar detalhes"><X/></button><div className="modal-media"><img src={assetUrl(product.image_url)} alt={`Garrafa de ${product.name}`}/></div><div className="modal-content"><p className="eyebrow">{product.country} • {product.type}</p><h2>{product.name}</h2><p className="modal-price">{product.promotional_price !== null && <del>{money.format(product.normal_price)}</del>}<strong>{money.format(currentPrice(product))}</strong></p>{product.description && <p className="modal-description">{product.description}</p>}<dl>{fields.map(([k,v]) => <div key={String(k)}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>{product.pairing && <div className="pairing"><Grape/><div><strong>Harmonização</strong><p>{product.pairing}</p></div></div>}<div className="modal-buy"><div className="quantity"><button onClick={() => setQuantity(Math.max(1, quantity - 1))}><Minus/></button><span>{quantity}</span><button onClick={() => setQuantity(Math.min(product.quantity_available ?? 99, quantity + 1))}><Plus/></button></div><button className="primary-button" onClick={onAdd} disabled={product.quantity_available === 0}>Adicionar • {money.format(currentPrice(product) * quantity)}</button></div><small className="stock-copy">{product.quantity_available === null ? "Disponibilidade confirmada pela loja no WhatsApp." : `${product.quantity_available} unidade(s) disponível(is).`}</small></div></div></div>;
}

function CheckoutModal({ total, cart, error, onClose, onSubmit }: { total: number; cart: CartItem[]; error: string; onClose: () => void; onSubmit: (e: React.FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-overlay"><div className="checkout-modal"><button className="modal-close" onClick={onClose} aria-label="Fechar"><X/></button><p className="eyebrow">Última etapa</p><h2>Dados para retirada</h2><p>Seu pedido será enviado à OLI Vinhos pelo WhatsApp.</p><form onSubmit={onSubmit}><div className="form-row"><label>Nome completo *<input name="name" required autoFocus/></label><label>Telefone *<input name="phone" type="tel" required/></label></div><div className="form-row"><label>Data desejada *<input name="date" type="date" required min={new Date().toISOString().slice(0,10)}/></label><label>Horário aproximado *<input name="time" type="time" required/></label></div><label>Observações<textarea name="notes" rows={3} placeholder="Alguma preferência ou observação?"/></label>{error && <div className="form-error"><CircleAlert size={16}/>{error}</div>}<div className="order-preview"><span>{cart.reduce((s,i) => s+i.quantity,0)} item(ns)</span><strong>{money.format(total)}</strong></div><button className="primary-button wide" type="submit">Enviar pedido pelo WhatsApp <ArrowRight size={18}/></button><small>Ao continuar, você reconhece que pedido, estoque e horário dependem da confirmação da loja.</small></form></div></div>;
}
