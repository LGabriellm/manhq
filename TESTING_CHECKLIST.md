# Testing Checklist

## Automação básica
- [ ] `npm run build`
- [ ] `npm run test`

## Banco/Prisma (quando aplicável)
- [ ] `npx prisma validate`
- [ ] `npx prisma migrate status`

## Smoke tests locais
- [ ] `npm run dev` (subir o servidor e validar `/` e `/login` com `curl` ou Postman)
