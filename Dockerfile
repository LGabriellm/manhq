# 1. Base Image: Node 20 (Debian Slim - Leve e Compatível)
FROM node:22-slim AS base

# 2. Instalar dependências do SISTEMA (Obrigatório para PDF e Prisma)
# - openssl: Necessário para o Prisma
# - poppler-utils: Necessário para o pdf-to-img
# - ca-certificates: Para HTTPS
RUN apt-get update -y && \
    apt-get install -y openssl poppler-utils ca-certificates && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

# 3. Definir diretório de trabalho
WORKDIR /app

# 4. Stage de build
FROM base AS build

# 4. Copiar arquivos de dependência primeiro (Cache Layer)
COPY package*.json ./
COPY prisma ./prisma/

# 5. Instalar dependências do Node
# O 'npm ci' é mais rápido e seguro que 'npm install' para produção
RUN npm ci

# 6. Gerar o cliente do Prisma
RUN npx prisma generate

# 7. Copiar o resto do código fonte
COPY . .

# 8. Compilar o TypeScript para JavaScript (Pasta dist)
RUN npm run build

# 9. Limpeza: remove dependências de desenvolvimento
RUN npm prune --omit=dev

# 10. Stage runtime
FROM base AS runtime

ENV NODE_ENV=production

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

# 11. Expor a porta
EXPOSE 3000

# 12. Comando para iniciar
CMD ["npm", "start"]
