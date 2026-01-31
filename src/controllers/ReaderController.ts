import Fastify from "fastify";
import fs from "fs";
import yauzl from "yauzl";
import { createExtractorFromData } from "node-unrar-js";
import mime from "mime-types";
import { prisma } from "../lib/prisma.ts";

// --- CACHE DE ESTRUTURA ---
// Guarda a lista de arquivos para não ter que abrir o ZIP toda hora só pra ver o índice
const structureCache = new Map<
  string,
  { files: string[]; lastAccess: number }
>();
const MAX_CACHE_ENTRIES = 500;

const pruneCache = () => {
  if (structureCache.size <= MAX_CACHE_ENTRIES) return;
  let oldestKey: string | null = null;
  let oldestAccess = Infinity;
  for (const [key, val] of structureCache.entries()) {
    if (val.lastAccess < oldestAccess) {
      oldestAccess = val.lastAccess;
      oldestKey = key;
    }
  }
  if (oldestKey) structureCache.delete(oldestKey);
};

// Limpeza automática do cache (1 hora)
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of structureCache.entries()) {
    if (now - val.lastAccess > 3600000) structureCache.delete(key);
  }
}, 3600000);

const pdfLib = await import("pdf-to-img").catch(() => null);

export class ReaderController {
  /**
   * --- HELPERS DO YAUZL (Promise Wrappers) ---
   * O yauzl é antigo e usa callbacks. Transformamos em Promises para usar async/await.
   */

  // Abre o ZIP e retorna o "handle"
  private openZip(path: string): Promise<yauzl.ZipFile> {
    return new Promise((resolve, reject) => {
      // autoClose: false é CRUCIAL aqui.
      // Queremos controlar manualmente quando fechar para não fechar no meio do stream.
      yauzl.open(
        path,
        { lazyEntries: true, autoClose: false },
        (err, zipfile) => {
          if (err) reject(err);
          else resolve(zipfile);
        },
      );
    });
  }

  // Lê todos os nomes de arquivo dentro do ZIP (sem extrair os dados)
  private getZipEntries(zipfile: yauzl.ZipFile): Promise<string[]> {
    return new Promise((resolve, reject) => {
      const files: string[] = [];

      // 1. Configura ouvintes PRIMEIRO
      zipfile.on("entry", (entry) => {
        // Ignora pastas e arquivos que não são imagem
        if (
          !/\/$/.test(entry.fileName) &&
          entry.fileName.match(/\.(jpg|jpeg|png|webp|gif|avif)$/i)
        ) {
          files.push(entry.fileName);
        }
        zipfile.readEntry();
      });

      zipfile.on("end", () => resolve(files));
      zipfile.on("error", (err) => reject(err));

      // 2. Começa a ler DEPOIS
      zipfile.readEntry();
    });
  }

  private getZipStreamAndSize(
    zipfile: yauzl.ZipFile,
    fileName: string,
  ): Promise<{ stream: NodeJS.ReadableStream; size: number } | null> {
    return new Promise((resolve, reject) => {
      zipfile.on("entry", (entry) => {
        if (entry.fileName === fileName) {
          zipfile.openReadStream(entry, (err, readStream) => {
            if (err) reject(err);
            else resolve({ stream: readStream, size: entry.uncompressedSize });
          });
        } else {
          zipfile.readEntry();
        }
      });

      zipfile.on("end", () => resolve(null));
      zipfile.on("error", (err) => reject(err));
      zipfile.readEntry();
    });
  }
  /**
   * --- LÓGICA DE ORDENAÇÃO E CACHE ---
   */

  private async getCachedStructure(
    id: string,
    path: string,
    extension: string,
  ): Promise<string[]> {
    const cached = structureCache.get(id);
    if (cached) {
      cached.lastAccess = Date.now();
      return cached.files;
    }

    let files: string[] = [];

    if (extension === "cbz" || extension === "zip") {
      const zipfile = await this.openZip(path);
      try {
        files = await this.getZipEntries(zipfile);
      } finally {
        zipfile.close(); // Fecha após ler o índice
      }
    } else if (extension === "cbr") {
      const buf = Uint8Array.from(fs.readFileSync(path)).buffer;
      const extractor = await createExtractorFromData({ data: buf });
      const list = extractor.getFileList();
      files = [...list.fileHeaders]
        .filter(
          (h) =>
            !h.flags.directory &&
            h.name.match(/\.(jpg|jpeg|png|webp|gif|avif)$/i),
        )
        .map((h) => h.name);
    } else if (extension === "pdf" && pdfLib) {
      const doc = await pdfLib.pdf(path);
      let count = 0;
      for await (const _ of doc) count++;
      return Array.from({ length: count }, (_, i) => i.toString());
    }

    files.sort((a, b) =>
      a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
    );
    structureCache.set(id, { files, lastAccess: Date.now() });
    pruneCache();
    return files;
  }
  /**
   * --- CONTROLLERS ---
   */

