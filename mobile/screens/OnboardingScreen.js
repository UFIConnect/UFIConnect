import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  ActivityIndicator, Alert, SafeAreaView,
} from 'react-native';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS, CATEGORY_COLORS, CATEGORY_ICONS } from '../theme';

const STEPS = [
  {
    key: 'role',
    title: 'What best describes you?',
    subtitle: "We'll use this to find your most relevant groups.",
    multi: false,
    options: [
      { value: 'Engineer / Developer',   icon: '👨‍💻', desc: 'Building software & systems' },
      { value: 'Designer / Creative',    icon: '🎨', desc: 'Crafting products & brands' },
      { value: 'Product Manager',        icon: '📦', desc: 'Shipping & prioritising features' },
      { value: 'Marketer / Growth',      icon: '📈', desc: 'Growing audiences & revenue' },
      { value: 'Founder / Entrepreneur', icon: '🚀', desc: 'Starting & scaling companies' },
      { value: 'Investor',               icon: '💰', desc: 'Backing founders & startups' },
      { value: 'Data / Analytics',       icon: '📊', desc: 'Turning data into decisions' },
      { value: 'Student / Learner',      icon: '🎓', desc: 'Learning & entering the field' },
    ],
  },
  {
    key: 'goals',
    title: "What brings you here?",
    subtitle: 'Pick everything that applies.',
    multi: true,
    options: [
      { value: 'Connect with peers in my field',  icon: '🤝' },
      { value: 'Find collaborators or co-founders', icon: '👥' },
      { value: 'Stay updated on trends',           icon: '📡' },
      { value: 'Find jobs or freelance work',      icon: '💼' },
      { value: 'Learn from experts',               icon: '📚' },
      { value: 'Get funding / find investors',     icon: '💸' },
    ],
  },
  {
    key: 'interests',
    title: 'Which topics excite you most?',
    subtitle: "Pick all that apply — we'll surface groups in these areas.",
    multi: true,
    options: [
      { value: 'AI & ML',     icon: CATEGORY_ICONS['AI & ML'],     color: CATEGORY_COLORS['AI & ML'] },
      { value: 'Engineering', icon: CATEGORY_ICONS['Engineering'],  color: CATEGORY_COLORS['Engineering'] },
      { value: 'Startups',    icon: CATEGORY_ICONS['Startups'],     color: CATEGORY_COLORS['Startups'] },
      { value: 'Design',      icon: CATEGORY_ICONS['Design'],       color: CATEGORY_COLORS['Design'] },
      { value: 'Marketing',   icon: CATEGORY_ICONS['Marketing'],    color: CATEGORY_COLORS['Marketing'] },
      { value: 'Finance',     icon: CATEGORY_ICONS['Finance'],      color: CATEGORY_COLORS['Finance'] },
      { value: 'Remote Work', icon: CATEGORY_ICONS['Remote Work'],  color: CATEGORY_COLORS['Remote Work'] },
      { value: 'Education',   icon: CATEGORY_ICONS['Education'],    color: CATEGORY_COLORS['Education'] },
    ],
  },
  {
    key: 'experience',
    title: "How long have you been in your field?",
    subtitle: "Helps us match you with the right level of community.",
    multi: false,
    options: [
      { value: 'Just starting (0-2 years)', icon: '🌱', desc: 'Building foundations' },
      { value: 'Growing fast (3-6 years)',  icon: '⚡', desc: 'Expanding your impact' },
      { value: 'Senior (7-14 years)',       icon: '🔥', desc: 'Leading & mentoring' },
      { value: 'Leadership (15+ years)',    icon: '🏆', desc: 'Defining the industry' },
    ],
  },
];

