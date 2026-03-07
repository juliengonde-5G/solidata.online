FROM node:20
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
RUN mkdir -p /app/uploads
EXPOSE 3001
CMD ["node", "src/index.js"]
