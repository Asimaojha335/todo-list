const $ = (id) => document.getElementById(id);
const form = $("taskForm");
const input = $("taskInput");
const prioritySelect = $("priority");
const dueInput = $("due");
const list = $("taskList");
const empty = $("empty");
const count = $("count");
const clearDone = $("clearDone");
const searchInput = $("search");
const formError = $("formError");
const apiError = $("apiError");
const filterButtons = document.querySelectorAll(".filter");
const toast = $("toast");
const submitBtn = form.querySelector(".btn-add");

const API_URL = "/api/tasks";
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

let tasks = [];          // loaded from the server
let filter = "all";
let query = "";
let lastDeleted = null;  // { text, priority, due } for undo (re-created as a new task)
let toastTimer = null;
let editingId = null;
let loaded = false;

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options && options.headers) },
  });
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* no body */
  }
  if (!res.ok) throw new Error((body && body.error) || `Request failed (${res.status})`);
  return body;
}

function showApiError(message) {
  apiError.textContent = message;
  apiError.hidden = false;
}
function clearApiError() {
  apiError.hidden = true;
  apiError.textContent = "";
}

function todayString() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function formatDue(value) {
  const today = todayString();
  const date = new Date(value + "T00:00:00");
  const diff = Math.round((date - new Date(today + "T00:00:00")) / 86400000);
  if (diff === 0) return "Due today";
  if (diff === 1) return "Due tomorrow";
  if (diff === -1) return "Due yesterday";
  const label = date.toLocaleDateString("en-US", { day: "numeric", month: "short" });
  return diff < 0 ? `Overdue since ${label}` : `Due ${label}`;
}

/* ---------- rendering ---------- */
function visibleTasks() {
  const q = query.trim().toLowerCase();
  return tasks
    .filter((t) => filter === "all" || (filter === "done" ? t.done : !t.done))
    .filter((t) => !q || t.text.toLowerCase().includes(q))
    .sort((a, b) =>
      Number(a.done) - Number(b.done) ||
      PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] ||
      (a.due || "9999").localeCompare(b.due || "9999")
    );
}

function renderTask(task) {
  const li = document.createElement("li");
  li.className = "task" + (task.done ? " done" : "");

  const check = document.createElement("input");
  check.type = "checkbox";
  check.className = "check";
  check.checked = task.done;
  check.setAttribute("aria-label", `Mark "${task.text}" as ${task.done ? "not done" : "done"}`);
  check.addEventListener("change", () => toggleDone(task, check.checked));

  const body = document.createElement("div");
  body.className = "body";

  if (editingId === task.id) {
    const edit = document.createElement("input");
    edit.type = "text";
    edit.className = "edit-input";
    edit.value = task.text;
    edit.maxLength = 120;
    edit.setAttribute("aria-label", "Edit task");
    let finished = false;
    const commit = (keep) => {
      if (finished) return;
      finished = true;
      const value = edit.value.trim();
      editingId = null;
      if (keep && value && value !== task.text) renameTask(task, value);
      else render();
    };
    edit.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit(true);
      else if (e.key === "Escape") commit(false);
    });
    edit.addEventListener("blur", () => commit(true));
    body.appendChild(edit);
    requestAnimationFrame(() => { edit.focus(); edit.select(); });
  } else {
    const title = document.createElement("span");
    title.className = "title";
    title.textContent = task.text;
    title.title = "Double-click to edit";
    title.addEventListener("dblclick", () => { editingId = task.id; render(); });
    body.appendChild(title);
  }

  const meta = document.createElement("div");
  meta.className = "meta";
  const tag = document.createElement("span");
  tag.className = `tag ${task.priority}`;
  tag.textContent = task.priority;
  meta.appendChild(tag);
  if (task.due) {
    const due = document.createElement("span");
    due.className = "due" + (!task.done && task.due < todayString() ? " overdue" : "");
    due.textContent = formatDue(task.due);
    meta.appendChild(due);
  }
  body.appendChild(meta);

  const actions = document.createElement("div");
  actions.className = "actions";
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "icon";
  editBtn.setAttribute("aria-label", `Edit "${task.text}"`);
  editBtn.title = "Edit";
  editBtn.textContent = "✎";
  editBtn.addEventListener("click", () => { editingId = task.id; render(); });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon del";
  del.setAttribute("aria-label", `Delete "${task.text}"`);
  del.title = "Delete";
  del.textContent = "×";
  del.addEventListener("click", () => removeTask(task));
  actions.append(editBtn, del);

  li.append(check, body, actions);
  return li;
}

