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
    title: "What's your role?",
    subtitle: "We'll tailor your feed, groups, and opportunities around it.",
    multi: false,
    options: [
      { value: 'Engineer / Developer',   icon: '💻', desc: 'Software, ML, DevOps' },
      { value: 'Designer / Creative',    icon: '🎨', desc: 'UI/UX, Brand, Motion' },
      { value: 'Product Manager',        icon: '📋', desc: 'Strategy & execution' },
      { value: 'Marketer / Growth',      icon: '📈', desc: 'SEO, Content, Ads' },
      { value: 'Founder / Entrepreneur', icon: '🚀', desc: 'Building something new' },
      { value: 'Investor / VC',          icon: '💰', desc: 'VC, Angel, LP' },
      { value: 'Data / Analytics',       icon: '📊', desc: 'Data Sci, BI, MLOps' },
      { value: 'Student / Learner',      icon: '🎓', desc: 'Growing & exploring' },
      { value: 'Sales / Business Dev',   icon: '🤝', desc: 'Revenue, partnerships' },
      { value: 'Operations / Finance',   icon: '⚙️', desc: 'Ops, accounting, strategy' },
      { value: 'Content Creator',        icon: '🎬', desc: 'Video, writing, podcasts' },
      { value: 'Community Manager',      icon: '🌐', desc: 'Grow & engage communities' },
      { value: 'Researcher / Academic',  icon: '🔬', desc: 'R&D, academia, science' },
      { value: 'HR / People Ops',        icon: '👥', desc: 'Recruiting, culture, L&D' },
    ],
  },
  {
    key: 'interests',
    title: 'What topics light you up?',
    subtitle: "We surface groups and opportunities in these areas.",
    multi: true,
    options: [
      { value: 'AI & Machine Learning',  icon: '🤖' },
      { value: 'Generative AI',          icon: '✨' },
      { value: 'LLMs & Chatbots',        icon: '💬' },
      { value: 'Data Science',           icon: '📊' },
      { value: 'Developer Tools',        icon: '🔧' },
      { value: 'Open Source',            icon: '🌐' },
      { value: 'Cybersecurity',          icon: '🔒' },
      { value: 'Cloud & DevOps',         icon: '☁️' },
      { value: 'Frontend Dev',           icon: '🖥️' },
      { value: 'Backend Dev',            icon: '⚙️' },
      { value: 'Mobile Dev',             icon: '📱' },
      { value: 'Web3 / Crypto',          icon: '⛓️' },
      { value: 'Hardware / IoT',         icon: '🔩' },
      { value: 'Game Dev',               icon: '🎮' },
      { value: 'AR / VR',                icon: '🥽' },
      { value: 'No-Code / Low-Code',     icon: '🔌' },
      { value: 'SaaS',                   icon: '🚀' },
      { value: 'B2B / Enterprise',       icon: '🏢' },
      { value: 'Bootstrapping',          icon: '💪' },
      { value: 'Venture Capital',        icon: '💰' },
      { value: 'Growth Marketing',       icon: '📈' },
      { value: 'Product-Led Growth',     icon: '📦' },
      { value: 'Sales & Revenue',        icon: '🤝' },
      { value: 'UI/UX Design',           icon: '🎨' },
      { value: 'Design Systems',         icon: '🗂️' },
      { value: 'Brand Identity',         icon: '✏️' },
      { value: 'Motion Design',          icon: '🎬' },
      { value: 'FinTech',                icon: '💳' },
      { value: 'DeFi / Crypto Finance',  icon: '🏦' },
      { value: 'Real Estate',            icon: '🏠' },
      { value: 'Health Tech',            icon: '🏥' },
      { value: 'BioTech',                icon: '🧬' },
      { value: 'Climate Tech',           icon: '🌱' },
      { value: 'EdTech',                 icon: '🎓' },
      { value: 'LegalTech',              icon: '⚖️' },
      { value: 'SpaceTech',              icon: '🚀' },
      { value: 'Remote Work',            icon: '🌍' },
      { value: 'Future of Work',         icon: '🔮' },
      { value: 'Recruiting & Hiring',    icon: '🔍' },
      { value: 'Leadership',             icon: '🏆' },
      { value: 'Creator Economy',        icon: '🎬' },
      { value: 'Podcasting',             icon: '🎙️' },
      { value: 'Newsletter & Writing',   icon: '📝' },
      { value: 'E-commerce',             icon: '🛒' },
      { value: 'Social Impact',          icon: '💚' },
      { value: 'Career Growth',          icon: '📉' },
      { value: 'Productivity',           icon: '⚡' },
      { value: 'Side Projects',          icon: '🔨' },
      { value: 'Freelancing',            icon: '🧑‍💻' },
    ],
  },
  {
    key: 'experience',
    title: "How long have you been in your field?",
    subtitle: "Helps us match you with the right level of community.",
    multi: false,
    options: [
      { value: 'student',   icon: '🌱', desc: '0–1 year — Building foundations' },
      { value: 'junior',    icon: '⚡', desc: '1–3 years — Growing fast' },
      { value: 'mid',       icon: '🔥', desc: '3–6 years — Expanding your impact' },
      { value: 'senior',    icon: '🏆', desc: '6–10 years — Leading & mentoring' },
      { value: 'principal', icon: '⭐', desc: '10+ years — Principal / Staff' },
      { value: 'exec',      icon: '👑', desc: 'C-suite, Founder, Executive' },
    ],
  },
];

export default function OnboardingScreen() {
  const { token, updateProfileLocally } = useAuth();
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ role: null, interests: [], experience: null });
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
