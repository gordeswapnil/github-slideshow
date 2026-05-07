const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL + '?connection_limit=5&pool_timeout=10' } },
});

module.exports = prisma;
