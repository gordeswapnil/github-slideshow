const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const logAudit = async ({ userId, action, entity, entityId, details, req }) => {
  try {
    await prisma.auditLog.create({
      data: {
        userId: userId || null,
        action,
        entity,
        entityId: entityId || null,
        details: details || null,
        ipAddress: req?.ip || req?.connection?.remoteAddress || null,
        userAgent: req?.headers?.['user-agent'] || null,
      },
    });
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
};

module.exports = { logAudit };
