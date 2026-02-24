import React, { useEffect, useState } from 'react';
import { api } from '../api';

type Article = {
  id: string;
  title: string;
  summary?: string;
  body?: string;
  imageUrl?: string;
  topic?: string;
  createdAt: string;
};

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Articles() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);
        const res = await api.get('/api/articles', { params: { limit: 24 } });
        setArticles(Array.isArray(res.data) ? res.data : []);
        setError(null);
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Unable to load the latest briefings.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const featured = articles[0] ?? null;
  const rest = articles.slice(1);

  return (
    <main className='mx-auto max-w-5xl px-4 py-10'>
      {/* Header */}
      <div className='mb-8'>
        <h1 className='text-2xl font-bold text-slate-900'>Daily Briefings</h1>
        <p className='mt-1 text-sm text-slate-500'>
          AI-generated logistics and construction insights. Updated every morning.
        </p>
      </div>

      {/* Loading */}
      {loading && (
        <div className='rounded-xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400'>
          Loading briefings…
        </div>
      )}

      {/* Error */}
      {!loading && error && (
        <div className='rounded-xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600'>
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && articles.length === 0 && (
        <div className='rounded-xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-400'>
          No briefings yet. An admin can trigger article generation from the admin workspace.
        </div>
      )}

      {/* Featured article */}
      {!loading && !error && featured && (
        <article className='mb-8 overflow-hidden rounded-xl border border-slate-200 bg-white'>
          {featured.imageUrl && (
            <img
              src={featured.imageUrl}
              alt={featured.title}
              className='h-64 w-full object-cover sm:h-80'
              loading='lazy'
            />
          )}
          <div className='p-6'>
            <div className='mb-3 flex items-center gap-3'>
              <span className='rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-700'>
                {featured.topic || 'Insight'}
              </span>
              <span className='text-xs text-slate-400'>{formatDate(featured.createdAt)}</span>
            </div>
            <h2 className='text-xl font-bold text-slate-900'>{featured.title}</h2>
            {featured.summary && (
              <p className='mt-2 text-sm leading-relaxed text-slate-600'>{featured.summary}</p>
            )}
            {featured.body && (
              <div className='mt-4'>
                <div
                  className={[
                    'text-sm leading-relaxed text-slate-700 whitespace-pre-line overflow-hidden transition-all',
                    expanded[featured.id] ? 'max-h-[9999px]' : 'max-h-28',
                  ].join(' ')}
                >
                  {featured.body.trim()}
                </div>
                <button
                  type='button'
                  onClick={() => setExpanded((p) => ({ ...p, [featured.id]: !p[featured.id] }))}
                  className='mt-3 text-xs font-semibold text-slate-900 underline underline-offset-2'
                >
                  {expanded[featured.id] ? 'Show less' : 'Read more'}
                </button>
              </div>
            )}
          </div>
        </article>
      )}

      {/* Article grid */}
      {!loading && !error && rest.length > 0 && (
        <div className='grid gap-5 sm:grid-cols-2 lg:grid-cols-3'>
          {rest.map((article) => {
            const isExpanded = !!expanded[article.id];
            const preview = article.summary || article.body?.trim().split(/\s+/).slice(0, 30).join(' ') + '…' || '';
            return (
              <article
                key={article.id}
                className='flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white'
              >
                {article.imageUrl && (
                  <img
                    src={article.imageUrl}
                    alt={article.title}
                    className='h-40 w-full object-cover'
                    loading='lazy'
                  />
                )}
                <div className='flex flex-1 flex-col p-4'>
                  <div className='mb-2 flex items-center gap-2'>
                    <span className='rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-500'>
                      {article.topic || 'Insight'}
                    </span>
                    <span className='text-[10px] text-slate-400'>{formatDate(article.createdAt)}</span>
                  </div>
                  <h2 className='text-sm font-bold text-slate-900 leading-snug'>{article.title}</h2>
                  {preview && (
                    <p className='mt-1.5 text-xs leading-relaxed text-slate-500 line-clamp-3'>{preview}</p>
                  )}
                  {article.body && (
                    <div className='mt-3 flex-1'>
                      <div
                        className={[
                          'text-xs leading-relaxed text-slate-600 whitespace-pre-line overflow-hidden transition-all',
                          isExpanded ? 'max-h-[9999px]' : 'max-h-0',
                        ].join(' ')}
                      >
                        {article.body.trim()}
                      </div>
                      <button
                        type='button'
                        onClick={() => setExpanded((p) => ({ ...p, [article.id]: !p[article.id] }))}
                        className='mt-2 text-[11px] font-semibold text-slate-900 underline underline-offset-2'
                      >
                        {isExpanded ? 'Show less' : 'Read more'}
                      </button>
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
