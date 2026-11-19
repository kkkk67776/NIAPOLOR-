import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import {
  getPersistenceStatus,
  isCloudPersistenceEnabled,
  loadCloudJson,
  PersistenceProvider,
  saveCloudJson,
} from './cloudPersistence';
import { quarantineSuspiciousItem } from './securityEngine';

export const MAX_PRODUCT_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const FIRESTORE_CLOUD_IMAGE_MAX_BYTES = 650 * 1024; // Fits safely inside Firestore 1 MiB document limit

export type MediaStorageProvider = 'cloudflare-r2' | PersistenceProvider;

export interface UploadedProductImageResult {
  ok: boolean;
  statusCode?: number;
  error?: string;
  mediaId?: string;
  fileName?: string;
  url?: string;
  mime?: string;
  format?: 'JPEG' | 'PNG' | 'WebP';
  sizeBytes?: number;
  sha256?: string;
  provider?: MediaStorageProvider;
}

export interface StoredMediaAsset {
  mediaId: string;
  fileName: string;
  buffer: Buffer;
  mime: string;
  format: 'JPEG' | 'PNG' | 'WebP';
  sizeBytes: number;
  etag: string;
  provider: MediaStorageProvider;
}

interface StoredMediaMetadata {
  mediaId: string;
  fileName: string;
  mime: string;
  format: 'JPEG' | 'PNG' | 'WebP';
  sizeBytes: number;
  sha256: string;
  originalName?: string;
  provider: MediaStorageProvider;
  objectKey?: string;
  publicUrl?: string;
  createdAt: string;
  uploadedBy?: string;
}

interface CloudMediaRecord extends StoredMediaMetadata {
  dataBase64: string;
}

const VALID_PRODUCT_FILENAME_RE = /^(img_[a-zA-Z0-9_-]{8,80})\.(jpe?g|png|webp)$/i;

interface DetectedImageSignature {
  mime: 'image/jpeg' | 'image/png' | 'image/webp';
  format: 'JPEG' | 'PNG' | 'WebP';
  ext: 'jpg' | 'png' | 'webp';
}

export function detectProductImageMagicBytes(buf: Buffer): DetectedImageSignature | null {
  if (!buf || buf.length < 12) return null;

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mime: 'image/jpeg', format: 'JPEG', ext: 'jpg' };
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mime: 'image/png', format: 'PNG', ext: 'png' };
  }

  // WebP: RIFF....WEBP
  if (
    buf.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buf.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', format: 'WebP', ext: 'webp' };
  }

  return null;
}

function getNormalizedDeclaredMime(rawMime: string): string {
  const base = (rawMime || '').split(';')[0].trim().toLowerCase();
  if (base === 'image/jpg') return 'image/jpeg';
  return base;
}

function doesTextLookLikeDangerousScriptOrMarkup(buf: Buffer): boolean {
  const sample = buf.subarray(0, 512).toString('utf8').toLowerCase();
  return (
    sample.includes('<svg') ||
    sample.includes('<html') ||
    sample.includes('<script') ||
    sample.includes('<!doctype') ||
    sample.includes('<?xml')
  );
}

export function isR2Configured(): boolean {
  const accessKey = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucket = (process.env.R2_BUCKET_NAME || '').trim();
  const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const endpoint = (process.env.R2_ENDPOINT || '').trim();
  return Boolean(accessKey && secretKey && bucket && (accountId || endpoint));
}

function getR2Config() {
  const accountId = (process.env.R2_ACCOUNT_ID || '').trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || '').trim();
  const bucketName = (process.env.R2_BUCKET_NAME || '').trim();
  const region = (process.env.R2_REGION || 'auto').trim() || 'auto';
  const endpointRaw = (process.env.R2_ENDPOINT || '').trim();
  const endpoint = (endpointRaw || `https://${accountId}.r2.cloudflarestorage.com`).replace(/\/$/, '');
  const publicUrl = (process.env.R2_PUBLIC_URL || '').trim().replace(/\/$/, '');
  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucketName,
    region,
    endpoint,
    publicUrl,
  };
}

