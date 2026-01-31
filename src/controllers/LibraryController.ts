import Fastify from "fastify";
import { prisma } from "../lib/prisma.ts";

export class LibraryController {
  // 1. LISTAR TODAS AS SÉRIES (A "Netflix" dos mangás)
  async listSeries(req: Fastify.FastifyRequest, reply: Fastify.FastifyReply) {
    try {
      const series = await prisma.series.findMany({
        orderBy: { updatedAt: "desc" }, // As mais recentes primeiro
        include: {
          _count: { select: { medias: true } }, // Retorna: { _count: { medias: 10 } }

          // Tenta pegar a capa do primeiro volume/capítulo disponível
          medias: {
            take: 1,
            orderBy: { number: "asc" },
            select: { id: true, number: true },
          },
        },
      });

      return series;
    } catch (error) {
      console.error(error);
      return reply.status(500).send({ error: "Erro ao listar biblioteca" });
    }
  }

  // 2. DETALHES DA SÉRIE (Lista de Capítulos)
  async getSeriesDetails(
    req: Fastify.FastifyRequest<{ Params: { id: string } }>,
    reply: Fastify.FastifyReply,
  ) {
    const { id } = req.params;

    try {
      const series = await prisma.series.findUnique({
        where: { id },
        include: {
          medias: {
            orderBy: { number: "asc" }, // Ordena: 1, 1.5, 2, ...
            select: {
              id: true,
              title: true,
              number: true,
              volume: true, // Importante mostrar o volume
              isOneShot: true,
              isReady: true,
              extension: true, // Para o front saber se é PDF ou Imagem
            },
          },
        },
      });

      if (!series) {
        return reply.status(404).send({ error: "Série não encontrada" });
      }

      return series;
    } catch (error) {
      console.error(error);
      return reply
        .status(500)
        .send({ error: "Erro ao buscar detalhes da série" });
    }
  }
}
