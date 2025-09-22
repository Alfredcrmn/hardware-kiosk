// pages/api/get.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { skus } = (req.body || {}) as { skus?: string[] };
  if (!Array.isArray(skus) || skus.length === 0) return res.status(400).json({ error: "skus[] required" });

  const { data, error } = await supabaseAdmin
    .from("products")
    .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url,specs")
    .in("sku", skus);

  if (error) return res.status(500).json({ error: error.message });

  const bySku = new Map((data || []).map((p) => [p.sku, p]));
  const ordered = skus.map((s) => bySku.get(s)).filter(Boolean);
  return res.json({ products: ordered });
}