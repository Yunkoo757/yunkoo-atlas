FROM node:24-alpine

WORKDIR /app
COPY app.mjs index.mjs ./

ENV NODE_ENV=production
ENV ATLAS_SYNC_DATABASE=/data/atlas-sync.db
EXPOSE 8787

CMD ["node", "--disable-warning=ExperimentalWarning", "index.mjs"]
