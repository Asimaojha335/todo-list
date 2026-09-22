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
const filterButtons = document.querySelectorAll(".filter");
const toast = $("toast");

const STORAGE_KEY = "todo-tasks-v2";
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

let tasks = load();
let filter = "all";
let query = "";
let lastDeleted = null; // { task, index } for undo
let toastTimer = null;
let editingId = null;

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); } catch { /* storage may be unavailable */ }
}

const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

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
    // open tasks first, then by priority, then earliest due date
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
  check.addEventListener("change", () => {
    task.done = check.checked;
    save();
    render();
  });

  const body = document.createElement("div");
  body.className = "body";

  if (editingId === task.id) {
    const edit = document.createElement("input");
    edit.type = "text";
    edit.className = "edit-input";
    edit.value = task.text;
    edit.maxLength = 120;
    edit.setAttribute("aria-label", "Edit task");
    let finished = false; // Enter/Escape re-render the list, which also fires "blur"; only finish once
    const commit = (keep) => {
      if (finished) return;
      finished = true;
      const value = edit.value.trim();
      if (keep && value) task.text = value;
      editingId = null;
      save();
      render();
    };
    edit.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit(true);
      else if (e.key === "Escape") commit(false);
    });
    edit.addEventListener("blur", () => commit(true));
    body.appendChild(edit);
    requestAnimationFrame(() => { edit.focus(); edit.select(); });
  } else {
    const title = document.createElement("span"); // textContent keeps user input safe from HTML injection
    title.className = "title";
    title.textContent = task.text;
    title.title = "Double-click to edit";
    title.addEventListener("dblclick", () => startEdit(task.id));
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
  editBtn.addEventListener("click", () => startEdit(task.id));
  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon del";
  del.setAttribute("aria-label", `Delete "${task.text}"`);
  del.title = "Delete";
  del.textContent = "×";
  del.addEventListener("click", () => removeTask(task.id));
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

  empty.hidden = visible.length > 0;
  if (!visible.length) {
    empty.textContent = !total ? "Nothing here yet. Add your first task above."
      : query ? `No tasks match "${query}".`
      : filter === "done" ? "No completed tasks yet."
      : "You are all caught up!";
  }
}

/* ---------- actions ---------- */
function startEdit(id) {
  editingId = id;
  render();
}

function removeTask(id) {
  const index = tasks.findIndex((t) => t.id === id);
  if (index < 0) return;
  lastDeleted = { task: tasks[index], index };
  tasks.splice(index, 1);
  save();
  render();
  showToast(`Deleted "${lastDeleted.task.text.slice(0, 30)}${lastDeleted.task.text.length > 30 ? "..." : ""}"`);
}

function showToast(message) {
  $("toastText").textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; lastDeleted = null; }, 5000);
}

$("undoBtn").addEventListener("click", () => {
  if (!lastDeleted) return;
  tasks.splice(Math.min(lastDeleted.index, tasks.length), 0, lastDeleted.task);
  lastDeleted = null;
  toast.hidden = true;
  save();
  render();
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
  tasks.push({ id: newId(), text, done: false, priority: prioritySelect.value, due: dueInput.value || "" });
  input.value = "";
  dueInput.value = "";
  save();
  render();
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

clearDone.addEventListener("click", () => {
  tasks = tasks.filter((t) => !t.done);
  save();
  render();
});

$("themeBtn").addEventListener("click", () => {
  const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem("theme", next); } catch { /* storage may be unavailable */ }
});

$("today").textContent = new Date().toLocaleDateString("en-US", { weekday: "long", day: "numeric", month: "long" });
render();
