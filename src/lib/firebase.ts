import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

const firebaseConfig = {
  apiKey:
    import.meta.env.VITE_FIREBASE_API_KEY ||
    'AIzaSyBh9yN2w_f6aF1nG8_dWM29ixRJVn9sqoM',
  authDomain:
    import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'bmspro-black.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'bmspro-black',
  storageBucket:
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ||
    'bmspro-black.firebasestorage.app',
  messagingSenderId:
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '807442450614',
  appId:
    import.meta.env.VITE_FIREBASE_APP_ID ||
    '1:807442450614:web:6df4fcda16b65b6860fe17',
  measurementId:
    import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-FKFHRS06RR',
};

// Prevent re-initialising during hot-reload in dev
const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const db   = getFirestore(app);
export const auth = getAuth(app);

// ─── Auth-ready gate ────────────────────────────────────────────────────────

let _authReady = false;
let _pendingResolvers: (() => void)[] = [];
let _waitPromise: Promise<void> | null = null;

function _settle() {
  if (_authReady) return;
  _authReady = true;
  for (const r of _pendingResolvers) r();
  _pendingResolvers = [];
}

/** Called by FirebaseAuthProvider once auth state is fully settled (including auto-login). */
export function signalAuthReady(): void {
  _settle();
}

/**
 * Blocks until Firebase auth is fully initialised.
 * Resolves via whichever fires first:
 *  1. signalAuthReady() from FirebaseAuthProvider
 *  2. onAuthStateChanged reporting a signed-in user
 *  3. 10-second safety timeout
 */
export function waitForAuth(): Promise<void> {
  if (_authReady || auth.currentUser) return Promise.resolve();

  if (!_waitPromise) {
    _waitPromise = new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        _settle();
        resolve();
      };

      _pendingResolvers.push(done);

      const unsub = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsub();
          done();
        }
      });

      setTimeout(() => { unsub(); done(); }, 10_000);
    });
  }

  return _waitPromise;
}
