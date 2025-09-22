// lib/upsell.ts
export type Item = { sku: string; name: string };

export function suggestUpsell(basketSkus: string[]): Item[] {
  const s = new Set(basketSkus);
  const ups: Item[] = [];

  // Plumbing jobs → add Teflón + llave ajustable
  if (s.has("PVC-GLUE-240") || s.has("PVC-CPL-050")) {
    if (!s.has("PTF-12")) ups.push({ sku: "PTF-12", name: "Cinta de teflón 1/2\"x12m" });
    if (!s.has("WR-8IN")) ups.push({ sku: "WR-8IN", name: "Llave ajustable 8\"" });
  }

  // Painting jobs → masking if missing
  if (!s.has("MASK-TAPE-36") && Array.from(s).some((k) => k.startsWith("PAINT-"))) {
    ups.push({ sku: "MASK-TAPE-36", name: "Cinta masking 36mm" });
  }

  return ups.slice(0, 2);
}