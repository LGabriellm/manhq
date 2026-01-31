import fs from "fs";
import path from "path";
import AdmZip from "adm-zip";
import { prisma } from "../lib/prisma.ts"; // Verifique se o caminho está certo (sem .ts no import)
import { parseFileName } from "../utils/parser.ts";
import { AIScanner } from "./AIScanner.ts";
import { MetadataExtractor } from "../utils/MetadataExtractor.ts"; // Importe o extrator modular
import { createExtractorFromData } from "node-unrar-js";

const aiScanner = new AIScanner();
const metadataExtractor = new MetadataExtractor();

export class ScannerService {
  // Função recursiva para pegar todos os arquivos (incluindo subpastas)
  private async *getFilesRecursively(dir: string): AsyncGenerator<string> {
    const dirents = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const dirent of dirents) {
      const res = path.resolve(dir, dirent.name);
      if (dirent.isDirectory()) {
        yield* this.getFilesRecursively(res);
      } else {
        yield res;
      }
    }
  }

  async scanLibrary(libraryPath: string) {
    console.log(`📂 Iniciando varredura profunda em: ${libraryPath}`);

    if (!fs.existsSync(libraryPath)) {
      console.error("❌ Pasta não encontrada!");
      return;
    }

    // Busca biblioteca padrão ou cria (apenas uma vez no início)
    // Isso evita criar bibliotecas duplicadas "Geral"
    let library = await prisma.library.findFirst({
      where: { path: libraryPath },
    });
    if (!library) {
      library =
        (await prisma.library.findFirst()) ||
        (await prisma.library.create({
          data: { name: "Principal", path: libraryPath },
        }));
    }

    // Itera recursivamente sobre os arquivos
    for await (const fullPath of this.getFilesRecursively(libraryPath)) {
      const filename = path.basename(fullPath);

      // Filtro de extensão
      if (
        !filename.startsWith(".") &&
        filename.match(/\.(cbz|cbr|pdf|epub)$/i)
      ) {
        await this.processFile(filename, fullPath, library.id);
      }
    }

    console.log("✅ Varredura concluída!");
  }

  private async countPages(
    filePath: string,
    extension: string,
  ): Promise<number> {
    try {
      // CBZ / ZIP
      if (extension === "cbz" || extension === "zip") {
        const zip = new AdmZip(filePath);
        // Conta imagens ignorando pastas e arquivos ocultos
        return zip
          .getEntries()
          .filter(
            (e) =>
              !e.isDirectory &&
              e.entryName.match(/\.(jpg|jpeg|png|webp|gif)$/i),
          ).length;
      }
      // CBR
      else if (extension === "cbr") {
        const data = Uint8Array.from(fs.readFileSync(filePath)).buffer;
        const extractor = await createExtractorFromData({ data });
        const list = extractor.getFileList();
        return [...list.fileHeaders].filter(
          (h) =>
            !h.flags.directory && h.name.match(/\.(jpg|jpeg|png|webp|gif)$/i),
        ).length;
      }
      // PDF (Estimativa rápida baseada em metadados para não travar scan)
      // Se precisar de precisão absoluta no PDF, teria que usar pdf-to-img, mas é lento para scan.
      // Deixamos 0 para o Reader contar on-demand se for PDF pesado.
      return 0;
    } catch (e) {
      console.warn(
        `⚠️ Erro ao contar páginas de ${path.basename(filePath)}`,
        e,
      );
      return 0;
    }
  }

  private async processFile(
    filename: string,
    filePath: string,
    libraryId: string,
  ) {
    // Check rápido de existência (Cache this if slow)
    const exists = await prisma.media.findFirst({
      where: { path: filePath },
      select: { id: true }, // Select apenas ID é mais rápido
    });
    if (exists) return;

    console.log(`Analyzing: ${filename}`);

    // 1. TENTATIVA METADADOS INTERNOS (XML/OPF/PDF)
    // Usa o MetadataExtractor que suporta CBZ, CBR, PDF e EPUB
    const internalMeta = await metadataExtractor.extract(filePath);

    // 2. TENTATIVA REGEX (Sempre roda para garantir numeração)
    const parsed = parseFileName(filename);

    // 3. MERGE DE DADOS (Prioriza interno para Título, Regex para fallback)
    let finalMeta = {
      title: internalMeta?.title || parsed.title,
      number: internalMeta?.number ?? parsed.number, // ?? permite que 0 seja válido
      volume: internalMeta?.volume ?? parsed.volume,
      year: internalMeta?.year ?? parsed.year,
      isOneShot: parsed.isOneShot,
    };

    // Validação: Se o título interno for ruim (ex: "Untitled"), usa o do arquivo
    if (
      !finalMeta.title ||
      finalMeta.title === "Desconhecido" ||
      finalMeta.title.startsWith("Microsoft Word")
    ) {
      finalMeta.title = parsed.title;
    }

    // 4. TENTATIVA IA (Fallback final)
    const isBadData =
      finalMeta.title === "Desconhecido" ||
      (finalMeta.number === 0 && !finalMeta.isOneShot);

    if (isBadData) {
      const aiResult = await aiScanner.parseFilename(filename);
      if (aiResult) {
        finalMeta.title = aiResult.series;
        finalMeta.number = aiResult.chapter;
        finalMeta.volume = aiResult.volume || finalMeta.volume;
        finalMeta.year = aiResult.year || finalMeta.year;
        console.log(`   ✨ IA Salvou: ${finalMeta.title} #${finalMeta.number}`);
      }
    }

    // GARANTIA FINAL: Título não pode ser vazio
    const seriesTitle = finalMeta.title || "Série Desconhecida";

    // 5. BANCO DE DADOS (Upsert para evitar Race Condition)
    // O upsert garante que se dois processos tentarem criar "Naruto" ao mesmo tempo,
    // o banco resolve sem erro.
    const series = await prisma.series.upsert({
      where: {
        // Assumindo que você criou um índice @@unique([title, libraryId]) no schema.prisma
        // Se não tiver, use findFirst antes (mas upsert é melhor)
        id:
          (
            await prisma.series.findFirst({
              where: { title: seriesTitle, libraryId },
            })
          )?.id || "new",
      },
      create: {
        title: seriesTitle,
        libraryId: libraryId,
        sourceType: "LOCAL",
        folderPath: path.dirname(filePath),
      },
      update: { updatedAt: new Date() },
    });

    const ext = path.extname(filename).replace(".", "").toLowerCase();
    const pageCount = await this.countPages(filePath, ext);

    // Salva o Arquivo
    await prisma.media.create({
      data: {
        seriesId: series.id,
        title: `Capítulo ${finalMeta.number}`,
        number: finalMeta.number,
        volume: finalMeta.volume, // Não precisa de Math.floor se o banco for Int/Float compativel
        year: finalMeta.year,
        path: filePath,
        extension: ext,
        pageCount: pageCount,
        size: BigInt(fs.statSync(filePath).size),
        isOneShot: finalMeta.isOneShot,
        isReady: true,
      },
    });

    console.log(`   💾 Salvo: ${series.title} - Cap ${finalMeta.number}`);
  }
}
