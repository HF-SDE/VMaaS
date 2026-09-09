FROM node:26-alpine AS base

# Setting the timezone
RUN apk add -U tzdata
RUN cp /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime

# Set working directory
WORKDIR /usr/src/app

# Copy package.json and install dependencies
COPY package.json ./
RUN npm install

# Copy other application files
COPY . .

# Generate Prisma types
RUN npx prisma generate

EXPOSE 5000

CMD ["npm", "run", "dev"]
