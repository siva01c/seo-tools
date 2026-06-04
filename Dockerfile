FROM apify/actor-node-playwright-chrome:20 AS builder

USER root
RUN sed -i 's/^myuser:/seobot:/g' /etc/passwd /etc/group \
    && mv /home/myuser /home/seobot \
    && ln -s /home/seobot /home/myuser

WORKDIR /home/seobot

COPY --chown=seobot package*.json ./
COPY --chown=seobot tsconfig.json ./

RUN npm ci --include=dev --audit=false --ignore-scripts

COPY --chown=seobot src/ ./src/
COPY --chown=seobot config/ ./config/
COPY --chown=seobot scripts/ ./scripts/

RUN npm run build

# ─── test stage ──────────────────────────────────────────────────────────────
FROM apify/actor-node-playwright-chrome:20 AS test

USER root
RUN sed -i 's/^myuser:/seobot:/g' /etc/passwd /etc/group \
    && mv /home/myuser /home/seobot \
    && ln -s /home/seobot /home/myuser

WORKDIR /home/seobot

COPY --chown=seobot package*.json ./
COPY --chown=seobot tsconfig.json ./
RUN npm ci --include=dev --audit=false --ignore-scripts

COPY --chown=seobot src/ ./src/
COPY --chown=seobot config/ ./config/
COPY --chown=seobot scripts/ ./scripts/
COPY --chown=seobot jest.config.js ./

USER seobot

CMD ["npm", "test"]

# ─── production stage ─────────────────────────────────────────────────────────
FROM apify/actor-node-playwright-chrome:20

USER root
RUN sed -i 's/^myuser:/seobot:/g' /etc/passwd /etc/group \
    && mv /home/myuser /home/seobot \
    && ln -s /home/seobot /home/myuser

WORKDIR /home/seobot

COPY --chown=seobot package*.json ./

RUN npm ci --omit=dev --omit=optional --audit=false --ignore-scripts

COPY --from=builder --chown=seobot /home/seobot/dist ./dist

COPY --chown=seobot config/ ./config/
COPY --chown=seobot .actor/ ./.actor/
COPY --chown=seobot README.md ./

RUN mkdir -p storage && chown seobot:seobot storage

RUN echo "Installed NPM packages:" \
    && (npm list --omit=dev --all || true) \
    && echo "Node.js version:" \
    && node --version \
    && echo "NPM version:" \
    && npm --version \
    && echo "Available files:" \
    && ls -la

USER seobot

CMD ./start_xvfb_and_run_cmd.sh && npm run start:prod --silent
