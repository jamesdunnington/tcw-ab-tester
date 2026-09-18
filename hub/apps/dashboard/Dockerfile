FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY hub/apps/dashboard/package.json hub/apps/dashboard/package.json
RUN npm ci --workspace=@tcw/dashboard --include-workspace-root
COPY tsconfig.base.json ./tsconfig.base.json
COPY hub/apps/dashboard hub/apps/dashboard
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL
RUN npm run build -w @tcw/dashboard

FROM nginx:1.27-alpine AS runtime
COPY --from=build /app/hub/apps/dashboard/dist /usr/share/nginx/html
COPY hub/apps/dashboard/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
