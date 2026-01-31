import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { createExtractorFromData } from "node-unrar-js";
import { parseStringPromise } from "xml2js";
import pdfParse from "pdf-parse";

// Interface padronizada para o retorno
export interface ExtractedMetadata {
  title?: string;
  number?: number;
  volume?: number;
  year?: number;
  author?: string;
}

export class MetadataExtractor {
  // Método principal que decide qual extrator usar baseado na extensão
  async extract(filePath: string): Promise<ExtractedMetadata | null> {
    const ext = path.extname(filePath).toLowerCase();

    try {
      if (ext === ".cbz" || ext === ".zip") {
        return await this.fromCBZ(filePath);
      } else if (ext === ".cbr") {
        return await this.fromCBR(filePath);
      } else if (ext === ".epub") {
        return await this.fromEPUB(filePath);
      } else if (ext === ".pdf") {
        return await this.fromPDF(filePath);
      }
    } catch (error) {
      console.warn(
        `⚠️  [Metadata] Falha ao ler metadados internos de ${path.basename(filePath)}`,
      );
      // Não damos throw no erro para não parar o scanner. Retornamos null e deixamos o Regex/IA assumir.
    }

    return null;
  }

  // --- 1. Extração de CBZ (ZIP) ---
  // Busca pelo arquivo ComicInfo.xml padrão
  private async fromCBZ(filePath: string): Promise<ExtractedMetadata | null> {
    const zip = new AdmZip(filePath);
    const xmlEntry = zip.getEntry("ComicInfo.xml");

    if (!xmlEntry) return null;

    const xmlContent = zip.readAsText(xmlEntry);
    return this.parseComicInfoXML(xmlContent);
  }

  // --- 2. Extração de CBR (RAR) ---
  // Usa WebAssembly para ler RAR de forma eficiente
  private async fromCBR(filePath: string): Promise<ExtractedMetadata | null> {
    const fileBuffer = Uint8Array.from(fs.readFileSync(filePath)).buffer;

    // Cria o extrator
    const extractor = await createExtractorFromData({ data: fileBuffer });

    // Lista arquivos sem descompactar tudo (Rápido)
    const list = extractor.getFileList();
    console.log(list);
    const header = [...list.fileHeaders].find(
      (h) => h.name.toLowerCase() === "comicinfo.xml",
    );

    if (!header) return null;

    // Extrai APENAS o XML
    const extracted = extractor.extract({ files: [header.name] });
    const files = [...extracted.files];

    if (files.length === 0 || !files[0].extraction) return null;

    const xmlContent = new TextDecoder().decode(files[0].extraction);
    return this.parseComicInfoXML(xmlContent);
  }

  // --- 3. Extração de EPUB ---
  // Busca o arquivo .opf dentro do ZIP do EPUB
  private async fromEPUB(filePath: string): Promise<ExtractedMetadata | null> {
    const zip = new AdmZip(filePath);
    const entries = zip.getEntries();

    // O arquivo de metadados termina com .opf
    const opfEntry = entries.find((e) => e.entryName.endsWith(".opf"));
    if (!opfEntry) return null;

    const xmlContent = zip.readAsText(opfEntry);
    const result = await parseStringPromise(xmlContent);

    // Navegação no XML do EPUB (Dublin Core Metadata)
    const metadata = result.package?.metadata?.[0];
    if (!metadata) return null;

    const title = metadata["dc:title"]?.[0];
    const author =
      metadata["dc:creator"]?.[0]?._ || metadata["dc:creator"]?.[0]; // Pode ser objeto ou string

    return {
      title: typeof title === "string" ? title : undefined,
      author: typeof author === "string" ? author : undefined,
      // EPUBs raramente têm "número do capítulo" nos metadados padrão
    };
  }

  // --- 4. Extração de PDF ---
  private async fromPDF(filePath: string): Promise<ExtractedMetadata | null> {
    const dataBuffer = fs.readFileSync(filePath);
    const result = await pdfParse(dataBuffer);
    const info = result.info;

    if (!info) return null;

    let title = info.Title;
    const author = info.Author;

    // Limpeza básica: Muitos PDFs têm títulos genéricos de quem criou o arquivo
    if (
      title &&
      (title.startsWith("Microsoft Word") ||
        title === "Untitled" ||
        title.trim() === "")
    ) {
      title = undefined;
    }

    return {
      title: title || undefined,
      author: author || undefined,
    };
  }

  // --- Helper: Parser do ComicInfo.xml ---
  // Usado tanto pelo CBZ quanto pelo CBR
  private async parseComicInfoXML(
    xmlContent: string,
  ): Promise<ExtractedMetadata | null> {
    const result = await parseStringPromise(xmlContent);
    const info = result.ComicInfo;

    if (!info) return null;

    // O xml2js retorna arrays, então pegamos o índice [0]
    return {
      title: info.Series?.[0],
      number: info.Number ? parseFloat(info.Number[0]) : undefined,
      volume: info.Volume ? parseFloat(info.Volume[0]) : undefined,
      year: info.Year ? parseInt(info.Year[0]) : undefined,
      author: info.Writer?.[0],
    };
  }
}
