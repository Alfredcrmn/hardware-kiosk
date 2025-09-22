// lib/llm.ts
import { GoogleGenerativeAI } from "@google/generative-ai";

export type ChatMsg = { role: "system" | "user" | "assistant"; content: string };
export type ToolSchema = {
  name: string;
  description: string;
  parameters: any; // JSON Schema
};

export interface LLM {
  chat(args: {
    messages: ChatMsg[];
    tools?: ToolSchema[];
    toolChoice?: "auto";
    temperature?: number;
  }): Promise<any>; // normalized OpenAI-like shape
}

// Convert our ToolSchema[] into Gemini's Tool[] shape
function toGeminiTools(tools?: ToolSchema[]) {
  if (!tools?.length) return undefined;
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters, // JSON Schema
      })),
    },
  ];
}

export function makeLLM(): LLM {
  const provider = process.env.LLM_PROVIDER ?? "gemini";
  const modelName = process.env.LLM_MODEL ?? "gemini-1.5-flash";
  if (provider !== "gemini") throw new Error("This build is configured for Gemini");

  const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
  const model = genAI.getGenerativeModel({ model: modelName });

  return {
    async chat({ messages, tools, temperature = 0.4 }) {
      const contents = messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

      const req: any = {
        contents,
        generationConfig: {
          temperature,
          responseMimeType: "application/json",
        },
      };

      const geminiTools = toGeminiTools(tools);
      if (geminiTools) {
        req.tools = geminiTools;
        req.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
      }

      const result = await model.generateContent(req);

      // Normalize response to OpenAI-like shape:
      // - message.content: text
      // - message.tool_calls: [{ type:"function", function:{ name, arguments }}]
      const cand = result.response?.candidates?.[0];
      const parts = cand?.content?.parts ?? [];
      let textOut = "";
      const toolCalls: any[] = [];

      for (const p of parts as any[]) {
        if (p.text) textOut += p.text;
        if (p.functionCall) {
          toolCalls.push({
            type: "function",
            function: {
              name: p.functionCall.name,
              arguments: JSON.stringify(p.functionCall.args ?? {}),
            },
          });
        }
      }

      return {
        choices: [
          {
            message: {
              content: textOut || "",
              tool_calls: toolCalls.length ? toolCalls : undefined,
            },
          },
        ],
      };
    },
  };
}