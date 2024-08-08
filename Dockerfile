FROM node:14

# Create app directory
WORKDIR /usr/src/app

# Install app dependencies
COPY package*.json ./
RUN npm install

# Bundle app source
COPY . .

# Ensure the data directory exists
RUN mkdir -p /app/data

# Expose the application port
EXPOSE 3000

# Start the application
CMD ["node", "src/indexer.js"]
