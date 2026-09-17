import { createRequire } from "module";

const require = createRequire(import.meta.url);
const firebase = require("firebase/app");
require("firebase/firestore");

const config = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyD-V_aZxvLXXdpudiqbiWJ0L5hZLYQBhv0",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "oliota.firebaseapp.com",
  projectId: process.env.FIREBASE_PROJECT_ID || "oliota",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "oliota.appspot.com",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "956770335052",
  appId: process.env.FIREBASE_APP_ID || "1:956770335052:web:9fc2dda8514b6a622377e9",
  measurementId: process.env.FIREBASE_MEASUREMENT_ID || "G-X412KJ6JW7"
};

const app = firebase.apps.length ? firebase.app() : firebase.initializeApp(config);
export const db = app.firestore();
export const FieldValue = firebase.firestore.FieldValue;
