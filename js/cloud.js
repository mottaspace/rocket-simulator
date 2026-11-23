// Firebase 연동: Google 로그인 + Firestore 저장
// 완료되면 window.Cloud 를 만들고 'cloud-ready' 이벤트를 보냅니다.
import { firebaseConfig } from './firebase-config.js';

const SDK = 'https://www.gstatic.com/firebasejs/10.12.2/';
const configured = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith('YOUR');

function ready(api) {
  window.Cloud = api;
  window.dispatchEvent(new Event('cloud-ready'));
}

if (!configured) {
  ready({ configured: false });
} else {
  const [{ initializeApp }, A, F] = await Promise.all([
    import(SDK + 'firebase-app.js'),
    import(SDK + 'firebase-auth.js'),
    import(SDK + 'firebase-firestore.js'),
  ]);
  const fbApp = initializeApp(firebaseConfig);
  const auth = A.getAuth(fbApp);
  auth.languageCode = 'ko';
  const db = F.getFirestore(fbApp);
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  // 리디렉션 로그인에서 돌아온 경우 결과 처리
  A.getRedirectResult(auth).catch(() => {});

  const uid = () => {
    if (!auth.currentUser) throw new Error('로그인이 필요해요');
    return auth.currentUser.uid;
  };

  ready({
    configured: true,

    onAuth(cb) {
      A.onAuthStateChanged(auth, async user => {
        if (user) {
          // 사용자 프로필 기록 (순위표 이름 표시용)
          F.setDoc(F.doc(db, 'users', user.uid), {
            displayName: user.displayName || '우주비행사',
            photoURL: user.photoURL || '',
            lastLogin: F.serverTimestamp(),
          }, { merge: true }).catch(() => {});
        }
        cb(user);
      });
    },

    async signIn() {
      try {
        await A.signInWithPopup(auth, provider);
      } catch (e) {
        // 모바일에서 팝업이 막히면 리디렉션 방식으로 다시 시도
        if (e && (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment')) {
          await A.signInWithRedirect(auth, provider);
        } else if (e && e.code === 'auth/popup-closed-by-user') {
          return;
        } else throw e;
      }
    },

    signOut() { return A.signOut(auth); },

    // ── 내 로켓 설계: users/{uid}/designs/{id}
    async saveDesign(name, parts) {
      const col = F.collection(db, 'users', uid(), 'designs');
      await F.addDoc(col, { name, parts, updatedAt: F.serverTimestamp() });
    },
    async listDesigns() {
      const q = F.query(F.collection(db, 'users', uid(), 'designs'), F.orderBy('updatedAt', 'desc'), F.limit(30));
      const snap = await F.getDocs(q);
      return snap.docs.map(d => ({ id: d.id, ...d.data() }));
    },
    deleteDesign(id) { return F.deleteDoc(F.doc(db, 'users', uid(), 'designs', id)); },

    // ── 비행 기록: flights/{id} (로그인한 사용자 모두 읽기 가능 → 순위표)
    async saveFlight(rec) {
      const u = auth.currentUser;
      await F.addDoc(F.collection(db, 'flights'), {
        ...rec,
        uid: uid(),
        displayName: (u.displayName || '우주비행사').slice(0, 40),
        createdAt: F.serverTimestamp(),
      });
    },
    async topFlights(field) {
      const q = F.query(F.collection(db, 'flights'), F.orderBy(field, 'desc'), F.limit(20));
      return (await F.getDocs(q)).docs.map(d => d.data());
    },
    async myFlights() {
      // 복합 색인 없이 쓰기 위해 정렬은 브라우저에서
      const q = F.query(F.collection(db, 'flights'), F.where('uid', '==', uid()), F.limit(50));
      const rows = (await F.getDocs(q)).docs.map(d => d.data());
      return rows.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0)).slice(0, 20);
    },
  });
}
