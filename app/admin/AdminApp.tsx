"use client";

import { useEffect, useMemo, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { ArrowLeft, CircleAlert, Edit3, ImageUp, LogOut, Package, Plus, RefreshCw, Search, Trash2, Wine, X } from "lucide-react";
import { STORE_CONFIG } from "../data/store-config";
import type { WineProduct } from "../data/types";
import { hasSupabaseConfig, supabase } from "../lib/supabase";
import { sitePath } from "../lib/paths";

const blank: Partial<WineProduct> = { name: "", slug: "", producer: "", country: "", region: "", type: "", grape: "", grape_composition: "", vintage: null, volume: "750 ml", alcohol_content: "", classification: "", description: "", pairing: "", service_temperature: "", normal_price: 0, promotional_price: null, quantity_available: null, image_url: "", featured: false, active: true, low_stock: false, pending_review: false, information_source: "" };
const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

export default function AdminApp() {
  const [session, setSession] = useState<Session | null>(null);
  const [products, setProducts] = useState<WineProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [editing, setEditing] = useState<Partial<WineProduct> | null>(null);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!supabase) { setLoading(false); return; }
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);
  useEffect(() => { if (session) loadProducts(); }, [session]);

  async function loadProducts() {
    if (!supabase) return; setLoading(true);
    const { data, error } = await supabase.from("products").select("*").order("updated_at", { ascending: false });
    if (error) setMessage({ type: "error", text: "Não foi possível carregar os produtos. Verifique seu acesso administrativo." });
    else setProducts((data ?? []) as WineProduct[]);
    setLoading(false);
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
  const visible = useMemo(() => products.filter((p) => {
    const search = `${p.name} ${p.producer} ${p.country} ${p.grape}`.toLowerCase();
    const statusMatch = status === "all" || (status === "inactive" && !p.active) || (status === "low" && p.low_stock) || (status === "review" && p.pending_review) || (status === "unavailable" && p.quantity_available === 0);
    return search.includes(query.toLowerCase()) && statusMatch;
  }), [products, query, status]);

  if (!hasSupabaseConfig) return <AdminGate><CircleAlert size={34}/><h1>Conecte o Supabase</h1><p>A área administrativa está pronta, mas precisa das variáveis públicas do seu projeto Supabase para autenticar e carregar os produtos.</p><code>VITE_SUPABASE_URL<br/>VITE_SUPABASE_ANON_KEY</code><a href={sitePath("/")}>Voltar à loja</a></AdminGate>;
  if (loading && !session) return <AdminGate><RefreshCw className="spin"/><p>Carregando área segura…</p></AdminGate>;
  if (!session) return <AdminGate><div className="admin-logo"><Wine/> OLI <span>ADMIN</span></div><h1>Bem-vindo de volta</h1><p>Entre com o e-mail e a senha cadastrados no Supabase Auth.</p><form className="login-form" onSubmit={login}><label>E-mail<input type="email" name="email" required autoComplete="email"/></label><label>Senha<input type="password" name="password" required autoComplete="current-password"/></label>{message && <AdminMessage message={message}/>}<button className="primary-button wide" type="submit">Entrar</button></form><a href={sitePath("/")}><ArrowLeft size={15}/> Voltar à loja</a></AdminGate>;

  return <div className="admin-shell"><aside className="admin-nav"><div className="admin-logo"><Wine/> OLI <span>ADMIN</span></div><nav><a className="active"><Package/> Produtos</a><a href="/" target="_blank"><Wine/> Ver loja</a></nav><div className="admin-user"><small>Conectado como</small><span>{session.user.email}</span><button onClick={() => supabase?.auth.signOut()}><LogOut/> Sair</button></div></aside><main className="admin-main"><header><div><p>{STORE_CONFIG.name}</p><h1>Produtos</h1></div><button className="primary-button" onClick={() => setEditing({ ...blank })}><Plus/> Novo produto</button></header><div className="admin-stats"><div><span>Total</span><b>{products.length}</b></div><div><span>Ativos</span><b>{products.filter(p=>p.active).length}</b></div><div><span>Sem estoque</span><b>{products.filter(p=>p.quantity_available===0).length}</b></div><div><span>Pendentes</span><b>{products.filter(p=>p.pending_review).length}</b></div></div>{message && <AdminMessage message={message}/>}<div className="admin-toolbar"><label><Search/><input placeholder="Pesquisar produtos" value={query} onChange={(e)=>setQuery(e.target.value)}/></label><select value={status} onChange={(e)=>setStatus(e.target.value)}><option value="all">Todos os produtos</option><option value="inactive">Inativos</option><option value="unavailable">Indisponíveis</option><option value="low">Poucas unidades</option><option value="review">Pendentes de revisão</option></select><button onClick={loadProducts} aria-label="Atualizar"><RefreshCw/></button></div>{loading ? <div className="admin-loading">Carregando produtos…</div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Produto</th><th>Tipo / Origem</th><th>Preço</th><th>Estoque</th><th>Status</th><th aria-label="Ações"/></tr></thead><tbody>{visible.map(p=><tr key={p.id}><td><div className="admin-product"><img src={p.image_url??""} alt=""/><div><strong>{p.name}</strong><small>{p.producer} • {p.vintage??"Sem safra"}</small></div></div></td><td>{p.type}<small>{[p.region,p.country].filter(Boolean).join(", ")}</small></td><td>{p.promotional_price&&<del>{money.format(p.normal_price)}</del>}<strong>{money.format(p.promotional_price??p.normal_price)}</strong></td><td>{p.quantity_available===null?"Não informado":p.quantity_available}</td><td><button className={`status-pill ${p.active?"on":"off"}`} onClick={()=>toggleProduct(p)}>{p.active?"Ativo":"Inativo"}</button>{p.pending_review&&<small className="review">Revisar</small>}</td><td><div className="row-actions"><button onClick={()=>setEditing({...p})} aria-label="Editar"><Edit3/></button><button onClick={()=>removeProduct(p)} aria-label="Excluir"><Trash2/></button></div></td></tr>)}</tbody></table>{visible.length===0&&<p className="admin-empty">Nenhum produto nesta visualização.</p>}</div>}</main>{editing&&<ProductForm product={editing} setProduct={setEditing} onClose={()=>setEditing(null)} onSave={saveProduct} onMessage={setMessage}/>}</div>;
}
function AdminGate({ children }: { children: React.ReactNode }) { return <main className="admin-gate">{children}</main>; }
function AdminMessage({ message }: { message: { type: "ok"|"error"; text:string } }) { return <div className={`admin-message ${message.type}`}><CircleAlert/>{message.text}</div>; }

