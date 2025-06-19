import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class OpenAIService {
  static async extractBillingData(text) {
    try {
      const completion = await openai.chat.completions.create({
        model: "gpt-4o",
        temperature: 0, // resposta mais objetiva e consistente
        messages: [
          {
            role: "system",
            content: `
      Você é um extrator de dados de boletos. Sempre retorne **apenas** um JSON no seguinte formato, sem explicações:
      
      {
        "beneficiario": "Nome do beneficiário",
        "cnpj_beneficiario": "CNPJ do beneficiário",
        "valor": "valor com duas casas decimais, como string",
        "vencimento": "data no formato yyyy-mm-dd",
        "codigo_barras": "linha digitável ou código de barras"
      }
      
      Garanta que os campos estejam completos e formatados corretamente. Se algum campo não for encontrado, retorne com valor null.
          `.trim(),
          },
          {
            role: "user",
            content: text,
          },
        ],
      });

      const data = completion.choices[0].message.content;

      const jsonString = data.replace(/```json|```/g, "").trim();
      return JSON.parse(jsonString);
    } catch (error) {
      console.error("OpenAI service error:", error);
      throw new Error("Failed to process bill");
    }
  }
}
