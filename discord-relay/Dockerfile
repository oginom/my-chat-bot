FROM node:22.22.2-alpine

RUN corepack enable

WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY src ./src
COPY tsconfig.json ./

CMD ["pnpm", "start"]
