export type ImageUrlIssue =
  | 'empty'
  | 'http_insecure'
  | 'missing_protocol'
  | 'unsupported_scheme'
  | 'suspected_webpage';

export interface NormalizedImageUrlResult {
  url: string;
  original: string;
  transformedFrom?: string;
  issue?: ImageUrlIssue;
  reason?: string;
}

const DIRECT_IMAGE_EXT_RE = /\.(jpe?g|png|webp|gif|avif|bmp|svg)(?:$|[?#])/i;
const WEBPAGE_EXT_RE = /\.(html?|php|aspx?|jsp)(?:$|[?#])/i;

export function unwrapKnownImageWrapperUrl(rawUrl: string): { url: string; transformedFrom?: string } {
  const trimmed = rawUrl.trim();
  if (!trimmed) return { url: '' };

  try {
    const parsed = new URL(trimmed);
    const host = parsed.hostname.toLowerCase();

    // 1. Google Images redirect wrapper: https://www.google.com/imgres?imgurl=...
    if ((host === 'google.com' || host.endsWith('.google.com')) && parsed.pathname === '/imgres') {
      const imgUrl = parsed.searchParams.get('imgurl');
      if (imgUrl && /^https?:\/\//i.test(imgUrl.trim())) {
        return { url: imgUrl.trim(), transformedFrom: trimmed };
      }
    }

    // 2. Google redirect: https://www.google.com/url?url=... or ?q=...
    if ((host === 'google.com' || host.endsWith('.google.com')) && parsed.pathname === '/url') {
      const target = parsed.searchParams.get('url') || parsed.searchParams.get('q');
      if (target && /^https?:\/\//i.test(target.trim()) && DIRECT_IMAGE_EXT_RE.test(target.trim())) {
        return { url: target.trim(), transformedFrom: trimmed };
      }
    }

    // 3. Google Drive share URL: /file/d/<ID>/view or /open?id=<ID> or /uc?id=<ID>
    if (host === 'drive.google.com') {
      const fileMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
      const driveId = fileMatch?.[1] || parsed.searchParams.get('id');
      if (driveId && /^[a-zA-Z0-9_-]{10,}$/.test(driveId)) {
        return {
          url: `https://lh3.googleusercontent.com/d/${driveId}`,
          transformedFrom: trimmed,
        };
      }
    }

    // 4. Dropbox share link (?dl=0 -> ?raw=1)
    if (host === 'dropbox.com' || host.endsWith('.dropbox.com')) {
      const next = new URL(trimmed);
      if (next.searchParams.get('raw') !== '1') {
        next.searchParams.delete('dl');
        next.searchParams.set('raw', '1');
        return { url: next.toString(), transformedFrom: trimmed };
      }
    }
  } catch {
    // ignore URL parse error and handle below
  }

  return { url: trimmed };
}

export function normalizeProductImageUrl(raw: string): NormalizedImageUrlResult {
  const original = typeof raw === 'string' ? raw : '';
  let candidate = original.trim();

  // Strip accidental surrounding quotes pasted from JSON/spreadsheets
  if (
    candidate.length >= 2 &&
    ((candidate.startsWith('"') && candidate.endsWith('"')) ||
      (candidate.startsWith("'") && candidate.endsWith("'")))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  if (!candidate) {
    return { url: '', original, issue: 'empty', reason: 'الرابط فارغ.' };
  }

  // Allow valid base64 raster Data URLs (JPEG / PNG / WebP / GIF)
  if (/^data:image\/(jpeg|jpg|png|webp|gif);base64,/i.test(candidate)) {
    return { url: candidate, original };
  }

  if (/^(javascript|vbscript|file|blob|data):/i.test(candidate)) {
    return {
      url: candidate,
      original,
      issue: 'unsupported_scheme',
      reason: 'صيغة الرابط أو البروتوكول غير مدعوم أو غير آمن لعرض الصور.',
    };
  }

  // Relative local & permanent uploaded product media paths
  if (candidate.startsWith('/assets/') || candidate.startsWith('/api/media/products/')) {
    if (candidate.includes('..')) {
      return {
        url: candidate,
        original,
        issue: 'unsupported_scheme',
        reason: 'مسار الصورة غير صالح.',
      };
    }
    return { url: candidate, original };
  }

  let transformedFrom: string | undefined;

  // Protocol-relative URL -> upgrade to https://
  if (candidate.startsWith('//')) {
    transformedFrom = candidate;
    candidate = `https:${candidate}`;
  } else if (!/^https?:\/\//i.test(candidate) && !candidate.startsWith('/')) {
    // Bare domain pasted without scheme (e.g. cdn.site.com/img.webp or www.site.com/img.jpg)
    if (/^(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\//i.test(candidate)) {
      transformedFrom = candidate;
      candidate = `https://${candidate}`;
    } else {
      return {
        url: candidate,
        original,
        issue: 'missing_protocol',
        reason: 'الرابط غير مكتمل؛ يجب أن يبدأ بـ https:// أو يكون مساراً صحيحاً لصورة.',
      };
    }
  }

  if (
    candidate.startsWith('/') &&
    !candidate.startsWith('/assets/') &&
    !candidate.startsWith('/api/media/products/')
  ) {
    return {
      url: candidate,
      original,
      issue: 'missing_protocol',
      reason: 'المسار المحلي غير موجود ضمن مجلد صور المتجر (/assets/) أو مخزن الوسائط.',
    };
  }

  const unwrapped = unwrapKnownImageWrapperUrl(candidate);
  if (unwrapped.transformedFrom) {
    transformedFrom = transformedFrom || unwrapped.transformedFrom;
    candidate = unwrapped.url;
  }

  try {
    const parsed = new URL(candidate);
    if (parsed.protocol === 'http:') {
      return {
        url: candidate,
        original,
        transformedFrom,
        issue: 'http_insecure',
        reason: 'الرابط يستخدم http:// غير المشفر؛ سياسة الأمان في المتجر تتطلب https:// لعرض الصورة.',
      };
    }
    if (parsed.protocol !== 'https:') {
      return {
        url: candidate,
        original,
        issue: 'unsupported_scheme',
        reason: 'يُسمح فقط بروابط الصور عبر HTTPS.',
      };
    }

    const host = parsed.hostname.toLowerCase();
    const pathLower = parsed.pathname.toLowerCase();
    const looksLikeWebpageHost =
      ((host === 'unsplash.com' || host.endsWith('.unsplash.com')) && host !== 'images.unsplash.com' && pathLower.startsWith('/photos/')) ||
      ((host === 'pexels.com' || host === 'www.pexels.com') && pathLower.startsWith('/photo/')) ||
      ((host === 'pixabay.com' || host === 'www.pixabay.com') && pathLower.includes('/photos/')) ||
      ((host === 'imgur.com' || host === 'www.imgur.com') && !DIRECT_IMAGE_EXT_RE.test(pathLower) && pathLower.length > 1) ||
      ((host === 'google.com' || host.endsWith('.google.com')) && pathLower === '/search');

    if ((WEBPAGE_EXT_RE.test(pathLower) && !DIRECT_IMAGE_EXT_RE.test(candidate)) || looksLikeWebpageHost) {
      return {
        url: candidate,
        original,
        transformedFrom,
        issue: 'suspected_webpage',
        reason: 'هذا الرابط يبدو كصفحة ويب وليس رابطاً مباشراً لصورة (JPEG / PNG / WebP). استخدم "فحص الروابط" لاستخراج رابط الصورة المباشر.',
      };
    }
  } catch {
    return {
      url: candidate,
      original,
      issue: 'missing_protocol',
      reason: 'تنسيق الرابط غير صالح.',
    };
  }

  return {
    url: candidate,
    original,
    transformedFrom,
  };
}

export function splitImageUrlsInput(rawText: string): string[] {
  return (rawText || '')
    .split(/[\r\n]+/)
    .map((line) => normalizeProductImageUrl(line).url)
    .filter(Boolean);
}

export async function compressImageFileToDataUrl(file: File): Promise<string> {
  const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
  if (!allowedTypes.includes((file.type || '').toLowerCase()) && !/\.(jpe?g|png|webp)$/i.test(file.name || '')) {
    throw new Error('يرجى اختيار صورة بصيغة JPEG أو PNG أو WebP فقط.');
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error('حجم الصورة يتجاوز 10 ميغابايت.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('تعذر قراءة ملف الصورة المحدد.'));
      el.src = objectUrl;
    });

    const maxDim = 1200;
    const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
    const width = Math.max(1, Math.round((img.naturalWidth || 800) * scale));
    const height = Math.max(1, Math.round((img.naturalHeight || 800) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('تعذر تهيئة معالج الصور في المتصفح.');
    ctx.drawImage(img, 0, 0, width, height);

    // Prefer WebP; fallback to JPEG/PNG cleanly
    const isPng = (file.type || '').toLowerCase() === 'image/png';
    const webpData = canvas.toDataURL('image/webp', 0.86);
    if (webpData.startsWith('data:image/webp;base64,') && webpData.length <= 550_000) {
      return webpData;
    }
    const targetMime = isPng ? 'image/png' : 'image/jpeg';
    const fallbackData = canvas.toDataURL(targetMime, 0.85);
    if (fallbackData.length > 1_200_000) {
      return canvas.toDataURL('image/jpeg', 0.72);
    }
    return fallbackData;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
