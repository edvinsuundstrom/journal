// ============================================================================
// Recovery Journal — app.js
//
// This file does four jobs:
//   1. Sign in / sign out (using Supabase Auth)
//   2. Load the entry for whichever date is selected, and let you move between days
//   3. Save the form as one row per date (an "upsert": update if a row for that
//      date already exists, insert a new one if it doesn't)
//   4. Export a date range of entries as a CSV file
// ============================================================================

// --- Guard against an unfilled config.js, so failures are easy to diagnose ---
if (SUPABASE_URL.includes("YOUR-PROJECT") || SUPABASE_ANON_KEY.includes("YOUR-ANON")) {
  document.body.innerHTML =
    '<div style="max-width:480px;margin:60px auto;padding:24px;font-family:sans-serif;line-height:1.5;">' +
    "<h2>Setup needed</h2>" +
    "<p>Open <code>config.js</code> and paste in your own Supabase project URL and anon key. " +
    "See README.md for step-by-step instructions.</p></div>";
  throw new Error("config.js has not been filled in yet");
}

// `supabase` here is the global object created by the CDN script tag in index.html.
// We use it once, to create our own client, which we call `sb` for the rest of this file.
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const TABLE = "journal_entries";

// Track which user is signed in, and which date is currently shown on screen.
let currentUser = null;
let currentDate = todayStr();

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const loginView = document.getElementById("login-view");
const appView = document.getElementById("app-view");
const loginForm = document.getElementById("login-form");
const loginError = document.getElementById("login-error");
const logoutBtn = document.getElementById("logout-btn");

const dateInput = document.getElementById("date-input");
const prevDayBtn = document.getElementById("prev-day");
const nextDayBtn = document.getElementById("next-day");
const todayBtn = document.getElementById("today-btn");
const entryStatus = document.getElementById("entry-status");

// Every card has its own "Save section" button + status text next to it.
const sectionSaveButtons = document.querySelectorAll(".section-save-btn");

const exportStartInput = document.getElementById("export-start");
const exportEndInput = document.getElementById("export-end");
const exportBtn = document.getElementById("export-btn");
const exportStatus = document.getElementById("export-status");

// Slider fields need special handling (see NOTE below), so list them once here.
const SLIDER_FIELDS = [
  "sleep_hours",
  "work_hours",
  "school_hours",
  "hamstring_pain",
  "wrist_pain",
  "overall_physical_status",
  "overall_stress",
  "mood_during_day",
];

// ---------------------------------------------------------------------------
// Date helpers
// A plain `new Date().toISOString()` reports UTC time, which can roll over to
// the "wrong" day depending on where you are relative to UTC. These helpers
// work with the browser's local date instead, so "today" always means today
// where you actually are.
// ---------------------------------------------------------------------------
function todayStr() {
  return toDateStr(new Date());
}

function toDateStr(d) {
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shiftDate(dateStr, deltaDays) {
  const d = parseDateStr(dateStr);
  d.setDate(d.getDate() + deltaDays);
  return toDateStr(d);
}

function formatDateLong(dateStr) {
  return parseDateStr(dateStr).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
async function init() {
  const { data } = await sb.auth.getSession();
  if (data.session) {
    await enterApp(data.session.user);
  } else {
    showLogin();
  }
}

function showLogin() {
  loginView.hidden = false;
  appView.hidden = true;
}

async function enterApp(user) {
  currentUser = user;
  loginView.hidden = true;
  appView.hidden = false;

  dateInput.value = currentDate;
  exportStartInput.value = shiftDate(currentDate, -6);
  exportEndInput.value = currentDate;

  await loadEntryForDate(currentDate);

  // workouts.js defines this once it's loaded; it sets up the Workouts tab
  // (exercise list, today's session, etc.) the first time you sign in.
  if (typeof initWorkoutsPage === "function") {
    initWorkoutsPage(user);
  }
}

// ---------------------------------------------------------------------------
// Tab switching (Journal <-> Workouts)
// ---------------------------------------------------------------------------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    const targetId = btn.dataset.tab;
    document.querySelectorAll(".page").forEach((page) => {
      page.hidden = page.id !== targetId;
    });
  });
});

loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  loginError.hidden = true;

  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  if (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
    return;
  }
  await enterApp(data.user);
});

logoutBtn.addEventListener("click", async () => {
  await sb.auth.signOut();
  currentUser = null;
  showLogin();
});

// ---------------------------------------------------------------------------
// Date navigation
// ---------------------------------------------------------------------------
dateInput.addEventListener("change", () => {
  currentDate = dateInput.value;
  loadEntryForDate(currentDate);
});

prevDayBtn.addEventListener("click", () => {
  currentDate = shiftDate(currentDate, -1);
  dateInput.value = currentDate;
  loadEntryForDate(currentDate);
});

nextDayBtn.addEventListener("click", () => {
  currentDate = shiftDate(currentDate, 1);
  dateInput.value = currentDate;
  loadEntryForDate(currentDate);
});

todayBtn.addEventListener("click", () => {
  currentDate = todayStr();
  dateInput.value = currentDate;
  loadEntryForDate(currentDate);
});

// ---------------------------------------------------------------------------
// Load an entry (one row for the given date, if it exists) into the form
// ---------------------------------------------------------------------------
async function loadEntryForDate(dateStr) {
  entryStatus.textContent = "Loading…";

  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("entry_date", dateStr)
    .maybeSingle();

  if (error) {
    entryStatus.textContent = "Couldn't load that date: " + error.message;
    return;
  }

  if (data) {
    populateForm(data);
    entryStatus.textContent = `Editing your saved entry for ${formatDateLong(dateStr)}`;
  } else {
    resetForm();
    entryStatus.textContent = `No entry yet for ${formatDateLong(dateStr)} — fill in whatever you have`;
  }
  document.querySelectorAll(".section-save-status").forEach((el) => (el.textContent = ""));
}

// ---------------------------------------------------------------------------
// Pill groups & radio lists: generic click handling
// Clicking a pill/row makes it the only "active" one among its siblings.
// Clicking an already-active one clears the selection (useful since you may
// not have an answer yet for every field every time you open the journal).
// ---------------------------------------------------------------------------
document.querySelectorAll(".pill-group").forEach((group) => {
  group.addEventListener("click", (e) => {
    const btn = e.target.closest(".pill");
    if (!btn) return;
    const wasActive = btn.classList.contains("active");
    group.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
    if (!wasActive) btn.classList.add("active");
  });
});

document.querySelectorAll(".radio-list").forEach((list) => {
  list.addEventListener("click", (e) => {
    const row = e.target.closest(".radio-row");
    if (!row) return;
    const wasActive = row.classList.contains("active");
    list.querySelectorAll(".radio-row").forEach((r) => r.classList.remove("active"));
    if (!wasActive) row.classList.add("active");
  });
  // Basic keyboard support (Enter/Space) since these rows aren't native inputs.
  list.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      e.target.click();
    }
  });
});

// ---------------------------------------------------------------------------
// Sliders
// NOTE: a native <input type="range"> always has *some* numeric value — there
// is no built-in "empty" state. That's a problem here because you fill this
// journal in at different times of day, so a slider you simply haven't
// touched yet needs to be distinguishable from a deliberate "0". We solve
// this with a `data-touched` flag: it flips to "true" the first time you move
// a slider (or when a saved value is loaded from the database), and only
// touched sliders are included when we collect the form for saving.
// ---------------------------------------------------------------------------
SLIDER_FIELDS.forEach((field) => {
  const slider = document.getElementById(`${field}-slider`);
  const valueLabel = document.getElementById(`${field}-value`);
  slider.addEventListener("input", () => {
    slider.dataset.touched = "true";
    valueLabel.textContent = slider.value;
  });
});

