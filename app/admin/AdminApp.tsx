"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, CircleAlert, ClipboardList, Edit3, Eye, ImageUp, KeyRound, LogOut, Package, Plus, RefreshCw, Search, Trash2, UserPlus, Users, Wine, X } from "lucide-react";
import { STORE_CONFIG } from "../data/store-config";
import type { CustomerOrder, CustomerProfile, OrderStatus, WineProduct } from "../data/types";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { assetUrl, sitePath } from "../lib/paths";

const blank: Partial<WineProduct> = { name: "", slug: "", producer: "", country: "", region: "", type: "", grape: "", grape_composition: "", vintage: null, volume: "750 ml", alcohol_content: "", classification: "", description: "", pairing: "", service_temperature: "", normal_price: 0, promotional_price: null, quantity_available: null, image_url: "", featured: false, active: true, low_stock: false, pending_review: false, information_source: "" };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
const orderStatusLabel: Record<OrderStatus, string> = { pending: "Pendente", confirmed: "Confirmado", preparing: "Em separação", ready: "Pronto para retirada", delivered: "Entregue", canceled: "Cancelado" };
const orderStatuses = Object.keys(orderStatusLabel) as OrderStatus[];

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<WineProduct[]>([]);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<Partial<WineProduct> | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [creatingAdmin, setCreatingAdmin] = useState(false);
  const [creatingAdminBusy, setCreatingAdminBusy] = useState(false);
  const [adminCreationFeedback, setAdminCreationFeedback] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const [section, setSection] = useState<"products" | "orders" | "customers" | "admins">("products");
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [customers, setCustomers] = useState<CustomerProfile[]>([]);
  const [orderFilter, setOrderFilter] = useState<"all" | OrderStatus>("all");
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrder | null>(null);
  const [adminAllowed, setAdminAllowed] = useState<boolean | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { if (session) verifyAdmin(); else setAdminAllowed(null); }, 0);
    return () => window.clearTimeout(timer);
  }, [session]);

  async function verifyAdmin() {
    if (!supabase || !session) return;
    const { data } = await supabase.from("profiles").select("role").eq("id", session.user.id).single();
    const allowed = data?.role === "admin"; setAdminAllowed(allowed);
    if (allowed) await Promise.all([loadProducts(), loadOrders(), loadCustomers()]);
  }

  async function loadProducts() {
    if (!supabase) return; setLoading(true);
    const { data, error } = await supabase.from("products").select("*").order("updated_at", { ascending: false });
    if (error) setMessage({ type: "error", text: "Não foi possível carregar os produtos. Verifique seu acesso administrativo." });
    else setProducts((data ?? []) as WineProduct[]);
    setLoading(false);
  }
  async function loadOrders() {
    if (!supabase) return;
    const { data, error } = await supabase.from("orders").select("*, order_items(*), order_status_history(*)").order("created_at", { ascending: false });
    if (error) setMessage({ type: "error", text: "Não foi possível carregar os pedidos." });
    else setOrders((data ?? []).map((order) => ({ ...order, order_items: order.order_items ?? [], order_status_history: [...(order.order_status_history ?? [])].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) })) as CustomerOrder[]);
  }
  async function loadCustomers() {
    if (!supabase) return;
    const { data } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (data) setCustomers(data as CustomerProfile[]);
  }
  async function changeOrderStatus(order: CustomerOrder, nextStatus: OrderStatus) {
    if (!supabase) return;
    const { error } = await supabase.rpc("set_order_status", { p_order_id: order.id, p_status: nextStatus, p_note: null });
    if (error) setMessage({ type: "error", text: `Não foi possível atualizar o pedido #${order.order_number}.` });
    else { setMessage({ type: "ok", text: `Pedido #${order.order_number} atualizado para ${orderStatusLabel[nextStatus]}.` }); await loadOrders(); }
  }
  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; const data = new FormData(event.currentTarget); setLoading(true); setMessage(null);
    const { error } = await supabase.auth.signInWithPassword({ email: String(data.get("email")), password: String(data.get("password")) });
    if (error) setMessage({ type: "error", text: "E-mail ou senha inválidos." }); setLoading(false);
  }
  async function saveProduct(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase || !editing) return;
    if (!editing.name?.trim() || !editing.slug?.trim() || !editing.normal_price || editing.normal_price < 0) { setMessage({ type: "error", text: "Informe nome, slug e preço normal válido." }); return; }
    const payload = { ...editing, updated_at: new Date().toISOString() };
    const result = editing.id ? await supabase.from("products").update(payload).eq("id", editing.id) : await supabase.from("products").insert(payload);
    if (result.error) setMessage({ type: "error", text: `Falha ao salvar: ${result.error.message}` });
    else { setMessage({ type: "ok", text: "Produto salvo com sucesso." }); setEditing(null); await loadProducts(); }
  }
  async function removeProduct(product: WineProduct) {
    if (!supabase || !confirm(`Excluir permanentemente “${product.name}”?`)) return;
    const { error } = await supabase.from("products").delete().eq("id", product.id);
    if (error) setMessage({ type: "error", text: "Não foi possível excluir o produto." }); else { setMessage({ type: "ok", text: "Produto excluído." }); loadProducts(); }
  }
  async function toggleProduct(product: WineProduct) {
    if (!supabase) return; const { error } = await supabase.from("products").update({ active: !product.active }).eq("id", product.id);
    if (error) setMessage({ type: "error", text: "Não foi possível alterar o status." }); else loadProducts();
  }
  async function changePassword(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!supabase) return; const data = new FormData(event.currentTarget); const password = String(data.get("password")); const confirmation = String(data.get("confirmation"));
    if (password.length < 8) { setMessage({ type: "error", text: "A nova senha deve ter pelo menos 8 caracteres." }); return; }
    if (password !== confirmation) { setMessage({ type: "error", text: "A confirmação da senha não confere." }); return; }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) setMessage({ type: "error", text: `Não foi possível alterar a senha: ${error.message}` });
    else { setMessage({ type: "ok", text: "Senha alterada com sucesso." }); setChangingPassword(false); }
  }
  async function createAdmin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || creatingAdminBusy) return;
    const data = new FormData(event.currentTarget);
    const email = String(data.get("email")).trim().toLowerCase();
    const password = String(data.get("password"));
    const confirmation = String(data.get("confirmation"));
    setAdminCreationFeedback(null);
    if (password.length < 8) { setAdminCreationFeedback({ type: "error", text: "A senha temporária deve ter pelo menos 8 caracteres." }); return; }
    if (password !== confirmation) { setAdminCreationFeedback({ type: "error", text: "A confirmação da senha não confere." }); return; }
    setCreatingAdminBusy(true);
    const { data: created, error } = await supabase.functions.invoke("create-admin", { body: { email, password } });
    setCreatingAdminBusy(false);
    if (error) {
      let detail = "Verifique se o e-mail já está cadastrado e tente novamente.";
      const response = (error as { context?: Response }).context;
      if (response) {
        const payload = await response.clone().json().catch(() => null) as { message?: string } | null;
        if (payload?.message) detail = payload.message;
      }
      setAdminCreationFeedback({ type: "error", text: `Não foi possível criar o administrador. ${detail}` });
      return;
    }
    setMessage({ type: "ok", text: `Administrador ${created.email} criado com sucesso.` });
    setAdminCreationFeedback({ type: "ok", text: `Acesso criado para ${created.email}.` });
    window.setTimeout(() => { setCreatingAdmin(false); setAdminCreationFeedback(null); }, 900);
  }
  async function resetAdminPassword(admin: CustomerProfile) {
    if (!supabase) return;
    const password = window.prompt(`Digite uma nova senha temporária para ${admin.email}:`);
    if (password === null) return;
    if (password.length < 8) { setMessage({ type: "error", text: "A senha temporária deve ter pelo menos 8 caracteres." }); return; }
    const { error } = await supabase.functions.invoke("create-admin", { body: { action: "reset_password", userId: admin.id, password } });
    if (error) {
      let detail = "Não foi possível alterar a senha.";
      const response = (error as { context?: Response }).context;
      if (response) { const payload = await response.clone().json().catch(() => null) as { message?: string } | null; if (payload?.message) detail = payload.message; }
      setMessage({ type: "error", text: detail });
    } else setMessage({ type: "ok", text: `Senha temporária de ${admin.email} alterada.` });
  }
  async function removeAdmin(admin: CustomerProfile) {
    if (!supabase || !session) return;
    if (admin.id === session.user.id) { setMessage({ type: "error", text: "Você não pode remover o próprio acesso." }); return; }
    if (!window.confirm(`Remover o acesso administrativo de ${admin.email}? Essa pessoa não poderá mais entrar.`)) return;
    const { error } = await supabase.functions.invoke("create-admin", { body: { action: "delete", userId: admin.id } });
    if (error) {
      let detail = "Não foi possível remover o administrador.";
      const response = (error as { context?: Response }).context;
      if (response) { const payload = await response.clone().json().catch(() => null) as { message?: string } | null; if (payload?.message) detail = payload.message; }
      setMessage({ type: "error", text: detail });
    } else { setMessage({ type: "ok", text: `Acesso de ${admin.email} removido.` }); await loadCustomers(); }
  }
  const visible = useMemo(() => products.filter((p) => {
    const search = `${p.name} ${p.producer} ${p.country} ${p.grape}`.toLowerCase();
    const statusMatch = status === "all" || (status === "inactive" && !p.active) || (status === "low" && p.low_stock) || (status === "review" && p.pending_review) || (status === "unavailable" && p.quantity_available === 0);
    return search.includes(query.toLowerCase()) && statusMatch;
  }), [products, query, status]);

  if (!hasSupabaseConfig) return <AdminGate><CircleAlert size={34}/><h1>Conecte o Supabase</h1><p>A área administrativa está pronta, mas precisa das variáveis públicas do seu projeto Supabase para autenticar e carregar os produtos.</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_PUBLISHABLE_KEY</code><a href={sitePath("/")}>Voltar à loja</a></AdminGate>;
  if (loading && !session) return <AdminGate><RefreshCw className="spin"/><p>Carregando área segura…</p></AdminGate>;
  if (!session) return <AdminGate><div className="admin-logo"><Wine/> OLI <span>ADMIN</span></div><h1>Bem-vindo de volta</h1><p>Entre com o e-mail e a senha cadastrados no Supabase Auth.</p><form className="login-form" onSubmit={login}><label>E-mail<input type="email" name="email" required autoComplete="email"/></label><label>Senha<input type="password" name="password" required autoComplete="current-password"/></label>{message && <AdminMessage message={message}/>}<button className="primary-button wide" type="submit">Entrar</button></form><a href={sitePath("/")}><ArrowLeft size={15}/> Voltar à loja</a></AdminGate>;
  if (adminAllowed === null) return <AdminGate><RefreshCw className="spin"/><p>Verificando acesso administrativo…</p></AdminGate>;
  if (!adminAllowed) return <AdminGate><CircleAlert size={34}/><h1>Acesso restrito</h1><p>Esta conta é de cliente e não possui permissão para acessar a administração.</p><button className="primary-button" onClick={() => supabase?.auth.signOut()}>Sair desta conta</button><a href={sitePath("/")}><ArrowLeft size={15}/> Voltar à loja</a></AdminGate>;

  return <div className="admin-shell"><aside className="admin-nav"><div className="admin-logo"><Wine/> OLI <span>ADMIN</span></div><nav><button className={section === "products" ? "active" : ""} onClick={() => setSection("products")}><Package/> Produtos</button><button className={section === "orders" ? "active" : ""} onClick={() => setSection("orders")}><ClipboardList/> Pedidos</button><button className={section === "customers" ? "active" : ""} onClick={() => setSection("customers")}><Users/> Clientes</button><button className={section === "admins" ? "active" : ""} onClick={() => setSection("admins")}><UserPlus/> Administradores</button><a href={sitePath("/")} target="_blank"><Wine/> Ver loja</a></nav><div className="admin-user"><small>Conectado como</small><span>{session.user.email}</span><button onClick={() => { setAdminCreationFeedback(null); setCreatingAdmin(true); }}><UserPlus/> Novo administrador</button><button onClick={() => setChangingPassword(true)}><KeyRound/> Alterar minha senha</button><button onClick={() => supabase?.auth.signOut()}><LogOut/> Sair</button></div></aside><main className="admin-main">{message && <AdminMessage message={message}/>} {section === "products" && <ProductsSection products={products} visible={visible} loading={loading} query={query} status={status} setQuery={setQuery} setStatus={setStatus} onRefresh={loadProducts} onNew={() => setEditing({ ...blank })} onEdit={(product) => setEditing({ ...product })} onRemove={removeProduct} onToggle={toggleProduct}/>} {section === "orders" && <OrdersSection orders={orders} filter={orderFilter} setFilter={setOrderFilter} onRefresh={loadOrders} onSelect={setSelectedOrder} onStatus={changeOrderStatus}/>} {section === "customers" && <CustomersSection customers={customers} orders={orders} onRefresh={async () => { await Promise.all([loadCustomers(), loadOrders()]); }}/>} {section === "admins" && <AdminsSection admins={customers.filter((profile)=>profile.role==="admin")} currentUserId={session.user.id} onRefresh={loadCustomers} onCreate={()=>{ setAdminCreationFeedback(null); setCreatingAdmin(true); }} onReset={resetAdminPassword} onRemove={removeAdmin}/>}</main>{editing&&<ProductForm product={editing} setProduct={setEditing} onClose={()=>setEditing(null)} onSave={saveProduct} onMessage={setMessage}/>} {changingPassword&&<PasswordForm onClose={()=>setChangingPassword(false)} onSave={changePassword}/>} {creatingAdmin&&<CreateAdminForm feedback={adminCreationFeedback} busy={creatingAdminBusy} onClose={()=>{ if (!creatingAdminBusy) { setCreatingAdmin(false); setAdminCreationFeedback(null); } }} onSave={createAdmin}/>} {selectedOrder&&<OrderDetail order={selectedOrder} onClose={()=>setSelectedOrder(null)} onStatus={async (next) => { await changeOrderStatus(selectedOrder,next); setSelectedOrder(null); }}/>}</div>;
}
function AdminGate({ children }: { children: React.ReactNode }) { return <main className="admin-gate">{children}</main>; }
function AdminMessage({ message }: { message: { type: "ok"|"error"; text:string } }) { return <div className={`admin-message ${message.type}`}><CircleAlert/>{message.text}</div>; }

