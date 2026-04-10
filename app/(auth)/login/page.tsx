'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { createClient } from '@/lib/supabase/client'
import { Building2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

const loginSchema = z.object({
  email: z.string().email('メールアドレスの形式が正しくありません'),
  password: z.string().min(6, 'パスワードは6文字以上です'),
})
type LoginValues = z.infer<typeof loginSchema>

/**
 * ログインフォーム本体
 * useSearchParams を使うため Suspense 境界内に置く
 */
function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [loading, setLoading] = useState(false)

  // middleware が付与した redirectTo を取得
  // 安全のため / から始まる相対パスのみ許可（外部URLへのオープンリダイレクト防止）
  const rawRedirect = searchParams.get('redirectTo') ?? '/'
  const redirectTo = rawRedirect.startsWith('/') ? rawRedirect : '/'

  const { register, handleSubmit, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
  })

  const onSubmit = async (values: LoginValues) => {
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({
        email: values.email,
        password: values.password,
      })
      if (error) {
        toast.error('ログインに失敗しました。メールアドレスとパスワードを確認してください。')
        return
      }
      // ログイン成功 → redirectTo があればそこへ、なければダッシュボードへ
      router.push(redirectTo)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card p-8 shadow-sm">
        {/* ロゴ */}
        <div className="mb-8 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Building2 className="h-6 w-6 text-primary" />
          </div>
          <h1 className="text-xl font-bold">APEXIA</h1>
          <p className="text-sm text-muted-foreground">イベント管理システム</p>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* メール */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              メールアドレス
            </label>
            <input
              {...register('email')}
              type="email"
              autoComplete="email"
              placeholder="staff@apexia.jp"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {errors.email && (
              <p className="mt-1 text-xs text-destructive">{errors.email.message}</p>
            )}
          </div>

          {/* パスワード */}
          <div>
            <label className="mb-1.5 block text-sm font-medium text-foreground">
              パスワード
            </label>
            <input
              {...register('password')}
              type="password"
              autoComplete="current-password"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            {errors.password && (
              <p className="mt-1 text-xs text-destructive">{errors.password.message}</p>
            )}
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin" />}
            ログイン
          </button>
        </form>
      </div>
    </div>
  )
}

/**
 * ページエクスポート
 * useSearchParams を使う LoginForm を Suspense でラップする（Next.js 14 要件）
 */
export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
