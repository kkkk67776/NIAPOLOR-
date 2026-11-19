import dns from 'dns';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { normalizeProductImageUrl } from '../src/lib/imageUrl';
import { readStoredProductImage } from './mediaStorage';
import { validateRasterImageMagicBytes } from './securityEngine';

export interface MediaInspectResult {
  ok: boolean;
  kind: 'image' | 'webpage' | 'http_insecure' | 'invalid' | 'error';
  inputUrl: string;
  normalizedUrl: string;
  directUrl?: string;
  suggestedImageUrl?: string;
  httpsUpgradeUrl?: string;
  mime?: string;
  format?: string;
  statusCode?: number;
  error?: string;
}

const IMAGE_MIME_FORMATS: Record<string, string> = {
  'image/jpeg': 'JPEG',
  'image/jpg': 'JPEG',
  'image/png': 'PNG',
  'image/webp': 'WebP',
  'image/gif': 'GIF',
  'image/avif': 'AVIF',
  'image/svg+xml': 'SVG',
};

function isPrivateOrLoopbackIp(ip: string): boolean {
  const clean = ip.replace(/^::ffff:/i, '').trim().toLowerCase();
  if (!clean) return true;
  if (clean === '127.0.0.1' || clean === '0.0.0.0' || clean === '::1' || clean === '::') return true;

  if (net.isIPv4(clean)) {
    const parts = clean.split('.').map((n) => parseInt(n, 10));
    if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) return true;
    const [a, b] = parts;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }

  if (net.isIPv6(clean)) {
    if (clean === '::1' || clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) {
      return true;
    }
    return false;
  }

  return true;
}

async function assertSafePublicTarget(targetUrl: URL, allowLoopbackForTest: boolean): Promise<void> {
  const host = targetUrl.hostname.toLowerCase();
  if (!host) throw new Error('نطاق الرابط غير صالح.');

  const isLocalName =
    host === 'localhost' ||
    host === 'localhost.localdomain' ||
    host.endsWith('.local') ||
    host.endsWith('.internal');

  if (!allowLoopbackForTest && isLocalName) {
    throw new Error('لا يُسمح بفحص روابط الشبكة المحلية.');
  }

  if (net.isIP(host)) {
    if (!allowLoopbackForTest && isPrivateOrLoopbackIp(host)) {
      throw new Error('عنوان IP خاص غير مسموح به لأسباب أمنية.');
    }
    return;
  }

  if (allowLoopbackForTest && (host === '127.0.0.1' || host === 'localhost')) {
    return;
  }

  const records = await dns.promises.lookup(host, { all: true });
  if (!records || records.length === 0) {
    throw new Error('تعذر العثور على النطاق (DNS).');
  }
  for (const rec of records) {
    if (!allowLoopbackForTest && isPrivateOrLoopbackIp(rec.address)) {
      throw new Error('يشير النطاق إلى عنوان شبكة داخلية محظور أمنياً.');
    }
  }
}

function detectFormatFromMagicBytes(buf: Buffer): { mime: string; format: string } | null {
  if (!buf || buf.length < 4) return null;
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
    return { mime: 'image/png', format: 'PNG' };
  }
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', format: 'JPEG' };
  }
  if (
    buf.length >= 12 &&
    buf.slice(0, 4).toString('ascii') === 'RIFF' &&
    buf.slice(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', format: 'WebP' };
  }
  if (buf.length >= 6 && buf.slice(0, 4).toString('ascii') === 'GIF8') {
    return { mime: 'image/gif', format: 'GIF' };
  }
  return null;
}

