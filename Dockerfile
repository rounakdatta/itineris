# Stage 1: build the static site. `npm run build` first regenerates the seed
# (seed/ + public/data + public/media) via its pre-hook, so dist/ carries the
# demo gallery and the image also carries the private seed library.
FROM node:24-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

# Stage 2: serve it. nginx-unprivileged runs as uid 101, listens on 8080 and
# keeps its pid file and every *_temp_path under /tmp -- which is what lets the
# chart run this with a read-only root filesystem and every capability dropped.
FROM nginxinc/nginx-unprivileged:1.28-alpine
LABEL org.opencontainers.image.source="https://github.com/rounakdatta/itineris"
COPY nginx/default.conf /etc/nginx/conf.d/default.conf
COPY nginx/security-headers.conf /etc/nginx/security-headers.conf
COPY --from=builder /app/dist /usr/share/nginx/html
# The private half of the seed, OUTSIDE the served root: the chart's
# initContainer copies it onto a fresh volume so the admin finds a library.
COPY --from=builder /app/seed/library /seed/library
EXPOSE 8080