function sha256Hex(input: Buffer | string): string {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hmacSha256(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

export function buildS3v4SignedRequest(params: {
  method: 'PUT' | 'GET';
  endpoint: string;
  bucket: string;
  objectKey: string;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  contentType?: string;
  payload?: Buffer;
  date?: Date;
}): { url: string; headers: Record<string, string> } {
  const now = params.date || new Date();
  const iso = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const amzDate = iso; // YYYYMMDDTHHMMSSZ
  const dateStamp = iso.slice(0, 8);
  const region = params.region || 'auto';
  const service = 's3';

  const encodedKey = params.objectKey
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
  const targetUrl = new URL(`${params.endpoint.replace(/\/$/, '')}/${encodeURIComponent(params.bucket)}/${encodedKey}`);
  const payloadHash = sha256Hex(params.payload || Buffer.alloc(0));

  const signedHeaderMap: Record<string, string> = {
    host: targetUrl.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  if (params.contentType) {
    signedHeaderMap['content-type'] = params.contentType;
  }

  const headerNames = Object.keys(signedHeaderMap).sort();
  const canonicalHeaders = headerNames.map((name) => `${name}:${signedHeaderMap[name].trim()}\n`).join('');
  const signedHeaders = headerNames.join(';');

  const canonicalRequest = [
    params.method,
    targetUrl.pathname,
    '',
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmacSha256(`AWS4${params.secretAccessKey}`, dateStamp);
  const kRegion = hmacSha256(kDate, region);
  const kService = hmacSha256(kRegion, service);
  const kSigning = hmacSha256(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign, 'utf8').digest('hex');

  const headers: Record<string, string> = {
    'x-amz-date': amzDate,
    'x-amz-content-sha256': payloadHash,
    Authorization: `AWS4-HMAC-SHA256 Credential=${params.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
  if (params.contentType) {
    headers['Content-Type'] = params.contentType;
  }

  return {
    url: targetUrl.toString(),
    headers,
  };
}

async function putObjectToR2(
  objectKey: string,
  buffer: Buffer,
  mime: string
): Promise<{ ok: boolean; error?: string }> {
  const cfg = getR2Config();
  const signed = buildS3v4SignedRequest({
    method: 'PUT',
    endpoint: cfg.endpoint,
    bucket: cfg.bucketName,
    objectKey,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
    contentType: mime,
    payload: buffer,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(signed.url, {
      method: 'PUT',
      headers: {
        ...signed.headers,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Length': String(buffer.length),
      },
      body: new Uint8Array(buffer),
      signal: controller.signal,
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      return {
        ok: false,
        error: `فشل رفع الصورة إلى Cloudflare R2 (HTTP ${res.status})${errBody ? `: ${errBody.slice(0, 140)}` : '.'}`,
      };
    }
    return { ok: true };
  } catch (err: any) {
    return {
      ok: false,
      error:
        err?.name === 'AbortError'
          ? 'انتهت مهلة الاتصال بخدمة التخزين السحابي Cloudflare R2.'
          : `تعذر الاتصال بخدمة Cloudflare R2: ${err?.message || String(err)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function getObjectFromR2(objectKey: string): Promise<Buffer | null> {
  if (!isR2Configured()) return null;
  const cfg = getR2Config();
  const signed = buildS3v4SignedRequest({
    method: 'GET',
    endpoint: cfg.endpoint,
    bucket: cfg.bucketName,
    objectKey,
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    region: cfg.region,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const res = await fetch(signed.url, {
      method: 'GET',
      headers: signed.headers,
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const arr = await res.arrayBuffer();
    return Buffer.from(arr);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function getMediaUploadsDir(): string {
  const status = getPersistenceStatus();
  const dir = path.join(status.dataDir, 'media_uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function atomicWriteBinarySync(targetPath: string, data: Buffer): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, data);
  fs.renameSync(tmpPath, targetPath);
}

function atomicWriteMetadataSync(targetPath: string, meta: StoredMediaMetadata): void {
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(meta, null, 2), 'utf-8');
  fs.renameSync(tmpPath, targetPath);
}

export function getMediaStorageStatus() {
  const persistence = getPersistenceStatus();
  const r2 = isR2Configured();
  const r2Cfg = getR2Config();
  const provider: MediaStorageProvider = r2 ? 'cloudflare-r2' : persistence.provider;
  return {
    provider,
    r2Configured: r2,
    r2PublicUrlConfigured: Boolean(r2 && r2Cfg.publicUrl),
    durable: r2 ? true : persistence.durable,
    cloudEnabled: r2 || persistence.cloudEnabled,
    maxUploadBytes: MAX_PRODUCT_IMAGE_UPLOAD_BYTES,
    allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    persistenceProvider: persistence.provider,
  };
}

export async function uploadVerifiedProductImage(params: {
  buffer: Buffer;
  declaredMime?: string;
  originalName?: string;
  actorIp?: string;
  actorEmail?: string;
}): Promise<UploadedProductImageResult> {
  const { buffer, declaredMime = '', originalName = '', actorIp = 'unknown', actorEmail = 'owner' } = params;

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    return {
      ok: false,
      statusCode: 400,
      error: 'ملف الصورة فارغ أو لم يصل إلى الخادم.',
    };
  }

  if (buffer.length > MAX_PRODUCT_IMAGE_UPLOAD_BYTES) {
    return {
      ok: false,
      statusCode: 413,
      error: 'حجم الصورة يتجاوز الحد الأقصى المسموح به (10 ميغابايت).',
    };
  }

  const sha256 = sha256Hex(buffer);
  const normalizedMime = getNormalizedDeclaredMime(declaredMime);
  const magic = detectProductImageMagicBytes(buffer);

  if (!magic) {
    const looksDangerous =
      normalizedMime.includes('svg') ||
      normalizedMime.includes('html') ||
      doesTextLookLikeDangerousScriptOrMarkup(buffer);
    if (looksDangerous) {
      quarantineSuspiciousItem({
        source: 'admin_media_upload',
        reason: 'محاولة رفع ملف غير نقطي (SVG/HTML/Script) ضمن رفع صور المنتجات',
        severity: 'critical',
        actorIp,
        mimeDeclared: declaredMime || 'unknown',
        payloadHash: sha256,
        payloadPreview: buffer.subarray(0, 96).toString('utf8'),
      });
    }
    return {
      ok: false,
      statusCode: 415,
      error: 'صيغة الملف غير مدعومة أو تالفة. يُسمح فقط بملفات JPEG وPNG وWebP الأصلية.',
    };
  }

  if (
    normalizedMime &&
    normalizedMime !== 'application/octet-stream' &&
    normalizedMime !== magic.mime
  ) {
    quarantineSuspiciousItem({
      source: 'admin_media_upload',
      reason: `تضارب بين نوع الملف المُعلن (${normalizedMime}) والتوقيع الثنائي الفعلي (${magic.mime})`,
      severity: 'warning',
      actorIp,
      mimeDeclared: normalizedMime,
      payloadHash: sha256,
      payloadPreview: `declared=${normalizedMime}, actual=${magic.mime}`,
    });
    return {
      ok: false,
      statusCode: 415,
      error: `محتوى الصورة الفعلي (${magic.format}) لا يطابق نوع الملف المعلن (${normalizedMime}).`,
    };
  }

  const mediaId = `img_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
  const fileName = `${mediaId}.${magic.ext}`;
  const objectKey = `products/${fileName}`;
  const nowIso = new Date().toISOString();

  // 1. Primary Cloud Object Storage: Cloudflare R2 (when configured)
  if (isR2Configured()) {
    const r2Res = await putObjectToR2(objectKey, buffer, magic.mime);
    if (!r2Res.ok) {
      return {
        ok: false,
        statusCode: 502,
        error: r2Res.error || 'تعذر حفظ الصورة في التخزين السحابي Cloudflare R2.',
      };
    }

    const r2Cfg = getR2Config();
    const permanentUrl = r2Cfg.publicUrl
      ? `${r2Cfg.publicUrl}/${objectKey}`
      : `/api/media/products/${fileName}`;

    const meta: StoredMediaMetadata = {
      mediaId,
      fileName,
      mime: magic.mime,
      format: magic.format,
      sizeBytes: buffer.length,
      sha256,
      originalName: originalName.slice(0, 120),
      provider: 'cloudflare-r2',
      objectKey,
      publicUrl: permanentUrl,
      createdAt: nowIso,
      uploadedBy: actorEmail,
    };

    try {
      const uploadsDir = getMediaUploadsDir();
      atomicWriteBinarySync(path.join(uploadsDir, fileName), buffer);
      atomicWriteMetadataSync(path.join(uploadsDir, `${mediaId}.meta.json`), meta);
    } catch {
      // Non-fatal local cache write when R2 already confirmed permanent persistence
    }

    return {
      ok: true,
      statusCode: 201,
      mediaId,
      fileName,
      url: permanentUrl,
      mime: magic.mime,
      format: magic.format,
      sizeBytes: buffer.length,
      sha256,
      provider: 'cloudflare-r2',
    };
  }

  // 2. Durable Backend Persistence: Cloud DB (Firestore / Upstash) + Persistent/Local Atomic Disk
  const persistence = getPersistenceStatus();
  if (!persistence.durable) {
    return {
      ok: false,
      statusCode: 503,
      error:
        'تعذر تأكيد الحفظ الدائم للصورة: الخادم يعمل حالياً على قرص مؤقت بدون ربط Cloudflare R2 أو قاعدة بيانات سحابية.',
    };
  }

  const permanentUrl = `/api/media/products/${fileName}`;
  const meta: StoredMediaMetadata = {
    mediaId,
    fileName,
    mime: magic.mime,
    format: magic.format,
    sizeBytes: buffer.length,
    sha256,
    originalName: originalName.slice(0, 120),
    provider: persistence.provider,
    publicUrl: permanentUrl,
    createdAt: nowIso,
    uploadedBy: actorEmail,
  };

  if (isCloudPersistenceEnabled()) {
    if (persistence.provider === 'firestore' && buffer.length > FIRESTORE_CLOUD_IMAGE_MAX_BYTES) {
      return {
        ok: false,
        statusCode: 413,
        error:
          'حجم الصورة يتجاوز الحد المسموح لتخزين Firestore المباشر (650 كيلوبايت) بدون ربط Cloudflare R2. يرجى ضغط الصورة أو ربط Cloudflare R2.',
      };
    }

    const cloudRecord: CloudMediaRecord = {
      ...meta,
      dataBase64: buffer.toString('base64'),
    };
    const cloudSave = await saveCloudJson(`echox:media:${mediaId}`, cloudRecord);
    if (!cloudSave.ok) {
      return {
        ok: false,
        statusCode: 503,
        error: cloudSave.error || 'تعذر تأكيد حفظ الصورة في التخزين السحابي.',
      };
    }
  }

  try {
    const uploadsDir = getMediaUploadsDir();
    atomicWriteBinarySync(path.join(uploadsDir, fileName), buffer);
    atomicWriteMetadataSync(path.join(uploadsDir, `${mediaId}.meta.json`), meta);
  } catch (err: any) {
    if (!isCloudPersistenceEnabled()) {
      return {
        ok: false,
        statusCode: 500,
        error: `فشل تخزين ملف الصورة على الخادم: ${err?.message || String(err)}`,
      };
    }
  }

  return {
    ok: true,
    statusCode: 201,
    mediaId,
    fileName,
    url: permanentUrl,
    mime: magic.mime,
    format: magic.format,
    sizeBytes: buffer.length,
    sha256,
    provider: persistence.provider,
  };
}

export async function readStoredProductImage(rawFileName: string): Promise<StoredMediaAsset | null> {
  const cleanName = (rawFileName || '').split('?')[0].trim();
  const match = cleanName.match(VALID_PRODUCT_FILENAME_RE);
  if (!match) return null;

  const mediaId = match[1];
  const uploadsDir = getMediaUploadsDir();
  const diskFilePath = path.join(uploadsDir, cleanName);
  const diskMetaPath = path.join(uploadsDir, `${mediaId}.meta.json`);

  // 1. Fast disk hit (Atomic Disk / Persistent Disk / Local Cache)
  if (fs.existsSync(diskFilePath)) {
    try {
      const buffer = fs.readFileSync(diskFilePath);
      const magic = detectProductImageMagicBytes(buffer);
      if (magic) {
        let provider: MediaStorageProvider = getPersistenceStatus().provider;
        if (fs.existsSync(diskMetaPath)) {
          try {
            const parsedMeta = JSON.parse(fs.readFileSync(diskMetaPath, 'utf-8')) as StoredMediaMetadata;
            if (parsedMeta?.provider) provider = parsedMeta.provider;
          } catch {}
        }
        return {
          mediaId,
          fileName: cleanName,
          buffer,
          mime: magic.mime,
          format: magic.format,
          sizeBytes: buffer.length,
          etag: `"${sha256Hex(buffer).slice(0, 24)}"`,
          provider,
        };
      }
    } catch {
      // fall through to cloud lookup
    }
  }

  // 2. Cloud Persistence fallback (Firestore / Upstash Redis)
  if (isCloudPersistenceEnabled()) {
    const cloudRecord = await loadCloudJson<CloudMediaRecord>(`echox:media:${mediaId}`);
    if (cloudRecord && typeof cloudRecord.dataBase64 === 'string' && cloudRecord.dataBase64.length > 0) {
      try {
        const buffer = Buffer.from(cloudRecord.dataBase64, 'base64');
        const magic = detectProductImageMagicBytes(buffer);
        if (magic) {
          try {
            atomicWriteBinarySync(diskFilePath, buffer);
            const { dataBase64: _ignored, ...metaOnly } = cloudRecord;
            atomicWriteMetadataSync(diskMetaPath, metaOnly);
          } catch {}
          return {
            mediaId,
            fileName: cleanName,
            buffer,
            mime: magic.mime,
            format: magic.format,
            sizeBytes: buffer.length,
            etag: `"${sha256Hex(buffer).slice(0, 24)}"`,
            provider: cloudRecord.provider || getPersistenceStatus().provider,
          };
        }
      } catch {
        // ignore corrupt base64
      }
    }
  }

  // 3. Cloudflare R2 fallback (when R2 is configured without public URL or cache miss)
  if (isR2Configured()) {
    const r2Buf = await getObjectFromR2(`products/${cleanName}`);
    if (r2Buf) {
      const magic = detectProductImageMagicBytes(r2Buf);
      if (magic) {
        try {
          atomicWriteBinarySync(diskFilePath, r2Buf);
        } catch {}
        return {
          mediaId,
          fileName: cleanName,
          buffer: r2Buf,
          mime: magic.mime,
          format: magic.format,
          sizeBytes: r2Buf.length,
          etag: `"${sha256Hex(r2Buf).slice(0, 24)}"`,
          provider: 'cloudflare-r2',
        };
      }
    }
  }

  return null;
}
