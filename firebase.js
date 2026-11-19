
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
// Firebase configuration

const firebaseConfig = {
  apiKey: "AIzaSyDmfXMQX7dF2kan5XsSJtLywc40LEgufsg",
  authDomain: "lora-human-tracker.firebaseapp.com",
  projectId: "lora-human-tracker",
  storageBucket: "lora-human-tracker.firebasestorage.app",
  messagingSenderId: "963256122914",
  appId: "1:963256122914:web:25137514d59740a7b1547b"
};



// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);