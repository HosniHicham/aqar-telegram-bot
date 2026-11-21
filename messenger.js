'use strict';

function buildThreadId(propertyId, ownerId, otherUserId) {
  return `p_${Number(propertyId)}_o_${Number(ownerId)}_u_${Number(otherUserId)}`;
}

function createMessengerModule(core) {
  const {
    Markup,
    supabase,
    userState,
    browsingSession,
    supportUserSession,
    trackBotMessage,
    clearTrackedBotMessages,
    replyTracked,
    safeDeleteUserMessage,
    escapeHtml,
    fitTelegramText,
    formatDateTime,
    chunkButtons
  } = core;

  // جلسة المراسلات لكل مستخدم:
  // { mode: 'list' | 'thread', threadId, propertyId, ownerId, receiverId, otherName, cardMessageId, senderMap }
  const messengerSession = {};

  function getUserDisplayName(from) {
    if (!from) return 'مراسل';
    const full = [from.first_name, from.last_name].filter(Boolean).join(' ').trim();
    return full || from.username || 'مراسل';
  }

  // جلب الاسم الحقيقي من جدول users إذا كان متوفراً، وإلا من sender_name في messanger بدون إظهار ID
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

    return cleanFallback || 'مراسل';
  }

  // حساب عدد الرسائل الواردة غير المقروءة للمستخدم (إلى = userId والمرسل ليس userId)
  async function getUnreadCount(userId) {
    const uid = Number(userId);
    if (!uid) return 0;

    try {
      const { data, error } = await supabase
        .from('messanger')
        .select('id')
        .eq('receiver_id', uid)
        .neq('sender_id', uid)
        .eq('is_read', false)
        .eq('is_closed', false);

      if (error || !Array.isArray(data)) return 0;
      return data.length;
    } catch (e) {
      return 0;
    }
  }

  // نص الزر الرئيسي: يظهر الرقم بين قوسين فقط إذا وُجدت رسائل واردة غير مقروءة
  async function getMessengerButtonLabel(userId) {
    const count = await getUnreadCount(userId);
    return count > 0 ? `💬 المراسلات (${count})` : '💬 المراسلات';
  }

  // حفظ رسالة جديدة في جدول messanger
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

  // جلب قائمة المراسلين للمستخدم الحالي (اسم فقط بدون ID)
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
            rawSenderName: Number(row.sender_id) === otherId ? (row.sender_name || '') : '',
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

      const list = [];
      for (const t of threadsMap.values()) {
        const cleanName = await resolveCleanSenderName(t.otherId, t.rawSenderName);
        const buttonText = t.unreadCount > 0 ? `🟢 ${cleanName} (${t.unreadCount})` : cleanName;
        list.push({
          ...t,
          cleanName,
          buttonText
        });
      }

      return list;
    } catch (e) {
      console.error('fetchSenderThreads error:', e);
      return [];
    }
  }

  // فتح محادثة: تسجيل الرسائل الواردة كمقروءة + حفظ تاريخ الفتح read_at
  async function openThreadMessages(userId, threadId) {
    const uid = Number(userId);
    const nowIso = new Date().toISOString();

    await supabase
      .from('messanger')
      .update({ is_read: true, read_at: nowIso })
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

  // تنسيق البطاقة الواحدة التي تجمع رسائل المحادثة وتُحدّث باستمرار (بدون إظهار ID)
  function formatSingleThreadCard(userId, messages, meta = {}) {
    const uid = Number(userId);
    const otherRow = messages.find((m) => Number(m.sender_id) !== uid);
    const otherName = otherRow?.sender_name || meta.otherName || 'مراسل';
    const propId = messages[0]?.property_id || meta.propertyId;

    const lines = messages.map((m) => {
      const mine = Number(m.sender_id) === uid;
      const who = mine ? 'أنت' : escapeHtml(m.sender_name || otherName);
      const timeStr = m.created_at ? ` <code>[${escapeHtml(formatDateTime(m.created_at))}]</code>` : '';
      const icon = mine ? '🟦' : '🟩';
      return `${icon} <b>${who}:</b> ${escapeHtml(m.message)}${timeStr}`;
    });

    const header =
      `💬 <b>محادثة مع ${escapeHtml(otherName)}</b>` +
      (propId ? ` • عقار <code>#${propId}</code>` : '') +
      `\n━━━━━━━━━━━━━━━━━━━━\n`;

    const body = lines.length > 0
      ? lines.join('\n')
      : `<i>لا توجد رسائل بعد. اكتب رسالتك الأولى الآن.</i>`;

    const footer =
      `\n━━━━━━━━━━━━━━━━━━━━\n` +
      `✍️ <i>اكتب رسالتك وسيتم إرسالها وتحديث هذه الرسالة مباشرة.</i>`;

    return fitTelegramText(header + body + footer, false);
  }

  // عرض قائمة المراسلين كأزرار في لوحة المفاتيح السفلية (بدون عرض أي رسائل أو ID)
  async function showInboxList(ctx) {
    const userId = ctx.from.id;
    delete userState[userId];
    delete browsingSession[userId];
    delete supportUserSession[userId];

    const threads = await fetchSenderThreads(userId);
    const unreadCount = await getUnreadCount(userId);

    if (!threads.length) {
      delete messengerSession[userId];
      return replyTracked(
        ctx,
        userId,
        '📭 <b>لا توجد رسائل واردة حالياً.</b>',
        { parse_mode: 'HTML', ...core.getMainMenuKeyboard(userId, unreadCount) },
        true
      );
    }

    const senderMap = {};
    const buttonLabels = [];
    for (const t of threads) {
      senderMap[t.buttonText] = t;
      buttonLabels.push(t.buttonText);
    }

    messengerSession[userId] = {
      mode: 'list',
      senderMap
    };

    const rows = chunkButtons ? chunkButtons(buttonLabels, 2) : [];
    if (!rows.length) {
      for (let i = 0; i < buttonLabels.length; i += 2) {
        rows.push(buttonLabels.slice(i, i + 2));
      }
    }
    rows.push(['🏠 القائمة الرئيسية']);

    await replyTracked(
      ctx,
      userId,
      '💬 <b>المراسلات</b>',
      {
        parse_mode: 'HTML',
        ...Markup.keyboard(rows).resize()
      },
      true
    );
  }

  // عرض / تحديث البطاقة الواحدة للمحادثة النشطة
  async function renderActiveThread(ctx, userId, threadId, meta = {}, editMessageId = null) {
    const messages = await openThreadMessages(userId, threadId);
    const unreadCount = await getUnreadCount(userId);

    const first = messages[0] || {};
    const ownerId = Number(first.owner_id || meta.ownerId);
    const propertyId = Number(first.property_id || meta.propertyId);
    const receiverId = Number(
      meta.receiverId ||
      (Number(first.sender_id) === Number(userId) ? first.receiver_id : first.sender_id) ||
      ownerId
    );
    const otherName = meta.otherName || first.sender_name || 'مراسل';

    const cardText = formatSingleThreadCard(userId, messages, {
      ...meta,
      propertyId,
      owner
