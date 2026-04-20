'use client';

import {
  ChangeEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  AlertCircle,
  ArrowRight,
  BadgeCheck,
  Bot,
  ClipboardCheck,
  Copy,
  FileSearch,
  Loader2,
  MessageSquareText,
  ScanSearch,
  Shield,
  Sparkles,
  Upload,
  WandSparkles,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useChatStore } from '@/store/useChatStore';
import { getApiURL } from '@/lib/client/api';
import { cn } from '@/lib/utils';
import { parseSSEStream } from '@/lib/sse';

type RedactionItem = {
  type: string;
  label: string;
  original: string;
  masked: string;
  start: number;
  end: number;
  confidence: string;
};

type ManualRule = {
  id: string;
  type: string;
  text: string;
  label: string;
};

type RedactionResponse = {
  sourceType: string;
  fileName?: string;
  originalText: string;
  redactedText: string;
  warnings?: string[];
  unsupportedFile?: boolean;
  items: RedactionItem[];
  summary: {
    total: number;
    characterCount: number;
    redactedPreview: string;
    byType: Record<string, number>;
  };
};

const demoText = `姓名：王小雨
手机号：13812345678
身份证号：310101199202038765
住址：上海市徐汇区肇嘉浜路889号
病案号：ZY2026-00891
主诉：近两周睡眠差、焦虑反复。`;

const typeLabels: Record<string, string> = {
  name: '姓名',
  phone: '手机号',
  id_card: '身份证号',
  address: '地址',
  medical_id: '病历编号',
  birth_date: '出生日期',
  email: '邮箱',
  custom: '自定义',
};

const quickRuleTypes = [
  { type: 'name', label: '标成姓名' },
  { type: 'phone', label: '标成手机号' },
  { type: 'id_card', label: '标成身份证' },
  { type: 'medical_id', label: '标成病历号' },
  { type: 'address', label: '标成地址' },
];

