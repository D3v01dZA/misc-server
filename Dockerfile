FROM node:22-alpine3.21

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY src ./src

# Build TypeScript
RUN npm run build

# Remove devDependencies after build
RUN npm prune --production

# Set environment to production
ENV NODE_ENV=production

# Expose the port your app runs on (adjust if needed)
EXPOSE 3000

# Run the application
CMD ["node", "build/index.js"]