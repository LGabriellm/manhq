import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import sharp from "sharp";
import { createExtractorFromData } from "node-unrar-js";
import { parseFileName } from "../utils/parser.ts";
import { config } from "../config.ts";

export class OptimizerService {
  private tempDir = config.tempPath;
  private libraryDir = config.libraryPath;

  constructor() {
    if (!fs.existsSync(this.tempDir))
      fs.mkdirSync(this.tempDir, { recursive: true });
    if (!fs.existsSync(this.libraryDir))
      fs.mkdirSync(this.libraryDir, { recursive: true });
  }

  async processUpload(filePath: string, originalFilename: string) {
    console.log(`⚙️ [Optimizer] Iniciando: ${originalFilename}`);

    const workDir = path.join(
      this.tempDir,
      path.parse(originalFilename).name + "_" + Date.now(),
    );
    if (fs.existsSync(workDir))
      fs.rmSync(workDir, { recursive: true, force: true });
    fs.mkdirSync(workDir);

    try {
      // 1. EXTRAÇÃO INTELIGENTE (Detecta o tipo real do arquivo)
      await this.extractArchiveSmart(filePath, workDir);

      // 2. OTIMIZAÇÃO
      await this.processFolderRecursively(workDir);

      // 3. ORGANIZAÇÃO
      const meta = parseFileName(originalFilename);
      const seriesFolder = path.join(this.libraryDir, meta.title);

      if (!fs.existsSync(seriesFolder))
        fs.mkdirSync(seriesFolder, { recursive: true });

      const finalName = `${meta.title} - Cap ${meta.number}${meta.volume ? " Vol " + meta.volume : ""}.cbz`;
      const finalPath = path.join(seriesFolder, finalName);

      // 4. RE-COMPACTAÇÃO
      const newZip = new AdmZip();
      newZip.addLocalFolder(workDir);
      newZip.writeZip(finalPath);

      console.log(`✅ [Optimizer] Sucesso! Salvo em: ${finalPath}`);

      fs.rmSync(workDir, { recursive: true, force: true });
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

      return finalPath;
    } catch (error) {
      console.error("❌ [Optimizer] Erro durante o processamento:", error);
      if (fs.existsSync(workDir))
        fs.rmSync(workDir, { recursive: true, force: true });
      // Mantém o arquivo original em caso de erro para análise manual se quiser
      throw error;
    }
  }

  // --- O NOVO MÉTODO DE EXTRAÇÃO BLINDADO ---

  private async extractArchiveSmart(filePath: string, destDir: string) {
    // Detecta o tipo REAL lendo os primeiros bytes (Magic Numbers)
    const fileType = await this.detectFileType(filePath);

    console.log(`🔍 Tipo real detectado: ${fileType.toUpperCase()}`);

    // === TIPO REAL: ZIP (Mesmo que a extensão seja .cbr ou .doc) ===
    if (fileType === "zip") {
      try {
        const zip = new AdmZip(filePath);
        zip.extractAllTo(destDir, true);
      } catch (e) {
        throw new Error("O arquivo parece ser um ZIP, mas está corrompido.");
      }
    }

    // === TIPO REAL: RAR ===
    else if (fileType === "rar") {
      const data = Uint8Array.from(fs.readFileSync(filePath)).buffer;
      const extractor = await createExtractorFromData({ data });
      const extracted = extractor.extract();

      for (const file of extracted.files) {
        if (file.extraction) {
          const fullPath = path.join(destDir, file.fileHeader.name);
          const dir = path.dirname(fullPath);
          if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(fullPath, file.extraction);
        }
      }
    }

    // === TIPO REAL: PDF ===
    else if (fileType === "pdf") {
      const pdfLib = await import("pdf-to-img");
      const document = await pdfLib.pdf(filePath, { scale: 3.0 });
      let counter = 1;
      for await (const image of document) {
        const fileName = `page_${String(counter).padStart(4, "0")}.png`;
        const outPath = path.join(destDir, fileName);
        fs.writeFileSync(outPath, image);
        counter++;
      }
    } else {
      throw new Error(
        `Formato de arquivo desconhecido ou não suportado (Header: ${fileType})`,
      );
    }
  }

  // --- FAREJADOR DE ARQUIVOS (MAGIC NUMBERS) ---
  // Lê os primeiros 4 bytes do arquivo para saber a verdade
  private async detectFileType(
    filePath: string,
  ): Promise<"zip" | "rar" | "pdf" | "unknown"> {
    const buffer = Buffer.alloc(4);
    const fd = fs.openSync(filePath, "r");
    fs.readSync(fd, buffer, 0, 4, 0);
    fs.closeSync(fd);

    const hex = buffer.toString("hex").toUpperCase();

    // Assinaturas Hexadecimais Padrão
    if (hex.startsWith("504B0304")) return "zip"; // PK.. (Zip padrão)
    if (hex.startsWith("52617221")) return "rar"; // Rar! (RAR v4 ou v5)
    if (hex.startsWith("25504446")) return "pdf"; // %PDF (PDF)

    return "unknown";
  }

  // --- MÉTODOS DE CONVERSÃO (Mantém igual) ---

  private async processFolderRecursively(folderPath: string) {
    const items = fs.readdirSync(folderPath);

    for (const item of items) {
      const fullPath = path.join(folderPath, item);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        await this.processFolderRecursively(fullPath);
      } else {
        await this.convertFile(fullPath);
      }
    }
  }

  private async convertFile(filePath: string) {
    const ext = path.extname(filePath).toLowerCase();
    if (![".jpg", ".jpeg", ".png", ".bmp", ".tiff", ".webp"].includes(ext))
      return;

    try {
      const pipeline = sharp(filePath);
      const buffer = await pipeline
        .resize({ width: 1600, withoutEnlargement: true, fit: "inside" })
        .webp({ quality: 80, effort: 4, smartSubsample: true })
        .toBuffer();

      const newPath = filePath.replace(/\.[^/.]+$/, ".webp");
      fs.writeFileSync(newPath, buffer);

      if (newPath !== filePath) fs.unlinkSync(filePath);
    } catch (error) {
      console.warn(
        `⚠️ Erro ao converter imagem ${path.basename(filePath)}`,
        error,
      );
    }
  }
}