function ProductsSection({ products, visible, loading, query, status, setQuery, setStatus, onRefresh, onNew, onEdit, onRemove, onToggle }: { products: WineProduct[]; visible: WineProduct[]; loading: boolean; query: string; status: string; setQuery:(value:string)=>void; setStatus:(value:string)=>void; onRefresh:()=>void; onNew:()=>void; onEdit:(product:WineProduct)=>void; onRemove:(product:WineProduct)=>void; onToggle:(product:WineProduct)=>void }) {
  return <><header><div><p>{STORE_CONFIG.name}</p><h1>Produtos</h1></div><button className="primary-button" onClick={onNew}><Plus/> Novo produto</button></header><div className="admin-stats"><div><span>Total</span><b>{products.length}</b></div><div><span>Ativos</span><b>{products.filter(p=>p.active).length}</b></div><div><span>Sem estoque</span><b>{products.filter(p=>p.quantity_available===0).length}</b></div><div><span>Pendentes</span><b>{products.filter(p=>p.pending_review).length}</b></div></div><div className="admin-toolbar"><label><Search/><input placeholder="Pesquisar produtos" value={query} onChange={(e)=>setQuery(e.target.value)}/></label><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="all">Todos os produtos</option><option value="inactive">Inativos</option><option value="unavailable">Indisponíveis</option><option value="low">Poucas unidades</option><option value="review">Pendentes de revisão</option></select><button onClick={onRefresh} aria-label="Atualizar"><RefreshCw/></button></div>{loading ? <div className="admin-loading">Carregando produtos…</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Produto</th><th>Tipo / Origem</th><th>Preço</th><th>Estoque</th><th>Status</th><th aria-label="Ações"/></tr></thead><tbody>{visible.map(p=><tr key={p.id}><td><div className="admin-product"><img src={assetUrl(p.image_url)} alt=""/><div><strong>{p.name}</strong><small>{p.producer} • {p.vintage??"Sem safra"}</small></div></div></td><td>{p.type}<small>{[p.region,p.country].filter(Boolean).join(", ")}</small></td><td>{p.promotional_price&&<del>{money.format(p.normal_price)}</del>}<strong>{money.format(p.promotional_price??p.normal_price)}</strong></td><td>{p.quantity_available===null?"Não informado":p.quantity_available}</td><td><button className={`status-pill ${p.active?"on":"off"}`} onClick={()=>onToggle(p)}>{p.active?"Ativo":"Inativo"}</button>{p.pending_review&&<small className="review">Revisar</small>}</td><td><div className="row-actions"><button onClick={()=>onEdit(p)} aria-label="Editar"><Edit3/></button><button onClick={()=>onRemove(p)} aria-label="Excluir"><Trash2/></button></div></td></tr>)}</tbody></table>{visible.length===0&&<p className="admin-empty">Nenhum produto nesta visualização.</p>}</div>}</>;
}

