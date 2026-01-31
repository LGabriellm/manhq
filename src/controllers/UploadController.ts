import Fastify from "fastify";
import util from "util";
import { pipeline } from "stream";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { OptimizerService } from "../services/Optimizer.ts";
import { ScannerService } from "../services/Scanner.ts";

const pump = util.promisify(pipeline);
const optimizer = new OptimizerService();
const scanner = new ScannerService();

export class UploadController {
  async uploadFile(req: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    // Pega o arquivo do multipart
    const data: any = await req.file();

    if (!data) {
      return reply.status(400).send({ error: "Nenhum arquivo enviado" });
    }

    const originalName = data.filename ? path.basename(data.filename) : "upload";
    const safeName = originalName.replace(/[^\w.\-() ]+/g, "_");
    const ext = path.extname(safeName).toLowerCase();
    const allowed = new Set([".cbz", ".cbr", ".pdf", ".epub", ".zip"]);

    if (!allowed.has(ext)) {
      return reply.status(400).send({ error: "Tipo de arquivo não permitido" });
    }

    const tempName = `${path.parse(safeName).name}-${crypto.randomUUID()}${ext}`;
    const tempPath = path.join(process.cwd(), "temp", tempName);

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
}
