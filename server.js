
// ============================================================
// A Q A R - CENTRAL PROPERTY PUBLISH ENGINE
// محرك موحد لرفع الوسائط وتسجيل العقارات
// ============================================================

async function publishProperty(state, userId, mediaType, buffer, contentType) {
  let uploadedFileName = null;

  try {
    if (!state || !state.data) {
      throw new Error('PROPERTY_STATE_MISSING');
    }

    const p = state.data;

    // 1. التحقق من البيانات الأساسية
    if (!p.property_type) {
      throw new Error('PROPERTY_TYPE_MISSING');
    }

    if (!p.state_name) {
      throw new Error('PROPERTY_STATE_MISSING');
    }

    if (!p.price || !p.phone || !p.description) {
      throw new Error('PROPERTY_DATA_INCOMPLETE');
    }

    // 2. إنشاء اسم فريد للملف
    const extension = mediaType === 'photo' ? 'jpg' : 'mp4';

    uploadedFileName =
      `properties/${userId}/${Date.now()}_${Math.random()
        .toString(36).substring(2, 10)}.${extension}`;

    // 3. رفع الملف إلى Supabase Storage
    const { data: uploadData, error: uploadError } =
      await supabase.storage
        .from('test_media')
        .upload(uploadedFileName, buffer, {
          contentType: contentType,
          upsert: false
        });

    if (uploadError) {
      throw new Error(`STORAGE_UPLOAD_ERROR: ${uploadError.message}`);
    }

    if (!uploadData) {
      throw new Error('STORAGE_UPLOAD_NO_DATA');
    }

    // 4. استخراج رابط الملف
    const { data: publicURLData } =
      supabase.storage
        .from('test_media')
        .getPublicUrl(uploadedFileName);

    const mediaURL = publicURLData?.publicUrl;

    if (!mediaURL) {
      throw new Error('PUBLIC_URL_GENERATION_FAILED');
    }

    // 5. تجهيز سجل العقار
    const propertyRecord = {
      property_type: String(p.property_type),
      state_name: String(p.state_name),
      price: String(p.price),
      phone: String(p.phone),
      description: String(p.description),
      message: String(p.description),

      image_url: mediaType === 'photo' ? mediaURL : 'EMPTY',
      video_url: mediaType === 'video' ? mediaURL : 'EMPTY'
    };

    // 6. تسجيل سطر جديد في قاعدة البيانات
    const { data: insertedData, error: insertError } =
      await supabase
        .from('test_messages')
        .insert([propertyRecord])
        .select('id')
        .single();

    if (insertError) {
      throw new Error(`DATABASE_INSERT_ERROR: ${insertError.message}`);
    }

    if (!insertedData || !insertedData.id) {
      throw new Error('DATABASE_INSERT_NOT_CONFIRMED');
    }

    // 7. نجاح العملية
    console.log('======================================');
    console.log('AQAR PROPERTY PUBLISHED SUCCESSFULLY');
    console.log('Property ID:', insertedData.id);
    console.log('User ID:', userId);
    console.log('Media:', mediaType);
    console.log('File:', uploadedFileName);
    console.log('======================================');

    return {
      success: true,
      propertyId: insertedData.id,
      mediaURL: mediaURL
    };

  } catch (error) {

    console.error('AQAR PUBLISH ERROR:', error.message);

    // حذف الملف المرفوع إذا فشلت عملية تسجيل العقار
    if (uploadedFileName) {
      try {
        await supabase.storage
          .from('test_media')
          .remove([uploadedFileName]);
      } catch (cleanupError) {
        console.error('STORAGE CLEANUP ERROR:', cleanupError.message);
      }
    }

    throw error;
  }
}
