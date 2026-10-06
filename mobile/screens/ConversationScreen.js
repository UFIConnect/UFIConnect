import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TextInput,
  TouchableOpacity, KeyboardAvoidingView, Platform,
  ActivityIndicator, Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import axios from 'axios';
import { useAuth, API_BASE } from '../context/AuthContext';
import { COLORS } from '../theme';
import { attachmentDetails } from '../security/attachmentDetails';
import SafetyButton from '../components/SafetyButton';
import { useModeration } from '../context/ModerationContext';

function timeStamp(dateStr) {
  return new Date(dateStr).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

function fileIcon(mimeType) {
  if (!mimeType) return '📄';
  if (mimeType.startsWith('image/')) return '🖼️';
  if (mimeType.includes('pdf')) return '📋';
  if (mimeType.includes('word') || mimeType.includes('document')) return '📝';
  if (mimeType.includes('sheet') || mimeType.includes('excel')) return '📊';
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint')) return '📑';
  if (mimeType.includes('zip') || mimeType.includes('compressed')) return '🗜️';
  if (mimeType.includes('video')) return '🎬';
  if (mimeType.includes('audio')) return '🎵';
  return '📄';
}

function AttachmentBubble({ attachment, isMe }) {
  return (
    <View style={[att.wrap, isMe && att.wrapMe]}>
      <Text style={att.icon}>{fileIcon(attachment.mimeType)}</Text>
      <View style={att.info}>
        <Text style={[att.size, isMe && att.sizeMe]}>File details</Text>
        <Text style={[att.name, isMe && att.nameMe]} numberOfLines={1}>{attachment.name}</Text>
        {attachment.size ? <Text style={[att.size, isMe && att.sizeMe]}>{formatBytes(attachment.size)}</Text> : null}
      </View>
    </View>
  );
}

function Bubble({ msg, isMe }) {
  return (
    <View style={[bub.row, isMe && bub.rowMe]}>
      <View style={[bub.bubble, isMe ? bub.bubbleMe : bub.bubbleThem]}>
        {msg.attachment && <AttachmentBubble attachment={msg.attachment} isMe={isMe} />}
        {msg.content ? <Text style={[bub.text, isMe && bub.textMe]}>{msg.content}</Text> : null}
        <Text style={[bub.time, isMe && bub.timeMe]}>{timeStamp(msg.createdAt)}</Text>
      </View>
    </View>
  );
}

export default function ConversationScreen({ route, navigation }) {
  const { userId, participant } = route.params;
  const { token, profile } = useAuth();
  const moderation = useModeration();
  const blocked = moderation.isBlocked(userId);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [pendingAttachment, setPendingAttachment] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [sendError, setSendError] = useState('');
  const sendingRef = useRef(false);
  const blockedRef = useRef(blocked);
  blockedRef.current = blocked;
  const listRef = useRef(null);

  const fetchMessages = useCallback(async () => {
    try {
      const res = await axios.get(`${API_BASE}/messages/${userId}`, {
        headers: { Authorization: `Bearer ${token}` }, timeout: 15000,
      });
      setMessages(res.data.messages || []);
      setLoadError('');
    } catch { setLoadError('Could not load this conversation. Please retry.'); }
    finally { setLoading(false); }
  }, [token, userId]);

  useEffect(() => {
    navigation.setOptions({ title: participant?.name || 'Conversation' });
    fetchMessages();
  }, [fetchMessages, navigation, participant]);

  async function pickFile() {
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: '*/*',
        copyToCacheDirectory: false,
      });
      if (result.canceled) return;
      const file = result.assets?.[0];
      setPendingAttachment(attachmentDetails(file));
    } catch (e) {
      Alert.alert('Error', 'Could not pick file.');
    }
  }

  async function send() {
    const content = input.trim();
    if (blocked || !moderation.loaded || (!content && !pendingAttachment) || sendingRef.current) return;
    const att = pendingAttachment;
    sendingRef.current = true;
    setSending(true);
    setSendError('');
    try {
      const res = await axios.post(
        `${API_BASE}/messages/${userId}`,
        { content, attachment: att },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 }
      );
      if (!res.data?.message?.id) throw new Error('Message was not confirmed');
      if (!blockedRef.current) {
        setMessages((prev) => [...prev, res.data.message]);
        setInput('');
        setPendingAttachment(null);
      }
    } catch { setSendError('Message could not be sent. Your draft is still here.'); }
    finally { sendingRef.current = false; setSending(false); }
  }

  const canSend = moderation.loaded && !blocked && (input.trim() || pendingAttachment) && !sending;

  useEffect(() => {
    if (blocked) { setInput(''); setPendingAttachment(null); setMessages([]); setSendError(''); }
  }, [blocked]);

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={90}>
      {participant && (
        <View style={s.infoBar}>
          <Text style={s.infoName}>{participant.title}{participant.organization ? ` · ${participant.organization}` : ''}</Text>
          {!blocked && <SafetyButton userId={userId} userName={participant.name} />}
        </View>
      )}

      {!blocked && loadError ? <View style={s.infoBar}>
        <Text accessibilityRole="alert" style={{ color: COLORS.danger }}>{loadError}</Text>
        <TouchableOpacity accessibilityRole="button" accessibilityLabel="Retry conversation" onPress={fetchMessages}><Text style={{ color: COLORS.primary, paddingVertical: 10 }}>Retry</Text></TouchableOpacity>
      </View> : null}
      {loading && <ActivityIndicator accessibilityLabel="Loading conversation" color={COLORS.primary} />}

      <FlatList
        ref={listRef}
        data={blocked || !moderation.loaded ? [] : messages}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
        renderItem={({ item }) => <Bubble msg={item} isMe={item.senderId === profile?.id} />}
        ListEmptyComponent={<View style={s.empty}><Text style={s.emptyText}>{blocked ? 'You blocked this user. Messages are hidden.' : !moderation.loaded ? 'Loading safety preferences...' : loading || loadError ? '' : 'Say hello!'}</Text></View>}
      />

      {/* Pending attachment preview */}
      {!blocked && pendingAttachment && (
        <View style={s.attachPreview}>
          <Text style={s.attachIcon}>{fileIcon(pendingAttachment.mimeType)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={s.attachName} numberOfLines={1}>{pendingAttachment.name}</Text>
            <Text style={s.attachSize}>File details only; contents are not uploaded.</Text>
            {pendingAttachment.size ? <Text style={s.attachSize}>{formatBytes(pendingAttachment.size)}</Text> : null}
          </View>
          <TouchableOpacity onPress={() => setPendingAttachment(null)} style={s.attachRemove}>
            <Text style={s.attachRemoveText}>✕</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Input row */}
      {!blocked && sendError ? <Text accessibilityRole="alert" style={{ color: COLORS.danger, paddingHorizontal: 16, paddingVertical: 8 }}>{sendError}</Text> : null}
      {!blocked && <View style={s.inputRow}>
        <TouchableOpacity style={s.attachBtn} onPress={pickFile} disabled={sending} activeOpacity={0.7} accessibilityLabel="Share file details">
          <Text style={s.attachBtnIcon}>📎</Text>
        </TouchableOpacity>
        <TextInput
          style={s.input}
          placeholder="Message..."
          placeholderTextColor={COLORS.muted}
          value={input}
          editable={moderation.loaded && !sending}
          onChangeText={setInput}
          multiline
          maxLength={2000}
          returnKeyType="send"
          blurOnSubmit={false}
        />
        <TouchableOpacity
          style={[s.sendBtn, !canSend && s.sendBtnDisabled]}
          onPress={send}
          disabled={!canSend}
          accessibilityRole="button"
          accessibilityLabel="Send message"
          activeOpacity={0.8}
        >
          {sending
            ? <ActivityIndicator size="small" color="#fff" />
            : <Text style={s.sendIcon}>↑</Text>
          }
        </TouchableOpacity>
      </View>}
    </KeyboardAvoidingView>
  );
}