export default function OnboardingScreen() {
  const { token, updateProfileLocally } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ role: null, goals: [], interests: [], experience: null });
  const [loading, setLoading] = useState(false);

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  function toggle(key, value, multi) {
    if (!multi) {
      setAnswers((a) => ({ ...a, [key]: value }));
    } else {
      setAnswers((a) => {
        const arr = a[key];
        return {
          ...a,
          [key]: arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value],
        };
      });
    }
  }

  function isSelected(key, value) {
    const v = answers[key];
    return Array.isArray(v) ? v.includes(value) : v === value;
  }

  function canAdvance() {
    const v = answers[current.key];
    return Array.isArray(v) ? v.length > 0 : v !== null;
  }

  async function finish() {
    setLoading(true);
    try {
      const res = await axios.post(
        `${API_BASE}/profile/onboarding`,
        { preferences: answers },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      updateProfileLocally(res.data.profile);
    } catch (err) {
      Alert.alert('Error', err?.response?.data?.message || 'Something went wrong.');
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      {/* Progress bar */}
      <View style={styles.progressRow}>
        {STEPS.map((_, i) => (
          <View
            key={i}
            style={[styles.progressDot, i <= step && styles.progressDotActive, i < step && styles.progressDotDone]}
          />
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        <Text style={styles.stepLabel}>Step {step + 1} of {STEPS.length}</Text>
        <Text style={styles.title}>{current.title}</Text>
        <Text style={styles.subtitle}>{current.subtitle}</Text>

        <View style={styles.options}>
          {current.options.map((opt) => {
            const selected = isSelected(current.key, opt.value);
            const cc = opt.color || null;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  styles.option,
                  selected && styles.optionSelected,
                  cc && selected && { backgroundColor: cc.bg, borderColor: cc.text },
                ]}
                onPress={() => toggle(current.key, opt.value, current.multi)}
                activeOpacity={0.75}
              >
                <Text style={styles.optionIcon}>{opt.icon}</Text>
                <View style={styles.optionTextWrap}>
                  <Text style={[styles.optionLabel, selected && styles.optionLabelSelected, cc && selected && { color: cc.text }]}>
                    {opt.value}
                  </Text>
                  {opt.desc ? (
                    <Text style={styles.optionDesc}>{opt.desc}</Text>
                  ) : null}
                </View>
                {selected && (
                  <Text style={[styles.check, cc && { color: cc.text }]}>✓</Text>
                )}
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {step > 0 && (
          <TouchableOpacity style={styles.backBtn} onPress={() => setStep((s) => s - 1)}>
            <Text style={styles.backBtnText}>← Back</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={[styles.nextBtn, !canAdvance() && styles.nextBtnDisabled]}
          onPress={isLast ? finish : () => setStep((s) => s + 1)}
          disabled={!canAdvance() || loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.nextBtnText}>{isLast ? '🎉 Find my groups' : 'Continue →'}</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  progressRow: { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 16, gap: 6 },
  progressDot: { flex: 1, height: 4, borderRadius: 4, backgroundColor: COLORS.border },
  progressDotActive: { backgroundColor: COLORS.primary },
  progressDotDone: { backgroundColor: COLORS.primary, opacity: 0.4 },
  container: { padding: 24, paddingBottom: 120 },
  stepLabel: { fontSize: 12, fontWeight: '600', color: COLORS.muted, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 8 },
  title: { fontSize: 26, fontWeight: '900', color: COLORS.text, marginBottom: 8, lineHeight: 32 },
  subtitle: { fontSize: 15, color: COLORS.muted, marginBottom: 28, lineHeight: 22 },
  options: { gap: 10 },
  option: {
    flexDirection: 'row', alignItems: 'center', padding: 14, borderRadius: 14,
    backgroundColor: '#fff', borderWidth: 1.5, borderColor: COLORS.border,
    shadowColor: '#000', shadowOpacity: 0.03, shadowOffset: { width: 0, height: 1 }, shadowRadius: 4, elevation: 1,
  },
  optionSelected: { borderColor: COLORS.primary, backgroundColor: COLORS.primaryLight },
  optionIcon: { fontSize: 22, marginRight: 12 },
  optionTextWrap: { flex: 1 },
  optionLabel: { fontSize: 15, fontWeight: '600', color: COLORS.text },
  optionLabelSelected: { color: COLORS.primary },
  optionDesc: { fontSize: 12, color: COLORS.muted, marginTop: 2 },
  check: { fontSize: 16, fontWeight: '800', color: COLORS.primary, marginLeft: 8 },
  footer: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', padding: 20, gap: 10,
    backgroundColor: COLORS.background, borderTopWidth: 1, borderTopColor: COLORS.border,
  },
  backBtn: {
    paddingHorizontal: 16, paddingVertical: 14, borderRadius: 12,
    backgroundColor: COLORS.surface, justifyContent: 'center',
  },
  backBtnText: { color: COLORS.muted, fontWeight: '600' },
  nextBtn: { flex: 1, backgroundColor: COLORS.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  nextBtnDisabled: { opacity: 0.4 },
  nextBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
