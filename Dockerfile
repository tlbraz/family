FROM node:22-alpine AS build
WORKDIR /app
# Tools to compile better-sqlite3 (used by Actual Budget's API) if no prebuilt binary matches.
RUN apk add --no-cache python3 make g++
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache tzdata
# Coolify passes the git commit as a build arg; bake it in so /api/health can report it.
ARG SOURCE_COMMIT=dev
ENV NODE_ENV=production PORT=3000 SOURCE_COMMIT=$SOURCE_COMMIT
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "dist/server/index.js"]