function extractMetaImageFromHtml(html: string, pageUrl: string): string | undefined {
  const metaPatterns = [
    /<meta[^>]+(?:property|name)=["'](?:og:image:secure_url|og:image|twitter:image|twitter:image:src)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:og:image:secure_url|og:image|twitter:image|twitter:image:src)["']/i,
  ];
  for (const re of metaPatterns) {
    const match = html.match(re);
    if (match?.[1]) {
      try {
        const resolved = new URL(match[1].trim(), pageUrl).toString();
        if (/^https:\/\//i.test(resolved)) {
          return resolved;
        }
      } catch {
        // ignore invalid relative url
      }
    }
  }
  return undefined;
}

async function fetchRemoteWithSafeRedirects(
  initialUrl: string,
  method: 'HEAD' | 'GET',
  allowLoopbackForTest: boolean
): Promise<{ finalUrl: string; res: globalThis.Response }> {
  let currentUrl = initialUrl;
  for (let hop = 0; hop < 5; hop++) {
    const parsed = new URL(currentUrl);
    await assertSafePublicTarget(parsed, allowLoopbackForTest);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    try {
      const res = await fetch(currentUrl, {
        method,
        redirect: 'manual',
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; ECHOXStoreMediaCheck/1.0)',
          Accept: 'image/webp,image/png,image/jpeg,image/*;q=0.9,text/html;q=0.5,*/*;q=0.1',
          ...(method === 'GET' ? { Range: 'bytes=0-65535' } : {}),
        },
      });
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get('location');
        if (!location) {
          return { finalUrl: currentUrl, res };
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      return { finalUrl: currentUrl, res };
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('تجاوز الرابط الحد الأقصى لإعادة التوجيه.');
}

async function readPrefixBuffer(res: globalThis.Response, maxBytes = 65536): Promise<Buffer> {
  if (!res.body) return Buffer.alloc(0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < maxBytes) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      total += value.byteLength;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  return Buffer.concat(chunks).subarray(0, maxBytes);
}

export async function inspectImageUrlOnServer(
  rawUrl: string,
  options: { allowLoopbackForTest?: boolean } = {}
): Promise<MediaInspectResult> {
  const allowLoopbackForTest = Boolean(options.allowLoopbackForTest);
  const norm = normalizeProductImageUrl(rawUrl);

  if (!norm.url) {
    return {
      ok: false,
      kind: 'invalid',
      inputUrl: rawUrl,
      normalizedUrl: '',
      error: 'الرجاء إدخال رابط صورة.',
    };
  }

  if (norm.issue === 'unsupported_scheme' || norm.issue === 'missing_protocol') {
    return {
      ok: false,
      kind: 'invalid',
      inputUrl: rawUrl,
      normalizedUrl: norm.url,
      error: norm.reason || 'صيغة الرابط غير صالحة.',
    };
  }

  // Data URI image check
  if (norm.url.startsWith('data:image/')) {
    const magic = validateRasterImageMagicBytes(norm.url);
    if (!magic.ok) {
      return {
        ok: false,
        kind: 'invalid',
        inputUrl: rawUrl,
        normalizedUrl: norm.url,
        error: magic.error || 'بيانات الصورة غير صالحة.',
      };
    }
    const ext = (magic.mime || '').replace('image/', '').toUpperCase();
    return {
      ok: true,
      kind: 'image',
      inputUrl: rawUrl,
      normalizedUrl: norm.url,
      directUrl: norm.url,
      mime: magic.mime,
      format: ext === 'WEBP' ? 'WebP' : ext,
    };
  }

  // Local /assets/... check
  if (norm.url.startsWith('/assets/')) {
    const rel = norm.url.replace(/^\/+/, '').split('?')[0];
    if (rel.includes('..')) {
      return { ok: false, kind: 'invalid', inputUrl: rawUrl, normalizedUrl: norm.url, error: 'مسار غير صالح.' };
    }
    const candidates = [
      path.resolve(process.cwd(), 'public', rel),
      path.resolve(process.cwd(), 'dist', rel),
    ];
    const hit = candidates.find((p) => fs.existsSync(p) && fs.statSync(p).isFile());
    if (!hit) {
      return {
        ok: false,
        kind: 'error',
        inputUrl: rawUrl,
        normalizedUrl: norm.url,
        statusCode: 404,
        error: 'ملف الصورة المحلي غير موجود على الخادم.',
      };
    }
    const prefix = fs.readFileSync(hit).subarray(0, 32);
    const detected = detectFormatFromMagicBytes(prefix);
    const ext = path.extname(hit).toLowerCase();
    const mime = detected?.mime || (ext === '.svg' ? 'image/svg+xml' : 'image/webp');
    const format = detected?.format || ext.replace('.', '').toUpperCase();
    return {
      ok: true,
      kind: 'image',
      inputUrl: rawUrl,
      normalizedUrl: norm.url,
      directUrl: norm.url,
      mime,
      format,
      statusCode: 200,
    };
  }

  // Uploaded permanent product image check (/api/media/products/...)
  if (norm.url.startsWith('/api/media/products/')) {
    const fileName = norm.url.slice('/api/media/products/'.length).split('?')[0];
    const stored = await readStoredProductImage(fileName);
    if (!stored) {
      return {
        ok: false,
        kind: 'error',
        inputUrl: rawUrl,
        normalizedUrl: norm.url,
        statusCode: 404,
        error: 'ملف الصورة المرفوع غير موجود في التخزين السحابي/الدائم.',
      };
    }
    return {
      ok: true,
      kind: 'image',
      inputUrl: rawUrl,
      normalizedUrl: norm.url,
      directUrl: norm.url,
      mime: stored.mime,
      format: stored.format,
      statusCode: 200,
    };
  }

  const probeRemote = async (target: string): Promise<MediaInspectResult> => {
    let headResult = await fetchRemoteWithSafeRedirects(target, 'HEAD', allowLoopbackForTest);
    let res = headResult.res;
    let finalUrl = headResult.finalUrl;

    if (res.status === 405 || res.status === 501 || res.status === 403 || !res.headers.get('content-type')) {
      const getResult = await fetchRemoteWithSafeRedirects(target, 'GET', allowLoopbackForTest);
      res = getResult.res;
      finalUrl = getResult.finalUrl;
    }

    const ctRaw = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();

    if (!res.ok) {
      return {
        ok: false,
        kind: 'error',
        inputUrl: rawUrl,
        normalizedUrl: target,
        statusCode: res.status,
        error:
          res.status === 403
            ? 'المصدر يرفض الوصول المباشر للصورة (HTTP 403 Forbidden)؛ حمّل الصورة أو استخدم رابطاً مباشراً مفتوحاً.'
            : res.status === 404
            ? 'ملف الصورة غير موجود في هذا الرابط (HTTP 404 Not Found).'
            : `تعذر تحميل الرابط (HTTP ${res.status}).`,
      };
    }

    if (IMAGE_MIME_FORMATS[ctRaw] || ctRaw.startsWith('image/')) {
      const format = IMAGE_MIME_FORMATS[ctRaw] || ctRaw.replace('image/', '').toUpperCase();
      return {
        ok: true,
        kind: 'image',
        inputUrl: rawUrl,
        normalizedUrl: target,
        directUrl: finalUrl,
        mime: ctRaw,
        format,
        statusCode: res.status,
      };
    }

    if (ctRaw.includes('text/html') || ctRaw.includes('application/xhtml')) {
      // Read first 64KB of HTML to discover og:image if available
      const htmlRes =
        res.body && !res.bodyUsed
          ? res
          : (await fetchRemoteWithSafeRedirects(finalUrl, 'GET', allowLoopbackForTest)).res;
      const buf = await readPrefixBuffer(htmlRes, 65536);
      const htmlText = buf.toString('utf8');
      const suggestedImageUrl = extractMetaImageFromHtml(htmlText, finalUrl);
      return {
        ok: false,
        kind: 'webpage',
        inputUrl: rawUrl,
        normalizedUrl: target,
        suggestedImageUrl,
        mime: ctRaw,
        statusCode: res.status,
        error: 'الرابط المُدخل يشير إلى صفحة ويب (HTML) وليس إلى ملف صورة مباشر.',
      };
    }

    // Some CDNs serve valid images with application/octet-stream — inspect binary magic bytes
    if (ctRaw === 'application/octet-stream' || !ctRaw) {
      const byteRes =
        res.body && !res.bodyUsed
          ? res
          : (await fetchRemoteWithSafeRedirects(finalUrl, 'GET', allowLoopbackForTest)).res;
      const prefix = await readPrefixBuffer(byteRes, 64);
      const magic = detectFormatFromMagicBytes(prefix);
      if (magic) {
        return {
          ok: true,
          kind: 'image',
          inputUrl: rawUrl,
          normalizedUrl: target,
          directUrl: finalUrl,
          mime: magic.mime,
          format: magic.format,
          statusCode: res.status,
        };
      }
    }

    return {
      ok: false,
      kind: 'error',
      inputUrl: rawUrl,
      normalizedUrl: target,
      mime: ctRaw || 'unknown',
      statusCode: res.status,
      error: `نوع المحتوى المُعاد (${ctRaw || 'غير معروف'}) ليس صورة صالحة (JPEG / PNG / WebP).`,
    };
  };

  try {
    if (norm.issue === 'http_insecure') {
      const httpsCandidate = norm.url.replace(/^http:\/\//i, 'https://');
      try {
        const httpsCheck = await probeRemote(httpsCandidate);
        if (httpsCheck.ok) {
          return {
            ok: false,
            kind: 'http_insecure',
            inputUrl: rawUrl,
            normalizedUrl: norm.url,
            httpsUpgradeUrl: httpsCheck.directUrl || httpsCandidate,
            mime: httpsCheck.mime,
            format: httpsCheck.format,
            error: 'الرابط يستخدم http:// غير المشفر وسيحظره المتصفح بسبب CSP. يتوفر رابط HTTPS مباشر جاهز للترقية.',
          };
        }
      } catch {
        // ignore HTTPS probe error
      }
      return {
        ok: false,
        kind: 'http_insecure',
        inputUrl: rawUrl,
        normalizedUrl: norm.url,
        error: norm.reason || 'يجب أن يستخدم رابط الصورة بروتوكول HTTPS.',
      };
    }

    return await probeRemote(norm.url);
  } catch (err: any) {
    return {
      ok: false,
      kind: 'error',
      inputUrl: rawUrl,
      normalizedUrl: norm.url,
      error: err?.name === 'AbortError' ? 'انتهت مهلة الاتصال بمصدر الصورة.' : err?.message || 'تعذر الوصول إلى رابط الصورة.',
    };
  }
}
