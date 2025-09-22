// pages/api/search.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { q } = (req.body || {}) as { q?: string };
  if (!q || typeof q !== "string") return res.status(400).json({ error: "q required" });

  // Keyword search across products + synonyms
  const { data: products, error } = await supabaseAdmin
    .from("products")
    .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
    .or(`name.ilike.%${q}%,description.ilike.%${q}%,category.ilike.%${q}%,subcategory.ilike.%${q}%`)
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });

  const { data: syns } = await supabaseAdmin
    .from("synonyms")
    .select("product_sku,term")
    .ilike("term", `%${q}%`);

  const synSkus = new Set((syns || []).map((s) => s.product_sku));
  let synProducts: any[] = [];
  if (synSkus.size) {
    const { data } = await supabaseAdmin
      .from("products")
      .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
      .in("sku", Array.from(synSkus));
    synProducts = data || [];
  }

  const map = new Map<string, any>();
  [...(products || []), ...synProducts].forEach((p) => map.set(p.sku, p));

  return res.json({ candidates: Array.from(map.values()) });
}