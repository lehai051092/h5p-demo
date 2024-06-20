# Stage 1: Build Stage
FROM node:lts AS build

WORKDIR /app
COPY package*.json ./
COPY yarn.lock ./
COPY download-core.sh ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn build

# Stage 2: Production Stage
FROM node:lts

USER node
WORKDIR /home/node/h5p-nodejs-library

COPY --from=build --chown=node:node /app ./
RUN yarn install --production --frozen-lockfile

EXPOSE 8080
CMD [ "node", "build/index.js" ]
