import { useEffect } from 'react';
import {
  AUTH_LOGOUT_EVENT,
  AUTH_SESSION_EXPIRED_MESSAGE,
  consumeSessionExpiredNotice,
  type AuthLogoutEventDetail,
} from '@/lib/api';
import { toast } from '@/hooks/use-toast';

function showSessionExpiredToast(): void {
  toast({
    variant: 'destructive',
    title: 'Auth session expired',
    description: AUTH_SESSION_EXPIRED_MESSAGE,
  });
}

function getLogoutEventDetail(event: Event): AuthLogoutEventDetail | null {
  return event instanceof CustomEvent ? (event.detail as AuthLogoutEventDetail) : null;
}

export function AuthSessionExpiredNotice() {
  useEffect(() => {
    if (consumeSessionExpiredNotice()) {
      showSessionExpiredToast();
    }

    const onLogout = (event: Event) => {
      const detail = getLogoutEventDetail(event);
      if (detail?.reason !== 'session-expired' || detail.redirect) return;
      consumeSessionExpiredNotice();
      showSessionExpiredToast();
    };

    window.addEventListener(AUTH_LOGOUT_EVENT, onLogout);
    return () => window.removeEventListener(AUTH_LOGOUT_EVENT, onLogout);
  }, []);

  return null;
}
