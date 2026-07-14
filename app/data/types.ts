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

