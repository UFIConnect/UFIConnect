import { ArrowLeft } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';

export function useBackNavigation(fallbackTo = '/') {
  const navigate = useNavigate();
  return () => {
    if (window.history.state?.idx > 0) navigate(-1);
    else navigate(fallbackTo, { replace: true });
  };
}

export default function BackButton({ to, fallbackTo, onClick, iconOnly = false, children = 'Back', ...props }) {
  const goBack = useBackNavigation(fallbackTo);
  const className = iconOnly ? 'btn-back btn-back--icon-only' : 'btn-back';
  const content = <><ArrowLeft size={18} aria-hidden="true" />{!iconOnly && <span>{children}</span>}</>;

  if (to) return <Link to={to} className={className} {...props}>{content}</Link>;
  return <button type="button" className={className} onClick={onClick || goBack} {...props}>{content}</button>;
}
