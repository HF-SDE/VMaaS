FROM node:26-bookworm-slim

# Set working directory
WORKDIR /usr/src/app

COPY shared/ /usr/src/shared/
RUN npm install --prefix /usr/src/shared --omit=dev --no-package-lock

COPY admin-frontend/package.json ./
RUN npm i

COPY admin-frontend/ ./

CMD ["npm", "run", "dev"]
