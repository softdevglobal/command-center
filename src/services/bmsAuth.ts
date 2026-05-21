import { auth, waitForAuth } from '@/lib/firebase';
import { getAccessToken } from '@/lib/api';
import { getIdToken } from 'firebase/auth';

const SIGN_IN_REQUIRED =
  'Sign in required to use the workshop API. Please sign in with your dashboard account.';

/**
 * Bearer token for BMS Pro `/api/call-center` requests.
 * Uses the signed-in Firebase user ID token, or the dashboard backend JWT — never a static env secret.
 */
export async function getBmsBearerToken(options?: {
  /** Wait for Firebase auth to finish initializing (matches previous bookings/notifications behaviour). */
  waitForFirebaseInit?: boolean;
  /** Request a fresh Firebase ID token (notifications only). */
  forceRefreshFirebase?: boolean;
}): Promise<string> {
  if (options?.waitForFirebaseInit) {
    await waitForAuth();
  }

  const user = auth.currentUser;
  if (user) {
    return getIdToken(user, options?.forceRefreshFirebase ?? false);
  }

  const token = getAccessToken();
  if (token) return token;

  throw new Error(SIGN_IN_REQUIRED);
}

/**
 * Firebase ID token only — for BMS `/api/call-center` routes that must use the
 * workshop agent identity (chat). Does not fall back to the Supabase session JWT.
 */
export async function getFirebaseOnlyBmsBearerToken(): Promise<string> {
  await waitForAuth();
  const user = auth.currentUser;
  if (!user) {
    throw new Error(SIGN_IN_REQUIRED);
  }
  return getIdToken(user, false);
}
