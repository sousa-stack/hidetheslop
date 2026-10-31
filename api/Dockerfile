FROM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:26-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY drizzle ./drizzle
COPY package.json ./
USER node
# Migrations run as `node dist/migrate.js`, never through npm, which wants to write
# to a read-only filesystem.
CMD ["node", "dist/server.js"]
