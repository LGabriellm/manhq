import Fastify from "fastify";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../lib/prisma.ts";
import { config } from "../config.ts";

export class AuthController {
  // Rota: POST /register
  async register(req: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    const { name, email, password } = req.body as any;

    if (!email || !password) {
      return reply
        .status(400)
        .send({ error: "Email e senha são obrigatórios" });
    }

    // Verifica se já existe
    const userExists = await prisma.user.findUnique({ where: { email } });
    if (userExists) {
      return reply.status(400).send({ error: "Usuário já existe" });
    }

    // Criptografa a senha (Nunca salve senha pura!)
    const passwordHash = await bcrypt.hash(password, 6);

    // Cria usuário
    const user = await prisma.user.create({
      data: {
        name,
        email,
        passwordHash,
        role: "SUBSCRIBER", // Padrão
        subStatus: "ACTIVE", // Para testes, já nasce ativo
      },
    });

    return reply.send({
      id: user.id,
      name: user.name,
      email: user.email,
    });
  }

  // Rota: POST /login
  async login(req: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    const { email, password } = req.body as any;

    // 1. Busca usuário
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    // 2. Compara senha
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      return reply.status(401).send({ error: "Credenciais inválidas" });
    }

    // 3. Verifica Status (Regra de Negócio para App Pago)
    if (user.role !== "ADMIN" && user.subStatus !== "ACTIVE") {
      return reply
        .status(403)
        .send({ error: "Assinatura inativa. Renove para acessar." });
    }

    // 4. Gera Token JWT
    const token = jwt.sign(
      {
        id: user.id,
        role: user.role,
        name: user.name,
      },
      config.jwtSecret,
      { expiresIn: "7d" }, // Token dura 7 dias
    );

    return reply.send({
      token,
      user: { name: user.name, email: user.email, role: user.role },
    });
  }

  // Rota: GET /me (Para o frontend saber quem está logado ao recarregar a página)
  async me(req: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    // @ts-ignore
    const userId = req.user.id;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        subStatus: true,
      },
    });

    return user;
  }
}
