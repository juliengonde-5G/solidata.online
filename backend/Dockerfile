FROM node:20-alpine
WORKDIR /app

# Client PostgreSQL (pg_dump / psql) requis par les sauvegardes/restaurations
# du module Admin DB. Version alignée sur le serveur (postgis/postgis:15-3.4) ;
# fallback sur le méta-paquet si la 15 n'est pas dans le dépôt Alpine courant
# (un client de version ≥ serveur sait dumper un serveur plus ancien).
RUN apk add --no-cache postgresql15-client || apk add --no-cache postgresql-client

RUN addgroup -g 1001 appgroup && \
    adduser -D -u 1001 -G appgroup appuser && \
    chown appuser:appgroup /app

USER appuser

COPY --chown=appuser:appgroup package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=appuser:appgroup . .

# Créés en tant qu'appuser → un volume nommé monté ici hérite de cet
# owner à sa 1re création (sinon Docker crée le point de montage en root et
# l'écriture des sauvegardes échoue en « Permission denied »).
RUN mkdir -p /app/uploads /app/backups

EXPOSE 3001
CMD ["node", "src/index.js"]
