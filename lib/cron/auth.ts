/**
 * cron（Vercel Cron Jobs）呼び出しの認証。
 *
 * 要件: フェイルクローズ。CRON_SECRET が未設定・空・不正な場合は、必ず認証失敗にする。
 * 旧実装は `authHeader !== \`Bearer ${process.env.CRON_SECRET}\`` で、CRON_SECRET が未設定だと
 * 文字列 "Bearer undefined" と比較され、そのヘッダを付ければ誰でも通過できた。
 *
 * このファイルは秘密の値をログ・戻り値・例外に一切含めない。
 * Supabase / Next.js に依存しないため、node:test で単体テストできる。
 */
import { createHash, timingSafeEqual } from 'node:crypto'

export type CronAuthFailure = 'secret_not_configured' | 'missing_header' | 'bad_format' | 'mismatch'
export type CronAuthResult = { ok: true } | { ok: false; reason: CronAuthFailure }

/** 環境変数の取り違え（文字列としての "undefined" / "null"）も未設定として扱う */
const PLACEHOLDER_SECRETS = new Set(['undefined', 'null'])

/** CRON_SECRET が「使える値」として設定されているか */
export function isCronSecretConfigured(secret: string | undefined | null): secret is string {
  if (typeof secret !== 'string') return false
  const trimmed = secret.trim()
  return trimmed !== '' && !PLACEHOLDER_SECRETS.has(trimmed.toLowerCase())
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

/**
 * Authorization ヘッダ（"Bearer <secret>"）を検証する。
 * ・secret 未設定 / 空 → 常に失敗（ヘッダの内容に関わらず）
 * ・ヘッダなし / 形式不正 / 不一致 → 失敗
 * ・比較は固定長ハッシュ同士を timingSafeEqual で行う（長さや内容の差でタイミングが漏れない）
 */
export function verifyCronAuth(
  authorizationHeader: string | null | undefined,
  secret: string | undefined | null
): CronAuthResult {
  if (!isCronSecretConfigured(secret)) return { ok: false, reason: 'secret_not_configured' }
  if (typeof authorizationHeader !== 'string' || authorizationHeader.trim() === '') {
    return { ok: false, reason: 'missing_header' }
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim())
  if (!match) return { ok: false, reason: 'bad_format' }

  const presented = sha256(match[1])
  const expected = sha256(secret.trim())
  return timingSafeEqual(presented, expected) ? { ok: true } : { ok: false, reason: 'mismatch' }
}
