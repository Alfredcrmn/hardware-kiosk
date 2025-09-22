// components/ChatPane.tsx
import React, { useRef, useState } from "react";

export type Msg = { role: "user" | "assistant"; text: string };

type Props = {
  onResult: (plan: any) => void;
  onResetChat?: () => void;
};

function safeParseJson(input: string) {
  try {
    const first = JSON.parse(input);
    if (typeof first === "string") {
      try { return JSON.parse(first); } catch { return first; }
    }
    return first;
  } catch {
    return null;
  }
}

function renderWithBold(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) =>
        p.startsWith("**") && p.endsWith("**") ? (
          <strong key={i}>{p.slice(2, -2)}</strong>
        ) : (
          <span key={i}>{p}</span>
        )
      )}
    </>
  );
}

export default function ChatPane({ onResult, onResetChat }: Props) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text:
        "Hola 👋 Soy tu asistente de ferretería. Cuéntame tu proyecto (puedes escribir o usar el micrófono).\nEj.: “Tengo fuga en un tubo de PVC de media”.",
    },
  ]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [listening, setListening] = useState(false);
  const [cart, setCart] = useState<{ sku: string; qty: number }[]>([]);
  const [lastSent, setLastSent] = useState<string>("");

  const recRef = useRef<any>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);

  function scrollToBottom() {
    requestAnimationFrame(() => {
      scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight, behavior: "smooth" });
    });
  }

  async function sendToAgent(userText: string) {
    if (pending) return;
    if (userText.length < 2) return;
    if (userText === lastSent) return;
    setLastSent(userText);

    setPending(true);
    const history = messages.map((m) => ({ role: m.role, text: m.text }));

    try {
      const r = await fetch("/api/agent?debug=0", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ q: userText, history, cart }),
      });
      const data = await r.json();
      if (!r.ok) {
        setMessages((m) => [...m, { role: "assistant", text: "Hubo un problema. ¿Puedes repetirlo?" }]);
        return;
      }
      const parsed = safeParseJson(data.content);
      if (!parsed || typeof parsed !== "object") {
        setMessages((m) => [...m, { role: "assistant", text: "No recibí un formato válido. ¿Puedes repetir?" }]);
        return;
      }

      const { plan, reply } = parsed as { plan: any; reply: string };
      if (plan) onResult(plan);
      if (Array.isArray(plan?.basket)) {
        setCart(plan.basket.map((b: any) => ({ sku: b.sku, qty: Math.max(1, Number(b.qty || 1)) })));
      }

      setMessages((m) => [...m, { role: "assistant", text: reply || "Listo. ¿Algo más?" }]);
      scrollToBottom();
    } catch (err) {
      console.error(err);
      setMessages((m) => [...m, { role: "assistant", text: "Error de red. Intenta de nuevo." }]);
    } finally {
      setPending(false);
    }
  }

  function handleSend() {
    const text = input.trim();
    if (!text) return;
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    scrollToBottom();
    sendToAgent(text);
  }

  const startListening = () => {
    if (listening || pending) return;
    const SR = (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
    if (!SR) { alert("Tu navegador no soporta reconocimiento de voz."); return; }
    const rec = new SR();
    rec.lang = "es-MX";
    rec.interimResults = true;
    rec.continuous = false;

    let finalText = "";
    rec.onresult = (e: any) => {
      let txt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        txt += e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText = txt;
      }
      setInput(txt);
    };
    rec.onend = async () => {
      setListening(false);
      const utterance = (finalText || input).trim();
      if (!utterance) return;
      setMessages((m) => [...m, { role: "user", text: utterance }]);
      setInput("");
      scrollToBottom();
      await sendToAgent(utterance);
    };

    recRef.current = rec;
    setListening(true);
    rec.start();
  };

  return (
    <section className="chat-pane" style={{ flex: 1.35, display: "flex", flexDirection: "column", height: "100%", padding: 16 }}>
      <div
        ref={scrollerRef}
        style={{
          flex: 1,
          border: "1px solid #333",
          borderRadius: 14,
          padding: 18,
          overflowY: "auto",
          background: "#0a0a0a",
        }}
      >
        {messages.map((m, i) => (
          <div key={i} style={{ display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start", marginBottom: 14 }}>
            <div
              style={{
                maxWidth: "82%",
                padding: "16px 18px",
                borderRadius: 16,
                whiteSpace: "pre-wrap",
                background: m.role === "user" ? "#1f6feb" : "#161b22",
                color: m.role === "user" ? "#fff" : "#ddd",
                border: m.role === "assistant" ? "1px solid #2c2c2c" : "none",
                fontSize: 19,
                lineHeight: 1.55,
              }}
            >
              {m.role === "assistant" ? renderWithBold(m.text) : m.text}
            </div>
          </div>
        ))}
        {pending && <div style={{ color: "#888", fontStyle: "italic" }}>Pensando…</div>}
      </div>

      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe aquí tu consulta…"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") handleSend();
          }}
          style={{
            flex: 1,
            height: 72,
            padding: 14,
            borderRadius: 12,
            border: "1px solid #333",
            background: "#0a0a0a",
            color: "#eee",
            resize: "none",
            fontSize: 16,
          }}
        />
        <button
          onClick={startListening}
          disabled={listening || pending}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: listening ? "#444" : "#10b981",
            color: "white",
            fontWeight: 600,
            cursor: listening || pending ? "not-allowed" : "pointer",
            minWidth: 110,
          }}
        >
          {listening ? "Escuchando…" : "Hablar"}
        </button>
        <button
          onClick={handleSend}
          disabled={pending}
          style={{
            padding: "12px 14px",
            borderRadius: 12,
            background: "#1f6feb",
            color: "white",
            fontWeight: 600,
            cursor: pending ? "not-allowed" : "pointer",
            minWidth: 110,
          }}
        >
          Enviar
        </button>
      </div>
    </section>
  );
}