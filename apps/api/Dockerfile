FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @cue-room/api build
RUN pnpm --filter @cue-room/api exec prisma generate
RUN pnpm --filter @cue-room/api deploy --prod /out

FROM node:20-slim AS runtime
RUN corepack enable
WORKDIR /app
COPY --from=build /out .
EXPOSE 4000
CMD ["node", "dist/server.js"]
