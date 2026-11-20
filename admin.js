'use strict';

const { Markup } = require('telegraf');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://jjrisfyotyryanhbsvlz.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_t7kVxzmOtz16C95U_B52FA_AJl_WK-h';
const adminSupabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const adminState = {};
const adminMsgHistory = {};

function trackAdminMessage(adminId, chatId, messageId) {
  if (!adminId || !chatId || !messageId) return;
  if (!adminMsgHistory[adminId]) {
    adminMsgHistory[adminId] = { chatId, ids: [] };
  }
  adminMsgHistory[adminId].chatId = chatId;
  if (!adminMsgHistory[adminId].ids.includes(messageId)) {
    adminMsgHistory[adminId].ids.push(messageId);
  }
}

async function clearAdminTrackedMessages(ctx, adminId, keepMessageIds = []) {
  const history = adminMsgHistory[adminId];
  const keepSet = new Set(Array.isArray(keepMessageIds) ? keepMessageIds : [keepMessageIds].filter(Boolean));
  const chatId = ctx?.chat?.id || history?.chatId;
  if (!history || !chatId) return;

  const remaining = [];
  for (const msgId of history.ids) {
    if (keepSet.has(msgId)) {
      remaining.push(msgId);
      continue;
    }
    try {
      await ctx.telegram.deleteMessage(chatId, msgId);
    } catch (e) {}
  }
  adminMsgHistory[adminId].ids = remaining;
}

async function replyAdminTracked(ctx, adminId, text, extra = {}, cleanPrevious = false, keepIds = []) {
  if (cleanPrevious) {
    await clearAdminTrackedMessages(ctx, adminId, keepIds);
  }
  const sent = await ctx.reply(text, extra);
  if (sent && sent.message_id) {
    trackAdminMessage(adminId, ctx.chat.id, sent.message_id);
  }
  return sent;
}

async function safeDeleteAdminMessage(ctx) {
  try {
    if (ctx.message && ctx.message.message_id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, ctx.message.message_id).catch(() => {});
    }
  } catch (e) {}
}

async function getAdminIds() {
  try {
    const { data } = await adminSupabase.from('app_settings').select('value').eq('key', 'admin_id').single();
    if (!data || !data.value) return [5883330772];
    return data.value.split(/[,،\s]+/).map(id => Number(id.trim())).filter(Boolean);
  } catch (e) {
    return [5883330772];
  }
}

function sanitizeNumericPrice(val) {
  if (val === null || val === undefined) return 0;
  const digitsOnly = String(val).replace(/\D/g, '');
  if (!digitsOnly) return 0;
  const num = Number(digitsOnly);
  return Number.isFinite(num) ? num : 0;
}

