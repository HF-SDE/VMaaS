FROM node:26-alpine AS base

# Setting the timezone
RUN apk add -U tzdata
RUN cp /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime

# Set working directory
WORKDIR /usr/src/app

# The file:../shared dependency resolves at install time, so the shared
# package must land at /usr/src/shared before npm install runs.
COPY shared/ /usr/src/shared/

# Copy package.json and install dependencies
COPY backend/package.json ./
RUN npm install

# Copy other application files
COPY backend/ ./

# Generate Prisma types
RUN npx prisma generate

RUN chmod +x ./entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["./entrypoint.sh"]

CMD ["npm", "run", "dev"]
