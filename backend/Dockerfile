FROM node:20-alpine
WORKDIR /app

RUN addgroup -g 1001 appgroup && \
    adduser -D -u 1001 -G appgroup appuser && \
    chown appuser:appgroup /app

USER appuser

COPY --chown=appuser:appgroup package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --chown=appuser:appgroup . .

RUN mkdir -p /app/uploads

EXPOSE 3001
CMD ["node", "src/index.js"]
