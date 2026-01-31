import axios from "axios";

export interface AIMetadata {
  series: string;
  volume: number | null;
  chapter: number;
  year: number | null;
}

export class AIScanner {
  // Aponta para o Ollama local (padrão)
  private ollamaUrl = "http://127.0.0.1:11434/api/generate";
  // Modelo leve recomendado para seu i3
  private modelName = "phi3:mini";

  async parseFilename(filename: string): Promise<AIMetadata | null> {
    console.log(`🤖 IA Solicitada para: "${filename}"`);

    const prompt = `
        Analise o nome do arquivo de quadrinho abaixo e extraia os dados em JSON.
        Arquivo: "${filename}"

        Regras:
        1. "series": Nome da obra limpo (sem autor, sem ano).
        2. "volume": Número do volume (ou null).
        3. "chapter": Número do capítulo (use 1 se for One-shot/Graphic Novel).
        4. "year": Ano de lançamento (ou null).

        Responda APENAS o JSON. Exemplo: {"series": "Batman", "volume": 3, "chapter": 4, "year": 2016}
        `;

    try {
      const response = await axios.post(
        this.ollamaUrl,
        {
          model: this.modelName,
          prompt: prompt,
          format: "json", // Força resposta estruturada
          stream: false,
          options: {
            temperature: 0.1, // Criatividade baixa para ser preciso
          },
        },
        { timeout: 20000 },
      ); // Timeout de 20s para não travar scan eterno

      const result = JSON.parse(response.data.response);
      return {
        series: result.series,
        volume: result.volume,
        chapter: result.chapter,
        year: result.year,
      };
    } catch (error) {
      // Se der erro (Ollama desligado ou timeout), retornamos null e o sistema segue a vida
      console.warn(
        "⚠️  IA Indisponível ou falhou (usando Regex):",
        (error as any).message,
      );
      return null;
    }
  }
}
