FROM node:22-alpine AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/core/package.json packages/core/package.json
COPY packages/messaging/package.json packages/messaging/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/world/package.json apps/world/package.json
RUN pnpm install --frozen-lockfile
COPY packages packages
COPY apps apps

FROM base AS server
RUN pnpm --filter @game/server build
EXPOSE 3001
CMD ["pnpm", "--filter", "@game/server", "start"]

FROM base AS world
RUN pnpm --filter @game/world build
EXPOSE 3002
CMD ["pnpm", "--filter", "@game/world", "start"]

FROM base AS web-build
RUN pnpm --filter @game/web build

FROM nginx:1.27-alpine AS web
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=web-build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
