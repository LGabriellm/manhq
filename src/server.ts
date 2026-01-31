import Fastify from "fastify";
import cors from "@fastify/cors"; // Instale: npm i @fastify/cors
import {
  validatorCompiler,
  serializerCompiler,
} from "fastify-type-provider-zod";
import fastifyMultipart from "@fastify/multipart";
import { appRoutes } from "./routes.ts";
import rateLimit from "@fastify/rate-limit";

const app = Fastify({ logger: true, bodyLimit: 1048576 * 100 });

app.register(fastifyMultipart, { limits: { fileSize: 100 * 1024 * 1024 } }); // Limite de 100MB por arquivo

app.register(cors, { origin: true }); // Permite todas as origens (CORS)

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(appRoutes);

app.register(rateLimit, {
  max: 100, // Máximo de 100 requisições
  timeWindow: "1 minute", // Por minuto por IP
  errorResponseBuilder: () => ({ error: "Muitas requisições. Acalme-se." }),
});

app.setErrorHandler((error: any, request, reply) => {
  // Se for erro de validação do Zod
  if (error.validation) {
    return reply.status(400).send({
      error: "Dados inválidos",
      details: error.validation,
    });
  }

  // Se for erro conhecido do Prisma (ex: Registro não encontrado)
  if (error.code === "P2025") {
    return reply.status(404).send({ error: "Registro não encontrado" });
  }

  // Loga o erro real no servidor para você debugar
  app.log.error(error);

  // Resposta genérica para o usuário
  return reply.status(500).send({
    error: "Erro interno do servidor",
    message: error.message, // Em produção, oculte isso
  });
});

const start = async () => {
  try {
    await app.listen({ port: 3000 });
    console.log("🚀 Servidor rodando em http://localhost:3000");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
