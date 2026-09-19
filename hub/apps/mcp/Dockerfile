FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/stats/package.json packages/stats/package.json
COPY packages/core/package.json packages/core/package.json
COPY hub/apps/mcp/package.json hub/apps/mcp/package.json
RUN npm ci --workspace=@tcw/shared --workspace=@tcw/db --workspace=@tcw/stats --workspace=@tcw/core --workspace=@tcw/mcp --include-workspace-root

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY packages/stats packages/stats
COPY packages/core packages/core
COPY hub/apps/mcp hub/apps/mcp
RUN npm run build -w @tcw/shared && npm run build -w @tcw/db && npm run build -w @tcw/stats && npm run build -w @tcw/core && npm run build -w @tcw/mcp

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
COPY --from=build /app/hub/apps/mcp/dist hub/apps/mcp/dist
COPY --from=build /app/hub/apps/mcp/package.json hub/apps/mcp/package.json
WORKDIR /app/hub/apps/mcp
EXPOSE 4100
# The api container runs the migrations (the OAuth tables are in migration 0002), so this one only serves.
CMD ["node", "dist/index.js"]
