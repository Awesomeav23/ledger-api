# Ledger API

Transaction ledger API with fraud detection rules, built with TypeScript, Node.js/Express, and PostgreSQL.

## Run locally

    npm install
    cp .env.example .env
    npm run db:up
    npm run dev

Health check: `curl http://localhost:3010/health`
