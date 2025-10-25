FROM node:22-alpine3.21

WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./
COPY tsconfig.json ./

# Install dependencies
RUN npm ci --only=production

# Copy source code
COPY src ./src

# Set environment to production
ENV NODE_ENV=production

# Expose the port your app runs on (adjust if needed)
EXPOSE 3000

# Run the application
CMD ["node", "src/index.ts"]