import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../contexts/AuthContext';
import type { DriverDashboard } from '../../types';

type ProfileState = {
  name: string;
  email: string;
  phone: string;
  nationalIdData: string;
  nationalIdPreview: string;
  photoData: string;
  photoPreview: string;
};

const initialState: ProfileState = {
  name: '',
  email: '',
  phone: '',
  nationalIdData: '',
  nationalIdPreview: '',
  photoData: '',
  photoPreview: '',
};

export default function DriverProfileScreen() {
  const {
    apiClient: { api, API_BASE },
  } = useAuth();
  const assetBase = useMemo(() => API_BASE.replace(/\/$/, ''), [API_BASE]);
  const [profile, setProfile] = useState<ProfileState>(initialState);
  const [status, setStatus] = useState<'idle' | 'loading' | 'saving' | 'error'>('loading');
  const [message, setMessage] = useState<string | null>(null);

  const loadProfile = useCallback(async () => {
    try {
      setStatus('loading');
      setMessage(null);
      const res = await api.get('/api/driver/dashboard');
      const details = (res.data as DriverDashboard | undefined)?.profile;
      setProfile({
        name: details?.name || '',
        email: details?.email || '',
        phone: details?.phone || '',
        nationalIdData: '',
        nationalIdPreview: details?.nationalIdPath
          ? `${assetBase}${details.nationalIdPath.startsWith('/') ? details.nationalIdPath : `/${details.nationalIdPath}`}`
          : '',
        photoData: '',
        photoPreview: details?.photoPath
          ? `${assetBase}${details.photoPath.startsWith('/') ? details.photoPath : `/${details.photoPath}`}`
          : '',
      });
      setStatus('idle');
    } catch (err: any) {
      setStatus('error');
      setMessage(err?.response?.data?.error || 'Unable to load profile.');
    }
  }, [api, assetBase]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const pickImage = useCallback(
    async (target: 'nationalId' | 'photo') => {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Permission needed', 'Allow photo library access to attach images.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.7,
        base64: true,
      });
      if (result.canceled || !result.assets?.length) return;
      const asset = result.assets[0];
      const data = asset.base64 ? `data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}` : '';
      const preview = asset.uri || '';
      setProfile((prev) =>
        target === 'nationalId'
          ? { ...prev, nationalIdData: data, nationalIdPreview: preview }
          : { ...prev, photoData: data, photoPreview: preview },
      );
    },
    [],
  );

  const save = useCallback(async () => {
    if (status === 'saving') return;
    setStatus('saving');
    setMessage(null);
    try {
      const payload: any = {
        name: profile.name.trim(),
        email: profile.email.trim(),
        phone: profile.phone.trim(),
      };
      if (profile.nationalIdData) payload.nationalIdData = profile.nationalIdData;
      if (profile.photoData) payload.photoData = profile.photoData;
      await api.put('/api/driver/profile', payload);
      setMessage('Profile updated successfully.');
      setProfile((prev) => ({
        ...prev,
        nationalIdData: '',
        photoData: '',
      }));
      await loadProfile();
    } catch (err: any) {
      setMessage(err?.response?.data?.error || 'Failed to update profile.');
    } finally {
      setStatus('idle');
    }
  }, [api, loadProfile, profile.email, profile.name, profile.phone, profile.nationalIdData, profile.photoData, status]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Driver profile</Text>
      <Text style={styles.subtitle}>Update your contact details and supporting documents.</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Full name</Text>
        <TextInput
          style={styles.input}
          value={profile.name}
          onChangeText={(text) => setProfile((prev) => ({ ...prev, name: text }))}
          placeholder="Driver name"
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          style={styles.input}
          autoCapitalize="none"
          keyboardType="email-address"
          value={profile.email}
          onChangeText={(text) => setProfile((prev) => ({ ...prev, email: text }))}
          placeholder="driver@example.com"
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Phone</Text>
        <TextInput
          style={styles.input}
          keyboardType="phone-pad"
          value={profile.phone}
          onChangeText={(text) => setProfile((prev) => ({ ...prev, phone: text }))}
          placeholder="+2547..."
          placeholderTextColor="#94a3b8"
        />
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>National ID / Passport</Text>
        {profile.nationalIdPreview ? (
          <Image source={{ uri: profile.nationalIdPreview }} style={styles.preview} />
        ) : (
          <Text style={styles.helper}>Attach a clear scan or photo of your identification.</Text>
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={() => pickImage('nationalId')}>
          <Text style={styles.secondaryButtonText}>
            {profile.nationalIdPreview ? 'Replace document' : 'Add document'}
          </Text>
        </TouchableOpacity>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Profile photo</Text>
        {profile.photoPreview ? (
          <Image source={{ uri: profile.photoPreview }} style={styles.preview} />
        ) : (
          <Text style={styles.helper}>Upload a recent headshot for your driver badge.</Text>
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={() => pickImage('photo')}>
          <Text style={styles.secondaryButtonText}>
            {profile.photoPreview ? 'Replace photo' : 'Add photo'}
          </Text>
        </TouchableOpacity>
      </View>

      {message && <Text style={status === 'error' ? styles.error : styles.success}>{message}</Text>}

      <TouchableOpacity style={styles.primaryButton} onPress={save} disabled={status === 'saving'}>
        <Text style={styles.primaryButtonText}>{status === 'saving' ? 'Saving…' : 'Save profile'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f8fafc',
  },
  content: {
    padding: 20,
    gap: 16,
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
  field: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    textTransform: 'uppercase',
    color: '#94a3b8',
    fontWeight: '600',
  },
  input: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: '#fff',
    color: '#0f172a',
    fontSize: 14,
  },
  preview: {
    width: '100%',
    height: 200,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#e2e8f0',
    resizeMode: 'cover',
  },
  helper: {
    fontSize: 12,
    color: '#475569',
  },
  primaryButton: {
    borderRadius: 999,
    backgroundColor: '#0f172a',
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontWeight: '700',
  },
  secondaryButton: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0f172a',
    paddingVertical: 10,
    alignItems: 'center',
  },
  secondaryButtonText: {
    color: '#0f172a',
    fontWeight: '700',
  },
  success: {
    color: '#065f46',
    fontSize: 13,
  },
  error: {
    color: '#b91c1c',
    fontSize: 13,
  },
});
