import { createContext, useContext, useState, useCallback, useRef } from 'react';

const ToastContext = createContext(null);

const TYPE_STYLE = {
  success: { icon: 'OK', color: 'var(--success)', bg: '#ECFDF5', border: '#A7F3D0' },
  error:   { icon: '!',  color: 'var(--danger)',  bg: '#FEF2F2', border: '#FECACA' },
  warning: { icon: '!',  color: 'var(--warning)', bg: '#FFFBEB', border: '#FDE68A' },
  info:    { icon: 'i',  color: 'var(--primary)', bg: 'var(--primary-light)', border: 'var(--border)' },
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
    const timer = timersRef.current.get(id);
    if (timer) { clearTimeout(timer); timersRef.current.delete(id); }
  }, []);

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => [...prev, { id, message, type }].slice(-4)); // cap the stack — a burst of actions shouldn't wall the screen
    if (duration > 0) {
      const timer = setTimeout(() => dismissToast(id), duration);
      timersRef.current.set(id, timer);
    }
    return id;
  }, [dismissToast]);

  return (
    <ToastContext.Provider value={{ showToast, dismissToast }}>
      {children}
      <div
        aria-live="polite"
        style={{
          position: 'fixed', zIndex: 5000, top: 16, right: 16,
          display: 'flex', flexDirection: 'column', gap: 8,
          maxWidth: 'min(360px, calc(100vw - 32px))',
        }}
      >
        {toasts.map(t => {
          const s = TYPE_STYLE[t.type] || TYPE_STYLE.info;
          return (
            <div
              key={t.id}
              role="status"
              style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '12px 14px', borderRadius: 'var(--radius-sm)',
                background: s.bg, border: `1.5px solid ${s.border}`,
                boxShadow: 'var(--shadow-lg)',
                animation: 'toast-in .18s ease-out',
              }}
            >
              <span style={{ fontSize: '.9rem', fontWeight: 800, color: s.color, flexShrink: 0, lineHeight: '1.4' }}>{s.icon}</span>
              <span style={{ fontSize: '.85rem', color: 'var(--text)', lineHeight: 1.45, flex: 1 }}>{t.message}</span>
              <button
                onClick={() => dismissToast(t.id)}
                aria-label="Dismiss"
                style={{
                  all: 'unset', cursor: 'pointer', color: 'var(--muted)', fontSize: '.8rem',
                  padding: '0 2px', lineHeight: 1.4, flexShrink: 0,
                }}
              >x</button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
