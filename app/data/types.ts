export type WineProduct = {
  id: string;
  name: string;
  slug: string;
  producer: string | null;
  country: string | null;
  region: string | null;
  type: string | null;
  grape: string | null;
  grape_composition: string | null;
  vintage: number | null;
  volume: string | null;
  alcohol_content: string | null;
  classification: string | null;
  description: string | null;
  pairing: string | null;
  service_temperature: string | null;
  normal_price: number;
  promotional_price: number | null;
  quantity_available: number | null;
  image_url: string | null;
  featured: boolean;
  active: boolean;
  low_stock: boolean;
  pending_review: boolean;
  information_source: string | null;
  created_at: string;
  updated_at: string;
};

export type CartItem = { product: WineProduct; quantity: number };

export type CustomerProfile = {
  id: string;
  role: "customer" | "manager" | "admin" | "master";
  email: string | null;
  full_name: string | null;
  phone: string | null;
  created_at: string;
  updated_at: string;
};

export type OrderStatus = "pending" | "confirmed" | "preparing" | "ready" | "delivered" | "canceled";

export type OrderItem = {
  id: string;
  order_id: string;
  product_id: string | null;
  product_name: string;
  image_url: string | null;
  unit_price: number;
  quantity: number;
  line_total: number;
  created_at: string;
};

export type OrderStatusHistory = {
  id: string;
  order_id: string;
  status: OrderStatus;
  note: string | null;
  changed_by: string | null;
  created_at: string;
};

export type CustomerOrder = {
  id: string;
  order_number: number;
  user_id: string;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  pickup_date: string;
  pickup_time: string;
  notes: string | null;
  status: OrderStatus;
  subtotal: number;
  total: number;
  email_sent_at: string | null;
  confirmed_at: string | null;
  delivered_at: string | null;
  created_at: string;
  updated_at: string;
  order_items: OrderItem[];
  order_status_history: OrderStatusHistory[];
};
