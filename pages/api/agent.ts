// pages/api/agent.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { supabaseAdmin } from "@/lib/supabase";

/**
 * Conversational kiosk agent (Gemini) with:
 * - history awareness
 * - client cart preservation (unless user asks to change/remove)
 * - add intent for follow-ups like "sí, agrégalo / dámelo / teflón"
 * - strong replace intent (“mejor…”, “prefiero…”, “cámbialo por…”)
 * - candidate filtering (no invented SKUs)
 * - server-side merge guards + keyword fallback for replace turns
 *
 * Returns: { content: stringifiedJSON({ plan, reply }) }
 *   plan = { title, steps[], basket[], upsell[], confirm }
 *   reply = natural chat response (may include **bold**)
 */
const SYSTEM_PROMPT = `Eres un asistente de kiosko para ferretería.

REGLAS:
- Mantén una conversación breve y clara en español.
- Usa SOLO productos en CANDIDATES (no inventes SKUs).
- CLIENT_CART: si el usuario NO pide cambios, respeta y conserva su canasta y cantidades.
- REEMPLAZO: si el usuario expresa cambio explícito (p. ej., “mejor”, “prefiero”, “cámbialo por”, “en lugar de”), ACTUALIZA la canasta acorde y **no** conserves los ítems reemplazados.
- Si el mejor producto no tiene stock, adviértelo explícitamente y ofrece una alternativa EN STOCK.
- Devuelve SIEMPRE un JSON con:
  {
    "plan": { "title": string, "steps": string[3-5],
              "basket": [ { "sku": string, "name": string, "qty": number, "price": number, "currency": string, "stock": number, "image_url": string, "why": string } ],
              "upsell":  [ { "sku": string, "name": string, "qty": number, "price": number, "currency": string, "stock": number, "image_url": string, "why": string } ],
              "confirm": string },
    "reply": string
  }
- "reply" es un mensaje natural (máx. 2 frases), con **negritas** para nombres/cantidades. Si la charla va cerrando (p.ej., el usuario dice “no”, “eso es todo”), indícale: “Pulsa **Confirmar e imprimir** para finalizar.”`;

function normalizeQuery(q: string) {
  const s = (q || "").toLowerCase();
  const t: string[] = [];
  if (s.includes("pvc")) t.push("pvc");
  if (s.includes("cpvc")) t.push("cpvc");
  if (s.includes("cobre")) t.push("cobre");
  if (s.includes("pex")) t.push("pex");
  if (s.includes("tablaroca") || s.includes("drywall")) t.push("tablaroca");
  if (s.includes("madera")) t.push("madera");
  const frac = s.match(/\b(\d+\s*\/\s*\d+)\b/);
  if (frac) t.push(frac[1].replace(/\s+/g, ""));
  if (s.includes("media")) t.push("1/2");
  if (s.includes("tres cuartos")) t.push("3/4");
  if (s.includes("un cuarto") || s.includes("cuarto")) t.push("1/4");
  if (s.includes("tres octavos")) t.push("3/8");
  if (s.includes("cinco octavos")) t.push("5/8");
  if (s.includes("una pulgada") || s.includes("1 pulgada") || s.includes('1"')) t.push('1"');
  if (s.includes("media pulgada")) t.push("1/2");
  const compact = Array.from(new Set(t)).join(" ").trim();
  return compact || q;
}

/** Make a safe ILIKE needle for PostgREST .or() (commas/parens break the parser) */
function likeNeedle(val: string) {
  const s = String(val ?? "")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `%${s}%`;
}

type Msg = { role: "user" | "assistant"; text: string };
type CartItem = { sku: string; qty?: number };