export default function Home() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<RedactionResponse | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState<'original' | 'redacted' | null>(null);
  const [manualRules, setManualRules] = useState<ManualRule[]>([]);
  const [selection, setSelection] = useState('');
  const [extractStatus, setExtractStatus] = useState<'idle' | 'extracting' | 'done' | 'error'>(
    'idle'
  );
  const [extractMessage, setExtractMessage] = useState('');
  const [assistantPrompt, setAssistantPrompt] = useState(
    '请基于下面这份已经脱敏的医疗资料，给出清晰、克制、非诊断性的建议，并指出还需要补充哪些信息。'
  );

  const initUser = useChatStore((state) => state.initUser);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const addMessage = useChatStore((state) => state.addMessage);
  const appendTokenToLastMessage = useChatStore((state) => state.appendTokenToLastMessage);
  const setLoading = useChatStore((state) => state.setLoading);
  const isChatLoading = useChatStore((state) => state.isLoading);
  const createNewSession = useChatStore((state) => state.createNewSession);
  const userId = useChatStore((state) => state.userId);

  useEffect(() => {
    void useChatStore.persist.rehydrate();
    const unsubscribe = useChatStore.persist.onFinishHydration(() => {
      initUser();
    });

    if (useChatStore.persist.hasHydrated()) {
      initUser();
    }

    return () => {
      unsubscribe();
    };
  }, [initUser]);

  const currentSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions]
  );

  const stats = useMemo(() => {
    if (!result) {
      return [];
    }

    return Object.entries(result.summary.byType)
      .sort((a, b) => b[1] - a[1])
      .map(([type, count]) => ({
        label: typeLabels[type] || type,
        count,
      }));
  }, [result]);

  const recentMessages = useMemo(() => currentSession?.messages.slice(-6) ?? [], [currentSession]);

  async function handleSubmit() {
    if (!text.trim()) {
      setError('先粘贴一段病历文字，或者上传一个能抽出文字的文件。');
      return;
    }

    setIsSubmitting(true);
    setError('');

    try {
      const hasFile = Boolean(selectedFile);
      const response = await fetch(getApiURL('/api/desensitize'), {
        method: 'POST',
        headers: hasFile ? undefined : { 'Content-Type': 'application/json' },
        body: hasFile
          ? createFormPayload(text, selectedFile, manualRules)
          : JSON.stringify({ text, manualRules: serializeManualRules(manualRules) }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || '脱敏处理失败，请稍后再试。');
      }

      setResult(payload as RedactionResponse);
    } catch (submitError) {
      setResult(null);
      setError(
        submitError instanceof Error ? submitError.message : '脱敏处理失败，请稍后再试。'
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setSelectedFile(file);
    setResult(null);

    if (!file) {
      setExtractStatus('idle');
      setExtractMessage('');
      return;
    }

    setExtractStatus('extracting');
    setExtractMessage('正在读取文件内容...');
    setError('');

    try {
      const extractedText = await extractTextFromFile(file, (message) => {
        setExtractMessage(message);
      });

      if (!extractedText.trim()) {
        throw new Error('这个文件里暂时没有抽出可用文字。可以试试换图片，或先做 OCR 后再粘贴进来。');
      }

      setText(extractedText.trim());
      setExtractStatus('done');
      setExtractMessage(`已从 ${file.name} 提取文字，你可以继续人工修正后再脱敏。`);
    } catch (extractError) {
      setExtractStatus('error');
      setExtractMessage(
        extractError instanceof Error
          ? extractError.message
          : '文件解析失败，请换一个文件重试。'
      );
    }
  }

  function handleReset() {
    setText('');
    setSelectedFile(null);
    setResult(null);
    setError('');
    setManualRules([]);
    setSelection('');
    setExtractStatus('idle');
    setExtractMessage('');
  }

  function captureSelection() {
    const node = textareaRef.current;
    if (!node) {
      return;
    }

    const start = node.selectionStart;
    const end = node.selectionEnd;
    const selectedText = node.value.slice(start, end).trim();
    setSelection(selectedText);
  }

  function addManualRule(type: string) {
    const selectedText = selection.trim();
    if (!selectedText) {
      return;
    }

    setManualRules((current) => {
      if (current.some((rule) => rule.type === type && rule.text === selectedText)) {
        return current;
      }

      return [
        ...current,
        {
          id: `${type}-${selectedText}-${current.length}`,
          type,
          text: selectedText,
          label: typeLabels[type] || '自定义',
        },
      ];
    });
    setSelection('');
  }

  function removeManualRule(ruleId: string) {
    setManualRules((current) => current.filter((rule) => rule.id !== ruleId));
  }

  async function handleCopy(content: string, type: 'original' | 'redacted') {
    await navigator.clipboard.writeText(content);
    setCopied(type);
    window.setTimeout(() => setCopied(null), 1600);
  }

  async function sendToAssistant(message: string) {
    const sessionMessages = currentSession?.messages ?? [];
    const targetSessionId = activeSessionId || createNewSession();

    addMessage('user', message);
    addMessage('assistant', '');
    setLoading(true);

    try {
      const response = await fetch(getApiURL('/api/chat'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            ...sessionMessages.map((item) => ({ role: item.role, content: item.content })),
            { role: 'user', content: message },
          ],
          stream: true,
          chatId: targetSessionId,
          variables: userId ? { uid: userId } : undefined,
        }),
      });

      if (!response.ok) {
        throw new Error(`聊天服务错误: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) {
        throw new Error('无法读取响应流');
      }

      await parseSSEStream(reader, appendTokenToLastMessage);
    } catch {
      appendTokenToLastMessage('抱歉，小馨宝暂时没能完成这次分析，请稍后再试。');
    } finally {
      setLoading(false);
    }
  }

  async function handleAskAI() {
    if (!result?.redactedText) {
      return;
    }

    const message = `${assistantPrompt}\n\n以下是已脱敏资料：\n${result.redactedText}`;
    await sendToAssistant(message);
  }

  async function handleFollowupSend() {
    if (!assistantPrompt.trim()) {
      return;
    }

    await sendToAssistant(assistantPrompt.trim());
  }

  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(13,148,136,0.18),_transparent_26%),linear-gradient(180deg,_#fcfbf5_0%,_#f4efe2_100%)] text-stone-900">
      <section className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-4 py-6 sm:px-6 lg:px-8">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
          className="mb-6 rounded-[28px] border border-white/80 bg-white/80 p-5 shadow-[0_18px_80px_rgba(68,64,60,0.08)] backdrop-blur"
        >
          <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-3xl">
              <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-sm font-medium text-teal-800">
                <Shield className="h-4 w-4" />
                医疗资料脱敏工作台
              </div>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
                先抽文字，再脱敏，再把安全版本交给 AI。
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">
                这一版已经把三条链路串起来了：图片 OCR、PDF 文本提取、手动选中文字打规则，以及把脱敏后的资料直接送进你现有的 AI 对话流。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['图片 OCR', '浏览器端抽字'],
                ['PDF 提取', '优先读文本层'],
                ['手动规则', '选中文字即标注'],
                ['安全问 AI', '沿用现有会话'],
              ].map(([title, sub]) => (
                <div
                  key={title}
                  className="rounded-2xl border border-stone-200/80 bg-stone-50/80 px-4 py-3"
                >
                  <p className="text-sm font-semibold text-stone-900">{title}</p>
                  <p className="mt-1 text-xs text-stone-500">{sub}</p>
                </div>
              ))}
            </div>
          </div>
        </motion.div>

        <div className="grid flex-1 gap-6 xl:grid-cols-[1.04fr_0.96fr]">
          <div className="space-y-6">
            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.05 }}
              className="rounded-[28px] border border-stone-200/80 bg-white/85 p-5 shadow-[0_18px_60px_rgba(68,64,60,0.07)]"
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-lg font-semibold text-stone-900">1. 抽取原文</p>
                  <p className="mt-1 text-sm text-stone-500">
                    支持文本直贴、图片 OCR、PDF 文本层提取和常见文本文件读取。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setText(demoText)}
                  className="rounded-full border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                >
                  填充示例
                </button>
              </div>

              <label className="mt-5 flex cursor-pointer flex-col rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-5 transition hover:border-teal-600 hover:bg-teal-50/60">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-white p-3 text-teal-700 shadow-sm">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-stone-900">上传病历文件</p>
                    <p className="mt-1 text-sm leading-6 text-stone-500">
                      图片会尝试 OCR；PDF 会优先提取文本层；TXT / MD / JSON / CSV 会直接读取。首次图片 OCR 可能需要一点时间下载语言包。
                    </p>
                    <p className="mt-3 text-sm text-stone-700">
                      {selectedFile ? `当前文件：${selectedFile.name}` : '点击选择文件'}
                    </p>
                  </div>
                </div>
                <input
                  type="file"
                  onChange={handleFileChange}
                  className="sr-only"
                  accept=".txt,.md,.json,.csv,.pdf,image/*"
                />
              </label>

              {extractStatus !== 'idle' && (
                <div
                  className={cn(
                    'mt-4 rounded-2xl border px-4 py-3 text-sm',
                    extractStatus === 'done'
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                      : extractStatus === 'error'
                        ? 'border-rose-200 bg-rose-50 text-rose-700'
                        : 'border-teal-200 bg-teal-50 text-teal-800'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {extractStatus === 'extracting' ? (
                      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
                    ) : extractStatus === 'done' ? (
                      <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" />
                    ) : (
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    )}
                    <span>{extractMessage}</span>
                  </div>
                </div>
              )}

              <div className="mt-5">
                <div className="mb-2 flex items-center justify-between">
                  <label htmlFor="medical-text" className="text-sm font-medium text-stone-700">
                    病历文字
                  </label>
                  <span className="text-xs text-stone-400">
                    在这个区域选中文字，就可以手动打规则
                  </span>
                </div>
                <textarea
                  id="medical-text"
                  ref={textareaRef}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onMouseUp={captureSelection}
                  onKeyUp={captureSelection}
                  placeholder="例如：姓名、手机号、身份证号、住址、病案号、主诉、既往史……"
                  className="min-h-[280px] w-full rounded-[24px] border border-stone-200 bg-stone-50/80 px-4 py-4 text-sm leading-7 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-teal-700 focus:bg-white"
                />
              </div>

              <div className="mt-5 rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-stone-800">
                  <WandSparkles className="h-4 w-4 text-teal-700" />
                  2. 手动标注规则
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  先在上面的文本框里选中内容，再点击下面的规则按钮。适合处理昵称、医院内部编号、模糊写法等自动规则抓不到的内容。
                </p>

                <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">
                  当前选中：
                  <span className="ml-2 font-medium text-stone-900">
                    {selection || '还没有选中任何文字'}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap gap-2">
                  {quickRuleTypes.map((rule) => (
                    <button
                      key={rule.type}
                      type="button"
                      disabled={!selection}
                      onClick={() => addManualRule(rule.type)}
                      className="rounded-full border border-stone-300 bg-white px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      {rule.label}
                    </button>
                  ))}
                </div>

                {manualRules.length > 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {manualRules.map((rule) => (
                      <button
                        key={rule.id}
                        type="button"
                        onClick={() => removeManualRule(rule.id)}
                        className="rounded-full border border-teal-200 bg-teal-50 px-3 py-2 text-sm text-teal-800"
                      >
                        {rule.label}：{rule.text} · 删除
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isSubmitting}
                  className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-5 py-3 text-sm font-medium text-white transition hover:bg-stone-700 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      正在脱敏
                    </>
                  ) : (
                    <>
                      <ScanSearch className="h-4 w-4" />
                      开始识别并脱敏
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                >
                  清空重来
                </button>
              </div>

              {error && (
                <div className="mt-5 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                  <div className="flex items-start gap-2">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{error}</span>
                  </div>
                </div>
              )}
            </motion.section>

            <motion.section
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.55, delay: 0.08 }}
              className="rounded-[28px] border border-stone-200/80 bg-white/85 p-5 shadow-[0_18px_60px_rgba(68,64,60,0.07)]"
            >
              <div className="flex items-center gap-2 text-lg font-semibold text-stone-900">
                <Bot className="h-5 w-5 text-teal-700" />
                3. 安全问 AI
              </div>
              <p className="mt-2 text-sm leading-6 text-stone-500">
                这块直接复用了你现有的聊天会话存储和 `/api/chat` 流式接口。你可以把脱敏后的完整文本一次发过去，也可以继续追问。
              </p>

              <textarea
                value={assistantPrompt}
                onChange={(event) => setAssistantPrompt(event.target.value)}
                placeholder="写下你想让 AI 重点回答什么"
                className="mt-4 min-h-[120px] w-full rounded-[24px] border border-stone-200 bg-stone-50/80 px-4 py-4 text-sm leading-7 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-teal-700 focus:bg-white"
              />

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!result?.redactedText || isChatLoading}
                  onClick={() => void handleAskAI()}
                  className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  {isChatLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      AI 正在分析
                    </>
                  ) : (
                    <>
                      <MessageSquareText className="h-4 w-4" />
                      发送脱敏文本给 AI
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!assistantPrompt.trim() || isChatLoading}
                  onClick={() => void handleFollowupSend()}
                  className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  只发送当前问题
                </button>
              </div>

              <div className="mt-5 space-y-3">
                {recentMessages.length === 0 ? (
                  <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 text-sm leading-6 text-stone-500">
                    还没有发送到 AI。先完成脱敏，再点击“发送脱敏文本给 AI”。
                  </div>
                ) : (
                  recentMessages.map((message) => (
                    <div
                      key={message.id}
                      className={cn(
                        'rounded-[24px] p-4 text-sm leading-7',
                        message.role === 'user'
                          ? 'bg-stone-900 text-white'
                          : 'border border-stone-200 bg-stone-50 text-stone-800'
                      )}
                    >
                      <div className="mb-2 text-xs uppercase tracking-[0.18em] opacity-70">
                        {message.role === 'user' ? '用户' : '小馨宝'}
                      </div>
                      <p className="whitespace-pre-wrap break-words">{message.content}</p>
                    </div>
                  ))
                )}
              </div>
            </motion.section>
          </div>

          <motion.section
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.55, delay: 0.1 }}
            className="rounded-[28px] border border-stone-200/80 bg-[#191816] p-5 text-stone-100 shadow-[0_22px_80px_rgba(28,25,23,0.28)]"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-lg font-semibold">脱敏结果</p>
                <p className="mt-1 text-sm text-stone-400">
                  自动规则和手动规则会一起生效，结果可以直接复制或继续送给 AI。
                </p>
              </div>

              {result && (
                <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-sm text-stone-200">
                  <BadgeCheck className="h-4 w-4 text-emerald-400" />
                  已识别 {result.summary.total} 项敏感信息
                </div>
              )}
            </div>

            {!result ? (
              <div className="mt-8 rounded-[24px] border border-white/10 bg-white/5 p-6">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-white/10 p-3 text-teal-300">
                    <FileSearch className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="font-medium text-white">结果会显示在这里</p>
                    <p className="mt-2 text-sm leading-7 text-stone-400">
                      先上传一张病历图、一个 PDF，或者直接粘贴文本。抽字完成后再执行脱敏，就能看到识别项、统计和可直接发给 AI 的安全版本。
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    {
                      label: '敏感项总数',
                      value: String(result.summary.total),
                    },
                    {
                      label: '原文长度',
                      value: `${result.summary.characterCount} 字`,
                    },
                    {
                      label: '来源',
                      value: result.fileName || result.sourceType,
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-2xl border border-white/10 bg-white/5 p-4">
                      <p className="text-xs uppercase tracking-[0.18em] text-stone-400">
                        {item.label}
                      </p>
                      <p className="mt-2 text-2xl font-semibold text-white">{item.value}</p>
                    </div>
                  ))}
                </div>

                {(result.warnings?.length ?? 0) > 0 && (
                  <div className="space-y-3">
                    {result.warnings?.map((warning) => (
                      <div
                        key={warning}
                        className="rounded-2xl border border-amber-200/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100"
                      >
                        <div className="flex items-start gap-2">
                          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>{warning}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2 text-sm text-stone-300">
                    <ClipboardCheck className="h-4 w-4 text-teal-300" />
                    识别类别
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {stats.map((item) => (
                      <span
                        key={item.label}
                        className="rounded-full border border-teal-400/25 bg-teal-400/10 px-3 py-1 text-sm text-teal-100"
                      >
                        {item.label} × {item.count}
                      </span>
                    ))}
                  </div>
                </div>

                <ResultBlock
                  title="原始文本"
                  content={result.originalText}
                  tone="light"
                  copied={copied === 'original'}
                  onCopy={() => void handleCopy(result.originalText, 'original')}
                />

                <div className="flex items-center justify-center text-stone-500">
                  <ArrowRight className="h-5 w-5" />
                </div>

                <ResultBlock
                  title="脱敏后文本"
                  content={result.redactedText}
                  tone="highlight"
                  copied={copied === 'redacted'}
                  onCopy={() => void handleCopy(result.redactedText, 'redacted')}
                />

                <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2 text-sm text-stone-300">
                    <Sparkles className="h-4 w-4 text-teal-300" />
                    识别明细
                  </div>
                  <div className="mt-3 space-y-3">
                    {result.items.map((item, index) => (
                      <div
                        key={`${item.type}-${item.start}-${index}`}
                        className="rounded-2xl border border-white/8 bg-black/10 p-4"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-white/10 px-2.5 py-1 text-xs text-white">
                            {item.label}
                          </span>
                          <span
                            className={cn(
                              'rounded-full px-2.5 py-1 text-xs',
                              item.confidence === 'high'
                                ? 'bg-emerald-400/15 text-emerald-300'
                                : item.confidence === 'manual'
                                  ? 'bg-sky-400/15 text-sky-300'
                                  : 'bg-amber-400/15 text-amber-300'
                            )}
                          >
                            {item.confidence === 'high'
                              ? '高置信度'
                              : item.confidence === 'manual'
                                ? '手动规则'
                                : '中置信度'}
                          </span>
                        </div>
                        <p className="mt-3 break-all font-mono text-sm text-stone-300">
                          {item.original}
                        </p>
                        <p className="mt-2 break-all font-mono text-sm text-teal-200">
                          {item.masked}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </motion.section>
        </div>
      </section>
    </main>
  );
}

function createFormPayload(text: string, file: File | null, manualRules: ManualRule[]) {
  const formData = new FormData();
  if (file) {
    formData.append('file', file);
  }
  if (text.trim()) {
    formData.append('text', text);
  }
  if (manualRules.length > 0) {
    formData.append('manualRules', JSON.stringify(serializeManualRules(manualRules)));
  }
  return formData;
}

function serializeManualRules(manualRules: ManualRule[]) {
  return manualRules.map(({ type, text, label }) => ({ type, text, label }));
}

async function extractTextFromFile(
  file: File,
  onStatus: (message: string) => void
): Promise<string> {
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith('.pdf') || file.type === 'application/pdf') {
    return extractPdfText(file, onStatus);
  }

  if (file.type.startsWith('image/')) {
    return extractImageText(file, onStatus);
  }

  onStatus('正在读取文本文件...');
  return await file.text();
}

async function extractPdfText(file: File, onStatus: (message: string) => void): Promise<string> {
  onStatus('正在读取 PDF 文本层...');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await file.arrayBuffer());
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
  const document = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    onStatus(`正在提取 PDF 第 ${pageNumber} 页文字...`);
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (text) {
      parts.push(`第 ${pageNumber} 页\n${text}`);
    }
  }

  if (parts.length === 0) {
    throw new Error('这个 PDF 更像扫描件，暂时没读到文本层。可以把页面导成图片后再试 OCR。');
  }

  return parts.join('\n\n');
}

async function extractImageText(file: File, onStatus: (message: string) => void): Promise<string> {
  onStatus('正在准备 OCR 模型...');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('chi_sim+eng');

  try {
    onStatus('正在识别图片中的文字...');
    const result = await worker.recognize(file);
    return result.data.text;
  } finally {
    await worker.terminate();
  }
}

function ResultBlock({
  title,
  content,
  tone,
  copied,
  onCopy,
}: {
  title: string;
  content: string;
  tone: 'light' | 'highlight';
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div
      className={cn(
        'rounded-[24px] border p-4',
        tone === 'highlight'
          ? 'border-teal-400/30 bg-teal-400/10'
          : 'border-white/10 bg-white/5'
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-medium text-white">{title}</p>
        <button
          type="button"
          onClick={onCopy}
          className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-stone-300 transition hover:border-white/30 hover:text-white"
        >
          {copied ? (
            <span className="inline-flex items-center gap-1">
              <BadgeCheck className="h-3.5 w-3.5" />
              已复制
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Copy className="h-3.5 w-3.5" />
              复制
            </span>
          )}
        </button>
      </div>
      <pre className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-stone-200">
        {content}
      </pre>
    </div>
  );
}
