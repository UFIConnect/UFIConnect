# Build on glibc so the canvas development dependency can use its Linux prebuild.
FROM node:24-bookworm-slim AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Public API address only. Secrets must never be passed as Vite build arguments.
ARG VITE_API_URL=""
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

FROM nginx:alpine AS runtime
ENV API_UPSTREAM=backend:3000
ENV NGINX_ENVSUBST_FILTER="^API_UPSTREAM$"

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
