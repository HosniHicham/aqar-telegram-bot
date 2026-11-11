// 2. تصفح العقارات المسجلة بforma حية وواقعية
bot.hears(['🔍 تصفح العقارات المتاحة', '🔍 Parcourir les biens'], async (ctx) => {
  const userId = ctx.from.id;
  delete userState[userId];

  try {
    const { data, error } = await supabase
      .from('test_messages')
      .select('*')
      .order('id', { ascending: false })
      .limit(5); // جلب آخر 5 عروض

    if (error || !data || data.length === 0) {
      return ctx.reply('📭 عذراً، لا توجد عقارات مسجلة حالياً في النظام.');
    }

    await ctx.reply('🏛 <b>إليك أحدث العروض العقارية الحية في المنصة:</b>', { parse_mode: 'HTML' });

    // استعراض كل عقار بطريقة بصرية حية
    for (const item of data) {
      const caption = 
        `🏠 <b>نوع العقار:</b> ${item.property_type || 'عقار'}\n` +
        `📍 <b>الولاية:</b> ${item.state_name || 'الجزائر'}\n` +
        `💰 <b>السعر:</b> ${item.price || 'حسب الاتفاق'}\n` +
        `📞 <b>الهاتف:</b> <code>${item.phone || 'غير مسجل'}</code>\n` +
        `📝 <b>الوصف:</b> ${item.description || item.message || 'بدون تفاصيل'}`;

      // إذا كانت هناك صورة مخزنة وليست فارغة، نعرضها كصورة حية وليست رابطاً!
      if (item.image_url && item.image_url !== 'EMPTY') {
        try {
          await ctx.replyWithPhoto(item.image_url, {
            caption: caption,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📞 طلب التواصل', 'contact_admin'), Markup.button.callback('❤️ حفظ في المفضلة', 'save_fav')]
            ])
          });
        } catch (imgErr) {
          // في حال حدث خطأ في رابط الصورة، نرسل النص تفادياً لتوقف البوت
          await ctx.reply(caption, { parse_mode: 'HTML' });
        }
      } 
      // إذا كان هناك فيديو مخزنعرضه كفيديو مباشر
      else if (item.video_url && item.video_url !== 'EMPTY') {
        try {
          await ctx.replyWithVideo(item.video_url, {
            caption: caption,
            parse_mode: 'HTML',
            ...Markup.inlineKeyboard([
              [Markup.button.callback('📞 طلب التواصل', 'contact_admin')]
            ])
          });
        } catch (vidErr) {
          await ctx.reply(caption, { parse_mode: 'HTML' });
        }
      } 
      // إذا لم يكن هناك لا صورة ولا فيديو، نرسل الكارت النصي المنظم
      else {
        await ctx.reply(caption, {
          parse_mode: 'HTML',
          ...Markup.inlineKeyboard([
            [Markup.button.callback('📞 طلب التواصل', 'contact_admin')]
          ])
        });
      }
    }

  } catch (err) {
    console.error(err);
    await ctx.reply('⚠️ حدث خطأ أثناء جلب العروض، يرجى إعادة المحاولة.');
  }
});
