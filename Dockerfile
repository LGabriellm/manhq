# 1. Base Image: Node 20 (Debian Slim - Leve e Compatível)
FROM node:20-slim

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

# 9. Limpeza (Opcional, mas bom pro i3): Remove libs de desenvolvimento
# RUN npm prune --production

# 10. Expor a porta
EXPOSE 3000

# 11. Comando para iniciar
CMD ["npm", "start"]
