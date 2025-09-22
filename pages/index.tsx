// pages/index.tsx
import React, { useState } from "react";
import ChatPane from "@/components/ChatPane";
import BasketPane from "@/components/BasketPane";

type BasketItem = {
  sku: string;
  name: string;
  qty?: number;
  price: number;
  currency: string;
  stock: number;
  image_url?: string;
  why?: string;
};

export default function Home() {
  const [plan, setPlan] = useState<{
    title?: string;
    steps?: string[];
    basket?: BasketItem[];
    upsell?: BasketItem[];
  } | null>(null);

  // Force remount ChatPane to clear its internal history after confirm
  const [chatKey, setChatKey] = useState(0);

  function handleResult(newPlan: any) {
    setPlan(newPlan);
  }

  function handleReset() {
    setPlan(null);
    setChatKey((k) => k + 1); // clears chat for a new customer
  }

  function handleQtyChange(sku: string, qty: number) {
    setPlan((prev: any) => {
      if (!prev) return prev;
      const next = { ...prev, basket: [...(prev.basket || [])] };
      next.basket = next.basket.map((it: any) =>
        it.sku === sku ? { ...it, qty: Math.max(1, Number(qty || 1)) } : it
      );
      return next;
    });
  }

  function printReceiptAndReset() {
    const items = plan?.basket ?? [];
    if (!items.length) {
      window.alert("No hay artículos en la canasta.");
      return;
    }

    const now = new Date();
    const fmt = new Intl.DateTimeFormat("es-MX", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(now);

    const currency = items[0]?.currency ?? "MXN";
    const subtotal = items.reduce(
      (s, it) => s + Number(it.price || 0) * Math.max(1, Number(it.qty || 1)),
      0
    );

    // Simple inline-styled HTML to ensure consistent printing
    const rows = items
      .map((it) => {
        const qty = Math.max(1, Number(it.qty || 1));
        const line = (Number(it.price || 0) * qty).toFixed(2);
        const unit = Number(it.price || 0).toFixed(2);
        const img = it.image_url
          ? `<img src="${it.image_url}" alt="" style="width:48px;height:48px;object-fit:cover;border-radius:8px;margin-right:10px;border:1px solid #e5e7eb" />`
          : "";
        return `
        <tr style="vertical-align:top">
          <td style="padding:8px 0; display:flex; align-items:center;">
            ${img}
            <div>
              <div style="font-weight:600">${escapeHtml(it.name)}</div>
              <div style="color:#6b7280;font-size:12px">SKU: ${escapeHtml(it.sku)}</div>
            </div>
          </td>
          <td style="padding:8px 0; text-align:center;">${qty}</td>
          <td style="padding:8px 0; text-align:right;">${currency} ${unit}</td>
          <td style="padding:8px 0; text-align:right; font-weight:600">${currency} ${line}</td>
        </tr>`;
      })
      .join("");

    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Ticket</title>
  <style>
    @media print {
      @page { margin: 14mm; }
    }
  </style>
</head>
<body style="font-family: ui-sans-serif, -apple-system, Segoe UI, Roboto, system-ui; color:#111; margin:0; padding:0;">
  <div style="max-width:720px; margin:24px auto; padding:0 8px;">
    <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
      <div>
        <div style="font-size:20px; font-weight:800;">Ferretería Demo</div>
        <div style="color:#6b7280; font-size:12px">${fmt}</div>
      </div>
      <div style="text-align:right; color:#6b7280; font-size:12px">
        Ticket de compra<br/>
        ${escapeHtml(plan?.title || "Pedido")}
      </div>
    </div>

    <hr style="border:none; border-top:1px solid #e5e7eb; margin:12px 0;" />

    <table style="width:100%; border-collapse:collapse; font-size:14px;">
      <thead>
        <tr>
          <th style="text-align:left; padding:6px 0; color:#374151">Producto</th>
          <th style="text-align:center; padding:6px 0; color:#374151; width:80px;">Cant.</th>
          <th style="text-align:right; padding:6px 0; color:#374151; width:120px;">Precio</th>
          <th style="text-align:right; padding:6px 0; color:#374151; width:140px;">Importe</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>

    <hr style="border:none; border-top:1px solid #e5e7eb; margin:12px 0;" />

    <div style="display:flex; justify-content:flex-end; font-size:16px;">
      <div style="min-width:240px;">
        <div style="display:flex; justify-content:space-between; padding:4px 0;">
          <div style="color:#374151">Subtotal</div>
          <div style="font-weight:700">${currency} ${subtotal.toFixed(2)}</div>
        </div>
      </div>
    </div>

    <div style="margin-top:18px; color:#6b7280; font-size:12px;">
      ¡Gracias por su compra! Si necesita factura, por favor indíquelo en caja.
    </div>
  </div>

  <script>
    window.onload = function() {
      window.focus();
      window.print();
      window.close();
    };
  </script>
</body>
</html>`;

    const win = window.open("", "PRINT", "width=900,height=700");
    if (!win) {
      window.alert("Por favor permite ventanas emergentes para imprimir el ticket.");
      return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();

    // reset for the next customer right after triggering print
    handleReset();
  }

  return (
    <main
      style={{
        display: "flex",
        height: "100vh",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto",
        background: "#000",
        color: "#e5e7eb",
      }}
    >
      {/* Chat area (remount on chatKey to clear history) */}
      <div style={{ flex: 1.35, display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", padding: "16px 16px 8px 16px" }}>
          <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: 0.2 }}>Asistente de Ferretería</div>
          <div style={{ marginLeft: 10, fontSize: 14, color: "#9ca3af" }}>
            Describe tu proyecto y resuelve dudas por chat/voz.
          </div>
        </div>
        <div className="chat-pane" key={chatKey} style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <ChatPane onResult={handleResult} />
        </div>
      </div>

      {/* Basket / guide (fixed wide) */}
      <div className="basket-pane">
        <BasketPane
          title={plan?.title}
          steps={plan?.steps}
          items={plan?.basket ?? []}
          upsell={plan?.upsell ?? []}
          onConfirm={printReceiptAndReset}
          onReset={handleReset}
          onQtyChange={handleQtyChange}
        />
      </div>
    </main>
  );
}

// --- helpers ---
function escapeHtml(s: string) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}