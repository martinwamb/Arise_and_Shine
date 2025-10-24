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

  return (
    <main className='mx-auto max-w-6xl px-4 py-16'>
      <header className='mb-8 space-y-2 text-center'>
        <h1 className='text-3xl font-bold text-slate-900'>Daily logistics briefings</h1>
        <p className='text-sm text-slate-600'>
          AI-generated highlights covering supply trends, site readiness tips, and fleet insights. Updated once every
          morning.
        </p>
      </header>

      {loading && (
        <section className='rounded-3xl border border-amber-100 bg-white p-6 text-center text-sm text-slate-600'>
          Serving today&apos;s articles…
        </section>
      )}

      {!loading && error && (
        <section className='rounded-3xl border border-rose-200 bg-rose-50 p-6 text-center text-sm text-rose-600'>
          {error}
        </section>
      )}

      {!loading && !error && (
        <section className='grid gap-6 md:grid-cols-2'>
          {articles.map((article) => {
            const isExpanded = !!expanded[article.id];
            const bodyWords = article.body ? article.body.trim().split(/\s+/) : [];
            const previewFromBody = bodyWords.slice(0, 40).join(' ');
            const hasMoreBody = bodyWords.length > 40;
            const previewText =
              article.summary ||
              (previewFromBody ? `${previewFromBody}${hasMoreBody ? '…' : ''}` : 'Fresh perspective for your crews today.');
            const fullText =
              article.body?.trim() || 'Full article will be available after the next generation run.';
            return (
              <article
                key={article.id}
                className='flex flex-col overflow-hidden rounded-3xl border border-amber-100 bg-white shadow-sm'
              >
                {article.imageUrl && (
                  <img src={article.imageUrl} alt={article.title} className='h-48 w-full object-cover' loading='lazy' />
                )}
                <div className='flex flex-1 flex-col gap-3 p-6 text-sm text-slate-700'>
                  <div className='space-y-1'>
                  <h2 className='text-lg font-semibold text-slate-900'>{article.title}</h2>
                  <p className='text-xs uppercase tracking-wide text-amber-600'>
                    {article.topic || 'Operations insight'}
                  </p>
                  <p className='text-xs text-slate-500'>
                    Published {new Date(article.createdAt).toLocaleString()}
                  </p>
                </div>
                <p>{previewText}</p>
                <div className='relative rounded-2xl border border-slate-200 bg-slate-50/70 p-4 text-xs leading-relaxed text-slate-700'>
                  <div
                    className={`${isExpanded ? 'max-h-none' : 'max-h-40 overflow-hidden'} space-y-2 whitespace-pre-line`}
                  >
                    {fullText}
                  </div>
                  {!isExpanded && (
                    <div className='pointer-events-none absolute inset-x-0 bottom-0 h-16 rounded-b-2xl bg-gradient-to-t from-slate-50 via-slate-50/95 to-transparent' />
                  )}
                </div>
                <button
                  type='button'
                  onClick={() =>
                    setExpanded((prev) => ({
                      ...prev,
                      [article.id]: !isExpanded,
                    }))
                  }
                  className='inline-flex items-center gap-2 self-start rounded-full border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-amber-400 hover:text-amber-600'
                >
                  {isExpanded ? 'Hide article' : 'Continue reading'}
                </button>
              </div>
            </article>
            );
          })}
          {articles.length === 0 && (
            <div className='rounded-3xl border border-dashed border-amber-200 p-8 text-center text-sm text-slate-500'>
              No articles generated yet. Trigger a manual run from the admin dashboard to populate this feed.
            </div>
          )}
        </section>
      )}
    </main>
  );
}
