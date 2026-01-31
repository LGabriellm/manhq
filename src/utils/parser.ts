import path from "path";

export interface ParsedMetadata {
  title: string;
  number: number;
  volume: number | null;
  year: number | null;
  isOneShot: boolean;
}

export function parseFileName(filename: string): ParsedMetadata {
  const ext = path.extname(filename);
  let name = path.basename(filename, ext);

  // ==================================================
  // 1. SANITIZAÇÃO (Limpeza de Lixo)
  // ==================================================
  let cleanName = name
    .replace(/\[.*?\]/g, " ")
    .replace(/\{.*?\}/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // ==================================================
  // 2. EXTRAÇÃO DE ANO
  // ==================================================
  let year: number | null = null;
  const yearRegex = /\((\d{4})\)/;
  const yearMatch = cleanName.match(yearRegex);

  if (yearMatch) {
    year = parseInt(yearMatch[1]);
    cleanName = cleanName.replace(yearMatch[0], "");
  }
  cleanName = cleanName.replace(/\(.*?\)/g, " ");

  // ==================================================
  // 3. EXTRAÇÃO DE VOLUME
  // ==================================================
  let volume: number | null = null;
  // Agora suporta decimais no volume também (ex: Vol 1.5)
  const volRegex = /\b(?:v|vol|volume|livro|book|tome)\.?\s*(\d+([.,]\d+)?)\b/i;
  const volMatch = cleanName.match(volRegex);

  if (volMatch) {
    // Troca vírgula por ponto antes de converter
    volume = parseFloat(volMatch[1].replace(",", "."));
    cleanName = cleanName.replace(volMatch[0], "");
  }

  // ==================================================
  // 4. EXTRAÇÃO DE CAPÍTULO (SUPORTE A DECIMAIS)
  // ==================================================
  let number = 0;
  let isOneShot = false;
  let foundChapter = false;

  // Lista de prioridade de Regex
  const chapterPatterns = [
    // 1. Prefixo explícito (c01, cap 1.5, #10,5)
    // O segredo está no (\d+([.,]\d+)?) -> Pega número, opcionalmente seguido de . ou , e mais números
    /\b(?:c|ch|cap|chapter|chap|#|no|num|numero)\.?\s*(\d+([.,]\d+)?)/i,

    // 2. Formato "X de Y" (Pega o primeiro)
    /\b(\d+([.,]\d+)?)\s*(?:de|of)\s*\d+/i,

    // 3. Formato Range: 03-06 (Pega o primeiro)
    /\b(\d+([.,]\d+)?)\s*-\s*\d+\b/,
  ];

  for (const pattern of chapterPatterns) {
    const match = cleanName.match(pattern);
    if (match) {
      // match[1] é o número completo (ex: "1.5" ou "1,5")
      number = parseFloat(match[1].replace(",", "."));
      foundChapter = true;
      cleanName = cleanName.replace(match[0], "");
      break;
    }
  }

  // 5. FALLBACK (Se não achou prefixo)
  if (!foundChapter) {
    // Procura números soltos, inclusive decimais (10.5 ou 10,5)
    const numbers = cleanName.match(/(\d+([.,]\d+)?)/g);

    if (numbers && numbers.length > 0) {
      // Pega o último número encontrado
      const lastNumStr = numbers[numbers.length - 1];
      const potentialChapter = parseFloat(lastNumStr.replace(",", "."));

      // Filtro de segurança para não pegar Anos (1990-2030) como capítulo
      if (potentialChapter < 1900 || potentialChapter > 2100) {
        number = potentialChapter;
        // Remove do título
        const index = cleanName.lastIndexOf(lastNumStr);
        if (index !== -1) {
          cleanName =
            cleanName.substring(0, index) +
            cleanName.substring(index + lastNumStr.length);
        }
      } else {
        isOneShot = true;
        number = 1;
      }
    } else {
      isOneShot = true;
      number = 1;
    }
  }

  // ==================================================
  // 6. LIMPEZA FINAL DO TÍTULO
  // ==================================================
  let title = cleanName
    .split(/\s+-\s+/)[0]
    .replace(/[._]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  title = title.replace(/[#-]+$/, "").trim();

  if (!title) title = "Desconhecido";

  return {
    title,
    number,
    volume: volume || null,
    year: year || null,
    isOneShot,
  };
}