function OrdersSection({ orders, filter, setFilter, onRefresh, onSelect, onStatus }: { orders:CustomerOrder[]; filter:"all"|OrderStatus; setFilter:(value:"all"|OrderStatus)=>void; onRefresh:()=>void; onSelect:(order:CustomerOrder)=>void; onStatus:(order:CustomerOrder,status:OrderStatus)=>void }) {
  const visible = filter === "all" ? orders : orders.filter((order) => order.status === filter);
  return <><header><div><p>Operação da loja</p><h1>Pedidos</h1></div><button className="secondary-action" onClick={onRefresh}><RefreshCw/> Atualizar</button></header><div className="admin-stats"><div><span>Total</span><b>{orders.length}</b></div><div><span>Pendentes</span><b>{orders.filter(o=>o.status==="pending").length}</b></div><div><span>Prontos</span><b>{orders.filter(o=>o.status==="ready").length}</b></div><div><span>Entregues</span><b>{orders.filter(o=>o.status==="delivered").length}</b></div></div><div className="order-filters"><button className={filter === "all" ? "active" : ""} onClick={()=>setFilter("all")}>Todos</button>{orderStatuses.map((value)=><button key={value} className={filter === value ? "active" : ""} onClick={()=>setFilter(value)}>{orderStatusLabel[value]}</button>)}</div><div className="admin-table-wrap"><table className="admin-table orders-table"><thead><tr><th>Pedido</th><th>Cliente</th><th>Retirada</th><th>Total</th><th>Status</th><th/></tr></thead><tbody>{visible.map((order)=><tr key={order.id}><td><strong>#{order.order_number}</strong><small>{dateTime.format(new Date(order.created_at))}</small></td><td><strong>{order.customer_name}</strong><small>{order.customer_email}<br/>{order.customer_phone}</small></td><td>{new Date(`${order.pickup_date}T12:00:00`).toLocaleDateString("pt-BR")}<small>{order.pickup_time.slice(0,5)}</small></td><td><strong>{money.format(Number(order.total))}</strong><small>{order.order_items.reduce((sum,item)=>sum+item.quantity,0)} item(ns)</small></td><td><select className={`order-status-select ${order.status}`} value={order.status} onChange={(event)=>onStatus(order,event.target.value as OrderStatus)}>{orderStatuses.map((value)=><option key={value} value={value}>{orderStatusLabel[value]}</option>)}</select></td><td><button className="view-order" onClick={()=>onSelect(order)} aria-label={`Ver pedido ${order.order_number}`}><Eye/></button></td></tr>)}</tbody></table>{visible.length===0&&<p className="admin-empty">Nenhum pedido neste status.</p>}</div></>;
}

function CustomersSection({ customers, orders, onRefresh }: { customers:CustomerProfile[]; orders:CustomerOrder[]; onRefresh:()=>void }) {
  const customersWithOrders = customers.filter((customer)=>customer.role === "customer").map((customer)=>{ const customerOrders=orders.filter((order)=>order.user_id===customer.id); return { customer, orders:customerOrders, total:customerOrders.reduce((sum,order)=>sum+Number(order.total),0), last:customerOrders[0]?.created_at }; });
  return <><header><div><p>Relacionamento</p><h1>Clientes</h1></div><button className="secondary-action" onClick={onRefresh}><RefreshCw/> Atualizar</button></header><div className="admin-stats"><div><span>Cadastrados</span><b>{customersWithOrders.length}</b></div><div><span>Com pedidos</span><b>{customersWithOrders.filter(item=>item.orders.length>0).length}</b></div><div><span>Pedidos</span><b>{orders.length}</b></div><div><span>Receita histórica</span><b className="stat-money">{money.format(orders.filter(o=>o.status!=="canceled").reduce((sum,o)=>sum+Number(o.total),0))}</b></div></div><div className="admin-table-wrap"><table className="admin-table customers-table"><thead><tr><th>Cliente</th><th>Contato</th><th>Pedidos</th><th>Total histórico</th><th>Último pedido</th></tr></thead><tbody>{customersWithOrders.map(({customer,orders:customerOrders,total,last})=><tr key={customer.id}><td><strong>{customer.full_name || "Nome não informado"}</strong><small>Desde {new Date(customer.created_at).toLocaleDateString("pt-BR")}</small></td><td>{customer.email}<small>{customer.phone || "Telefone não informado"}</small></td><td><strong>{customerOrders.length}</strong></td><td><strong>{money.format(total)}</strong></td><td>{last ? dateTime.format(new Date(last)) : "Sem pedidos"}</td></tr>)}</tbody></table>{customersWithOrders.length===0&&<p className="admin-empty">Nenhum cliente cadastrado.</p>}</div></>;
}

function AdminsSection({ admins, currentUserId, onRefresh, onCreate, onReset, onRemove }: { admins:CustomerProfile[]; currentUserId:string; onRefresh:()=>void; onCreate:()=>void; onReset:(admin:CustomerProfile)=>void; onRemove:(admin:CustomerProfile)=>void }) {
  return <><header><div><p>Controle de acesso</p><h1>Administradores</h1></div><button className="primary-button" onClick={onCreate}><UserPlus/> Novo administrador</button></header><div className="admin-stats admin-access-stats"><div><span>Acessos ativos</span><b>{admins.length}</b></div><div><span>Sua conta</span><b>1</b></div><div><span>Outros gestores</span><b>{Math.max(0,admins.length-1)}</b></div></div><div className="admin-toolbar admin-access-toolbar"><p>Somente administradores podem criar, alterar senha ou remover outros acessos.</p><button onClick={onRefresh} aria-label="Atualizar"><RefreshCw/></button></div><div className="admin-table-wrap"><table className="admin-table customers-table"><thead><tr><th>Administrador</th><th>Conta criada em</th><th>Status</th><th aria-label="Ações"/></tr></thead><tbody>{admins.map((admin)=><tr key={admin.id}><td><strong>{admin.full_name || admin.email || "Administrador"}</strong><small>{admin.email || "E-mail não informado"}</small></td><td>{new Date(admin.created_at).toLocaleDateString("pt-BR")}</td><td><span className="admin-access-badge">{admin.id===currentUserId?"Sua conta":"Ativo"}</span></td><td><div className="row-actions"><button onClick={()=>onReset(admin)} aria-label={`Alterar senha de ${admin.email}`} title="Definir senha temporária"><KeyRound/></button><button onClick={()=>onRemove(admin)} aria-label={`Remover ${admin.email}`} title={admin.id===currentUserId?"Você não pode remover a própria conta":"Remover acesso"} disabled={admin.id===currentUserId}><Trash2/></button></div></td></tr>)}</tbody></table>{admins.length===0&&<p className="admin-empty">Nenhum administrador encontrado.</p>}</div></>;
}

function OrderDetail({ order, onClose, onStatus }: { order:CustomerOrder; onClose:()=>void; onStatus:(status:OrderStatus)=>void }) {
  return <div className="admin-form-overlay"><div className="order-detail"><div className="form-head"><div><small>PEDIDO</small><h2>#{order.order_number}</h2></div><button onClick={onClose} aria-label="Fechar"><X/></button></div><div className="order-detail-body"><section><h3>Cliente e retirada</h3><p><b>{order.customer_name}</b><br/>{order.customer_email}<br/>{order.customer_phone}</p><p>Retirada: <b>{new Date(`${order.pickup_date}T12:00:00`).toLocaleDateString("pt-BR")} às {order.pickup_time.slice(0,5)}</b></p>{order.notes&&<p>Observações: {order.notes}</p>}</section><section><h3>Itens</h3>{order.order_items.map((item)=><div className="order-detail-item" key={item.id}><img src={assetUrl(item.image_url)} alt=""/><span><b>{item.product_name}</b><small>{item.quantity} × {money.format(Number(item.unit_price))}</small></span><strong>{money.format(Number(item.line_total))}</strong></div>)}<div className="order-detail-total"><span>Total</span><strong>{money.format(Number(order.total))}</strong></div></section><section><h3>Histórico</h3><div className="admin-timeline">{order.order_status_history.map((entry)=><div key={entry.id}><i/><span><b>{orderStatusLabel[entry.status]}</b><small>{dateTime.format(new Date(entry.created_at))}{entry.note?` • ${entry.note}`:""}</small></span></div>)}</div></section></div><div className="form-footer"><select value={order.status} onChange={(event)=>onStatus(event.target.value as OrderStatus)}>{orderStatuses.map((value)=><option key={value} value={value}>{orderStatusLabel[value]}</option>)}</select><button type="button" onClick={onClose}>Fechar</button></div></div></div>;
}

function PasswordForm({ onClose, onSave }: { onClose:()=>void; onSave:(e:React.FormEvent<HTMLFormElement>)=>void }) {
  return <div className="admin-form-overlay password-overlay"><form className="password-form" onSubmit={onSave}><div className="form-head"><div><small>MINHA CONTA</small><h2>Alterar senha</h2></div><button type="button" onClick={onClose} aria-label="Fechar"><X/></button></div><div className="password-fields"><label>Nova senha<input name="password" type="password" minLength={8} required autoComplete="new-password"/></label><label>Confirmar nova senha<input name="confirmation" type="password" minLength={8} required autoComplete="new-password"/></label><small>Use pelo menos 8 caracteres.</small></div><div className="form-footer"><button type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit">Salvar nova senha</button></div></form></div>;
}

function CreateAdminForm({ feedback, busy, onClose, onSave }: { feedback:{type:"ok"|"error";text:string}|null; busy:boolean; onClose:()=>void; onSave:(e:React.FormEvent<HTMLFormElement>)=>void }) {
  return <div className="admin-form-overlay password-overlay"><form className="password-form" onSubmit={onSave}><div className="form-head"><div><small>ACESSOS</small><h2>Novo administrador</h2></div><button type="button" onClick={onClose} aria-label="Fechar" disabled={busy}><X/></button></div><div className="password-fields"><label>E-mail da pessoa<input name="email" type="email" required autoComplete="off" disabled={busy}/></label><label>Senha temporária<input name="password" type="password" minLength={8} required autoComplete="new-password" disabled={busy}/></label><label>Confirmar senha<input name="confirmation" type="password" minLength={8} required autoComplete="new-password" disabled={busy}/></label><small>A pessoa poderá entrar, gerenciar produtos e trocar a própria senha.</small>{feedback&&<AdminMessage message={feedback}/>}</div><div className="form-footer"><button type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="primary-button" type="submit" disabled={busy}>{busy?"Criando acesso…":"Criar administrador"}</button></div></form></div>;
}

function ProductForm({ product, setProduct, onClose, onSave, onMessage }: { product: Partial<WineProduct>; setProduct: (p: Partial<WineProduct>)=>void; onClose:()=>void; onSave:(e:React.FormEvent<HTMLFormElement>)=>void; onMessage:(m:{type:"ok"|"error";text:string})=>void }) {
  const set=(key:keyof WineProduct,value:unknown)=>setProduct({...product,[key]:value});
  async function upload(file:File){ if(!supabase)return; const ext=file.name.split('.').pop(); const path=`${crypto.randomUUID()}.${ext}`; const {error}=await supabase.storage.from("product-images").upload(path,file,{upsert:false}); if(error){onMessage({type:"error",text:"Falha no upload da imagem."});return;} const {data}=supabase.storage.from("product-images").getPublicUrl(path); set("image_url",data.publicUrl); }
  return <div className="admin-form-overlay"><form className="product-form" onSubmit={onSave}><div className="form-head"><div><small>{product.id?"EDIÇÃO":"NOVO PRODUTO"}</small><h2>{product.name||"Cadastrar vinho"}</h2></div><button type="button" onClick={onClose}><X/></button></div><div className="form-scroll"><section><h3>Informações principais</h3><div className="form-grid"><Field label="Nome *" value={product.name} onChange={v=>{set("name",v);if(!product.id)set("slug",v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""))}}/><Field label="Slug *" value={product.slug} onChange={v=>set("slug",v)}/><Field label="Vinícola ou produtor" value={product.producer} onChange={v=>set("producer",v)}/><Field label="País" value={product.country} onChange={v=>set("country",v)}/><Field label="Região" value={product.region} onChange={v=>set("region",v)}/><Field label="Tipo" value={product.type} onChange={v=>set("type",v)}/><Field label="Uva" value={product.grape} onChange={v=>set("grape",v)}/><Field label="Composição de uvas" value={product.grape_composition} onChange={v=>set("grape_composition",v)}/><Field label="Safra" type="number" value={product.vintage} onChange={v=>set("vintage",v?Number(v):null)}/><Field label="Volume" value={product.volume} onChange={v=>set("volume",v)}/><Field label="Teor alcoólico" value={product.alcohol_content} onChange={v=>set("alcohol_content",v)}/><Field label="Classificação" value={product.classification} onChange={v=>set("classification",v)}/><Field label="Temperatura de serviço" value={product.service_temperature} onChange={v=>set("service_temperature",v)}/></div></section><section><h3>Descrição e harmonização</h3><label>Descrição<textarea rows={4} value={product.description??""} onChange={e=>set("description",e.target.value)}/></label><label>Harmonização<textarea rows={3} value={product.pairing??""} onChange={e=>set("pairing",e.target.value)}/></label><label>Fonte das informações<textarea rows={2} value={product.information_source??""} onChange={e=>set("information_source",e.target.value)}/></label></section><section><h3>Preço, estoque e imagem</h3><div className="form-grid"><Field label="Preço normal *" type="number" step="0.01" value={product.normal_price} onChange={v=>set("normal_price",Number(v))}/><Field label="Preço promocional" type="number" step="0.01" value={product.promotional_price} onChange={v=>set("promotional_price",v?Number(v):null)}/><Field label="Quantidade disponível" type="number" value={product.quantity_available} onChange={v=>set("quantity_available",v===""?null:Number(v))}/><Field label="URL da imagem" value={product.image_url} onChange={v=>set("image_url",v)}/></div><label className="upload-box"><ImageUp/> Enviar nova imagem<input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/></label>{product.image_url&&<img className="form-image" src={assetUrl(product.image_url)} alt="Prévia"/>}</section><section><h3>Visibilidade</h3><div className="form-checks">{[["active","Produto ativo"],["featured","Produto em destaque"],["low_stock","Poucas unidades"],["pending_review","Pendente de revisão"]].map(([key,label])=><label key={key}><input type="checkbox" checked={Boolean(product[key as keyof WineProduct])} onChange={e=>set(key as keyof WineProduct,e.target.checked)}/><span/>{label}</label>)}</div></section></div><div className="form-footer"><button type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit">Salvar produto</button></div></form></div>;
}
function Field({label,value,onChange,type="text",step}:{label:string;value:unknown;onChange:(v:string)=>void;type?:string;step?:string}){return <label>{label}<input type={type} step={step} value={value===null||value===undefined?"":String(value)} onChange={e=>onChange(e.target.value)}/></label>}
