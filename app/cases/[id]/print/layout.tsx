/**
 * 印刷専用 layout
 * - app/(dashboard)/layout.tsx（Sidebar + main ラッパー）を介さないルートに配置
 * - <html><body> は app/layout.tsx（root）が持つ。ここでは何もラップしない
 */
export default function PrintLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}