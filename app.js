import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword,
  createUserWithEmailAndPassword, signOut,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, collection, addDoc, updateDoc, deleteDoc, doc,
  onSnapshot, writeBatch, serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const $ = (id) => document.getElementById(id);
const show = (id, on) => ($(id).hidden = !on);

// ---------- Theme (per device) ----------
const applyTheme = (t) => { document.documentElement.dataset.theme = t; localStorage.setItem("dashboard.theme", t); };
applyTheme(localStorage.getItem("dashboard.theme") ||
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
$("theme").onclick = () => applyTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark");

// ---------- Setup check ----------
if (firebaseConfig.apiKey.startsWith("YOUR_")) {
  show("setup", true);
  throw new Error("Fill in firebase-config.js first.");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ---------- State ----------
let todos = [];
let filter = "all";
let unsubscribe = null;
let uid = null;
const col = () => collection(db, "users", uid, "todos");
const today = () => new Date().toLocaleDateString("sv"); // YYYY-MM-DD in local time

// ---------- Clock ----------
function tick() {
  const now = new Date();
  const h = now.getHours();
  $("greeting").textContent = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("date").textContent = now.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  $("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
tick();
setInterval(tick, 15000);

// ---------- Auth ----------
let signUp = false;
$("auth-toggle").onclick = () => {
  signUp = !signUp;
  $("auth-submit").textContent = signUp ? "Create account" : "Sign in";
  $("auth-toggle").textContent = signUp ? "Have an account? Sign in" : "No account yet? Create one";
  $("password").autocomplete = signUp ? "new-password" : "current-password";
  $("auth-msg").textContent = "";
};

const friendly = (e) => ({
  "auth/invalid-credential": "Wrong email or password.",
  "auth/email-already-in-use": "That email already has an account. Sign in instead.",
  "auth/weak-password": "Password must be at least 6 characters.",
  "auth/invalid-email": "That email address looks invalid.",
  "auth/too-many-requests": "Too many attempts. Try again later.",
  "auth/operation-not-allowed": "Email/password sign-in is not enabled in Firebase yet.",
}[e.code] || e.message);

$("auth-form").onsubmit = async (e) => {
  e.preventDefault();
  $("auth-msg").textContent = "";
  try {
    const fn = signUp ? createUserWithEmailAndPassword : signInWithEmailAndPassword;
    await fn(auth, $("email").value.trim(), $("password").value);
  } catch (err) {
    $("auth-msg").textContent = friendly(err);
  }
};

$("logout").onclick = () => signOut(auth);

onAuthStateChanged(auth, (user) => {
  if (unsubscribe) { unsubscribe(); unsubscribe = null; }
  if (!user) {
    uid = null; todos = [];
    show("app", false); show("auth", true);
    return;
  }
  uid = user.uid;
  $("user").textContent = user.email;
  $("password").value = "";
  show("auth", false); show("app", true);
  $("sync").textContent = "· syncing…";
  unsubscribe = onSnapshot(col(), (snap) => {
    todos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    $("sync").textContent = snap.metadata.hasPendingWrites ? "· saving…" : "· synced";
    render();
  }, (err) => {
    $("sync").textContent = "· sync error: " + err.code;
  });
});

// ---------- Render ----------
function render() {
  const list = $("list");
  list.innerHTML = "";
  const order = { high: 0, med: 1, low: 2 };
  const shown = todos
    .filter((t) => filter === "all" || (filter === "done") === !!t.done)
    .sort((a, b) => (a.done - b.done) || order[a.priority] - order[b.priority]);

  for (const t of shown) {
    const li = document.createElement("li");
    if (t.done) li.className = "done";

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = !!t.done;
    cb.onchange = () => updateDoc(doc(col(), t.id), { done: cb.checked });

    const label = document.createElement("span");
    label.className = "label";
    label.textContent = t.text;

    const tag = document.createElement("span");
    tag.className = "tag " + t.priority;
    tag.textContent = t.priority === "med" ? "medium" : t.priority;

    li.append(cb, label, tag);

    if (t.due) {
      const due = document.createElement("span");
      due.className = "due" + (!t.done && t.due < today() ? " overdue" : "");
      due.textContent = t.due;
      li.append(due);
    }

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Delete";
    del.onclick = () => deleteDoc(doc(col(), t.id));
    li.append(del);

    list.append(li);
  }
  $("empty").hidden = shown.length > 0;

  const done = todos.filter((t) => t.done).length;
  const pct = todos.length ? Math.round((done / todos.length) * 100) : 0;
  $("s-total").textContent = todos.length;
  $("s-done").textContent = done;
  $("s-open").textContent = todos.length - done;
  $("s-overdue").textContent = todos.filter((t) => !t.done && t.due && t.due < today()).length;
  $("pct").textContent = pct + "%";
  $("bar").style.width = pct + "%";
}

// ---------- Actions ----------
$("form").onsubmit = async (e) => {
  e.preventDefault();
  const text = $("text").value.trim();
  if (!text || !uid) return;
  const data = { text, priority: $("priority").value, due: $("due").value, done: false, created: serverTimestamp() };
  e.target.reset();
  $("priority").value = "med";
  await addDoc(col(), data);
};

document.querySelectorAll(".chip[data-f]").forEach((b) => {
  b.onclick = () => {
    filter = b.dataset.f;
    document.querySelectorAll(".chip[data-f]").forEach((x) => x.classList.toggle("active", x === b));
    render();
  };
});

$("clear").onclick = async () => {
  const batch = writeBatch(db);
  todos.filter((t) => t.done).forEach((t) => batch.delete(doc(col(), t.id)));
  await batch.commit();
};
