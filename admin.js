'use strict';

async function handleAdminMessage(ctx) {
  const name = ctx.from?.first_name || 'الأدمن';
  await ctx.reply(`مرحباً بك أيها الأدمن (${name}) — هذا رد صادر من ملف admin.js`);
}

module.exports = { handleAdminMessage };