function ProductForm({ product, setProduct, onClose, onSave, onMessage }: { product: Partial<WineProduct>; setProduct: (p: Partial<WineProduct>)=>void; onClose:()=>void; onSave:(e:React.FormEvent<HTMLFormElement>)=>void; onMessage:(m:{type:"ok"|"error";text:string})=>void }) {
  const set=(key:keyof WineProduct,value:unknown)=>setProduct({...product,[key]:value});
  async function upload(file:File){ if(!supabase)return; const ext=file.name.split('.').pop(); const path=`${crypto.randomUUID()}.${ext}`; const {error}=await supabase.storage.from("product-images").upload(path,file,{upsert:false}); if(error){onMessage({type:"error",text:"Falha no upload da imagem."});return;} const {data}=supabase.storage.from("product-images").getPublicUrl(path); set("image_url",data.publicUrl); }
  return <div className="admin-form-overlay"><form className="product-form" onSubmit={onSave}><div className="form-head"><div><small>{product.id?"EDIÇÃO":"NOVO PRODUTO"}</small><h2>{product.name||"Cadastrar vinho"}</h2></div><button type="button" onClick={onClose}><X/></button></div><div className="form-scroll"><section><h3>Informações principais</h3><div className="form-grid"><Field label="Nome *" value={product.name} onChange={v=>{set("name",v);if(!product.id)set("slug",v.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g,"").replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,""))}}/><Field label="Slug *" value={product.slug} onChange={v=>set("slug",v)}/><Field label="Vinícola ou produtor" value={product.producer} onChange={v=>set("producer",v)}/><Field label="País" value={product.country} onChange={v=>set("country",v)}/><Field label="Região" value={product.region} onChange={v=>set("region",v)}/><Field label="Tipo" value={product.type} onChange={v=>set("type",v)}/><Field label="Uva" value={product.grape} onChange={v=>set("grape",v)}/><Field label="Composição de uvas" value={product.grape_composition} onChange={v=>set("grape_composition",v)}/><Field label="Safra" type="number" value={product.vintage} onChange={v=>set("vintage",v?Number(v):null)}/><Field label="Volume" value={product.volume} onChange={v=>set("volume",v)}/><Field label="Teor alcoólico" value={product.alcohol_content} onChange={v=>set("alcohol_content",v)}/><Field label="Classificação" value={product.classification} onChange={v=>set("classification",v)}/><Field label="Temperatura de serviço" value={product.service_temperature} onChange={v=>set("service_temperature",v)}/></div></section><section><h3>Descrição e harmonização</h3><label>Descrição<textarea rows={4} value={product.description??""} onChange={e=>set("description",e.target.value)}/></label><label>Harmonização<textarea rows={3} value={product.pairing??""} onChange={e=>set("pairing",e.target.value)}/></label><label>Fonte das informações<textarea rows={2} value={product.information_source??""} onChange={e=>set("information_source",e.target.value)}/></label></section><section><h3>Preço, estoque e imagem</h3><div className="form-grid"><Field label="Preço normal *" type="number" step="0.01" value={product.normal_price} onChange={v=>set("normal_price",Number(v))}/><Field label="Preço promocional" type="number" step="0.01" value={product.promotional_price} onChange={v=>set("promotional_price",v?Number(v):null)}/><Field label="Quantidade disponível" type="number" value={product.quantity_available} onChange={v=>set("quantity_available",v===""?null:Number(v))}/><Field label="URL da imagem" value={product.image_url} onChange={v=>set("image_url",v)}/></div><label className="upload-box"><ImageUp/> Enviar nova imagem<input type="file" accept="image/*" onChange={e=>e.target.files?.[0]&&upload(e.target.files[0])}/></label>{product.image_url&&<img className="form-image" src={product.image_url} alt="Prévia"/>}</section><section><h3>Visibilidade</h3><div className="form-checks">{[["active","Produto ativo"],["featured","Produto em destaque"],["low_stock","Poucas unidades"],["pending_review","Pendente de revisão"]].map(([key,label])=><label key={key}><input type="checkbox" checked={Boolean(product[key as keyof WineProduct])} onChange={e=>set(key as keyof WineProduct,e.target.checked)}/><span/>{label}</label>)}</div></section></div><div className="form-footer"><button type="button" onClick={onClose}>Cancelar</button><button className="primary-button" type="submit">Salvar produto</button></div></form></div>;
}
function Field({label,value,onChange,type="text",step}:{label:string;value:unknown;onChange:(v:string)=>void;type?:string;step?:string}){return <label>{label}<input type={type} step={step} value={value===null||value===undefined?"":String(value)} onChange={e=>onChange(e.target.value)}/></label>}
