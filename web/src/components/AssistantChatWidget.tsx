import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { api } from '../api';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
  followUp?: string;
  suggestions?: string[];
};

const DEFAULT_PROMPTS = ['Which trucks exceeded 65 kph today?'];

export default function AssistantChatWidget() {
  const [open, setOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([
    {
      role: 'assistant',
      content: "Hi! Ask me about order volumes, truck usage, driver performance, or customers and I'll analyse the latest data for you.",
      followUp: "Would you also like to see today's delivery performance?",
    },
  ]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [starterPrompts, setStarterPrompts] = useState<string[]>(DEFAULT_PROMPTS);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const promptPills = useMemo(() => starterPrompts.slice(0, 1), [starterPrompts]);

  const sendPrompt = useCallback(async (promptText: string) => {
    const trimmed = promptText.trim();
    if (!trimmed || chatLoading) return;
    setChatError(null);
    setChatMessages((prev) => [...prev, { role: 'user', content: trimmed }]);
    setChatInput('');
    setChatLoading(true);
    try {
      const historyBase = chatMessages.concat({ role: 'user', content: trimmed });
      const history = historyBase.slice(-6).map((msg) => ({ role: msg.role, content: msg.content }));
      const response = await api.post('/api/admin/ai/chat', { prompt: trimmed, history });
      const answer =
        typeof response.data?.answer === 'string' && response.data.answer.trim()
          ? response.data.answer.trim()
          : 'I could not find an answer right now.';
      const followUp =
        typeof response.data?.followUp === 'string' && response.data.followUp.trim()
          ? response.data.followUp.trim()
          : undefined;
      const suggestions: string[] = Array.isArray(response.data?.suggestions)
        ? response.data.suggestions.filter(Boolean)
        : [];
      setStarterPrompts([]);
      setChatMessages((prev) => [...prev, { role: 'assistant', content: answer, followUp, suggestions }]);
    } catch (err: any) {
      const status = err?.response?.status;
      const message = err?.response?.data?.error || err?.message || 'Failed to ask the assistant.';
      const friendly =
        status === 504 ? 'The AI service timed out. Please retry in a moment.' : message;
      setChatError(friendly);
      setChatMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Sorry, I ran into an error: ${friendly}` },
      ]);
    } finally {
      setChatLoading(false);
    }
  }, [chatMessages, chatLoading]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        if (chatInput.trim()) sendPrompt(chatInput);
      }
    },
    [chatInput, sendPrompt],
  );

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatLoading]);

  return (
    <>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(true)}
        className='fixed bottom-6 right-6 z-30 inline-flex h-12 w-12 items-center justify-center rounded-full bg-slate-900 text-white shadow-lg transition hover:bg-slate-800'
        aria-label='Open AI assistant'
      >
        <MessageCircle className='h-5 w-5' />
      </button>

      {/* Chat panel */}
      {open && (
        <div
          className='fixed inset-0 z-40 flex items-end justify-end p-4 sm:items-end sm:justify-end'
          onClick={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className='w-full max-w-md flex flex-col rounded-2xl bg-white border border-slate-200 shadow-2xl overflow-hidden'
            style={{ maxHeight: 'min(600px, calc(100vh - 5rem))' }}>

            {/* Header */}
            <div className='flex items-center justify-between border-b border-slate-100 px-4 py-3 shrink-0'>
              <div>
                <p className='flex items-center gap-1.5 text-sm font-semibold text-slate-900'>
                  <Sparkles className='h-4 w-4 text-amber-500' />
                  Ops Copilot
                </p>
                <p className='text-xs text-slate-400 mt-0.5'>Powered by latest operational data</p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className='rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors'
                aria-label='Close'
              >
                <X className='h-4 w-4' />
              </button>
            </div>

            {/* Messages */}
            <div className='flex-1 overflow-y-auto px-4 py-4 space-y-3'>
              {chatMessages.map((msg, idx) => {
                const isAssistant = msg.role === 'assistant';
                return (
                  <div key={idx} className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
                    <div
                      className={[
                        'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
                        isAssistant
                          ? 'bg-slate-100 text-slate-800'
                          : 'bg-slate-900 text-white',
                      ].join(' ')}
                    >
                      {msg.content}

                      {isAssistant && msg.followUp && (
                        <button
                          onClick={() => sendPrompt(msg.followUp!)}
                          className='mt-2 block text-[11px] font-semibold text-slate-500 underline underline-offset-2 hover:text-slate-700'
                        >
                          {msg.followUp}
                        </button>
                      )}

                      {isAssistant && Array.isArray(msg.suggestions) && msg.suggestions.length > 0 && (
                        <div className='mt-2 flex flex-wrap gap-1.5'>
                          {msg.suggestions.slice(0, 3).map((s) => (
                            <button
                              key={s}
                              type='button'
                              onClick={() => sendPrompt(s)}
                              className='rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-300 transition-colors'
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {chatLoading && (
                <div className='flex justify-start'>
                  <div className='bg-slate-100 rounded-2xl px-4 py-3 flex items-center gap-2 text-xs text-slate-500'>
                    <Loader2 className='h-3.5 w-3.5 animate-spin' />
                    Thinking…
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Error banner */}
            {chatError && (
              <div className='mx-4 mb-2 shrink-0 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600'>
                {chatError}
              </div>
            )}

            {/* Input area */}
            <div className='border-t border-slate-100 px-4 py-3 shrink-0 space-y-2'>
              {promptPills.length > 0 && (
                <div className='flex flex-wrap gap-1.5'>
                  {promptPills.map((pill) => (
                    <button
                      key={pill}
                      type='button'
                      onClick={() => sendPrompt(pill)}
                      className='rounded-full border border-slate-200 px-3 py-1 text-[11px] font-medium text-slate-600 hover:border-slate-300 transition-colors'
                    >
                      {pill}
                    </button>
                  ))}
                </div>
              )}
              <div className='flex gap-2'>
                <input
                  ref={inputRef}
                  type='text'
                  className='flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm placeholder:text-slate-400 focus:border-slate-400 focus:outline-none'
                  placeholder='Ask about trucks, orders, finance…'
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  type='button'
                  disabled={chatLoading || !chatInput.trim()}
                  onClick={() => sendPrompt(chatInput)}
                  className='inline-flex h-10 w-10 items-center justify-center rounded-xl bg-slate-900 text-white disabled:opacity-50 hover:bg-slate-800 transition-colors shrink-0'
                >
                  {chatLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : <Send className='h-4 w-4' />}
                </button>
              </div>
              <p className='text-[10px] text-slate-400'>Enter to send · answers use live data</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
