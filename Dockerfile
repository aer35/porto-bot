# Build stage: full dependencies, compiles TypeScript. compose.yaml's dev profile also runs this stage.
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
COPY migrations ./migrations
RUN npm run build

# Runtime stage: production dependencies and compiled output only.
FROM node:24-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY migrations ./migrations
# A named volume copies this directory's ownership on first mount, so the node user can write the database.
RUN mkdir /data && chown node:node /data
USER node
CMD ["node", "dist/index.js"]
