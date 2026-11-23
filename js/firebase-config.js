// Firebase 콘솔 → 프로젝트 설정 → 일반 → 내 앱(웹)에서 받은 값을 붙여 넣으세요.
// (웹용 apiKey는 비밀번호가 아니라 공개되는 식별자입니다. 데이터 보호는 firestore.rules가 담당합니다.)
export const firebaseConfig = {
  apiKey: 'YOUR_API_KEY',
  authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
  projectId: 'YOUR_PROJECT_ID',
  storageBucket: 'YOUR_PROJECT_ID.firebasestorage.app',
  messagingSenderId: 'YOUR_SENDER_ID',
  appId: 'YOUR_APP_ID',
};
