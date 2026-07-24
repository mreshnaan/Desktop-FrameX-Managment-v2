FROM node:20-slim AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile

# Vite inlines VITE_* env vars into the client bundle at BUILD time, not at
# container runtime. For a real hosted deployment you MUST pass the API's
# public URL as a build arg, e.g.:
#   docker build --build-arg VITE_API_URL=https://api.your-domain.example -t cue-room-web -f apps/web/Dockerfile .
# Omitting --build-arg falls back to http://localhost:4000 (see
# apps/web/src/lib/api/client.ts), which only works when the browser and API
# are on the same machine -- fine for local testing, broken for any real
# deployment where the browser can't reach "localhost" on the server host.
ARG VITE_API_URL
ENV VITE_API_URL=$VITE_API_URL
RUN pnpm --filter @cue-room/web build

FROM nginx:1.27-alpine AS runtime
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