// ---------------------------------------------------------------------------
// Collect the current form into a row object ready for Supabase
// ---------------------------------------------------------------------------
function collectFormData() {
  const row = {
    user_id: currentUser.id,
    entry_date: currentDate,
  };

  // Pill groups
  row.sleep_quality = getPillValue("sleep_quality", parseInt);
  row.rehab_done = getPillValue("rehab_done", (v) => v === "true");

  // Radio lists
  row.food_quality = getRadioValue("food_quality");
  row.knee_swollen = getRadioValue("knee_swollen");
  row.progress_last_week = getRadioValue("progress_last_week");

  // Sliders (null if never touched this session and not loaded from the DB)
  SLIDER_FIELDS.forEach((field) => {
    const slider = document.getElementById(`${field}-slider`);
    row[field] = slider.dataset.touched === "true" ? parseFloat(slider.value) : null;
  });

  // Plain text / number inputs
  row.steps = emptyToNull(document.getElementById("steps-input").value, parseInt);
  row.knee_status = emptyToNull(document.getElementById("knee-status-input").value);
  row.knee_issues = emptyToNull(document.getElementById("knee-issues-input").value);
  row.exercises_done = emptyToNull(document.getElementById("exercises-done-input").value);
  row.exercise_note = emptyToNull(document.getElementById("exercise-note-input").value);
  row.other_pain = emptyToNull(document.getElementById("other-pain-input").value);

  return row;
}

function getPillValue(field, transform) {
  const group = document.querySelector(`.pill-group[data-field="${field}"]`);
  const active = group.querySelector(".pill.active");
  return active ? transform(active.dataset.value) : null;
}

function getRadioValue(field) {
  const list = document.querySelector(`.radio-list[data-field="${field}"]`);
  const active = list.querySelector(".radio-row.active");
  return active ? active.dataset.value : null;
}

function emptyToNull(value, transform) {
  if (value === "" || value === null || value === undefined) return null;
  return transform ? transform(value) : value;
}

// ---------------------------------------------------------------------------
// Populate the form from a saved row, and reset it to blank
// ---------------------------------------------------------------------------
function populateForm(data) {
  setPillValue("sleep_quality", data.sleep_quality);
  setPillValue("rehab_done", data.rehab_done === null ? null : String(data.rehab_done));

  setRadioValue("food_quality", data.food_quality);
  setRadioValue("knee_swollen", data.knee_swollen);
  setRadioValue("progress_last_week", data.progress_last_week);

  SLIDER_FIELDS.forEach((field) => {
    const slider = document.getElementById(`${field}-slider`);
    const valueLabel = document.getElementById(`${field}-value`);
    const val = data[field];
    if (val === null || val === undefined) {
      slider.value = 0;
      slider.dataset.touched = "false";
      valueLabel.textContent = "–";
    } else {
      slider.value = val;
      slider.dataset.touched = "true";
      valueLabel.textContent = val;
    }
  });

  document.getElementById("steps-input").value = data.steps ?? "";
  document.getElementById("knee-status-input").value = data.knee_status ?? "";
  document.getElementById("knee-issues-input").value = data.knee_issues ?? "";
  document.getElementById("exercises-done-input").value = data.exercises_done ?? "";
  document.getElementById("exercise-note-input").value = data.exercise_note ?? "";
  document.getElementById("other-pain-input").value = data.other_pain ?? "";
}

function resetForm() {
  document.querySelectorAll(".pill.active, .radio-row.active").forEach((el) =>
    el.classList.remove("active")
  );

  SLIDER_FIELDS.forEach((field) => {
    const slider = document.getElementById(`${field}-slider`);
    document.getElementById(`${field}-value`).textContent = "–";
    slider.value = 0;
    slider.dataset.touched = "false";
  });

  [
    "steps-input",
    "knee-status-input",
    "knee-issues-input",
    "exercises-done-input",
    "exercise-note-input",
    "other-pain-input",
  ].forEach((id) => (document.getElementById(id).value = ""));
}

function setPillValue(field, value) {
  const group = document.querySelector(`.pill-group[data-field="${field}"]`);
  const hasValue = value !== null && value !== undefined && value !== "";
  group.querySelectorAll(".pill").forEach((p) => {
    p.classList.toggle("active", hasValue && p.dataset.value === String(value));
  });
}

function setRadioValue(field, value) {
  const list = document.querySelector(`.radio-list[data-field="${field}"]`);
  const hasValue = value !== null && value !== undefined && value !== "";
  list.querySelectorAll(".radio-row").forEach((r) => {
    r.classList.toggle("active", hasValue && r.dataset.value === value);
  });
}

