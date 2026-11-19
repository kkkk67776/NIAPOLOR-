import { getAdminAuthHeaders, notifySessionExpired, refreshCsrfTokenFromServer, getCsrfToken } from './security';

export interface UploadedCloudMediaResult {
  mediaId: string;
  url: string;
  mime: string;
  format: 'JPEG' | 'PNG' | 'WebP';
  sizeBytes: number;
  provider: string;
}

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

function resolveAllowedImageMime(file: File): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  const rawType = (file.type || '').trim().toLowerCase();
  if (rawType === 'image/jpeg' || rawType === 'image/jpg') return 'image/jpeg';
  if (rawType === 'image/png') return 'image/png';
  if (rawType === 'image/webp') return 'image/webp';

  const name = (file.name || '').trim().toLowerCase();
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'image/jpeg';
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return null;
}

export function formatBytesReadable(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export async function uploadProductImageToCloud(
  file: File,
  options: {
    onProgress?: (percent: number, stage: 'validating' | 'uploading' | 'confirming') => void;
  } = {}
): Promise<UploadedCloudMediaResult> {
  const { onProgress } = options;
  onProgress?.(2, 'validating');

  const resolvedMime = resolveAllowedImageMime(file);
  if (!resolvedMime) {
    throw new Error('صيغة الملف غير مدعومة. يرجى اختيار صورة بصيغة JPEG أو PNG أو WebP فقط.');
  }

  if (file.size <= 0) {
    throw new Error('ملف الصورة فارغ ولا يمكن رفعه.');
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`حجم الصورة (${formatBytesReadable(file.size)}) يتجاوز الحد الأقصى المسموح به (10 MB).`);
  }

  if (!getCsrfToken()) {
    await refreshCsrfTokenFromServer().catch(() => null);
  }

  const headers = getAdminAuthHeaders({
    'Content-Type': resolvedMime,
    'X-File-Name': encodeURIComponent(file.name || `product.${resolvedMime.split('/')[1]}`),
  });

  return new Promise<UploadedCloudMediaResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/admin/media/upload', true);
    xhr.withCredentials = true;
    xhr.timeout = 45000;

    for (const [key, val] of Object.entries(headers)) {
      if (val) xhr.setRequestHeader(key, val);
    }

    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && ev.total > 0) {
        // Reserve 95%..100% for server cloud storage confirmation
        const transferPct = Math.max(5, Math.min(94, Math.round((ev.loaded / ev.total) * 90) + 5));
        onProgress?.(transferPct, transferPct >= 92 ? 'confirming' : 'uploading');
      } else {
        onProgress?.(45, 'uploading');
      }
    };

    xhr.upload.onload = () => {
      onProgress?.(95, 'confirming');
    };

    xhr.onerror = () => {
      reject(new Error('تعذر الاتصال بالخادم أثناء رفع الصورة. تحقق من اتصال الإنترنت وأعد المحاولة.'));
    };

    xhr.ontimeout = () => {
      reject(new Error('انتهت مهلة رفع الصورة. يرجى المحاولة مرة أخرى.'));
    };

    xhr.onabort = () => {
      reject(new Error('تم إلغاء عملية رفع الصورة.'));
    };

    xhr.onload = () => {
      let data: any = {};
      try {
        data = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      } catch {
        data = {};
      }

      if (xhr.status === 401 || xhr.status === 403) {
        notifySessionExpired();
        reject(new Error(data?.error || 'انتهت جلسة المالك أو رمز الحماية CSRF غير صالح. يرجى إعادة تسجيل الدخول.'));
        return;
      }

      if (xhr.status < 200 || xhr.status >= 300 || !data?.success || typeof data?.url !== 'string' || !data.url) {
        reject(
          new Error(
            data?.error ||
              `فشل تخزين الصورة على الخادم السحابي (HTTP ${xhr.status}). لم يتم اعتماد الصورة.`
          )
        );
        return;
      }

      onProgress?.(100, 'confirming');
      resolve({
        mediaId: String(data.mediaId || ''),
        url: String(data.url),
        mime: String(data.mime || resolvedMime),
        format: (data.format || 'JPEG') as 'JPEG' | 'PNG' | 'WebP',
        sizeBytes: Number(data.sizeBytes || file.size),
        provider: String(data.provider || 'cloud'),
      });
    };

    xhr.send(file);
  });
}
