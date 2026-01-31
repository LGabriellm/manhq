import Fastify from "fastify";
import util from "util";
import { pipeline } from "stream";
import fs from "fs";
import path from "path";
import { OptimizerService } from "../services/Optimizer.ts";
import { ScannerService } from "../services/Scanner.ts";

const pump = util.promisify(pipeline);
const optimizer = new OptimizerService();
const scanner = new ScannerService();

export class UploadController {
  async uploadFile(req: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    // Pega o arquivo do multipart
    const data: any = await req.file();
    console.log(data);

    if (!data) {
      return reply.status(400).send({ error: "Nenhum arquivo enviado" });
    }

    const tempPath = path.join(process.cwd(), "temp", data.filename);

    // Garante pasta temp
    if (!fs.existsSync(path.dirname(tempPath)))
      fs.mkdirSync(path.dirname(tempPath));

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
        const finalPath = await optimizer.processUpload(
          tempPath,
          data.filename,
        );

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
