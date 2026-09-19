FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/stats/package.json packages/stats/package.json
COPY packages/core/package.json packages/core/package.json
COPY packages/tracker/package.json packages/tracker/package.json
COPY hub/apps/api/package.json hub/apps/api/package.json
RUN npm ci --workspace=@tcw/shared --workspace=@tcw/db --workspace=@tcw/stats --workspace=@tcw/core --workspace=@tcw/tracker --workspace=@tcw/api --include-workspace-root

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/stats packages/stats
COPY packages/core packages/core
COPY packages/tracker packages/tracker
COPY hub/apps/api hub/apps/api
RUN npm run build -w @tcw/shared \
 && npm run build -w @tcw/db \
 && npm run build -w @tcw/stats \
 && npm run build -w @tcw/core \
 && npm run tracker:build \
 && npm run build -w @tcw/api

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/package.json packages/db/package.json
COPY --from=build /app/packages/stats/dist packages/stats/dist
COPY --from=build /app/packages/stats/package.json packages/stats/package.json
COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/packages/core/package.json packages/core/package.json
COPY --from=build /app/hub/apps/api/dist hub/apps/api/dist
COPY --from=build /app/hub/apps/api/public hub/apps/api/public
COPY --from=build /app/hub/apps/api/package.json hub/apps/api/package.json
COPY --from=build /app/hub/apps/api/drizzle hub/apps/api/drizzle
WORKDIR /app/hub/apps/api
EXPOSE 4000
# Migrations are safe to re-run (drizzle tracks what is already applied) —
# running them on every start keeps a fresh deploy and a restart both correct
# with no separate migration step to remember.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/index.js"]
