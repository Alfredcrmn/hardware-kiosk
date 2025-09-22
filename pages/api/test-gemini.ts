// pages/api/test-gemini.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: "Dame una lista de 3 herramientas comunes en una ferretería." }] }],
    });

    res.status(200).json({ text: result.response.text() });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message || "Unknown error" });
  }
}