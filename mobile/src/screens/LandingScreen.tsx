import React, { useEffect, useState } from 'react';
import {
  Image,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { HERO_FACTS } from '../constants';

export default function LandingScreen() {
  const navigation = useNavigation<any>();
  const { apiClient: { api } } = useAuth();
  const [baseRate, setBaseRate] = useState<string>('Live quote');

  useEffect(() => {
    api.get('/api/pricing').then((r: any) => {
      const p = r.data;
      if (p?.basePrice) setBaseRate(`KES ${p.basePrice.toLocaleString()} / ${p.baseDistanceKm} km`);
    }).catch(() => {});
  }, []);

  const facts = [{ label: 'Base Rate', value: baseRate }, ...HERO_FACTS];

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={s.header}>
          <Image source={require('../../assets/logo.jpeg')} style={s.logo} />
          <Text style={s.tagline}>Premium river sand deliveries across Kenya</Text>
        </View>

        {/* Stats */}
        <View style={s.statsGrid}>
          {facts.map(f => (
            <View key={f.label} style={s.statCard}>
              <Text style={s.statLabel}>{f.label.toUpperCase()}</Text>
              <Text style={s.statValue}>{f.value}</Text>
            </View>
          ))}
        </View>

        {/* Workspace cards */}
        <View style={s.section}>
          <Text style={s.sectionTitle}>Workspaces</Text>
          <Text style={s.sectionSub}>Sign in to access your workspace.</Text>
          {[
            { role: 'Customer', desc: 'Request quotes, confirm payment and track deliveries.' },
            { role: 'Driver', desc: 'View assigned loads, earnings and onboarding documents.' },
            { role: 'Ops', desc: 'Manage orders, stock, dispatch and live fleet tracking.' },
            { role: 'Fuel', desc: 'Capture pump receipts and mileage logs.' },
            { role: 'Admin', desc: 'Full access — reports, AI copilot, finance and audit.' },
          ].map(w => (
            <View key={w.role} style={s.workspaceCard}>
              <Text style={s.workspaceRole}>{w.role}</Text>
              <Text style={s.workspaceDesc}>{w.desc}</Text>
              <Text style={s.workspaceMeta}>Requires login</Text>
            </View>
          ))}
        </View>

        {/* Actions */}
        <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.navigate('Login')}>
          <Text style={s.primaryBtnText}>Sign in</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.secondaryBtn} onPress={() => navigation.navigate('Order')}>
          <Text style={s.secondaryBtnText}>Place an order as guest</Text>
        </TouchableOpacity>

      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#f8fafc' },
  content: { padding: 20, paddingBottom: 40, gap: 16 },

  header: {
    paddingVertical: 16,
    gap: 8,
  },
  logo: {
    width: 160,
    height: 56,
    resizeMode: 'contain',
  },
  tagline: {
    fontSize: 15,
    color: '#64748b',
  },

  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  statCard: {
    flexGrow: 1,
    minWidth: '45%',
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 14,
    gap: 4,
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '600',
    color: '#94a3b8',
    letterSpacing: 0.8,
  },
  statValue: {
    fontSize: 15,
    fontWeight: '700',
    color: '#0f172a',
  },

  section: { gap: 10 },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#0f172a',
  },
  sectionSub: {
    fontSize: 13,
    color: '#64748b',
    marginBottom: 2,
  },
  workspaceCard: {
    backgroundColor: '#ffffff',
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 12,
    padding: 16,
    gap: 4,
  },
  workspaceRole: {
    fontSize: 15,
    fontWeight: '600',
    color: '#0f172a',
  },
  workspaceDesc: {
    fontSize: 13,
    color: '#64748b',
    lineHeight: 18,
  },
  workspaceMeta: {
    fontSize: 12,
    color: '#94a3b8',
    marginTop: 2,
  },

  primaryBtn: {
    backgroundColor: '#0f172a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnText: {
    color: '#ffffff',
    fontWeight: '700',
    fontSize: 15,
  },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#e2e8f0',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryBtnText: {
    color: '#64748b',
    fontWeight: '600',
    fontSize: 14,
  },
});
