import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';

/**
 * Firebase config — provided by BMS Pro Black.
 * Add these to your .env file (see the placeholder block at the bottom of .env).
 */
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
};

// Avoid re-initialising on HMR hot-reload
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0];

export const auth = getAuth(app);
export default app;
