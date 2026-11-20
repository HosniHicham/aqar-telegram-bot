'use strict';

async function handleUserMessage(ctx) {
  const name = ctx.from?.first_name || 'العميل';
  await ctx.reply(`مرحباً بك أيها العميل (${name}) — هذا رد صادر من ملف users.js`);
}

module.exports = { handleUserMessage };