function render() {
  list.innerHTML = "";
  const visible = visibleTasks();
  visible.forEach((task) => list.appendChild(renderTask(task)));

  const total = tasks.length;
  const done = tasks.filter((t) => t.done).length;
  const left = total - done;
  const pct = total ? Math.round((done / total) * 100) : 0;

  $("barFill").style.width = `${pct}%`;
  $("bar").setAttribute("aria-valuenow", String(pct));
  $("progressPct").textContent = `${pct}%`;
  $("progressLabel").textContent = total ? `${done} of ${total} completed` : "No tasks yet";
  count.textContent = `${left} task${left === 1 ? "" : "s"} left`;
  clearDone.disabled = done === 0;

  empty.hidden = !loaded || visible.length > 0;
  if (loaded && !visible.length) {
    empty.textContent = !total ? "Nothing here yet. Add your first task above."
      : query ? `No tasks match "${query}".`
      : filter === "done" ? "No completed tasks yet."
      : "You are all caught up!";
  }
}

/* ---------- server-backed actions ---------- */
async function loadTasks() {
  try {
    const data = await api(API_URL);
    tasks = data.tasks;
    loaded = true;
    clearApiError();
  } catch (err) {
    showApiError("Could not load tasks. The API or database may be unreachable.");
    console.error(err);
  }
  render();
}

async function addTask(text, priority, due) {
  submitBtn.disabled = true;
  try {
    const data = await api(API_URL, { method: "POST", body: JSON.stringify({ text, priority, due }) });
    tasks.unshift(data.task);
    clearApiError();
    render();
  } catch (err) {
    showApiError("Could not save that task. Please try again.");
    console.error(err);
  } finally {
    submitBtn.disabled = false;
  }
}

async function toggleDone(task, done) {
  task.done = done; // optimistic
  render();
  try {
    await api(`${API_URL}/${task.id}`, { method: "PATCH", body: JSON.stringify({ done }) });
    clearApiError();
  } catch (err) {
    task.done = !done; // revert
    showApiError("Could not update that task.");
    render();
    console.error(err);
  }
}

async function renameTask(task, text) {
  const previous = task.text;
  task.text = text;
  render();
  try {
    await api(`${API_URL}/${task.id}`, { method: "PATCH", body: JSON.stringify({ text }) });
    clearApiError();
  } catch (err) {
    task.text = previous;
    showApiError("Could not rename that task.");
    render();
    console.error(err);
  }
}

async function removeTask(task) {
  tasks = tasks.filter((t) => t.id !== task.id);
  lastDeleted = { text: task.text, priority: task.priority, due: task.due };
  render();
  try {
    await api(`${API_URL}/${task.id}`, { method: "DELETE" });
    clearApiError();
    showToast(`Deleted "${task.text.slice(0, 30)}${task.text.length > 30 ? "..." : ""}"`);
  } catch (err) {
    tasks.push(task);
    lastDeleted = null;
    showApiError("Could not delete that task.");
    render();
    console.error(err);
  }
}

function showToast(message) {
  $("toastText").textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; lastDeleted = null; }, 5000);
}

$("undoBtn").addEventListener("click", async () => {
  if (!lastDeleted) return;
  const { text, priority, due } = lastDeleted;
  lastDeleted = null;
  toast.hidden = true;
  await addTask(text, priority, due); // re-creates it as a new task (the old id is gone for good)
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = input.value.trim();
  if (!text) {
    formError.textContent = "Please type a task first.";
    input.focus();
    return;
  }
  formError.textContent = "";
  addTask(text, prioritySelect.value, dueInput.value || "");
  input.value = "";
  dueInput.value = "";
  input.focus();
});

input.addEventListener("input", () => { if (input.value.trim()) formError.textContent = ""; });

filterButtons.forEach((btn) =>
  btn.addEventListener("click", () => {
    filter = btn.dataset.filter;
    filterButtons.forEach((b) => b.classList.toggle("active", b === btn));
    render();
  })
);

searchInput.addEventListener("input", () => {
  query = searchInput.value;
  render();
});

clearDone.addEventListener("click", async () => {
  const done = tasks.filter((t) => t.done);
  if (!done.length) return;
  clearDone.disabled = true;
  const results = await Promise.allSettled(done.map((t) => api(`${API_URL}/${t.id}`, { method: "DELETE" })));
  const failedIds = new Set(done.filter((_, i) => results[i].status === "rejected").map((t) => t.id));
  if (failedIds.size) showApiError("Some completed tasks could not be cleared.");
  else clearApiError();
  tasks = tasks.filter((t) => !t.done || failedIds.has(t.id));
  render();
});

$("themeBtn").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch { /* storage may be unavailable */ }
});

$("today").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
empty.textContent = "Loading tasks...";
empty.hidden = false;
render();
loadTasks();
