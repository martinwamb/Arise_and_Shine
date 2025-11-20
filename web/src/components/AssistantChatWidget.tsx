import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import { api } from '../api';

type ChatMessage = { role:'user'|'assistant'; content:string; followUp?:string; suggestions?:string[] };

const DEFAULT_PROMPTS = ['Which trucks exceeded 65 kph today?'];

export default function AssistantChatWidget(){
  const [open,setOpen]=useState(false);
  const [chatMessages,setChatMessages]=useState<ChatMessage[]>([
    {
      role:'assistant',
      content:'Hi! Ask me about order volumes, truck usage, driver performance, or customers and I\'ll analyse the latest data for you.',
      followUp:"Would you also like to see today's delivery performance?",
    },
  ]);
  const [chatInput,setChatInput]=useState('');
  const [chatLoading,setChatLoading]=useState(false);
  const [chatError,setChatError]=useState<string|null>(null);
  const [starterPrompts,setStarterPrompts]=useState<string[]>(DEFAULT_PROMPTS);
  const inputRef = useRef<HTMLInputElement|null>(null);

  const promptPills = useMemo(()=> starterPrompts.slice(0,1),[starterPrompts]);
  const suggestionList = useMemo(()=>{
    if(!chatInput){
      return starterPrompts.slice(0,1);
    }
    const query = chatInput.toLowerCase();
    const matches = starterPrompts.filter(prompt=> prompt.toLowerCase().includes(query));
    return (matches.length ? matches : starterPrompts).slice(0,1);
  },[chatInput, starterPrompts]);

  const sendPrompt = useCallback(async(promptText:string)=>{
    const trimmed = promptText.trim();
    if(!trimmed || chatLoading) return;
    setChatError(null);
    setChatMessages(prev=>[...prev, { role:'user', content:trimmed }]);
    setChatInput('');
    setChatLoading(true);
    try{
      const historyBase = chatMessages.concat({ role:'user', content: trimmed });
      const history = historyBase.slice(-6).map(msg=>({ role: msg.role, content: msg.content }));
      const response = await api.post('/api/admin/ai/chat',{ prompt: trimmed, history });
      const answer = typeof response.data?.answer === 'string' && response.data.answer.trim()
        ? response.data.answer.trim()
        : 'I could not find an answer right now.';
      const followUp = typeof response.data?.followUp === 'string' && response.data.followUp.trim()
        ? response.data.followUp.trim()
        : undefined;
      const suggestions: string[] = Array.isArray(response.data?.suggestions) ? response.data.suggestions.filter(Boolean) : [];
      setStarterPrompts([]); // hide starter suggestions after first interaction
      setChatMessages(prev=>[...prev, { role:'assistant', content: answer, followUp, suggestions }]);
    }catch(err:any){
      const status = err?.response?.status;
      const message = err?.response?.data?.error || err?.message || 'Failed to ask the assistant.';
      const friendly = status === 504
        ? 'The AI service timed out. Please retry in a few seconds.'
        : message;
      setChatError(friendly);
      setChatMessages(prev=>[...prev, { role:'assistant', content:`Sorry, I ran into an error: ${friendly}` }]);
    }finally{
      setChatLoading(false);
    }
  },[chatMessages, chatLoading]);

  const handleKeyDown = useCallback((event:React.KeyboardEvent<HTMLInputElement>)=>{
    if(event.key==='Enter'){
      event.preventDefault();
      if(chatInput.trim()){
        sendPrompt(chatInput);
      }
    }else if(event.key==='Tab' && suggestionList[0]){
      event.preventDefault();
      setChatInput(suggestionList[0]);
    }
  },[chatInput, sendPrompt, suggestionList]);

  useEffect(()=>{
    if(open){
      setTimeout(()=> inputRef.current?.focus(), 150);
    }
  },[open]);

  return (
    <>
      <button
        onClick={()=>setOpen(true)}
        className='fixed bottom-6 right-6 z-30 inline-flex h-14 w-14 items-center justify-center rounded-full bg-slate-900 text-white shadow-xl transition hover:bg-slate-800'
        aria-label='Open AI assistant'
      >
        <MessageCircle className='h-6 w-6' />
      </button>
      {open && (
        <div className='fixed inset-0 z-40 flex items-end justify-end bg-black/10 p-4 sm:items-center sm:justify-center'>
          <div className='w-full max-w-lg rounded-3xl bg-white shadow-2xl ring-1 ring-slate-200'>
            <div className='flex items-center justify-between border-b border-slate-100 px-4 py-3'>
              <div className='space-y-1'>
                <p className='flex items-center gap-1 text-sm font-semibold text-slate-900'>
                  <Sparkles className='h-4 w-4 text-amber-500' /> Ops Copilot
                </p>
                <p className='text-xs text-slate-500'>Ask about trucks, customers, finances, or telemetry. Answers use the latest data and audit flags.</p>
              </div>
              <button onClick={()=>setOpen(false)} className='rounded-full p-1 text-slate-500 hover:bg-slate-100' aria-label='Close chat'>
                <X className='h-4 w-4' />
              </button>
            </div>
            <div className='max-h-[420px] space-y-3 overflow-y-auto px-4 py-3 text-sm'>
              {chatMessages.map((msg,idx)=>{
                const isAssistant = msg.role==='assistant';
                return (
                  <div key={idx} className={`flex ${isAssistant ? 'justify-start' : 'justify-end'}`}>
                    <div className={`max-w-full whitespace-pre-wrap rounded-2xl px-4 py-3 shadow-sm sm:max-w-[80%] ${isAssistant ? 'bg-slate-50 text-slate-800 ring-1 ring-slate-100' : 'bg-slate-900 text-white'}`}>
                      {msg.content}
                      {isAssistant && msg.followUp && (
                        <button
                          onClick={()=>sendPrompt(msg.followUp!)}
                          className='mt-3 inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-600 hover:border-slate-300'
                        >
                          {msg.followUp}
                        </button>
                      )}
                      {isAssistant && Array.isArray(msg.suggestions) && msg.suggestions.length > 0 && (
                        <div className='mt-2 flex flex-wrap gap-2 text-[11px]'>
                          {msg.suggestions.slice(0,3).map((s)=>(
                            <button
                              key={s}
                              type='button'
                              onClick={()=>sendPrompt(s)}
                              className='rounded-full border border-slate-200 px-3 py-1 text-slate-600 hover:border-slate-300'
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
                <div className='flex items-center gap-2 text-xs text-slate-500'>
                  <Loader2 className='h-4 w-4 animate-spin' />
                  <span>Working on it...</span>
                </div>
              )}
            </div>
            {chatError && <div className='mx-4 mb-2 rounded border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-600'>{chatError}</div>}
            <div className='border-t border-slate-100 px-4 py-3 space-y-2'>
              <div className='flex flex-wrap gap-2'>
                {promptPills.map((pill)=>(
                  <button
                    key={pill}
                    type='button'
                    onClick={()=>sendPrompt(pill)}
                    className='rounded-full border border-slate-200 px-3 py-1 text-[11px] text-slate-600 transition hover:border-slate-300 hover:text-slate-800'
                  >
                    {pill}
                  </button>
                ))}
              </div>
              <div className='relative'>
                <input
                  ref={inputRef}
                  type='text'
                  className='w-full rounded-2xl border border-slate-200 px-4 py-2 pr-11 text-sm shadow-inner focus:border-slate-400 focus:outline-none'
                  placeholder='Ask me anything...'
                  value={chatInput}
                  onChange={(e)=>setChatInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                />
                <button
                  type='button'
                  disabled={chatLoading || !chatInput.trim()}
                  onClick={()=>sendPrompt(chatInput)}
                  className='absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-2xl bg-slate-900 text-white disabled:opacity-50'
                >
                  {chatLoading ? <Loader2 className='h-4 w-4 animate-spin' /> : <Send className='h-4 w-4' />}
                </button>
                {suggestionList.length > 0 && (
                  <div className='absolute left-0 top-full z-10 mt-2 w-full rounded-2xl border border-slate-100 bg-white shadow-lg'>
                    {suggestionList.map((suggestion)=>(
                      <button
                        key={suggestion}
                        type='button'
                        onClick={()=>{
                          setChatInput(suggestion);
                          setTimeout(()=> inputRef.current?.focus(), 0);
                        }}
                        className='block w-full px-4 py-2 text-left text-xs text-slate-600 hover:bg-slate-50'
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className='mt-1 text-[11px] text-slate-400'>Press Enter to send - Tab to autocomplete</p>
            </div>
          </div>
        </div>
      )}
    </>
  );
}





