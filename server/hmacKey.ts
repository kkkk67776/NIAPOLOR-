import dotenv from 'dotenv';

dotenv.config();

export interface ServerHmacStatus {
  configured: boolean;
  valid: boolean;
  effectiveBytes: number;
  charLength: number;
  error: string | null;
}

export class HmacSecretNotConfiguredError extends Error {
  public readonly statusCode = 503;
  public readonly code = 'HMAC_SECRET_NOT_CONFIGURED';

  constructor(
    message = 'تعذر تشغيل الوظائف الأمنية الحساسة: متغير البيئة ECHOX_SECURITY_HMAC_SECRET غير مضبوط أو أقصر من 32 بايت.'
  ) {
    super(message);
    this.name = 'HmacSecretNotConfiguredError';
  }
}

export function getEffectiveHmacByteLength(secret: string): number {
  const trimmed = (secret || '').trim();
  if (!trimmed) return 0;
  if (/^[a-f0-9]+$/i.test(trimmed)) {
    return Math.floor(trimmed.length / 2);
  }
  return Buffer.byteLength(trimmed, 'utf8');
}

export function getServerHmacStatus(): ServerHmacStatus {
  const raw = (process.env.ECHOX_SECURITY_HMAC_SECRET || '').trim();
  const effectiveBytes = getEffectiveHmacByteLength(raw);
  const configured = raw.length > 0;
  const valid = effectiveBytes >= 32;

  let error: string | null = null;
  if (!configured) {
    error = 'ECHOX_SECURITY_HMAC_SECRET environment variable is not set.';
  } else if (!valid) {
    error = `ECHOX_SECURITY_HMAC_SECRET is shorter than the required 32 bytes (${effectiveBytes} bytes).`;
  }

  return {
    configured,
    valid,
    effectiveBytes,
    charLength: raw.length,
    error,
  };
}

export function getValidatedHmacSecret(): string | null {
  const raw = (process.env.ECHOX_SECURITY_HMAC_SECRET || '').trim();
  return getEffectiveHmacByteLength(raw) >= 32 ? raw : null;
}

export function requireServerHmacSecret(): string {
  const secret = getValidatedHmacSecret();
  if (!secret) {
    throw new HmacSecretNotConfiguredError();
  }
  return secret;
}