function formatDateTime(dateInput) {
  const target = dateInput ? new Date(dateInput) : new Date();
  if (isNaN(target.getTime())) return String(dateInput || 'غير محدد');
  try {
    return target.toLocaleString('fr-DZ', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
  } catch (e) {
    return target.toISOString().replace('T', ' ').slice(0, 16);
  }
}

function escapeHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getAdminPanelKeyboard() {
  return Markup.keyboard([
    ['🏠 القائمة الرئيسية']
  ]).resize();
}

async function deliverAdminReplyToUser(ctx, adminId, targetUserId, payloadType, content) {
  const header = `📩 <b>رد الإدارة:</b>\n━━━━━━━━━━━━━━━━━━━━\n`;
  if (payloadType === 'photo') {
    const cap = header + (content.caption ? escapeHtml(content.caption) : '🖼 <b>مرفق صورة من الإدارة</b>');
    await ctx.telegram.sendPhoto(targetUserId, content.fileId, { caption: cap, parse_mode: 'HTML' });
  } else if (payloadType === 'video') {
    const cap = header + (content.caption ? escapeHtml(content.caption) : '🎥 <b>مرفق فيديو من الإدارة</b>');
    await ctx.telegram.sendVideo(targetUserId, content.fileId, { caption: cap, parse_mode: 'HTML' });
  } else {
    await ctx.telegram.sendMessage(targetUserId, header + escapeHtml(content.text), { parse_mode: 'HTML' });
  }

  delete adminState[adminId];
  await replyAdminTracked(
    ctx,
    adminId,
    `✅ <b>تم إرسال ردك بنجاح إلى العميل</b> <code>${targetUserId}</code>.`,
    { parse_mode: 'HTML', ...getAdminPanelKeyboard() },
    true
  );
}

async function handleAdminAction(ctx, action, requestId) {
  await ctx.answerCbQuery();

  try {
    const adminIds = await getAdminIds();
    if (!adminIds.includes(ctx.from.id)) {
      return await ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }

    const { data: pendingItem, error: fetchError } = await adminSupabase
      .from('pending_properties')
      .select('*')
      .eq('id', requestId)
      .single();

    if (fetchError || !pendingItem) {
      return ctx.editMessageCaption(`⚠️ <b>الطلب (#${requestId}) غير موجود أو تم التعامل معه مسبقاً.</b>`, { parse_mode: 'HTML' }).catch(() => {});
    }

    const targetUserId = pendingItem.user_id;
    const isFreeAd = pendingItem.receipt_url === 'FREE_NO_RECEIPT';

    if (action === 'approve') {
      const numericPrice = sanitizeNumericPrice(pendingItem.price);
      const cleanPhone = String(pendingItem.phone || '').replace(/\D/g, '').trim();
      const nowIso = new Date().toISOString();

      let { error: publishError } = await adminSupabase.from('test_messages').insert([{
        user_id: targetUserId,
        property_type: pendingItem.property_type,
        state_name: pendingItem.state_name,
        price: numericPrice,
        phone: cleanPhone,
        description: pendingItem.description,
        message: pendingItem.description,
        image_url: pendingItem.image_url || 'EMPTY',
        video_url: pendingItem.video_url || 'EMPTY',
        created_at: nowIso
      }]);

      if (publishError) {
        const retryRes = await adminSupabase.from('test_messages').insert([{
          property_type: pendingItem.property_type,
          state_name: pendingItem.state_name,
          price: numericPrice,
          phone: cleanPhone,
          description: pendingItem.description,
          message: pendingItem.description,
          image_url: pendingItem.image_url || 'EMPTY',
          video_url: pendingItem.video_url || 'EMPTY'
        }]);
        publishError = retryRes.error;
      }

      if (publishError) throw publishError;

      await adminSupabase.from('pending_properties').update({ status: 'approved' }).eq('id', requestId);

      await ctx.telegram.sendMessage(
        targetUserId,
        `🎉 <b>تم قبول إعلانك رقم (#${requestId}) ونشره بنجاح في المنصة!</b>\n🕒 <b>تاريخ ووقت النشر:</b> <code>${escapeHtml(formatDateTime(nowIso))}</code>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await ctx.editMessageCaption(
        `✅ <b>تم قبول الطلب (#${requestId}) ونشره بنجاح!</b>\n👤 المستخدم: <code>${targetUserId}</code>\n🏷 النوع: <b>${isFreeAd ? 'إعلان مجاني' : 'مدفوع / بوصل'}</b>\n🕒 وقت النشر: <code>${escapeHtml(formatDateTime(nowIso))}</code>\n📌 الحالة: <b>مقبول (مُحفظ في جدول test_messages)</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    } else {
      await adminSupabase.from('pending_properties').update({ status: 'rejected' }).eq('id', requestId);

      const rejectUserMsg = isFreeAd
        ? `❌ <b>عذراً، لم تتم الموافقة على نشر إعلانك المجاني رقم (#${requestId}).</b>`
        : `❌ <b>عذراً، تم رفض وصل الدفع الخاص بطلبك رقم (#${requestId}).</b>`;

      await ctx.telegram.sendMessage(
        targetUserId,
        rejectUserMsg,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      await ctx.editMessageCaption(
        `❌ <b>تم رفض الطلب (#${requestId}).</b>\n👤 المستخدم: <code>${targetUserId}</code>\n🏷 النوع: <b>${isFreeAd ? 'إعلان مجاني' : 'مدفوع / بوصل'}</b>\n📌 الحالة: <b>مرفوض</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});
    }
  } catch (err) {
    console.error(`Admin action error #${requestId}:`, err);
    await ctx.reply(`⚠️ حدث خطأ أثناء معالجة الطلب #${requestId}: ${err.message}`);
  }
}

async function handleAdminCallbackQuery(ctx) {
  const data = ctx.callbackQuery?.data || '';
  const adminId = ctx.from.id;

  const approveMatch = data.match(/^approve_(\d+)$/);
  if (approveMatch) {
    await handleAdminAction(ctx, 'approve', Number(approveMatch[1]));
    return true;
  }

  const rejectMatch = data.match(/^reject_(\d+)$/);
  if (rejectMatch) {
    await handleAdminAction(ctx, 'reject', Number(rejectMatch[1]));
    return true;
  }

  const replyMatch = data.match(/^support_reply_(\d+)$/);
  if (replyMatch) {
    const targetUserId = Number(replyMatch[1]);
    await ctx.answerCbQuery();

    const adminIds = await getAdminIds();
    if (!adminIds.includes(adminId)) {
      return await ctx.answerCbQuery('⛔ هذا الإجراء مخصص للإدارة فقط.', { show_alert: true });
    }

    adminState[adminId] = {
      step: 'replying_to_support_user',
      data: { targetUserId },
      chatId: ctx.chat.id
    };

    await replyAdminTracked(
      ctx,
      adminId,
      `✉️ <b>وضع الرد على العميل</b> <code>${targetUserId}</code>\n\nاكتب ردك الآن أو أرسل صورة/فيديو (أو اضغط "🏠 القائمة الرئيسية" للإلغاء):`,
      {
        parse_mode: 'HTML',
        ...getAdminPanelKeyboard()
      },
      true
    );
    return true;
  }

  return false;
}

async function handleAdminText(ctx) {
  const adminId = ctx.from.id;
  const userText = ctx.message.text ? ctx.message.text.trim() : '';
  const state = adminState[adminId];

  if (userText === '🏠 القائمة الرئيسية' || userText === '❌ إلغاء العملية والعودة') {
    await safeDeleteAdminMessage(ctx);
    delete adminState[adminId];
    await replyAdminTracked(ctx, adminId, '🛡️ <b>تمت العودة إلى لوحة الإدارة.</b>', {
      parse_mode: 'HTML',
      ...getAdminPanelKeyboard()
    }, true);
    return true;
  }

  if (state && state.step === 'replying_to_support_user') {
    await safeDeleteAdminMessage(ctx);
    const targetUserId = state.data?.targetUserId;
    if (!targetUserId) {
      delete adminState[adminId];
      return true;
    }
    await deliverAdminReplyToUser(ctx, adminId, targetUserId, 'text', { text: userText });
    return true;
  }

  return false;
}

async function handleAdminPhoto(ctx) {
  const adminId = ctx.from.id;
  const state = adminState[adminId];
  if (state && state.step === 'replying_to_support_user') {
    await safeDeleteAdminMessage(ctx);
    const targetUserId = state.data?.targetUserId;
    if (!targetUserId) {
      delete adminState[adminId];
      return true;
    }
    const photo = ctx.message.photo[ctx.message.photo.length - 1];
    await deliverAdminReplyToUser(ctx, adminId, targetUserId, 'photo', {
      fileId: photo.file_id,
      caption: ctx.message.caption || ''
    });
    return true;
  }
  return false;
}

async function handleAdminVideo(ctx) {
  const adminId = ctx.from.id;
  const state = adminState[adminId];
  if (state && state.step === 'replying_to_support_user') {
    await safeDeleteAdminMessage(ctx);
    const targetUserId = state.data?.targetUserId;
    if (!targetUserId) {
      delete adminState[adminId];
      return true;
    }
    await deliverAdminReplyToUser(ctx, adminId, targetUserId, 'video', {
      fileId: ctx.message.video.file_id,
      caption: ctx.message.caption || ''
    });
    return true;
  }
  return false;
}

module.exports = {
  handleAdminCallbackQuery,
  handleAdminText,
  handleAdminPhoto,
  handleAdminVideo
};
