import Fastify from "fastify";
import cors from "@fastify/cors"; // Instale: npm i @fastify/cors
import {
  validatorCompiler,
  serializerCompiler,
} from "fastify-type-provider-zod";
import fastifyMultipart from "@fastify/multipart";
import { appRoutes } from "./routes.ts";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config.ts";

const app = Fastify({ logger: true, bodyLimit: config.bodyLimit });

app.register(fastifyMultipart, {
  limits: { fileSize: config.fileUploadLimit },
}); // Limite de upload configurável

app.register(cors, {
  origin: config.corsOrigins ?? true,
}); // Origem configurável via env

app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

app.register(rateLimit, {
  max: config.rateLimit.max, // Máximo de requisições
  timeWindow: config.rateLimit.timeWindow, // Por IP
  errorResponseBuilder: () => ({ error: "Muitas requisições. Acalme-se." }),
});

app.register(appRoutes);

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

  if (error.code === "P2002") {
    return reply.status(409).send({ error: "Conflito de dados" });
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
    await app.listen({ port: 3000, host: "0.0.0.0" }, (err, address) => {
      if (err) {
        app.log.error(err);
        process.exit(1);
      }
      app.log.info(`Servidor rodando em ${address}`);
    });
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
};

start();
