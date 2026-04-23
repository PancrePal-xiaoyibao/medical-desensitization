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
import React from 'react';
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
  { type: 'name', label: '这是姓名' },
  { type: 'phone', label: '这是手机号' },
  { type: 'id_card', label: '这是身份证号' },
  { type: 'medical_id', label: '这是病历号' },
  { type: 'address', label: '这是地址' },
];

const nonNameMedicalWords = new Set([
  '医生',
  '主任',
  '护士',
  '预约',
  '门诊',
  '住院',
  '复诊',
  '挂号',
  '病房',
  '床位',
  '加号',
  '检查',
  '报告',
  '取号',
  '药房',
  '缴费',
  '住院部',
  '门诊部',
  '科室',
]);

export default function Home() {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [text, setText] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [result, setResult] = useState<RedactionResponse | null>(null);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [copied, setCopied] = useState<
    'original' | 'redacted' | 'share_ai' | 'share_family' | null
  >(null);
  const [manualRules, setManualRules] = useState<ManualRule[]>([]);
  const [selection, setSelection] = useState('');
  const [extractStatus, setExtractStatus] = useState<'idle' | 'extracting' | 'done' | 'error'>(
    'idle'
  );
  const [extractMessage, setExtractMessage] = useState('');
  const [assistantPrompt, setAssistantPrompt] = useState(
    '请帮我看看这份资料里需要重点注意什么，还需要补充哪些信息。'
  );
  const aiChatEnabled = process.env.NEXT_PUBLIC_AI_CHAT_ENABLED === 'true';

  const initUser = useChatStore((state) => state.initUser);
  const sessions = useChatStore((state) => state.sessions);
  const activeSessionId = useChatStore((state) => state.activeSessionId);
  const addMessage = useChatStore((state) => state.addMessage);
  const appendTokenToLastMessage = useChatStore((state) => state.appendTokenToLastMessage);
  const setLoading = useChatStore((state) => state.setLoading);
  const isChatLoading = useChatStore((state) => state.isLoading);
  const createNewSession = useChatStore((state) => state.createNewSession);
  const switchSession = useChatStore((state) => state.switchSession);
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

  const selectionParts = useMemo(() => splitSelectionIntoParts(selection), [selection]);
  const highlightedTextPreview = useMemo(
    () => buildHighlightedTextPreview(text, manualRules, removeManualRule),
    [text, manualRules]
  );
  const aiSendHint = useMemo(() => {
    if (!aiChatEnabled) {
      return '这台演示环境还没有连上 AI 服务，所以现在还不能发送。';
    }

    if (isChatLoading) {
      return 'AI 正在阅读刚才发过去的内容，请稍等一下。';
    }

    if (!result?.redactedText) {
      return '要先点上面的“开始处理”，等页面出现“处理后的内容”以后，这里才能发送。';
    }

    return '现在可以把处理后的内容发给 AI 了。';
  }, [aiChatEnabled, isChatLoading, result?.redactedText]);

  async function handleSubmit() {
    if (!text.trim()) {
      setError('请先粘贴文字，或者上传一张图片、一个 PDF、一个文本文件。');
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
        throw new Error(payload?.error || '处理没有成功，请稍后再试。');
      }

      setResult(payload as RedactionResponse);
    } catch (submitError) {
      setResult(null);
      setError(
        submitError instanceof Error ? submitError.message : '处理没有成功，请稍后再试。'
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
    setExtractMessage('正在读取内容，请稍等...');
    setError('');

    try {
      const extractedText = await extractTextFromFile(file, (message) => {
        setExtractMessage(message);
      });

      if (!extractedText.trim()) {
        throw new Error('这个文件里暂时没有读出文字。你可以换一张更清楚的图片，或者把文字直接粘贴进来。');
      }

      setText(extractedText.trim());
      setExtractStatus('done');
      setExtractMessage(`已经从 ${file.name} 读出文字，你可以先检查一下，再继续处理。`);
    } catch (extractError) {
      setExtractStatus('error');
      setExtractMessage(
        extractError instanceof Error
          ? extractError.message
          : '文件读取失败，请换一个文件再试。'
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
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
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
    const nextParts = splitSelectionIntoParts(selection).filter((part) => part !== selectedText);
    setSelection(nextParts[0] || '');
  }

  function removeManualRule(ruleId: string) {
    setManualRules((current) => current.filter((rule) => rule.id !== ruleId));
  }

  async function handleCopy(content: string, type: 'original' | 'redacted') {
    await navigator.clipboard.writeText(content);
    setCopied(type);
    window.setTimeout(() => setCopied(null), 1600);
  }

  async function handleShortcutCopy(type: 'share_ai' | 'share_family') {
    if (!result?.redactedText) {
      return;
    }

    const content =
      type === 'share_ai'
        ? `${assistantPrompt.trim() || '请帮我看看这份资料里需要重点注意什么。'}\n\n以下是已经遮掉个人信息的内容：\n${result.redactedText}`
        : `这是已经遮掉个人信息后的内容，你可以直接看：\n\n${result.redactedText}`;

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
      appendTokenToLastMessage('抱歉，小胰宝暂时没能完成这次分析，请稍后再试。');
    } finally {
      setLoading(false);
    }
  }

  async function handleAskAI() {
    if (!result?.redactedText) {
      return;
    }
    if (!aiChatEnabled) {
      return;
    }

    const message = `${assistantPrompt}\n\n以下是已脱敏资料：\n${result.redactedText}`;
    await sendToAssistant(message);
  }

  async function handleFollowupSend() {
    if (!assistantPrompt.trim()) {
      return;
    }
    if (!aiChatEnabled) {
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
                发给 AI 前，先保护隐私
              </div>
              <h1 className="max-w-2xl text-3xl font-semibold tracking-tight text-stone-900 sm:text-5xl">
                把病历里的个人信息遮掉后，再发给 AI。
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">
                你可以上传图片、PDF，或者直接粘贴文字。我们会先帮你找出姓名、手机号、身份证号这些个人信息，再给你一份更安全的内容。
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ['上传图片', '帮你读出文字'],
                ['上传 PDF', '尽量读出内容'],
                ['手动标记', '把漏掉的信息补上'],
                ['再发给 AI', '更安心一些'],
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
                  <p className="text-lg font-semibold text-stone-900">1. 先把内容放进来</p>
                  <p className="mt-1 text-sm text-stone-500">
                    可以直接粘贴文字，也可以上传图片、PDF 或文本文件。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setText(demoText)}
                  className="rounded-full border border-stone-300 px-3 py-2 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                >
                  试试示例
                </button>
              </div>

              <label className="mt-5 flex cursor-pointer flex-col rounded-[24px] border border-dashed border-stone-300 bg-stone-50/80 p-5 transition hover:border-teal-600 hover:bg-teal-50/60">
                <div className="flex items-start gap-4">
                  <div className="rounded-2xl bg-white p-3 text-teal-700 shadow-sm">
                    <Upload className="h-5 w-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-stone-900">上传资料</p>
                    <p className="mt-1 text-sm leading-6 text-stone-500">
                      如果你上传的是图片，我们会尽量把图里的字读出来；如果是 PDF 或文本文件，也会尽量帮你读出内容。
                    </p>
                    <p className="mt-3 text-sm text-stone-700">
                      {selectedFile ? `当前文件：${selectedFile.name}` : '点这里选择文件'}
                    </p>
                  </div>
                </div>
                <input
                  ref={fileInputRef}
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
                    文字内容
                  </label>
                  <span className="text-xs text-stone-400">
                    如果有漏掉的个人信息，可以在这里手动选中处理
                  </span>
                </div>
                <textarea
                  id="medical-text"
                  ref={textareaRef}
                  value={text}
                  onChange={(event) => setText(event.target.value)}
                  onMouseUp={captureSelection}
                  onKeyUp={captureSelection}
                  placeholder="你可以把病历、检查结果、聊天记录里的文字直接粘贴到这里。"
                  className="min-h-[280px] w-full rounded-[24px] border border-stone-200 bg-stone-50/80 px-4 py-4 text-sm leading-7 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-teal-700 focus:bg-white"
                />

                {manualRules.length > 0 && (
                  <div className="mt-4 rounded-[24px] border border-teal-200 bg-teal-50/50 p-4">
                  <div className="mb-2 text-sm font-medium text-teal-900">
                    已经标记过的内容
                  </div>
                  <div className="mb-3 text-xs text-teal-700">
                    如果标错了，点一下高亮的那一段就可以取消。
                  </div>
                  <div className="max-h-[220px] overflow-y-auto whitespace-pre-wrap text-sm leading-7 text-stone-700">
                    {highlightedTextPreview}
                  </div>
                </div>
                )}
              </div>

              <div className="mt-5 rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
                <div className="flex items-center gap-2 text-sm font-medium text-stone-800">
                  <WandSparkles className="h-4 w-4 text-teal-700" />
                  2. 如果有漏掉的，再手动补一下
                </div>
                <p className="mt-2 text-sm leading-6 text-stone-500">
                  先在上面的文字里选中一小段，再点下面的按钮。这样可以把系统没认出来的信息补上。
                </p>

                <div className="mt-3 rounded-2xl border border-dashed border-stone-300 bg-white px-4 py-3 text-sm text-stone-600">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <label className="block text-xs font-medium tracking-[0.12em] text-stone-400">
                        你要处理的这段内容
                      </label>
                      <input
                        type="text"
                        value={selection}
                        onChange={(event) => setSelection(event.target.value)}
                        placeholder="先在上面的文字里选一段，或者直接在这里输入。"
                        className="mt-2 w-full border-0 bg-transparent p-0 text-lg font-medium text-stone-900 outline-none placeholder:text-stone-400"
                      />
                    </div>
                    {selectionParts.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setSelection(selectionParts[0])}
                        className="shrink-0 rounded-full border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                      >
                        先处理第一段
                      </button>
                    )}
                  </div>

                  {selectionParts.length > 1 && (
                    <div className="mt-3">
                      <div className="text-xs text-stone-400">
                        这段里好像有几块内容。你可以点下面任意一块，分开处理。
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectionParts.map((part) => (
                          <button
                            key={part}
                            type="button"
                            onClick={() => setSelection(part)}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-sm transition',
                              part === selection
                                ? 'border-stone-900 bg-stone-900 text-white'
                                : 'border-stone-300 bg-stone-50 text-stone-700 hover:border-stone-900 hover:text-stone-900'
                            )}
                          >
                            {part}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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
                      正在处理
                    </>
                  ) : (
                    <>
                      <ScanSearch className="h-4 w-4" />
                      开始处理
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                >
                  清空
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
                3. 如果你愿意，再发给 AI
              </div>
              <p className="mt-2 text-sm leading-6 text-stone-500">
                处理完以后，你可以把这份更安全的内容发给 AI，请它帮你一起看看。
              </p>

              {!aiChatEnabled && (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  现在这个演示页面还没有连上真实的 AI 回复服务，所以这里先不能直接发送。等接入正式服务后，这个按钮就可以用了。
                </div>
              )}

              <textarea
                value={assistantPrompt}
                onChange={(event) => setAssistantPrompt(event.target.value)}
                placeholder="比如：请帮我看看接下来最该问医生什么问题。"
                className="mt-4 min-h-[120px] w-full rounded-[24px] border border-stone-200 bg-stone-50/80 px-4 py-4 text-sm leading-7 text-stone-900 outline-none transition placeholder:text-stone-400 focus:border-teal-700 focus:bg-white"
              />

              <div className="mt-4 flex flex-wrap gap-3">
                <button
                  type="button"
                  disabled={!result?.redactedText || isChatLoading || !aiChatEnabled}
                  onClick={() => void handleAskAI()}
                  className="inline-flex items-center gap-2 rounded-full bg-teal-700 px-5 py-3 text-sm font-medium text-white transition hover:bg-teal-800 disabled:cursor-not-allowed disabled:bg-stone-400"
                >
                  {isChatLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      AI 正在阅读
                    </>
                  ) : (
                    <>
                      <MessageSquareText className="h-4 w-4" />
                      发给 AI 看看
                    </>
                  )}
                </button>

                <button
                  type="button"
                  disabled={!assistantPrompt.trim() || isChatLoading || !aiChatEnabled}
                  onClick={() => void handleFollowupSend()}
                  className="rounded-full border border-stone-300 px-5 py-3 text-sm font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  只发这句
                </button>
              </div>

              <div
                className={cn(
                  'mt-3 rounded-2xl px-4 py-3 text-sm',
                  result?.redactedText && aiChatEnabled && !isChatLoading
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
                    : 'border border-stone-200 bg-stone-50 text-stone-600'
                )}
              >
                {aiSendHint}
              </div>

                <div className="mt-5 space-y-3">
                {sessions.length === 0 ? (
                  <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4 text-sm leading-6 text-stone-500">
                    你还没有和 AI 聊过。处理好内容后，就可以从这里开始。
                  </div>
                ) : (
                  <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
                    <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-3">
                      <div className="mb-2 text-sm font-medium text-stone-700">历史对话</div>
                      <div className="space-y-2">
                        {sessions.map((session) => (
                          <button
                            key={session.id}
                            type="button"
                            onClick={() => switchSession(session.id)}
                            className={cn(
                              'w-full rounded-2xl px-3 py-3 text-left transition',
                              session.id === activeSessionId
                                ? 'bg-stone-900 text-white'
                                : 'bg-white text-stone-700 hover:bg-stone-100'
                            )}
                          >
                            <div className="line-clamp-2 text-sm font-medium">
                              {session.title || '新对话'}
                            </div>
                            <div
                              className={cn(
                                'mt-1 text-xs',
                                session.id === activeSessionId ? 'text-white/70' : 'text-stone-400'
                              )}
                            >
                              {session.messages.length === 0
                                ? '还没有内容'
                                : `${session.messages.length} 条消息`}
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-[24px] border border-stone-200 bg-stone-50/80 p-4">
                      <div className="mb-3 flex items-center justify-between gap-3">
                        <div>
                          <div className="text-sm font-medium text-stone-800">
                            {currentSession?.title || '当前对话'}
                          </div>
                          <div className="mt-1 text-xs text-stone-400">
                            这里会保留你和 AI 说过的话，方便回头查看。
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => switchSession(createNewSession())}
                          className="rounded-full border border-stone-300 px-3 py-2 text-xs font-medium text-stone-700 transition hover:border-stone-900 hover:text-stone-900"
                        >
                          新建对话
                        </button>
                      </div>

                      <div className="max-h-[360px] space-y-3 overflow-y-auto pr-1">
                        {currentSession?.messages.length ? (
                          currentSession.messages.map((message) => (
                            <div
                              key={message.id}
                              className={cn(
                                'rounded-[24px] p-4 text-sm leading-7',
                                message.role === 'user'
                                  ? 'bg-stone-900 text-white'
                                  : 'border border-stone-200 bg-white text-stone-800'
                              )}
                            >
                              <div className="mb-2 text-xs uppercase tracking-[0.18em] opacity-70">
                                {message.role === 'user' ? '我说的' : 'AI 回复'}
                              </div>
                              <p className="whitespace-pre-wrap break-words">{message.content}</p>
                            </div>
                          ))
                        ) : (
                          <div className="rounded-[24px] border border-dashed border-stone-300 bg-white p-4 text-sm leading-6 text-stone-500">
                            这一组对话里还没有内容。你可以先发一段处理后的资料，再继续问问题。
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
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
                <p className="text-lg font-semibold">处理结果</p>
                <p className="mt-1 text-sm text-stone-400">
                  这里会显示处理前后的内容，方便你自己检查。
                </p>
              </div>

              {result && (
                <div className="flex items-center gap-2 rounded-full bg-white/5 px-3 py-2 text-sm text-stone-200">
                  <BadgeCheck className="h-4 w-4 text-emerald-400" />
                  已经遮掉 {result.summary.total} 处个人信息
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
                      先上传一张病历图片、一个 PDF，或者直接粘贴文字。处理完成后，你会看到处理前和处理后的内容。
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 space-y-5">
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    {
                      label: '遮掉了多少处',
                      value: String(result.summary.total),
                    },
                    {
                      label: '一共有多少字',
                      value: `${result.summary.characterCount} 字`,
                    },
                    {
                      label: '这份内容来自',
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
                    这次处理了什么
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
                  title="原来的内容"
                  content={result.originalText}
                  tone="light"
                  copied={copied === 'original'}
                  onCopy={() => void handleCopy(result.originalText, 'original')}
                />

                <div className="flex items-center justify-center text-stone-500">
                  <ArrowRight className="h-5 w-5" />
                </div>

                <ResultBlock
                  title="处理后的内容"
                  content={result.redactedText}
                  tone="highlight"
                  copied={copied === 'redacted'}
                  onCopy={() => void handleCopy(result.redactedText, 'redacted')}
                />

                <div className="rounded-[24px] border border-teal-400/20 bg-teal-400/10 p-4">
                  <div className="flex items-center gap-2 text-sm text-teal-100">
                    <Sparkles className="h-4 w-4 text-teal-300" />
                    你可以直接复制出去
                  </div>
                  <p className="mt-2 text-sm leading-6 text-stone-300">
                    如果你准备把这份内容发给 AI、家人或医生，可以直接点下面的按钮，不用自己重新整理。
                  </p>
                  <div className="mt-4 flex flex-wrap gap-3">
                    <button
                      type="button"
                      onClick={() => void handleShortcutCopy('share_ai')}
                      className="inline-flex items-center gap-2 rounded-full bg-white px-4 py-2.5 text-sm font-medium text-stone-900 transition hover:bg-teal-50"
                    >
                      {copied === 'share_ai' ? (
                        <>
                          <BadgeCheck className="h-4 w-4" />
                          已复制给 AI 用的内容
                        </>
                      ) : (
                        <>
                          <MessageSquareText className="h-4 w-4" />
                          复制给 AI
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleShortcutCopy('share_family')}
                      className="inline-flex items-center gap-2 rounded-full border border-white/15 px-4 py-2.5 text-sm font-medium text-stone-100 transition hover:border-white/30 hover:bg-white/5"
                    >
                      {copied === 'share_family' ? (
                        <>
                          <BadgeCheck className="h-4 w-4" />
                          已复制给家人或医生
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          复制给家人或医生
                        </>
                      )}
                    </button>
                  </div>
                </div>

                <div className="rounded-[24px] border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center gap-2 text-sm text-stone-300">
                    <Sparkles className="h-4 w-4 text-teal-300" />
                    每一处是怎么处理的
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
                              ? '系统比较确定'
                              : item.confidence === 'manual'
                                ? '你手动标记'
                                : '系统猜测到'}
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

function buildHighlightedTextPreview(
  text: string,
  manualRules: ManualRule[],
  onRemoveRule: (ruleId: string) => void
) {
  if (!text.trim() || manualRules.length === 0) {
    return text;
  }

  const sortedRules = [...manualRules]
    .map((rule) => ({ ...rule, text: rule.text.trim() }))
    .filter((rule) => rule.text)
    .sort((a, b) => b.text.length - a.text.length);

  if (sortedRules.length === 0) {
    return text;
  }

  const pattern = new RegExp(
    sortedRules.map((rule) => escapeRegExp(rule.text)).join('|'),
    'g'
  );

  const chunks: React.ReactNode[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const matchedText = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      chunks.push(text.slice(lastIndex, index));
    }

    const matchedRule = sortedRules.find((rule) => rule.text === matchedText);
    chunks.push(
      <button
        key={`${matchedText}-${index}`}
        type="button"
        onClick={() => {
          if (matchedRule) {
            onRemoveRule(matchedRule.id);
          }
        }}
        className="rounded bg-teal-200/80 px-1 py-0.5 text-left text-stone-900 transition hover:bg-rose-200/80"
      >
        {matchedText}
        {matchedRule ? `（${matchedRule.label}）` : ''}
      </button>
    );
    lastIndex = index + matchedText.length;
  }

  if (lastIndex < text.length) {
    chunks.push(text.slice(lastIndex));
  }

  return chunks;
}

function splitSelectionIntoParts(selection: string) {
  const text = selection.trim();
  if (!text) {
    return [];
  }

  const groups = text
    .split(/[\s,，、；;|/]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const groupedMatches = groups.flatMap((group) => {
    const mergedName = normalizePossibleChineseName(group);
    if (mergedName && mergedName !== text) {
      return [mergedName];
    }

    const tokens = group.match(/[\p{Script=Han}]{2,6}|\d+|[A-Za-z]+/gu) ?? [];
    if (tokens.length > 0) {
      return tokens;
    }

    return [group];
  });

  const unique = Array.from(
    new Set(
      groupedMatches
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
        .filter((item) => item !== text)
        .filter((item) => !isNoiseFragment(item))
    )
  );

  return unique.length > 1 ? unique : [];
}

function normalizePossibleChineseName(value: string) {
  const compact = value.replace(/[\s·•・]+/g, '').trim();
  if (/^[\p{Script=Han}]{2,4}$/u.test(compact) && !nonNameMedicalWords.has(compact)) {
    return compact;
  }

  return '';
}

function isNoiseFragment(value: string) {
  if (value.length <= 1) {
    return true;
  }

  if (nonNameMedicalWords.has(value)) {
    return false;
  }

  if (/^[\p{Script=Han}]{2,4}$/u.test(value)) {
    return false;
  }

  if (/^\d+$/.test(value)) {
    return false;
  }

  if (/^[A-Za-z]+$/.test(value)) {
    return false;
  }

  return true;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

  onStatus('正在读取文件...');
  return await file.text();
}

async function extractPdfText(file: File, onStatus: (message: string) => void): Promise<string> {
  onStatus('正在读取 PDF 内容...');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await file.arrayBuffer());
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/legacy/build/pdf.worker.mjs',
    import.meta.url
  ).toString();
  const document = await pdfjs.getDocument({ data }).promise;
  const parts: string[] = [];

  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
    onStatus(`正在读取 PDF 第 ${pageNumber} 页...`);
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
    throw new Error('这个 PDF 暂时没有读出文字。你可以把它截图后当图片上传，或者把文字直接粘贴进来。');
  }

  return parts.join('\n\n');
}

async function extractImageText(file: File, onStatus: (message: string) => void): Promise<string> {
  onStatus('正在准备识别图片里的文字...');
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('chi_sim+eng');

  try {
    onStatus('正在识别图片里的文字...');
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
