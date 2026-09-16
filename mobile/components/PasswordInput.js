import React, { useEffect, useRef, useState } from 'react';
import { Alert, AppState, Platform, Text, TextInput, TouchableOpacity, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { COLORS } from '../theme';

export default function PasswordInput({ newPassword = false, concealKey = 0, style, onChangeText, onBlur, ...props }) {
  const input = useRef(null);
  const revealAtPress = useRef(false);
  const [revealed, setRevealed] = useState(false);
  const visible = revealed && props.editable !== false && Boolean(props.value);
  const fieldName = props.accessibilityLabel || 'Password';

  useEffect(() => { setRevealed(false); }, [concealKey]);

  useEffect(() => {
    if (!props.value || props.editable === false) setRevealed(false);
  }, [props.value, props.editable]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') setRevealed(false);
      if (state === 'background') onChangeText('');
    });
    return () => subscription.remove();
  }, [onChangeText]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const element = input.current;
    if (!element?.addEventListener) return undefined;
    const preventExport = (event) => event.preventDefault();
    const conceal = () => setRevealed(false);
    const events = ['copy', 'cut', 'dragstart'];
    events.forEach((event) => element.addEventListener(event, preventExport));
    window.addEventListener('blur', conceal);
    return () => {
      events.forEach((event) => element.removeEventListener(event, preventExport));
      window.removeEventListener('blur', conceal);
    };
  }, []);

  async function pastePassword() {
    setRevealed(false);
    try {
      // Read only after an explicit tap; never write passwords to the clipboard.
      const text = await Clipboard.getStringAsync();
      if (AppState.currentState !== 'active') return;
      onChangeText(text);
      input.current?.focus();
    } catch {
      Alert.alert('Paste unavailable', 'Allow clipboard access or use your password manager.');
    }
  }

  return (
    <View>
      <TextInput
        {...props}
        ref={input}
        style={style}
        onChangeText={onChangeText}
        onBlur={(event) => { setRevealed(false); onBlur?.(event); }}
        // Native secure mode also blocks hardware-keyboard copying. Keep it
        // enabled and reveal through a separate non-selectable preview instead.
        secureTextEntry={Platform.OS !== 'web' || !visible}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        autoComplete={newPassword ? 'new-password' : 'current-password'}
        textContentType={newPassword ? 'newPassword' : 'password'}
        importantForAutofill="yes"
        contextMenuHidden={Platform.OS !== 'web'}
      />
      {Platform.OS !== 'web' && visible && (
        <View pointerEvents="none" style={styles.preview}>
          <Text selectable={false} style={styles.previewLabel}>Entered password</Text>
          <Text selectable={false} style={styles.previewText}>{props.value}</Text>
        </View>
      )}
      <View style={styles.actions}>
        <TouchableOpacity
          onMouseDown={Platform.OS === 'web' ? (event) => event.preventDefault() : undefined}
          onPressIn={() => { revealAtPress.current = visible; }}
          onPress={() => {
            setRevealed(!revealAtPress.current);
            // Restore field focus so leaving it always conceals the password.
            input.current?.focus();
          }}
          accessibilityRole="button"
          accessibilityLabel={`${visible ? 'Hide' : 'Show'} ${fieldName.toLowerCase()}`}
          accessibilityState={{ expanded: visible, disabled: props.editable === false || !props.value }}
          style={styles.actionButton}
          disabled={props.editable === false || !props.value}
        >
          <Text style={styles.actionText}>{visible ? 'Hide password' : 'Show password'}</Text>
        </TouchableOpacity>
        {Platform.OS !== 'web' && (
          <TouchableOpacity
            onPress={pastePassword}
            accessibilityRole="button"
            accessibilityLabel="Paste password from clipboard"
            style={styles.actionButton}
            disabled={props.editable === false}
          >
            <Text style={styles.actionText}>Paste password</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  actions: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap' },
  actionButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4, marginBottom: 8 },
  actionText: { color: COLORS.primary, fontSize: 13, fontWeight: '600' },
  preview: { borderColor: COLORS.border, borderWidth: 1, borderRadius: 10, padding: 12, marginBottom: 4, backgroundColor: COLORS.surface },
  previewLabel: { color: COLORS.muted, fontSize: 12, marginBottom: 6 },
  previewText: { color: COLORS.text, fontSize: 16, lineHeight: 24, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
