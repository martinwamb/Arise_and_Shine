import React, { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useAuth } from '../contexts/AuthContext';
import type { Article } from '../types';

export default function ArticlesScreen() {
  const {
    apiClient: { api },
  } = useAuth();
  const [articles, setArticles] = useState<Article[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const loadArticles = useCallback(async () => {
    try {
      setStatus('loading');
      setError(null);
      const res = await api.get('/api/articles', { params: { limit: 24 } });
      setArticles(Array.isArray(res.data) ? res.data : []);
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setError(err?.response?.data?.error || 'Unable to load the latest briefings.');
    }
  }, [api]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadArticles();
    setRefreshing(false);
  }, [loadArticles]);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={handleRefresh} />}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Daily logistics briefings</Text>
        <Text style={styles.subtitle}>
          AI-generated highlights covering supply trends, site readiness tips, and fleet insights.
        </Text>
        <TouchableOpacity style={styles.button} onPress={loadArticles}>
          <Text style={styles.buttonText}>Reload</Text>
        </TouchableOpacity>
      </View>
      {status === 'loading' && <Text style={styles.meta}>Serving today&apos;s articles...</Text>}
      {status === 'error' && error && <Text style={[styles.meta, styles.error]}>{error}</Text>}
      {articles.map((article) => (
        <View key={article.id} style={styles.card}>
          <Text style={styles.cardTitle}>{article.title}</Text>
          <Text style={styles.cardBody}>{article.summary || 'Fresh perspective for your crews today.'}</Text>
          <Text style={styles.cardMeta}>
            {article.topic ? `${article.topic.toUpperCase()} · ` : ''}
            {article.createdAt ? new Date(article.createdAt).toLocaleString() : 'Draft'}
          </Text>
        </View>
      ))}
      {!articles.length && status === 'idle' && (
        <Text style={styles.meta}>No updates yet. Pull to refresh after the next AI run.</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fef9f2',
  },
  content: {
    padding: 20,
    gap: 16,
  },
  header: {
    gap: 8,
  },
  title: {
    fontSize: 24,
    fontWeight: '800',
    color: '#0f172a',
  },
  subtitle: {
    fontSize: 14,
    color: '#475569',
  },
  button: {
    alignSelf: 'flex-start',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#0f172a',
  },
  buttonText: {
    color: '#fff',
    fontWeight: '600',
  },
  meta: {
    fontSize: 12,
    color: '#475569',
  },
  error: {
    color: '#b91c1c',
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: '#fde68a',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0f172a',
  },
  cardBody: {
    fontSize: 14,
    color: '#475569',
  },
  cardMeta: {
    fontSize: 12,
    color: '#94a3b8',
  },
});