const att = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: 'rgba(0,0,0,0.06)', borderRadius: 10, padding: 10, marginBottom: 4 },
  wrapMe: { backgroundColor: 'rgba(255,255,255,0.2)' },
  icon: { fontSize: 22 },
  info: { flex: 1 },
  name: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  nameMe: { color: '#fff' },
  size: { fontSize: 11, color: COLORS.muted, marginTop: 1 },
  sizeMe: { color: 'rgba(255,255,255,0.7)' },
});

const bub = StyleSheet.create({
  row: { flexDirection: 'row', marginBottom: 6, paddingHorizontal: 16 },
  rowMe: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 20 },
  bubbleMe: { backgroundColor: COLORS.primary, borderBottomRightRadius: 4 },
  bubbleThem: { backgroundColor: COLORS.surface, borderBottomLeftRadius: 4 },
  text: { fontSize: 15, color: COLORS.text, lineHeight: 22 },
  textMe: { color: '#fff' },
  time: { fontSize: 11, color: COLORS.muted, marginTop: 3, alignSelf: 'flex-end' },
  timeMe: { color: 'rgba(255,255,255,0.65)' },
});

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  infoBar: { paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: COLORS.border },
  infoName: { fontSize: 12, color: COLORS.muted },
  list: { paddingTop: 16, paddingBottom: 8 },
  empty: { padding: 40, alignItems: 'center' },
  emptyText: { color: COLORS.muted, fontSize: 14 },
  attachPreview: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginHorizontal: 16, marginBottom: 6, backgroundColor: COLORS.surface,
    borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8,
    borderWidth: 1, borderColor: COLORS.border,
  },
  attachIcon: { fontSize: 20 },
  attachName: { fontSize: 13, fontWeight: '600', color: COLORS.text },
  attachSize: { fontSize: 11, color: COLORS.muted },
  attachRemove: { padding: 4 },
  attachRemoveText: { color: COLORS.muted, fontWeight: '700', fontSize: 14 },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: COLORS.border },
  attachBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: COLORS.surface, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border },
  attachBtnIcon: { fontSize: 18 },
  input: { flex: 1, backgroundColor: COLORS.surface, borderRadius: 22, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: COLORS.text, maxHeight: 120, borderWidth: 1, borderColor: COLORS.border },
  sendBtn: { width: 42, height: 42, borderRadius: 21, backgroundColor: COLORS.primary, justifyContent: 'center', alignItems: 'center' },
  sendBtnDisabled: { opacity: 0.4 },
  sendIcon: { color: '#fff', fontSize: 18, fontWeight: '800' },
});
