// lib/agent.ts (Gemini-simple: no tool-calling loop)
import { makeLLM, ChatMsg } from "@/lib/llm";

export const SYSTEM_PROMPT = `You are a hardware-store kiosk assistant.
Rules:
- Ask at most a few clarifying questions (brief) only if needed.
- Only recommend items from the provided CANDIDATES list. NEVER invent SKUs.
- If the best item is out of stock, clearly warn and propose an in-stock alternative.
- Final response MUST be valid JSON ONLY with:
  {
    "title": string,
    "steps": string[3-5],
    "basket": [
      { "sku": string, "name": string, "qty": number, "price": number, "currency": string, "stock": number, "image_url": string, "why": string }
    ],
    "upsell": [
      { "sku": string, "name": string, "qty": number, "price": number, "currency": string, "stock": number, "image_url": string, "why": string }
    ],
    "confirm": string
  }
- Keep language simple and actionable (Spanish is fine). Return ONLY the JSON, no extra text.`;

export async function runAgent(userText: string) {
  // 1) Fetch candidate products from our DB (keyword search)
  const r = await fetch("/api/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ q: userText }),
  });
  const { candidates = [] } = await r.json();

  // Optional: if nothing found, nudge for more details
  if (!candidates.length) {
    return JSON.stringify({
      title: "Necesito más detalles",
      steps: [
        "Indica material (PVC, cobre, madera, tablaroca, etc.)",
        "Especifica medidas/tamaño (diámetro, longitud, área)",
        "Describe si hay roscas, presión de agua, o tipo de muro"
      ],
      basket: [],
      upsell: [],
      confirm: "¿Puedes dar un poco más de detalle para sugerir piezas exactas?"
    });
  }

  // 2) Prompt Gemini to compose plan + basket using ONLY these candidates
  const llm = makeLLM();
  const messages: ChatMsg[] = [
    { role: "system", content: SYSTEM_PROMPT },
    {
      role: "user",
      content:
        `Customer request:\n${userText}\n\n` +
        `CANDIDATES (JSON array; choose only from these):\n` +
        JSON.stringify(candidates),
    },
    {
      role: "user",
      content:
        "Generate ONLY the final JSON object described in the rules. " +
        "Use 'why' to explain each item briefly. If an item is out of stock, pick an alternative from candidates.",
    },
  ];

  const resp = await llm.chat({ messages, temperature: 0.3 });
  return resp.choices?.[0]?.message?.content || "{}";
}