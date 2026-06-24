import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore } from "firebase/firestore";
import firebaseConfig from "../../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);

let db: any;
try {
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  }, (firebaseConfig as any).firestoreDatabaseId);
} catch (error) {
  console.warn("Failed to initialize Firestore with persistent local cache, falling back to basic Firestore initialization:", error);
  db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);
}

export { db };
export const auth = getAuth();

