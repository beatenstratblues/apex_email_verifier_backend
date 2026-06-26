# Use a lean official Node.js Alpine base image
FROM node:20-alpine AS base

# Set the working directory inside the container
WORKDIR /usr/src/app

# Copy dependency definition files first to leverage Docker layer caching
COPY package*.json ./

# Install production-only dependencies
RUN npm ci --only=production && npm cache clean --force

# Copy the rest of the application source code
COPY . .

# Ensure the logs directory exists and the application workspace is owned by the node user
RUN mkdir -p logs && chown -R node:node /usr/src/app

# Switch to the non-root node user for security
USER node

# Expose the application port (default is 8080)
EXPOSE 8083

# Set default runtime environment variables
ENV NODE_ENV=production
ENV PORT=8083

# Command to start the application
CMD [ "node", "server.js" ]
