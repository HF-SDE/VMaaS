FROM node:26-alpine AS base

# Setting the timezone
RUN apk add -U tzdata && \
    cp /usr/share/zoneinfo/Europe/Copenhagen /etc/localtime

# Set working directory
WORKDIR /usr/src/app

# The file:../shared dependency resolves at install time, so the shared
# package must land at /usr/src/shared before npm install runs.
COPY shared/package.json /usr/src/shared/package.json
RUN npm install --prefix /usr/src/shared --omit=dev --no-package-lock
COPY shared/ /usr/src/shared/

# Copy package.json/package-lock.json and install dependencies
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

# Copy other application files
COPY backend/ ./

# Generate Prisma types
RUN npx prisma generate

RUN chmod +x ./entrypoint.sh

EXPOSE 5000

ENTRYPOINT ["./entrypoint.sh"]

CMD ["npm", "run", "dev"]
