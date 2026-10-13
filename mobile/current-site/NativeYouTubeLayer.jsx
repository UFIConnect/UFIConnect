import React, { forwardRef, useEffect, useImperativeHandle, useReducer, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { APP_BASE_URL, allowNavigation, createPlayerRegistry, projectRect, swipeEvent } from './nativeYouTube.cjs';

function NativePlayer({ entry, registry, active, containerSize }) {
  const geometry = projectRect(entry.rect, containerSize, active);
  const geometryRef = useRef(geometry);
  geometryRef.current = geometry;
  const touch = useRef(null);
  const captured = useRef(false);
  const finish = (dx, dy) => {
    const start = touch.current;
    touch.current = null;
    captured.current = false;
    if (!start) return;
    const event = swipeEvent({ dx, dy, duration: Date.now() - start.time, fingers: start.fingers }, geometryRef.current?.scale || 1);
    if (event) registry.enqueue(entry, event);
  };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onStartShouldSetPanResponderCapture: () => false,
    onMoveShouldSetPanResponderCapture: (event, gesture) => gesture.numberActiveTouches === 1 && Math.max(Math.abs(gesture.dx), Math.abs(gesture.dy)) > 12,
    onPanResponderGrant: (event, gesture) => { captured.current = true; if (!touch.current) touch.current = { x: gesture.x0, y: gesture.y0, time: Date.now(), fingers: gesture.numberActiveTouches }; },
    onPanResponderMove: (event, gesture) => { if (touch.current && gesture.numberActiveTouches > 1) touch.current.fingers = gesture.numberActiveTouches; },
    onPanResponderRelease: (event, gesture) => finish(gesture.dx, gesture.dy),
    onPanResponderTerminate: () => { touch.current = null; captured.current = false; },
    onPanResponderTerminationRequest: () => true,
    onShouldBlockNativeResponder: () => true,
  })).current;
  const frame = geometry || { left: 0, top: 0, width: 1, height: 1, innerLeft: 0, innerTop: 0,
    innerWidth: Math.max(1, entry.rect.width), innerHeight: Math.max(1, entry.rect.height) };
  return (
    <View
      {...pan.panHandlers}
      pointerEvents={geometry ? 'auto' : 'none'}
      style={[styles.clip, { left: frame.left, top: frame.top, width: frame.width, height: frame.height, opacity: geometry ? 1 : 0 }]}
      onTouchStart={event => {
        const native = event.nativeEvent;
        if (!touch.current || native.touches?.length === 1) touch.current = { x: native.pageX, y: native.pageY, time: Date.now(), fingers: native.touches?.length || 1 };
        else if ((native.touches?.length || 1) > 1) touch.current.fingers = native.touches.length;
      }}
      onTouchEnd={event => {
        const native = event.nativeEvent;
        if (touch.current && !(native.touches?.length)) finish(native.pageX - touch.current.x, native.pageY - touch.current.y);
      }}
      onTouchCancel={() => { if (!captured.current) touch.current = null; }}
    >
      <WebView
        ref={value => { entry.webView = value; }}
        source={{ html: entry.html, baseUrl: APP_BASE_URL }}
        originWhitelist={['*']}
        style={[styles.player, { left: frame.innerLeft, top: frame.innerTop, width: frame.innerWidth, height: frame.innerHeight }]}
        scrollEnabled={false}
        bounces={false}
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        automaticallyAdjustsScrollIndicatorInsets={false}
        allowsInlineMediaPlayback
        allowsFullscreenVideo={false}
        mediaPlaybackRequiresUserAction={false}
        sharedCookiesEnabled={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows
        onOpenWindow={() => {}}
        onShouldStartLoadWithRequest={allowNavigation}
        onMessage={event => registry.receive(entry, event.nativeEvent)}
        onError={() => registry.enqueue(entry, { type: 'error', data: 5 })}
        onContentProcessDidTerminate={() => registry.enqueue(entry, { type: 'error', data: 5 })}
      />
    </View>
  );
}

const NativeYouTubeLayer = forwardRef(function NativeYouTubeLayer({ active = true, containerSize }, ref) {
  const [, update] = useReducer(value => value + 1, 0);
  const registryRef = useRef(null);
  if (!registryRef.current) registryRef.current = createPlayerRegistry({
    changed: update,
    send: (entry, message) => entry.webView?.postMessage(JSON.stringify(message)),
  });
  const registry = registryRef.current;
  useImperativeHandle(ref, () => ({ request: input => registry.request(input) }), [registry]);
  useEffect(() => { registry.setActive(active); }, [active, registry]);
  useEffect(() => () => registry.dispose(), [registry]);
  return <View pointerEvents="box-none" style={StyleSheet.absoluteFill}>
    {[...registry.entries.values()].map(entry => <NativePlayer key={entry.key} entry={entry} registry={registry}
      active={active} containerSize={containerSize} />)}
  </View>;
});

const styles = StyleSheet.create({
  clip: { position: 'absolute', overflow: 'hidden', backgroundColor: '#000' },
  player: { position: 'absolute', backgroundColor: '#000', flex: 0 },
});

export default NativeYouTubeLayer;