// ---------------------------------------------------------------------------
// Save (upsert: insert a new row, or update the existing one for this date)
//
// Every "Save section" button calls this same function. It always saves the
// *whole* form, not just the fields in that one card — that's what "upsert"
// needs: if it only sent the fields from one section, the other columns
// would be missing from the request and (depending on how the save is
// written) could wipe out values you already saved earlier for this date.
// Sending the whole form every time keeps every section's data intact no
// matter which button you clicked. The per-section buttons are really just
// a convenience so you don't have to scroll to the bottom to save.
// ---------------------------------------------------------------------------
sectionSaveButtons.forEach((btn) => {
  btn.addEventListener("click", () => saveEntry(btn));
});

async function saveEntry(triggerBtn) {
  const statusEl = triggerBtn.parentElement.querySelector(".section-save-status");

  triggerBtn.disabled = true;
  if (statusEl) statusEl.textContent = "Saving…";

  const row = collectFormData();

  const { error } = await sb
    .from(TABLE)
    .upsert(row, { onConflict: "user_id,entry_date" });

  triggerBtn.disabled = false;

  if (error) {
    if (statusEl) statusEl.textContent = "Couldn't save: " + error.message;
    return;
  }

  const now = new Date();
  const savedText = `Saved ✓ at ${now.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
  if (statusEl) statusEl.textContent = savedText;
  entryStatus.textContent = `Editing your saved entry for ${formatDateLong(currentDate)}`;
}

// ---------------------------------------------------------------------------
// CSV export for a date range
// ---------------------------------------------------------------------------
const CSV_COLUMNS = [
  ["entry_date", "Date"],
  ["sleep_hours", "Sleep hours"],
  ["sleep_quality", "Sleep quality"],
  ["steps", "Steps"],
  ["food_quality", "Food quality"],
  ["knee_swollen", "Knee swelling"],
  ["knee_status", "Knee status"],
  ["knee_issues", "Issues with knee"],
  ["rehab_done", "Rehab done as planned"],
  ["exercises_done", "Exercises done"],
  ["exercise_note", "Exercise note"],
  ["progress_last_week", "Progress since last week"],
  ["work_hours", "Work hours"],
  ["school_hours", "School hours"],
  ["hamstring_pain", "Hamstring pain"],
  ["wrist_pain", "Wrist pain"],
  ["other_pain", "Other injuries/pain"],
  ["overall_physical_status", "Overall physical status"],
  ["overall_stress", "Overall stress"],
  ["mood_during_day", "Mood during the day"],
];

exportBtn.addEventListener("click", async () => {
  const start = exportStartInput.value;
  const end = exportEndInput.value;

  if (!start || !end) {
    exportStatus.textContent = "Pick a start and end date first.";
    return;
  }

  exportStatus.textContent = "Fetching…";

  const { data, error } = await sb
    .from(TABLE)
    .select("*")
    .eq("user_id", currentUser.id)
    .gte("entry_date", start)
    .lte("entry_date", end)
    .order("entry_date", { ascending: true });

  if (error) {
    exportStatus.textContent = "Couldn't export: " + error.message;
    return;
  }

  if (!data || data.length === 0) {
    exportStatus.textContent = "No entries in that range.";
    return;
  }

  const csv = toCSV(data);
  downloadCSV(csv, `recovery-journal_${start}_to_${end}.csv`);
  exportStatus.textContent = `Downloaded ${data.length} entr${data.length === 1 ? "y" : "ies"}.`;
});

function toCSV(rows) {
  const header = CSV_COLUMNS.map((c) => csvEscape(c[1])).join(",");
  const lines = rows.map((row) =>
    CSV_COLUMNS.map((c) => csvEscape(formatCsvValue(row[c[0]]))).join(",")
  );
  return [header, ...lines].join("\r\n");
}

function formatCsvValue(v) {
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return v;
}

function csvEscape(val) {
  if (val === null || val === undefined) return "";
  const str = String(val);
  if (/[",\n\r]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

function downloadCSV(csvString, filename) {
  const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
init();
