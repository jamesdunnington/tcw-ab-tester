FROM node:20-alpine AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/db/package.json packages/db/package.json
COPY hub/apps/worker/package.json hub/apps/worker/package.json
RUN npm ci --workspace=@tcw/shared --workspace=@tcw/db --workspace=@tcw/worker --include-workspace-root

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY tsconfig.base.json ./tsconfig.base.json
COPY packages/shared packages/shared
COPY packages/db packages/db
COPY hub/apps/worker hub/apps/worker
RUN npm run build -w @tcw/shared && npm run build -w @tcw/db && npm run build -w @tcw/worker

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/db/dist packages/db/dist
COPY --from=build /app/packages/db/package.json packages/db/package.json
COPY --from=build /app/hub/apps/worker/dist hub/apps/worker/dist
COPY --from=build /app/hub/apps/worker/package.json hub/apps/worker/package.json
WORKDIR /app/hub/apps/worker
CMD ["node", "dist/index.js"]
