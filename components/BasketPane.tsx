// components/BasketPane.tsx
import React from "react";

type BasketItem = {
  sku: string;
  name: string;
  price: number;
  currency: string;
  stock: number;
  image_url?: string;
  why?: string;
  qty?: number;
};

export default function BasketPane({
  title,
  steps,
  items,
  upsell,
  onConfirm,
  onReset,
  onQtyChange,
}: {
  title?: string;
  steps?: string[];
  items: BasketItem[];
  upsell: BasketItem[];
  onConfirm?: () => void;
  onReset?: () => void;
  onQtyChange?: (sku: string, qty: number) => void;
}) {
  const pill = (stock: number) =>
    stock === 0
      ? { bg: "#3a0e0e", text: "Agotado" }
      : stock <= 3
      ? { bg: "#3a2a0e", text: `Bajo (${stock})` }
      : { bg: "#143a14", text: `Stock (${stock})` };

  const handleInc = (it: BasketItem) => {
    const current = Math.max(1, Number(it.qty || 1));
    if (onQtyChange) onQtyChange(it.sku, Math.min(current + 1, Math.max(1, it.stock || 0)));
  };
  const handleDec = (it: BasketItem) => {
    const current = Math.max(1, Number(it.qty || 1));
    if (onQtyChange) onQtyChange(it.sku, Math.max(1, current - 1));
  };

  const subtotal = items.reduce((s, it) => s + Number(it.price || 0) * Math.max(1, Number(it.qty || 1)), 0);

  return (
    <aside
      className="basket-pane"
      style={{
        width: 640,
        borderLeft: "1px solid #222",
        background: "#0b0b0b",
        display: "flex",
        flexDirection: "column",
        height: "100%",
      }}
    >
      <div style={{ padding: 20 }}>
        <h2 style={{ fontSize: 26, marginBottom: 12, color: "#fff" }}>Guía & Canasta</h2>

        {title ? (
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 700, color: "#e2e8f0", fontSize: 20 }}>{title}</div>
            {Array.isArray(steps) && steps.length > 0 && (
              <ol style={{ marginTop: 8, marginLeft: 20, color: "#cbd5e1", lineHeight: 1.6, fontSize: 17 }}>
                {steps.map((s, i) => (
                  <li key={i} style={{ marginBottom: 8 }}>{s}</li>
                ))}
              </ol>
            )}
          </div>
        ) : (
          <div style={{ color: "#777", fontSize: 15, marginBottom: 16 }}>
            Aquí verás los pasos sugeridos y la canasta cuando el asistente proponga un plan.
          </div>
        )}

        <h3 style={{ fontSize: 20, margin: "14px 0", color: "#e5e7eb" }}>Canasta</h3>
        {items.length === 0 && <div style={{ color: "#666" }}>Aún no hay artículos.</div>}

        {items.map((it) => {
          const p = pill(it.stock);
          const qty = Math.max(1, Number(it.qty || 1));
          const canInc = qty < Math.max(1, Number(it.stock || 0));
          const canDec = qty > 1;
          return (
            <div key={it.sku} style={{ display: "flex", gap: 14, marginBottom: 18, alignItems: "center" }}>
              {it.image_url && (
                <img
                  src={it.image_url}
                  alt={it.name}
                  width={72}
                  height={72}
                  style={{ objectFit: "cover", borderRadius: 10, background: "#111" }}
                />
              )}
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                  <div style={{ fontWeight: 600, color: "#f3f4f6", fontSize: 18 }}>{it.name}</div>
                  <span
                    style={{
                      fontSize: 13,
                      padding: "3px 8px",
                      borderRadius: 6,
                      background: p.bg,
                      color: "#d1fae5",
                      marginLeft: 8,
                    }}
                  >
                    {p.text}
                  </span>
                </div>
                {it.why && <div style={{ fontSize: 13, color: "#9ca3af", marginTop: 2 }}>{it.why}</div>}

                <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ color: "#d1d5db", minWidth: 110, fontSize: 15 }}>
                    {it.currency} {Number(it.price).toFixed(2)}
                  </span>

                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <button
                      onClick={() => handleDec(it)}
                      disabled={!canDec}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: canDec ? "#1f2937" : "#111827",
                        color: "#e5e7eb",
                        border: "1px solid #374151",
                        fontSize: 18,
                        cursor: canDec ? "pointer" : "not-allowed",
                      }}
                    >
                      −
                    </button>
                    <div
                      style={{
                        minWidth: 40,
                        textAlign: "center",
                        padding: "6px 8px",
                        borderRadius: 8,
                        background: "#0f172a",
                        color: "#e5e7eb",
                        border: "1px solid #1f2937",
                        fontSize: 16,
                      }}
                    >
                      {qty}
                    </div>
                    <button
                      onClick={() => handleInc(it)}
                      disabled={!canInc}
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 8,
                        background: canInc ? "#1f2937" : "#111827",
                        color: "#e5e7eb",
                        border: "1px solid #374151",
                        fontSize: 18,
                        cursor: canInc ? "pointer" : "not-allowed",
                      }}
                    >
                      +
                    </button>
                  </div>
                </div>
              </div>
            </div>
          );
        })}

        {upsell.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <h4 style={{ fontSize: 17, color: "#e5e7eb" }}>Sugerencias</h4>
            {upsell.map((u) => (
              <div key={u.sku} style={{ fontSize: 15, marginTop: 6, color: "#cbd5e1" }}>• {u.name}</div>
            ))}
          </div>
        )}
      </div>

      <div style={{ marginTop: "auto", padding: 20, borderTop: "1px solid #1f2937" }}>
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 14, color: "#e5e7eb", fontSize: 16 }}>
          <span style={{ opacity: 0.8 }}>Subtotal</span>
          <strong>MXN {subtotal.toFixed(2)}</strong>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onReset}
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 10,
              background: "#111827",
              color: "#e5e7eb",
              border: "1px solid #1f2937",
              cursor: "pointer",
              fontWeight: 600,
              fontSize: 16,
            }}
          >
            Nueva consulta
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: 14,
              borderRadius: 10,
              background: "#22c55e",
              color: "black",
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 16,
            }}
          >
            Confirmar e imprimir
          </button>
        </div>
      </div>
    </aside>
  );
}