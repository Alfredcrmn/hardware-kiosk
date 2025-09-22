// pages/api/check-supabase.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { supabaseAdmin } from "@/lib/supabase";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    // Quick ping: count rows without fetching data
    const { count, error } = await supabaseAdmin
      .from("products")
      .select("*", { count: "exact", head: true });

    if (error) return res.status(500).json({ ok: false, where: "select", error: error.message });

    return res.status(200).json({ ok: true, table: "products", count });
  } catch (e: any) {
    return res.status(500).json({ ok: false, where: "catch", error: e?.message || String(e) });
  }
}