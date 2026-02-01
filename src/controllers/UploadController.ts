import Fastify from "fastify";
import util from "util";
import { pipeline } from "stream";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { OptimizerService } from "../services/Optimizer.ts";
import { ScannerService } from "../services/Scanner.ts";
import { config } from "../config.ts";

const pump = util.promisify(pipeline);
const optimizer = new OptimizerService();
const scanner = new ScannerService();
const allowedExtensions = new Set([".cbz", ".cbr", ".pdf", ".epub", ".zip"]);

export class UploadController {
  private normalizeFilename(originalName: string) {
    const baseName = path.basename(originalName || "upload");
    const safeName = baseName.replace(/[^\w.\-() ]+/g, "_");
    const ext = path.extname(safeName).toLowerCase();
    return { safeName, ext };
  }

  private createTempPath(safeName: string, ext: string) {
    const tempName = `${path.parse(safeName).name}-${crypto.randomUUID()}${ext}`;
    return path.join(config.tempPath, tempName);
  }

  async uploadFile(req: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    // Pega o arquivo do multipart
    const data: any = await req.file();

    if (!data) {
      return reply.status(400).send({ error: "Nenhum arquivo enviado" });
    }

    const { safeName, ext } = this.normalizeFilename(data.filename);

    if (!allowedExtensions.has(ext)) {
      return reply.status(400).send({ error: "Tipo de arquivo não permitido" });
    }

    const tempPath = this.createTempPath(safeName, ext);

    // Garante pasta temp
    if (!fs.existsSync(path.dirname(tempPath)))
      fs.mkdirSync(path.dirname(tempPath), { recursive: true });

    // Salva o stream no disco (Upload rápido)
    await pump(data.file, fs.createWriteStream(tempPath));

    // RESPOSTA IMEDIATA AO USUÁRIO
    // Não esperamos a otimização terminar para responder, senão o navegador trava no loading.
    reply.send({
      message: "Upload recebido! Processamento iniciado em background.",
    });

    // --- PROCESSO EM BACKGROUND ---
    // Isso roda depois de responder ao usuário
    (async () => {
      try {
        console.log("🚀 Iniciando processamento background...");

        // 1. Otimiza e Organiza
        const finalPath = await optimizer.processUpload(tempPath, safeName);

        // 2. Chama o Scanner apenas para essa pasta/arquivo para registrar no banco
        // (Aqui precisaríamos adaptar o scanner para escanear um arquivo específico
        // ou a pasta da série, para não re-escanear tudo)
        // Por enquanto, apenas logamos.
        console.log("✅ Processo concluído:", finalPath);
      } catch (err) {
        console.error("Erro no processamento background:", err);
      }
    })();
  }

  async uploadBulk(req: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    const files = req.files();
    const queued: Array<{ tempPath: string; safeName: string }> = [];
    const rejected: Array<{ filename: string; reason: string }> = [];

    for await (const data of files) {
      const filename = data.filename || "upload";
      const { safeName, ext } = this.normalizeFilename(filename);

      if (!allowedExtensions.has(ext)) {
        rejected.push({ filename, reason: "Tipo de arquivo não permitido" });
        data.file.resume();
        continue;
      }

      const tempPath = this.createTempPath(safeName, ext);

      if (!fs.existsSync(path.dirname(tempPath))) {
        fs.mkdirSync(path.dirname(tempPath), { recursive: true });
      }

      await pump(data.file, fs.createWriteStream(tempPath));
      queued.push({ tempPath, safeName });
    }

    if (queued.length === 0) {
      return reply.status(400).send({
        error: "Nenhum arquivo válido enviado",
        rejected,
      });
    }

    reply.status(202).send({
      message: "Upload recebido! Processamento iniciado em background.",
      accepted: queued.length,
      rejected,
    });

    (async () => {
      for (const item of queued) {
        try {
          console.log("🚀 Iniciando processamento background...");
          const finalPath = await optimizer.processUpload(
            item.tempPath,
            item.safeName,
          );
          console.log("✅ Processo concluído:", finalPath);
        } catch (err) {
          console.error("Erro no processamento background:", err);
        }
      }
    })();
  }
}
