FROM oven/bun:1-alpine

WORKDIR /app
COPY package.json bun.lockb* ./
RUN bun install
COPY . .
EXPOSE 3003
CMD ["bun", "src/index.ts"]
