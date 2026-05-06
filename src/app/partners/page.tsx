import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ShieldCheck, Sparkles } from "lucide-react";

export const metadata: Metadata = {
  title: "合作伙伴 | 小胰宝",
  description: "小胰宝合作伙伴页面。",
};

const partners = [
  {
    name: "FastGPT",
    role: "对话编排",
  },
  {
    name: "阿里云百炼",
    role: "语音能力",
  },
  {
    name: "火山引擎豆包",
    role: "语音能力",
  },
];

export default function PartnersPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#fcfbf7_0%,#f4ede0_100%)] px-4 py-8 text-stone-900">
      <section className="mx-auto flex min-h-[calc(100vh-4rem)] w-full max-w-5xl flex-col justify-center">
        <div className="mb-8 flex items-center justify-between gap-4">
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-medium text-teal-800 shadow-sm ring-1 ring-teal-100">
            <ShieldCheck className="h-4 w-4" />
            小胰宝
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 rounded-full border border-stone-300 bg-white/70 px-4 py-2 text-sm font-medium text-stone-700 transition hover:border-teal-700 hover:text-teal-700"
          >
            返回首页
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="rounded-[28px] border border-white/80 bg-white/85 p-6 shadow-[0_20px_80px_rgba(120,113,108,0.12)] sm:p-10">
          <div className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-800">
            <Sparkles className="h-4 w-4" />
            合作伙伴
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
            连接可信服务，守护病历隐私。
          </h1>

          <div className="mt-8 grid gap-4 sm:grid-cols-3">
            {partners.map((partner) => (
              <div
                key={partner.name}
                className="rounded-2xl border border-stone-200 bg-stone-50/80 p-5"
              >
                <div className="text-lg font-semibold text-stone-900">{partner.name}</div>
                <div className="mt-2 text-sm text-stone-500">{partner.role}</div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
