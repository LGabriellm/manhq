import "dotenv/config";
import Fastify from "fastify";
import jwt from "jsonwebtoken";
import { config } from "../config.ts";

export async function authMiddleware(
  req: Fastify.FastifyRequest,
  reply: Fastify.FastifyReply,
) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return reply.status(401).send({ error: "Token não fornecido" });
    }

    // O header vem como "Bearer eyJhbGci..."
    const token = authHeader.replace("Bearer ", "");

    // Verifica a assinatura do token
    const decoded = jwt.verify(token, config.jwtSecret);

    // Anexa o usuário decodificado na requisição para usarmos nos controllers
    // (Ex: saber quem está lendo para salvar histórico)
    // @ts-ignore
    req.user = decoded;
  } catch (err) {
    return reply.status(401).send({ error: "Token inválido ou expirado" });
  }
}
