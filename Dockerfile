# ASTRAL Smart Agenda — imagem de produção
# 1) Compila o aplicativo; 2) roda só o pacote final (sem node_modules em produção).

FROM node:22-slim AS build
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund --omit=optional
COPY . .
RUN npm run build && npm test

FROM node:22-slim
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/data/astral.db \
    ATTACHMENTS_DIR=/data/anexos \
    BACKUP_DIR=/data/backups \
    APP_TIMEZONE=America/Cuiaba \
    TZ=America/Cuiaba
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package.json ./
RUN mkdir -p /data && chown -R node:node /data /app
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "dist/server.mjs"]
