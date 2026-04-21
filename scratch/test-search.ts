import { GoogleGenAI } from "@google/genai";
import * as dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function test() {
  const query = "精神保健福祉手帳 等級"; // Changed from 精神障害者福祉手帳
  const promptText = `検索クエリ: "site:ameblo.jp/kyupin/ ${query}"\n上記の検索クエリを使ってGoogle検索を実行し、その結果のみを使って回答してください。`;

  console.log("Testing gemini-3.1-flash-lite-preview...");
  try {
    const response2 = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: promptText,
      config: {
        tools: [{ googleSearch: {} }]
      }
    });
    
    console.log("Response:", response2.text);
    const chunks = response2.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    console.log("chunks length:", chunks.length);
    chunks.forEach(c => {
      console.log(`Source: [${c.web?.title}] ${c.web?.uri}`);
    });
  } catch (e) {
    console.error("Error:", e);
  }
}

test();