// intents
function endIntent(text: string) {
  const s = (text || "").toLowerCase().trim();
  return /^(no|no gracias|eso es todo|listo|estoy bien|nada mas|nada más)\.?$/.test(s);
}
function replaceIntent(text: string) {
  const s = (text || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return /(mejor|prefiero|cambial|cambia|en lugar de|en vez de|mejor pon|mejor usa)\b/.test(s);
}
function removeIntent(text: string) {
  const s = (text || "").toLowerCase();
  return /(quita|remueve|borra|elimina|saca)\b|sin\b/.test(s);
}
function addIntent(text: string) {
  const s = (text || "").toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
  // accept/confirm/add verbs and short affirmations
  return /\b(si|agrega|agregalo|anade|ponlo|sumalo|dame|me lo llevo|tambien|incluyelo|mete)\b/.test(s);
}

// Keyword fallback to pick items when model fails to add them
function pickByKeywords(q: string, qNorm: string, candidates: any[], max = 3) {
  const text = (q + " " + qNorm).toLowerCase();
  const keywords = [
    ["union", "unión", "roscada"],
    ["teflon", "teflón", "ptf", "ptfe", "cinta"],
    ["cople", "acople", "empalme"],
    ["cortatubo", "corta tubo"],
    ["repuesto", "disco", "cuchilla"],
    ["pegamento", "cemento", "adhesivo", "pvc"],
    ["primer", "limpiador"],
  ];
  const scored = candidates.map((c: any) => {
    const hay = (
      (c.name || "") +
      " " +
      (c.description || "") +
      " " +
      (c.category || "") +
      " " +
      (c.subcategory || "")
    ).toLowerCase();
    let score = 0;
    for (const group of keywords) {
      const inQ = group.some((k) => text.includes(k));
      const inC = group.some((k) => hay.includes(k));
      if (inQ && inC) score += 2;
    }
    if (Number(c.stock) > 0) score += 1; // prefer in-stock
    return { c, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ c }) => c);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") return res.status(405).end();
  const { q, history, cart } = (req.body || {}) as { q?: string; history?: Msg[]; cart?: CartItem[] };
  if (!q) return res.status(400).json({ error: "q required" });

  try {
    const qNorm = normalizeQuery(q);
    const isReplace = replaceIntent(q);
    const isAdd = addIntent(q);

    // --- Search candidates (original + normalized), plus token search
    const q1 = likeNeedle(q);
    const q2 = likeNeedle(qNorm);

    // 1a) full-phrase search
    const { data: p1, error: e1 } = await supabaseAdmin
      .from("products")
      .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
      .or(`name.ilike.${q1},description.ilike.${q1},category.ilike.${q1},subcategory.ilike.${q1}`)
      .limit(50);
    if (e1) return res.status(500).json({ error: e1.message });

    const { data: p2, error: e2 } = await supabaseAdmin
      .from("products")
      .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
      .or(`name.ilike.${q2},description.ilike.${q2},category.ilike.${q2},subcategory.ilike.${q2}`)
      .limit(50);
    if (e2) return res.status(500).json({ error: e2.message });

    // 1b) token search (pulls spare/teflon/etc into candidates)
    const tokenList = Array.from(
      new Set(
        (q.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "")
           .replace(/[^a-z0-9\s]/g, " ")
           .split(/\s+/)
           .filter(w => w.length >= 3))
      )
    );
    const tokenWhitelist = ["repuesto","disco","cuchilla","cortatubo","corta","tubo","teflon","ptfe","union","roscada","cople","pvc","cobre"];
    const tokens = tokenList.filter(t => tokenWhitelist.includes(t));

    let p3: any[] = [];
    if (tokens.length) {
      const ors: string[] = [];
      for (const t of tokens) {
        const needle = `%${t}%`;
        ors.push(`name.ilike.${needle}`, `description.ilike.${needle}`, `category.ilike.${needle}`, `subcategory.ilike.${needle}`);
      }
      const { data: p3res, error: e3 } = await supabaseAdmin
        .from("products")
        .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
        .or(ors.join(","))
        .limit(50);
      if (e3) return res.status(500).json({ error: e3.message });
      p3 = p3res || [];
    }

    // --- Synonyms
    const { data: syns } = await supabaseAdmin
      .from("synonyms")
      .select("product_sku,term")
      .or(`term.ilike.${q1},term.ilike.${q2}`);

    // Build candidates map
    const bySku = new Map<string, any>();
    [...(p1 || []), ...(p2 || []), ...p3].forEach((p) => bySku.set(p.sku, p));

    if (syns?.length) {
      const synSkuList = Array.from(new Set(syns.map((s) => s.product_sku)));
      if (synSkuList.length) {
        const { data: synProducts } = await supabaseAdmin
          .from("products")
          .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
          .in("sku", synSkuList);
        (synProducts || []).forEach((p) => bySku.set(p.sku, p));
      }
    }

    // include current cart SKUs
    const cartSkuList = Array.from(new Set((cart || []).map((c) => c.sku)));
    if (cartSkuList.length) {
      const { data: cartProducts } = await supabaseAdmin
        .from("products")
        .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
        .in("sku", cartSkuList);
      (cartProducts || []).forEach((p) => bySku.set(p.sku, p));
    }

    const candidates = Array.from(bySku.values());
    const candidateSkus = new Set(candidates.map((c) => c.sku));

    // end intent shortcut
    if (endIntent(q)) {
      return res.status(200).json({
        content: JSON.stringify({
          plan: { title: "", steps: [], basket: [], upsell: [], confirm: "Pulsa **Confirmar e imprimir** para finalizar." },
          reply: "Perfecto. Pulsa **Confirmar e imprimir** para terminar. ¡Éxitos con tu proyecto!",
        }),
      });
    }

    // conversation context
    const turns = (history || []).slice(-8);
    const convo = turns.map((t) => `${t.role === "user" ? "Usuario" : "Asistente"}: ${t.text}`).join("\n");

    // cart qty map
    const cartBySku = new Map<string, number>();
    (cart || []).forEach((ci) => cartBySku.set(ci.sku, Math.max(1, Number(ci.qty || 1))));

    // call Gemini
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: process.env.LLM_MODEL || "gemini-1.5-flash" });

    const prompt =
      `${SYSTEM_PROMPT}\n\n` +
      (convo ? `CONVERSACIÓN:\n${convo}\n\n` : "") +
      `MENSAJE ACTUAL:\n${q}\n\n` +
      `INTENCIÓN: ${isReplace ? "REEMPLAZO" : isAdd ? "AGREGAR" : "NORMAL"}\n` +
      `CLIENT_CART (respeta cantidades; no elimines sin instrucción explícita):\n${JSON.stringify(cart || [])}\n\n` +
      `CANDIDATES (usa solo estos):\n${JSON.stringify(candidates)}\n\n` +
      `Responde SOLO con JSON { "plan": {...}, "reply": "..." }`;

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.35, responseMimeType: "application/json" },
    });

    // parse model JSON
    let parsed: any;
    try {
      parsed = JSON.parse(result.response.text());
    } catch {
      return res.status(200).json({
        content: JSON.stringify({
          plan: { title: "", steps: [], basket: [], upsell: [], confirm: "¿Deseas confirmar ahora?" },
          reply: "Tengo una sugerencia lista. ¿Deseas confirmar ahora?",
        }),
      });
    }

    // server-side validation/merge
    const plan = parsed?.plan || {};
    let reply: string = parsed?.reply || "Listo. ¿Algo más?";

    function filterToCandidates(arr: any[]) {
      return (Array.isArray(arr) ? arr : []).filter((x) => x && candidateSkus.has(x.sku));
    }
    plan.basket = filterToCandidates(plan.basket);
    plan.upsell = filterToCandidates(plan.upsell);

    // prefer client qty if present
    for (const it of plan.basket) {
      const cartQty = cartBySku.get(it.sku);
      it.qty = Math.max(1, Number(cartQty ?? it.qty ?? 1));
    }

    const userWantsRemoval = removeIntent(q);

    // --- ADD PATH: keep cart and append requested accessory(s) ---
    if (isAdd) {
      const wantsSpare = /repuesto|disco|cuchilla/i.test(q);
      const wantsTeflon = /tefl[oó]n|ptfe|ptf/i.test(q);

      const ensured: any[] = [];

      // keep model-added items (that are valid candidates)
      for (const it of Array.isArray(plan.basket) ? plan.basket : []) {
        if (candidateSkus.has(it.sku)) ensured.push(it);
      }
      // re-add client cart items (preserve qty)
      for (const [sku, qty] of cartBySku.entries()) {
        if (!ensured.some((x) => x.sku === sku) && candidateSkus.has(sku)) {
          const src = bySku.get(sku);
          if (src) {
            ensured.push({
              sku, name: src.name, qty,
              price: src.price, currency: src.currency, stock: src.stock, image_url: src.image_url,
              why: "Conservado de tu selección previa.",
            });
          }
        }
      }

      // helper to push a candidate if matches
      const pushIf = (predicate: (p: any) => boolean, why: string) => {
        const pick = candidates.find(predicate);
        if (pick && !ensured.some((x) => x.sku === pick.sku)) {
          ensured.push({
            sku: pick.sku, name: pick.name, qty: 1,
            price: pick.price, currency: pick.currency, stock: pick.stock, image_url: pick.image_url, why
          });
        }
      };

      if (wantsSpare) {
        // prefer spare for cortatubo
        pushIf(
          (p) => /repuesto|disco|cuchilla/i.test(`${p.name} ${p.description}`) && /cortatubo|corta tubo/i.test(`${p.name} ${p.description}`),
          "Agregado a tu pedido como repuesto del cortatubo."
        );
      }
      if (wantsTeflon) {
        pushIf(
          (p) => /tefl[oó]n|ptfe|ptf/i.test(`${p.name} ${p.description}`),
          "Agregado para sellar roscas (cinta de teflón)."
        );
      }

      // Fallback TEFLÓN: if still not appended, try hard-coded SKU set (replace with your real SKUs)
      if (wantsTeflon && !ensured.some(x => /tefl[oó]n|ptfe|ptf/i.test(`${x.name} ${x.sku}`))) {
        const TEFLON_SKUS = ["PTF-12"]; // <-- replace with actual SKU(s)
        const { data: tfetch } = await supabaseAdmin
          .from("products")
          .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
          .in("sku", TEFLON_SKUS);
        const t = (tfetch || []).find(p => Number(p.stock) > 0) || (tfetch || [])[0];
        if (t && !ensured.some(x => x.sku === t.sku)) {
          ensured.push({
            sku: t.sku, name: t.name, qty: 1,
            price: t.price, currency: t.currency, stock: t.stock, image_url: t.image_url,
            why: "Agregado para sellar roscas (cinta de teflón)."
          });
        }
      }

      // --- Case-1 assist: ensure REP-CORTA-001 when cart has CORTA-COBRE-001 and user asked for spare
      if (wantsSpare && cartBySku.has("CORTA-COBRE-001") && !ensured.some(x => x.sku === "REP-CORTA-001")) {
        let rep = bySku.get("REP-CORTA-001");
        if (!rep) {
          const { data: repFetch } = await supabaseAdmin
            .from("products")
            .select("sku,name,brand,category,subcategory,description,price,currency,stock,image_url")
            .eq("sku", "REP-CORTA-001")
            .limit(1)
            .maybeSingle();
          if (repFetch) {
            rep = repFetch;
            bySku.set(rep.sku, rep);
          }
        }
        if (rep) {
          ensured.push({
            sku: rep.sku, name: rep.name, qty: 1,
            price: rep.price, currency: rep.currency, stock: rep.stock,
            image_url: rep.image_url, why: "Agregado a tu pedido como repuesto del cortatubo."
          });
        }
      }

      plan.basket = ensured;
      plan.confirm = plan.confirm || "¿Deseas algo más? Si está todo, pulsa **Confirmar e imprimir**.";
    }

    const userDidAdd = isAdd;

    // --- STRONG REPLACE path (skip if it's an ADD turn) ---
    const mentionsAlternates = /un(?:i|í)on|roscada|tefl(?:o|ó)n|ptfe|ptf|repuesto|disco|cuchilla/i.test(q);
    const prevSkus = new Set(Array.from(cartBySku.keys()));

    const shouldForceReplace =
      !userDidAdd &&
      (isReplace ||
        (mentionsAlternates &&
          Array.isArray(plan.basket) &&
          plan.basket.length > 0 &&
          plan.basket.every((x: any) => prevSkus.has(x.sku))));

    if (shouldForceReplace) {
      // drop items previously in cart
      plan.basket = Array.isArray(plan.basket)
        ? plan.basket.filter((x: any) => !prevSkus.has(x.sku))
        : [];

      if (plan.basket.length === 0) {
        const picks = pickByKeywords(q, qNorm, candidates, 3);
        plan.basket = picks.map((src) => ({
          sku: src.sku,
          name: src.name,
          qty: 1,
          price: src.price,
          currency: src.currency,
          stock: src.stock,
          image_url: src.image_url,
          why: "Seleccionado según tu preferencia.",
        }));
      } else if (mentionsAlternates) {
        const wantUnion = /un[ií]on|roscada/i.test(q);
        const wantTeflon = /tefl[oó]n|ptfe|ptf/i.test(q);
        const wantSpare = /repuesto|disco|cuchilla/i.test(q);
        const hasUnion = plan.basket.some((x: any) => /un[ií]on|roscada/i.test(`${x.name} ${x.sku}`));
        const hasTeflon = plan.basket.some((x: any) => /tefl[oó]n|ptfe|ptf/i.test(`${x.name} ${x.sku}`));
        const hasSpare = plan.basket.some((x: any) => /repuesto|disco|cuchilla/i.test(`${x.name} ${x.sku}`));
        if ((wantUnion && !hasUnion) || (wantTeflon && !hasTeflon) || (wantSpare && !hasSpare)) {
          const picks = pickByKeywords(q, qNorm, candidates, 3);
          for (const src of picks) {
            if (!plan.basket.some((x: any) => x.sku === src.sku)) {
              plan.basket.push({
                sku: src.sku,
                name: src.name,
                qty: 1,
                price: src.price,
                currency: src.currency,
                stock: src.stock,
                image_url: src.image_url,
                why: "Seleccionado según tu preferencia.",
              });
            }
          }
        }
      }

      for (const it of plan.basket) {
        const cartQty = cartBySku.get(it.sku);
        if (cartQty) it.qty = Math.max(1, Number(cartQty));
      }
    }

    // ===== EMPTY BASKET HANDLING =====
    if (!plan.basket || plan.basket.length === 0) {
      if (isReplace && !userDidAdd) {
        const picks = pickByKeywords(q, qNorm, candidates, 3);
        plan.basket = picks.map((src) => ({
          sku: src.sku,
          name: src.name,
          qty: 1,
          price: src.price,
          currency: src.currency,
          stock: src.stock,
          image_url: src.image_url,
          why: "Seleccionado según tu preferencia.",
        }));
        plan.confirm = plan.confirm || "¿Así está bien el cambio? Si sí, pulsa **Confirmar e imprimir**.";
      } else if (!userWantsRemoval && cartBySku.size > 0) {
        // restore previous cart
        plan.basket = [];
        for (const [sku, qty] of cartBySku.entries()) {
          if (!candidateSkus.has(sku)) continue;
          const src = bySku.get(sku);
          if (src) {
            plan.basket.push({
              sku: src.sku,
              name: src.name,
              qty,
              price: src.price,
              currency: src.currency,
              stock: src.stock,
              image_url: src.image_url,
              why: "Conservado de tu selección previa.",
            });
          }
        }
        plan.confirm = plan.confirm || "Pulsa **Confirmar e imprimir** para finalizar, o indica cambios.";
      }
    }

    // In NORMAL turns, if model omitted cart items, re-add them
    if (!isReplace && !userWantsRemoval) {
      for (const [sku, qty] of cartBySku.entries()) {
        if (!plan.basket.find((x: any) => x.sku === sku) && candidateSkus.has(sku)) {
          const src = bySku.get(sku);
          if (src) {
            plan.basket.push({
              sku: src.sku,
              name: src.name,
              qty,
              price: src.price,
              currency: src.currency,
              stock: src.stock,
              image_url: src.image_url,
              why: "Pedido previo del cliente.",
            });
          }
        }
      }
    }

    // ---- PVC-leak OOS narrative nudge (demo polish) ----
    try {
      const looksLikePVCLek = /fuga/i.test(q) && /pvc/i.test(q);
      if (looksLikePVCLek) {
        const { data: cople } = await supabaseAdmin
          .from("products")
          .select("sku,stock")
          .eq("sku", "PVC-CPL-050")
          .limit(1)
          .maybeSingle();
        const basketHasUnion = Array.isArray(plan.basket) && plan.basket.some((x: any) => x.sku === "PVC-UNION-050");
        if (cople && Number(cople.stock) === 0 && basketHasUnion) {
          if (!/agotad/i.test(reply)) {
            const prefix = "El **cople recto 1/2\"** está agotado. ";
            plan.confirm = plan.confirm || "¿Desea confirmar la **Unión roscada 1/2\"** como alternativa?";
            reply = prefix + reply;
          }
        }
      }
    } catch { /* non-fatal */ }

    // (Optional debug)
    if (req.query.debug === "1") {
      (plan as any).__debug = { isReplace, isAdd, q };
    }

    return res.status(200).json({ content: JSON.stringify({ plan, reply }) });
  } catch (e: any) {
    console.error(e);
    return res.status(500).json({ error: e?.message || "agent failure" });
  }
}