'use strict';

function buildThreadId(propertyId, ownerId, otherUserId) {
  return `p_${Number(propertyId)}_o_${Number(ownerId)}_u_${Number(otherUserId)}`;
}

const LRM = '\u200E'; // يجعل السطر يبدأ من اليسار (الطرف الآخر)
const RLM = '\u200F'; // يجعل السطر يبدأ من اليمين (أنا)
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
const MAX_CARD_MESSAGES = 15;

// وقت صغير: HH:MM بأرقام مرتفعة
function formatSmallTime(iso) {
  if (!iso) return '';
  try {
    const t = new Date(iso).toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    return t.replace(/\d/g, (d) => SUP[d]);
  } catch (_) {
    return '';
  }
}

function createMessengerModule(core) {
  const {
    Markup,
    supabase,
    userState,
    browsingSession,
    supportUserSession,
    replyTracked,
    safeDeleteUserMessage,
    escapeHtml,
    fitTelegramText
  } = core;

  // { mode: 'list' | 'thread', threadId, propertyId, ownerId, receiverId, otherName, cardMessageId }
  const messengerSession = {};

  function getUserDisplayName(from) {
    if (!from) return 'مراسل';
    const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    return full || from.username || 'مراسل';
  }

  // اسم نظيف بدون أي ID
  async function resolveCleanSenderName(otherUserId, fallbackSenderName = '') {
    const cleanFallback = String(fallbackSenderName || '').trim();
    if (cleanFallback && !/^مستخدم\s*\d*$/i.test(cleanFallback)) {
      return cleanFallback;
    }

    try {
      const { data } = await supabase
        .from('users')
        .select('first_name, last_name, username')
        .eq('id', Number(otherUserId))
        .limit(1);

      const row = Array.isArray(data) ? data[0] : data;
      if (row) {
        const full = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
        if (full) return full;
        if (row.username) return String(row.username).trim();
      }
    } catch (e) {}

    return 'مراسل';
  }

  async function getUnreadCount(userId) {
    const uid = Number(userId);
    if (!uid) return 0;

    try {
      const { count, error } = await supabase
        .from('messanger')
        .select('id', { count: 'exact', head: true })
        .eq('receiver_id', uid)
        .neq('sender_id', uid)
        .eq('is_read', false)
        .eq('is_closed', false);

      if (error) return 0;
      return count || 0;
    } catch (e) {
      return 0;
    }
  }

  async function getMessengerButtonLabel(userId) {
    const count = await getUnreadCount(userId);
    return count > 0 ? `💬 المراسلات (${count})` : '💬 المراسلات';
  }

  async function insertMessage({
    propertyId,
    ownerId,
    senderId,
    receiverId,
    senderName,
    messageType = 'text',
    message
  }) {
    const cleanMsg = String(message || '').trim();
    if (!cleanMsg) return null;

    const pId = Number(propertyId);
    const oId = Number(ownerId);
    const sId = Number(senderId);
    const rId = Number(receiverId);
    const otherId = sId === oId ? rId : sId;
    const threadId = buildThreadId(pId, oId, otherId);

    const { data, error } = await supabase
      .from('messanger')
      .insert([{
        thread_id: threadId,
        property_id: pId,
        owner_id: oId,
        sender_id: sId,
        receiver_id: rId,
        sender_name: String(senderName || 'مراسل').trim() || 'مراسل',
        message_type: messageType,
        message: cleanMsg,
        is_read: false,
        is_closed: false,
        created_at: new Date().toISOString(),
        read_at: null
      }])
      .select()
      .single();

    if (error) {
      console.error('messanger insert error:', error);
      return null;
    }
    return data;
  }

  async function fetchSenderThreads(userId) {
    const uid = Number(userId);

    try {
      const { data, error } = await supabase
        .from('messanger')
        .select('id, thread_id, property_id, owner_id, sender_id, receiver_id, sender_name, is_read, is_closed, created_at')
        .or(`sender_id.eq.${uid},receiver_id.eq.${uid}`)
        .eq('is_closed', false)
        .order('created_at', { ascending: false })
        .limit(200);

      if (error || !Array.isArray(data)) return [];

      const threadsMap = new Map();

      for (const row of data) {
        const otherId = Number(row.sender_id) === uid ? Number(row.receiver_id) : Number(row.sender_id);
        if (!otherId || otherId === uid) continue;

        const tId = row.thread_id || buildThreadId(row.property_id, row.owner_id, otherId);

        if (!threadsMap.has(tId)) {
          threadsMap.set(tId, {
            threadId: tId,
            propertyId: row.property_id,
            ownerId: row.owner_id,
            otherId,
            rawSenderName: '',
            unreadCount: 0
          });
        }

        const entry = threadsMap.get(tId);
        if (!entry.rawSenderName && Number(row.sender_id) === otherId && row.sender_name) {
          entry.rawSenderName = row.sender_name;
        }
        if (Number(row.receiver_id) === uid && Number(row.sender_id) !== uid && row.is_read === false) {
          entry.unreadCount += 1;
        }
      }

      const list = await Promise.all(
        [...threadsMap.values()].map(async (t) => {
          const cleanName = await resolveCleanSenderName(t.otherId, t.rawSenderName);
          const buttonText = t.unreadCount > 0 ? `🟢 ${cleanName} (${t.unreadCount})` : cleanName;
          return { ...t, cleanName, buttonText };
        })
      );

      return list;
    } catch (e) {
      console.error('fetchSenderThreads error:', e);
      return [];
    }
  }

  async function openThreadMessages(userId, threadId) {
    const uid = Number(userId);

    await supabase
      .from('messanger')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('thread_id', threadId)
      .eq('receiver_id', uid)
      .neq('sender_id', uid)
      .eq('is_read', false);

    const { data, error } = await supabase
      .from('messanger')
      .select('*')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true });

    if (error || !Array.isArray(data)) return [];
    return data;
  }

  // بطاقة المحادثة: رسائلي يمين، رسائل الطرف الآخر يسار، بدون "أنت" ولا ID، ووقت صغير
  function formatSingleThreadCard(userId, messages, meta = {}) {
    const uid = Number(userId);
    const otherRow = messages.find((m) => Number(m.sender_id) !== uid);
    const otherName = meta.otherName || otherRow?.sender_name || 'مراسل';

    const visible = messages.slice(-MAX_CARD_MESSAGES);
    const out = [];
    let lastSender = null;

    for (const m of visible) {
      const mine = Number(m.sender_id) === uid;
      const mark = mine ? RLM : LRM;
      const icon = mine ? '🟦' : '🟩';
      const time = formatSmallTime(m.created_at);

      // اسم الطرف الآخر مرة واحدة عند بداية كل تسلسل رسائله
      if (!mine && lastSender !== m.sender_id) {
        out.push(`${LRM}<b>${escapeHtml(m.sender_name || otherName)}</b>`);
      }
      lastSender = m.sender_id;

      const msgLines = String(m.message).split('\n').map(escapeHtml);
      msgLines[0] = `${icon} ${msgLines[0]}`;
      msgLines[msgLines.length - 1] += time ? `  <i>${time}</i>` : '';
      out.push(msgLines.map((l) => mark + l).join('\n'));
    }

    const header =
      `${LRM}💬 <b>${escapeHtml(otherName)}</b>\n` +
      `━━━━━━━━━━━━━━━━━━━━\n`;

    const body = out.length > 0
      ? out.join('\n')
      : `<i>لا توجد رسائل بعد. اكتب رسالتك الأولى الآن.</i>`;

    const footer = `\n━━━━━━━━━━━━━━━━━━━━\n✍️ <i>اكتب رسالتك للإرسال</i>`;

    return fitTelegramText(header + body + footer, false);
  }

  // تعديل رسالة موجودة أو إرسال جديدة إن فشل التعديل. الأزرار inline فلا تنتج أي رسائل إضافية
  async function upsertCard(ctx, userId, text, inlineKb, targetMsgId) {
    if (targetMsgId && ctx.chat?.id) {
      try {
        await ctx.telegram.editMessageText(ctx.chat.id, targetMsgId, undefined, text, {
          parse_mode: 'HTML',
          ...inlineKb
        });
        return targetMsgId;
      } catch (e) {
        const desc = String(e?.description || e?.message || '');
        if (desc.includes('message is not modified')) return targetMsgId;
        await ctx.telegram.deleteMessage(ctx.chat.id, targetMsgId).catch(() => {});
      }
    }

    const sent = await replyTracked(
      ctx,
      userId,
      text,
      { parse_mode: 'HTML', ...inlineKb },
      true
    );
    return sent?.message_id || null;
  }

  async function showInboxList(ctx, editMessageId = null) {
    const userId = ctx.from.id;
    delete userState[userId];
    delete browsingSession[userId];
    delete supportUserSession[userId];

    const threads = await fetchSenderThreads(userId);
    const prev = messengerSession[userId] || {};
    const targetMsgId = editMessageId || prev.cardMessageId || null;

    if (!threads.length) {
      delete messengerSession[userId];
      if (targetMsgId && ctx.chat?.id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, targetMsgId).catch(() => {});
      }
      const unreadCount = await getUnreadCount(userId);
      return replyTracked(
        ctx,
        userId,
        '📭 <b>لا توجد رسائل واردة حالياً.</b>',
        { parse_mode: 'HTML', ...core.getMainMenuKeyboard(userId, unreadCount) },
        true
      );
    }

    const buttons = threads.map((t) => Markup.button.callback(t.buttonText, `msg_open:${t.threadId}`));
    const rows = [];
    for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
    rows.push([Markup.button.callback('🏠 القائمة الرئيسية', 'msg_home')]);

    const msgId = await upsertCard(
      ctx,
      userId,
      '💬 <b>المراسلات</b>',
      Markup.inlineKeyboard(rows),
      targetMsgId
    );

    messengerSession[userId] = { mode: 'list', cardMessageId: msgId };
  }

  async function renderActiveThread(ctx, userId, threadId, meta = {}, editMessageId = null) {
    const messages = await openThreadMessages(userId, threadId);

    const first = messages[0] || {};
    const ownerId = Number(first.owner_id || meta.ownerId);
    const propertyId = Number(first.property_id || meta.propertyId);
    const receiverId = Number(
      meta.receiverId ||
      (Number(first.sender_id) === Number(userId) ? first.receiver_id : first.sender_id) ||
      ownerId
    );

    let otherName = meta.otherName;
    if (!otherName) {
      const otherRow = messages.find((m) => Number(m.sender_id) !== Number(userId));
      otherName = await resolveCleanSenderName(receiverId, otherRow?.sender_name || '');
    }

    const cardText = formatSingleThreadCard(userId, messages, { otherName });

    const kb = Markup.inlineKeyboard([
      [Markup.button.callback('⬅️ قائمة المراسلين', 'msg_list')],
      [Markup.button.callback('🏠 القائمة الرئيسية', 'msg_home')]
    ]);

    const prevSession = messengerSession[userId] || {};
    const targetMsgId = editMessageId || prevSession.cardMessageId || null;
    const msgId = await upsertCard(ctx, userId, cardText, kb, targetMsgId);

    messengerSession[userId] = {
      mode: 'thread',
      threadId,
      propertyId,
      ownerId,
      receiverId,
      otherName,
      cardMessageId: msgId
    };
    return msgId;
  }

  async function startPropertyMessage(ctx, propertyItem) {
    const userId = ctx.from.id;
    const ownerId = Number(propertyItem?.user_id);
    const propertyId = Number(propertyItem?.id);

    if (!propertyId || !ownerId) {
      return ctx.answerCbQuery('⚠️ بيانات المالك غير متوفرة لهذا العقار.', { show_alert: true }).catch(() => {});
    }
    if (ownerId === Number(userId)) {
      return ctx.answerCbQuery('ℹ️ هذا العقار منشور بحسابك.', { show_alert: true }).catch(() => {});
    }

    const ownerName = await resolveCleanSenderName(ownerId, 'صاحب العقار');
    const threadId = buildThreadId(propertyId, ownerId, userId);
    const meta = { propertyId, ownerId, receiverId: ownerId, otherName: ownerName };

    const { data: existing } = await supabase
      .from('messanger')
      .select('id')
      .eq('thread_id', threadId)
      .limit(1);

    // محادثة موجودة: نفتحها مباشرة، وأي نص يكتبه المستخدم يُرسل داخلها
    if (Array.isArray(existing) && existing.length > 0) {
      delete userState[userId];
      return renderActiveThread(ctx, userId, threadId, meta);
    }

    userState[userId] = {
      step: 'composing_property_message',
      data: { threadId, ...meta },
      chatId: ctx.chat.id,
      wizardMsgId: null
    };

    const sent = await replyTracked(
      ctx,
      userId,
      `💬 <b>${escapeHtml(ownerName)}</b>\n━━━━━━━━━━━━━━━━━━━━\nاكتب رسالتك الآن:`,
      {
        parse_mode: 'HTML',
        ...Markup.keyboard([['🏠 القائمة الرئيسية']]).resize()
      },
      true
    );
    if (sent?.message_id) userState[userId].wizardMsgId = sent.message_id;
  }

  async function handleMessengerText(ctx) {
    const userId = ctx.from.id;
    const rawText = ctx.message?.text ? ctx.message.text.trim() : '';
    if (!rawText || rawText.startsWith('/')) return false;

    const st = userState[userId];
    const sess = messengerSession[userId];

    // أول رسالة على عقار
    if (st && st.step === 'composing_property_message') {
      await safeDeleteUserMessage(ctx);
      const { threadId, propertyId, ownerId, receiverId, otherName, wizardMsgId } = st.data || {};
      delete userState[userId];

      if (wizardMsgId && ctx.chat?.id) {
        await ctx.telegram.deleteMessage(ctx.chat.id, wizardMsgId).catch(() => {});
      }

      await insertMessage({
        propertyId,
        ownerId,
        senderId: userId,
        receiverId,
        senderName: getUserDisplayName(ctx.from),
        message: rawText
      });

      await renderActiveThread(ctx, userId, threadId, { propertyId, ownerId, receiverId, otherName });
      return true;
    }

    // رسالة داخل محادثة مفتوحة: نحذف رسالة المستخدم ونحدّث نفس البطاقة
    if (sess && sess.mode === 'thread' && sess.threadId) {
      await safeDeleteUserMessage(ctx);

      await insertMessage({
        propertyId: sess.propertyId,
        ownerId: sess.ownerId,
        senderId: userId,
        receiverId: sess.receiverId,
        senderName: getUserDisplayName(ctx.from),
        message: rawText
      });

      await renderActiveThread(ctx, userId, sess.threadId, {
        propertyId: sess.propertyId,
        ownerId: sess.ownerId,
        receiverId: sess.receiverId,
        otherName: sess.otherName
      }, sess.cardMessageId);
      return true;
    }

    return false;
  }

  // زر القائمة السفلي: رسالة واحدة تُحذف ثم تُعرض القائمة
  core.bot.hears(/^💬 المراسلات(?: \(\d+\))?$/, async (ctx) => {
    await safeDeleteUserMessage(ctx);
    await showInboxList(ctx);
  });

  // أزرار inline: تعديل نفس الرسالة بصمت بدون أي رسالة جديدة أو إشعار
  core.bot.action('msg_list', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const msgId = ctx.callbackQuery?.message?.message_id || null;
    await showInboxList(ctx, msgId);
  });

  core.bot.action(/^msg_open:(.+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const msgId = ctx.callbackQuery?.message?.message_id || null;
    await renderActiveThread(ctx, ctx.from.id, ctx.match[1], {}, msgId);
  });

  core.bot.action(/^msg_prop:(\d+):(\d+)$/, async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    await startPropertyMessage(ctx, { id: Number(ctx.match[1]), user_id: Number(ctx.match[2]) });
  });

  core.bot.action('msg_home', async (ctx) => {
    await ctx.answerCbQuery().catch(() => {});
    const userId = ctx.from.id;
    const msgId = ctx.callbackQuery?.message?.message_id;
    if (msgId && ctx.chat?.id) {
      await ctx.telegram.deleteMessage(ctx.chat.id, msgId).catch(() => {});
    }
    delete messengerSession[userId];
    delete userState[userId];
    const unreadCount = await getUnreadCount(userId);
    await replyTracked(
      ctx,
      userId,
      '🏠 <b>القائمة الرئيسية</b>',
      { parse_mode: 'HTML', ...core.getMainMenuKeyboard(userId, unreadCount) },
      true
    );
  });

  return {
    messengerSession,
    buildThreadId,
    getUnreadCount,
    getMessengerButtonLabel,
    insertMessage,
    fetchSenderThreads,
    openThreadMessages,
    formatSingleThreadCard,
    showInboxList,
    renderActiveThread,
    startPropertyMessage,
    handleMessengerText
  };
}

module.exports = { createMessengerModule };