  async getChapterInfo(
    req: Fastify.FastifyRequest<{ Params: { id: string } }>,
    reply: Fastify.FastifyReply,
  ) {
    const { id } = req.params;
    try {
      const media = await prisma.media.findUnique({ where: { id } });
      if (!media || !media.path)
        return reply.status(404).send({ error: "Arquivo não encontrado" });

      const files = await this.getCachedStructure(
        media.id,
        media.path,
        media.extension || "cbz",
      );

      if (media.extension === "pdf" && !pdfLib) {
        return reply.status(501).send({ error: "Leitor de PDF indisponível" });
      }

      if (media.pageCount !== files.length) {
        await prisma.media.update({
          where: { id },
          data: { pageCount: files.length },
        });
      }

      return {
        id: media.id,
        title: media.title,
        pages: files.length,
        type: media.extension,
      };
    } catch (e) {
      console.error("Erro Info:", e);
      return reply.status(500).send({ error: "Erro interno" });
    }
  }

  async getPage(
    req: Fastify.FastifyRequest<{ Params: { id: string; page: string } }>,
    reply: Fastify.FastifyReply,
  ) {
    const { id, page } = req.params;
    const pageIndex = parseInt(page) - 1;

    try {
      const media = await prisma.media.findUnique({
        where: { id },
        select: { id: true, path: true, extension: true },
      });

      if (!media || !media.path)
        return reply.status(404).send("Mídia não encontrada");

      const files = await this.getCachedStructure(
        media.id,
        media.path,
        media.extension || "cbz",
      );

      if (pageIndex < 0 || pageIndex >= files.length) {
        return reply.status(404).send("Página fora do limite");
      }

      const targetFileName = files[pageIndex];

      // === ZIP / CBZ (CORRIGIDO) ===
      if (media.extension === "cbz" || media.extension === "zip") {
        const zipfile = await this.openZip(media.path);

        // Agora pegamos o tamanho também
        const result = await this.getZipStreamAndSize(zipfile, targetFileName);

        if (!result) {
          zipfile.close();
          return reply.status(404).send("Imagem sumiu");
        }

        const { stream, size } = result;
        const type = mime.lookup(targetFileName) || "image/webp";

        reply.header("Content-Type", type);
        reply.header("Content-Length", size); // <--- AJUDA O CLIENTE A NÃO FECHAR ANTES
        reply.header("Cache-Control", "public, max-age=31536000, immutable");

        // --- SOLUÇÃO DO STREAM CLOSED PREMATURELY ---
        // Nós NÃO fechamos o zipfile no 'then' do reply.
        // Nós ensinamos o stream a fechar o zipfile quando ELE acabar.

        stream.on("end", () => {
          zipfile.close();
        });
        stream.on("close", () => {
          zipfile.close();
        }); // Redundância segura
        stream.on("error", (err) => {
          console.error("Erro no stream do ZIP:", err);
          zipfile.close();
        });

        return reply.send(stream);
      }

      // === CBR ===
      else if (media.extension === "cbr") {
        const buf = Uint8Array.from(fs.readFileSync(media.path)).buffer;
        const extractor = await createExtractorFromData({ data: buf });
        const extracted = extractor.extract({ files: [targetFileName] });
        const filesRar = [...extracted.files];

        if (!filesRar[0]?.extraction) throw new Error("Erro RAR");

        const type = mime.lookup(targetFileName) || "image/jpeg";
        reply.header("Content-Type", type);
        reply.header("Cache-Control", "public, max-age=31536000");
        return reply.send(Buffer.from(filesRar[0].extraction));
      }

      // === PDF ===
      else if (media.extension === "pdf") {
        if (!pdfLib) {
          return reply.status(501).send("Leitor de PDF indisponível");
        }
        const doc = await pdfLib.pdf(media.path, { scale: 2.0 });
        let current = 0;
        for await (const image of doc) {
          if (current === pageIndex) {
            reply.header("Content-Type", "image/png");
            return reply.send(image);
          }
          current++;
          if (current > pageIndex) break;
        }
        return reply.status(404).send("Página fora do limite");
      }

      return reply.status(415).send("Formato não suportado");
    } catch (e) {
      console.error(`Erro leitura pagina:`, e);
      return reply.status(500).send("Erro interno");
    }
  }

  // 3. ATUALIZAR PROGRESSO (Chamado pelo Frontend a cada X segundos ou troca de página)
  // Rota: POST /read/:id/progress
  async updateProgress(
    req: Fastify.FastifyRequest<{
      Params: { id: string };
      Body: { page: number };
    }>,
    reply: Fastify.FastifyReply,
  ) {
    const { id } = req.params;
    const { page } = req.body;
    // @ts-ignore
    const userId = req.user.id; // Vem do AuthMiddleware

    if (!userId) return reply.status(401).send({ error: "Não autenticado" });

    try {
      const media = await prisma.media.findUnique({
        where: { id },
        select: { pageCount: true },
      });

      if (!media)
        return reply.status(404).send({ error: "Mídia não encontrada" });

      // Lógica inteligente: Se leu mais de 90% das páginas, marca como terminado
      const finished = media.pageCount > 0 && page >= media.pageCount - 1;

      await prisma.readProgress.upsert({
        where: {
          userId_mediaId: { userId, mediaId: id },
        },
        update: {
          page: page,
          finished: finished,
          updatedAt: new Date(),
        },
        create: {
          userId,
          mediaId: id,
          page: page,
          finished: finished,
        },
      });

      return { success: true };
    } catch (e) {
      console.error("Erro ao salvar progresso:", e);
      return reply.status(500).send({ error: "Falha ao salvar" });
    }
  }
}
