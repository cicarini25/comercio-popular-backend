FROM node:22-bookworm-slim AS web-build
WORKDIR /build/web

ARG VITE_GOOGLE_CLIENT_ID=
ARG VITE_TERMS_URL=
ARG VITE_PRIVACY_URL=
ARG VITE_AEGISX_URL=
ENV VITE_GOOGLE_CLIENT_ID=${VITE_GOOGLE_CLIENT_ID}
ENV VITE_TERMS_URL=${VITE_TERMS_URL}
ENV VITE_PRIVACY_URL=${VITE_PRIVACY_URL}
ENV VITE_AEGISX_URL=${VITE_AEGISX_URL}

COPY web/package.json ./package.json
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-bookworm-slim AS app
ENV NODE_ENV=production
WORKDIR /app

COPY api/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund
COPY api/src ./src
COPY --from=web-build /build/web/dist ./public

USER node:node
EXPOSE 3334
CMD ["npm", "start"]
