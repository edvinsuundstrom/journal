// ============================================================================
// Recovery Journal — workouts.js
//
// Adds the "Workouts" tab. Reuses `sb` (the Supabase client), `currentUser`,
// and the date helpers (todayStr, toDateStr, parseDateStr, shiftDate,
// formatDateLong) and CSV helpers (csvEscape, downloadCSV) that app.js
// already defines — this file is loaded after app.js in index.html, and
// both are plain <script> tags sharing one global scope, so nothing needs
// to be re-declared.
//
// Data model (see supabase-schema-workouts.sql):
//   exercises          — your reusable exercise library
//   workout_sessions   — one row per date you log a workout
//   session_exercises  — which exercises were done in a session
//   exercise_sets      — individual sets; each is its own row, so removing
//                        a set is a real delete, not just clearing a value
// ============================================================================

const EXERCISES_TABLE = "exercises";
const SESSIONS_TABLE = "workout_sessions";
const SESSION_EXERCISES_TABLE = "session_exercises";
const SETS_TABLE = "exercise_sets";

const TRACKING_LABELS = {
  reps: "Reps",
  weight_reps: "Weight + reps",
  time: "Time",
  weight_time: "Weight + time",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let workoutExercises = []; // your exercise library: [{id, exercise_name}, ...]
let currentWorkoutDate = todayStr();
let currentSessionId = null;
let sessionExercises = []; // exercises added to the currently-open session

// ---------------------------------------------------------------------------
// DOM references
// ---------------------------------------------------------------------------
const wDateInput = document.getElementById("w-date-input");
const wPrevDayBtn = document.getElementById("w-prev-day");
const wNextDayBtn = document.getElementById("w-next-day");
const wTodayBtn = document.getElementById("w-today-btn");
const sessionStatus = document.getElementById("session-status");

const exerciseNameInput = document.getElementById("exercise-name-input");
const exerciseOptionsDatalist = document.getElementById("exercise-options");
const trackingTypeGroup = document.getElementById("tracking-type-group");
const addExerciseBtn = document.getElementById("add-exercise-btn");
const addExerciseStatus = document.getElementById("add-exercise-status");

const sessionExercisesList = document.getElementById("session-exercises-list");

const sessionCategorySelect = document.getElementById("session-category-select");
const categoryStatus = document.getElementById("category-status");

const wExportStartInput = document.getElementById("w-export-start");
const wExportEndInput = document.getElementById("w-export-end");
const wExportBtn = document.getElementById("w-export-btn");
const wExportStatus = document.getElementById("w-export-status");

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function parseNumOrNull(value, isInt) {
  if (value === "" || value === null || value === undefined) return null;
  const n = isInt ? parseInt(value, 10) : parseFloat(value);
  return Number.isNaN(n) ? null : n;
}

// Standard Epley formula: 1RM = weight × (1 + reps/30)
function calculateOneRepMax(weight, reps) {
  if (weight === null || reps === null || reps <= 0) return null;
  return Math.round(weight * (1 + reps / 30) * 10) / 10;
}

// ---------------------------------------------------------------------------
// Init — called once from app.js after you sign in
// ---------------------------------------------------------------------------
async function initWorkoutsPage() {
  wDateInput.value = currentWorkoutDate;
  wExportStartInput.value = shiftDate(currentWorkoutDate, -27);
  wExportEndInput.value = currentWorkoutDate;

  await loadExerciseList();
  await loadWorkoutSession(currentWorkoutDate);
}

// ---------------------------------------------------------------------------
// Exercise library (the reusable list you pick from)
// ---------------------------------------------------------------------------
async function loadExerciseList() {
  const { data, error } = await sb
    .from(EXERCISES_TABLE)
    .select("id, exercise_name")
    .eq("user_id", currentUser.id)
    .order("exercise_name", { ascending: true });

  if (!error) {
    workoutExercises = data || [];
    refreshExerciseDatalist();
  }
}

function refreshExerciseDatalist() {
  exerciseOptionsDatalist.innerHTML = workoutExercises
    .map((e) => `<option value="${escapeHtml(e.exercise_name)}"></option>`)
    .join("");
}

// ---------------------------------------------------------------------------
// Date navigation (mirrors the journal page's date nav)
// ---------------------------------------------------------------------------
wDateInput.addEventListener("change", () => {
  currentWorkoutDate = wDateInput.value;
  loadWorkoutSession(currentWorkoutDate);
});

wPrevDayBtn.addEventListener("click", () => {
  currentWorkoutDate = shiftDate(currentWorkoutDate, -1);
  wDateInput.value = currentWorkoutDate;
  loadWorkoutSession(currentWorkoutDate);
});

wNextDayBtn.addEventListener("click", () => {
  currentWorkoutDate = shiftDate(currentWorkoutDate, 1);
  wDateInput.value = currentWorkoutDate;
  loadWorkoutSession(currentWorkoutDate);
});

wTodayBtn.addEventListener("click", () => {
  currentWorkoutDate = todayStr();
  wDateInput.value = currentWorkoutDate;
  loadWorkoutSession(currentWorkoutDate);
});

// ---------------------------------------------------------------------------
// Load (or start blank for) the session on the selected date
// ---------------------------------------------------------------------------
async function loadWorkoutSession(dateStr) {
  sessionStatus.textContent = "Loading…";
  sessionExercisesList.innerHTML = "";
  sessionExercises = [];
  addExerciseStatus.textContent = "";
  categoryStatus.textContent = "";

  const { data: session, error } = await sb
    .from(SESSIONS_TABLE)
    .select("*")
    .eq("user_id", currentUser.id)
    .eq("session_date", dateStr)
    .maybeSingle();

  if (error) {
    sessionStatus.textContent = "Couldn't load that date: " + error.message;
    return;
  }

  if (session) {
    currentSessionId = session.id;
    sessionCategorySelect.value = session.category || "";
    sessionStatus.textContent = `Session for ${formatDateLong(dateStr)}`;
    await loadSessionExercises();
  } else {
    currentSessionId = null;
    sessionCategorySelect.value = "";
    sessionStatus.textContent = `No session yet for ${formatDateLong(dateStr)} — add an exercise to start one`;
  }
}

async function loadSessionExercises() {
  const { data: rows, error } = await sb
    .from(SESSION_EXERCISES_TABLE)
    .select("id, exercise_id, tracking_type, notes, sort_order")
    .eq("session_id", currentSessionId)
    .order("sort_order", { ascending: true });

  if (error || !rows) return;

  for (const row of rows) {
    const exercise = workoutExercises.find((e) => e.id === row.exercise_id);
    const { data: sets } = await sb
      .from(SETS_TABLE)
      .select("*")
      .eq("session_exercise_id", row.id)
      .order("set_number", { ascending: true });

    const entry = {
      id: row.id,
      exercise_id: row.exercise_id,
      exercise_name: exercise ? exercise.exercise_name : "Exercise",
      tracking_type: row.tracking_type,
      setRows: [],
    };
    sessionExercises.push(entry);
    renderExerciseCard(entry);
    (sets || []).forEach((set) => addSetRow(entry, set, null));
  }
}

// ---------------------------------------------------------------------------
// Add an exercise to the session
// ---------------------------------------------------------------------------
addExerciseBtn.addEventListener("click", handleAddExercise);

trackingTypeGroup.addEventListener("click", (e) => {
  const btn = e.target.closest(".pill");
  if (!btn) return;
  trackingTypeGroup.querySelectorAll(".pill").forEach((p) => p.classList.remove("active"));
  btn.classList.add("active");
});

async function handleAddExercise() {
  const name = exerciseNameInput.value.trim();
  const trackingBtn = trackingTypeGroup.querySelector(".pill.active");

  if (!name) {
    addExerciseStatus.textContent = "Type an exercise name first.";
    return;
  }
  if (!trackingBtn) {
    addExerciseStatus.textContent = "Pick a tracking type first.";
    return;
  }
  const trackingType = trackingBtn.dataset.value;

  addExerciseBtn.disabled = true;
  addExerciseStatus.textContent = "Adding…";

  // Find the exercise in your library, or create it if this is the first time.
  let exercise = workoutExercises.find(
    (e) => e.exercise_name.toLowerCase() === name.toLowerCase()
  );
  if (!exercise) {
    const { data, error } = await sb
      .from(EXERCISES_TABLE)
      .upsert(
        { user_id: currentUser.id, exercise_name: name },
        { onConflict: "user_id,exercise_name" }
      )
      .select()
      .single();
    if (error) {
      addExerciseStatus.textContent = "Couldn't add exercise: " + error.message;
      addExerciseBtn.disabled = false;
      return;
    }
    exercise = data;
    workoutExercises.push(exercise);
    workoutExercises.sort((a, b) => a.exercise_name.localeCompare(b.exercise_name));
    refreshExerciseDatalist();
  }

  // Make sure a session exists for this date.
  if (!currentSessionId) {
    const { data, error } = await sb
      .from(SESSIONS_TABLE)
      .upsert(
        { user_id: currentUser.id, session_date: currentWorkoutDate },
        { onConflict: "user_id,session_date" }
      )
      .select()
      .single();
    if (error) {
      addExerciseStatus.textContent = "Couldn't start session: " + error.message;
      addExerciseBtn.disabled = false;
      return;
    }
    currentSessionId = data.id;
    sessionStatus.textContent = `Session for ${formatDateLong(currentWorkoutDate)}`;
  }

  const { data: seData, error: seError } = await sb
    .from(SESSION_EXERCISES_TABLE)
    .insert({
      session_id: currentSessionId,
      user_id: currentUser.id,
      exercise_id: exercise.id,
      tracking_type: trackingType,
      sort_order: sessionExercises.length,
    })
    .select()
    .single();

  addExerciseBtn.disabled = false;

  if (seError) {
    addExerciseStatus.textContent = "Couldn't add exercise to session: " + seError.message;
    return;
  }

  const entry = {
    id: seData.id,
    exercise_id: exercise.id,
    exercise_name: exercise.exercise_name,
    tracking_type: trackingType,
    setRows: [],
  };
  sessionExercises.push(entry);
  renderExerciseCard(entry);

  // Prefill: pull sets from the most recent past session with this exercise.
  const prevSets = await getPreviousSets(exercise.id);
  if (prevSets && prevSets.length > 0) {
    prevSets.forEach((prevSet) => addSetRow(entry, null, prevSet));
  } else {
    addSetRow(entry, null, null); // one blank set to start
  }

  exerciseNameInput.value = "";
  trackingBtn.classList.remove("active");
  addExerciseStatus.textContent = `Added ${exercise.exercise_name}.`;
}

async function getPreviousSets(exerciseId) {
  const { data, error } = await sb
    .from(SESSION_EXERCISES_TABLE)
    .select("id, workout_sessions!inner(session_date)")
    .eq("exercise_id", exerciseId)
    .eq("user_id", currentUser.id)
    .order("session_date", { foreignTable: "workout_sessions", ascending: false })
    .limit(8);

  if (error || !data) return null;

  const prev = data.find((se) => se.workout_sessions.session_date < currentWorkoutDate);
  if (!prev) return null;

  const { data: sets } = await sb
    .from(SETS_TABLE)
    .select("*")
    .eq("session_exercise_id", prev.id)
    .order("set_number", { ascending: true });

  return sets;
}

// ---------------------------------------------------------------------------
// Rendering an exercise card
// ---------------------------------------------------------------------------
function renderExerciseCard(entry) {
  const card = document.createElement("section");
  card.className = "card exercise-card";
  card.innerHTML = `
    <div class="exercise-card-header">
      <h3>${escapeHtml(entry.exercise_name)} <span class="badge">${TRACKING_LABELS[entry.tracking_type]}</span></h3>
      <button type="button" class="btn-icon remove-exercise-btn" aria-label="Remove exercise">×</button>
    </div>
    <div class="sets-list"></div>
    <button type="button" class="btn-secondary add-set-btn full-width">+ Add set</button>
    <div class="field">
      <label>Note</label>
      <textarea class="exercise-note-textarea" rows="2" placeholder="optional note"></textarea>
    </div>
  `;
  entry.cardEl = card;
  entry.setsListEl = card.querySelector(".sets-list");

  const noteInput = card.querySelector(".exercise-note-textarea");
  noteInput.value = entry.notes || "";
  const saveNote = debounce(async () => {
    await sb.from(SESSION_EXERCISES_TABLE).update({ notes: noteInput.value || null }).eq("id", entry.id);
  }, 500);
  noteInput.addEventListener("input", saveNote);

  card.querySelector(".remove-exercise-btn").addEventListener("click", () => removeExercise(entry));
  card.querySelector(".add-set-btn").addEventListener("click", () => addSetRow(entry, null, null));

  sessionExercisesList.appendChild(card);
}

async function removeExercise(entry) {
  // ON DELETE CASCADE on exercise_sets.session_exercise_id means this also
  // removes every set that belonged to it — no orphaned rows left behind.
  await sb.from(SESSION_EXERCISES_TABLE).delete().eq("id", entry.id);
  entry.cardEl.remove();
  sessionExercises = sessionExercises.filter((e) => e !== entry);
}

// ---------------------------------------------------------------------------
// Rendering a single set row
//
// `existingSet` (a saved row from the DB) shows real values.
// `prefillSet` (a set from your last session with this exercise) shows as
// gray placeholder text — type over it to change it, or just move to the
// next field to accept it: on blur, an empty field copies its placeholder
// into the real value and saves it.
// ---------------------------------------------------------------------------
function fieldConfigFor(trackingType) {
  switch (trackingType) {
    case "reps":
      return [{ key: "reps", label: "Reps", isInt: true }];
    case "weight_reps":
      return [
        { key: "weight", label: "Weight", isInt: false },
        { key: "reps", label: "Reps", isInt: true },
      ];
    case "time":
      return [{ key: "time_seconds", label: "Seconds", isInt: false }];
    case "weight_time":
      return [
        { key: "weight", label: "Weight", isInt: false },
        { key: "time_seconds", label: "Seconds", isInt: false },
      ];
    default:
      return [];
  }
}

function addSetRow(entry, existingSet, prefillSet) {
  const rowState = {
    id: existingSet ? existingSet.id : null,
    set_number: existingSet ? existingSet.set_number : entry.setRows.length + 1,
  };

  const fields = fieldConfigFor(entry.tracking_type);
  const showOneRepMax = entry.tracking_type === "weight_reps";

  const row = document.createElement("div");
  row.className = "set-row";

  const inputsHtml = fields
    .map((f) => {
      const existingVal = existingSet ? existingSet[f.key] : null;
      const prefillVal = prefillSet ? prefillSet[f.key] : null;
      const valueAttr = existingVal !== null && existingVal !== undefined ? `value="${existingVal}"` : "";
      const placeholderAttr =
        !existingVal && prefillVal !== null && prefillVal !== undefined
          ? `placeholder="${prefillVal}" data-prefill="${prefillVal}"`
          : `placeholder="${f.label}"`;
      return `<input type="number" step="any" inputmode="decimal" data-key="${f.key}" ${valueAttr} ${placeholderAttr} aria-label="${f.label}" />`;
    })
    .join("");

  row.innerHTML = `
    <span class="set-number">${rowState.set_number}</span>
    ${inputsHtml}
    ${showOneRepMax ? '<span class="one-rep-max"></span>' : ""}
    <button type="button" class="remove-set-btn" aria-label="Remove set">×</button>
  `;

  entry.setsListEl.appendChild(row);
  entry.setRows.push(rowState);

  const oneRepMaxLabel = row.querySelector(".one-rep-max");
  if (existingSet && existingSet.one_rep_max != null && oneRepMaxLabel) {
    oneRepMaxLabel.textContent = `1RM ${existingSet.one_rep_max}`;
  }

  const saveSet = debounce(() => persistSet(entry, rowState, row), 500);

  row.querySelectorAll("input").forEach((input) => {
    // Live 1RM preview as you type (no need to wait for the debounce/save).
    input.addEventListener("input", () => {
      updateLiveOneRepMax(entry, row);
      saveSet();
    });
    // Accept a gray placeholder by tabbing/clicking away without typing.
    input.addEventListener("blur", () => {
      if (input.value === "" && input.dataset.prefill) {
        input.value = input.dataset.prefill;
        updateLiveOneRepMax(entry, row);
        persistSet(entry, rowState, row);
      }
    });
  });

  row.querySelector(".remove-set-btn").addEventListener("click", () => removeSet(entry, rowState, row));

  updateLiveOneRepMax(entry, row);
}

function updateLiveOneRepMax(entry, row) {
  if (entry.tracking_type !== "weight_reps") return;
  const weight = parseNumOrNull(row.querySelector('[data-key="weight"]').value, false);
  const reps = parseNumOrNull(row.querySelector('[data-key="reps"]').value, true);
  const oneRepMax = calculateOneRepMax(weight, reps);
  const label = row.querySelector(".one-rep-max");
  if (label) label.textContent = oneRepMax !== null ? `1RM ${oneRepMax}` : "";
}

async function persistSet(entry, rowState, row) {
  const fields = fieldConfigFor(entry.tracking_type);
  const payload = { weight: null, reps: null, time_seconds: null };
  fields.forEach((f) => {
    payload[f.key] = parseNumOrNull(row.querySelector(`[data-key="${f.key}"]`).value, f.isInt);
  });

  const oneRepMax =
    entry.tracking_type === "weight_reps" ? calculateOneRepMax(payload.weight, payload.reps) : null;

  if (!rowState.id) {
    const { data, error } = await sb
      .from(SETS_TABLE)
      .insert({
        session_exercise_id: entry.id,
        exercise_id: entry.exercise_id,
        user_id: currentUser.id,
        set_number: rowState.set_number,
        weight: payload.weight,
        reps: payload.reps,
        time_seconds: payload.time_seconds,
        one_rep_max: oneRepMax,
      })
      .select()
      .single();
    if (!error && data) rowState.id = data.id;
  } else {
    await sb
      .from(SETS_TABLE)
      .update({
        weight: payload.weight,
        reps: payload.reps,
        time_seconds: payload.time_seconds,
        one_rep_max: oneRepMax,
      })
      .eq("id", rowState.id);
  }

  if (oneRepMax !== null) {
    await checkAndShowPR(entry, row, oneRepMax);
  }
}

async function checkAndShowPR(entry, row, oneRepMax) {
  const { data } = await sb
    .from(SETS_TABLE)
    .select("one_rep_max")
    .eq("exercise_id", entry.exercise_id)
    .eq("user_id", currentUser.id)
    .order("one_rep_max", { ascending: false })
    .limit(1);

  const best = data && data[0] ? data[0].one_rep_max : null;
  let prBadge = row.querySelector(".pr-badge");

  if (best !== null && oneRepMax >= best) {
    if (!prBadge) {
      prBadge = document.createElement("span");
      prBadge.className = "pr-badge";
      prBadge.textContent = "🏆 PR";
      row.querySelector(".one-rep-max").after(prBadge);
    }
  } else if (prBadge) {
    prBadge.remove();
  }
}

async function removeSet(entry, rowState, row) {
  if (rowState.id) {
    await sb.from(SETS_TABLE).delete().eq("id", rowState.id);
  }
  row.remove();
  entry.setRows = entry.setRows.filter((r) => r !== rowState);

  // No sets left for this exercise -> no reason to keep the exercise either.
  if (entry.setRows.length === 0) {
    await sb.from(SESSION_EXERCISES_TABLE).delete().eq("id", entry.id);
    entry.cardEl.remove();
    sessionExercises = sessionExercises.filter((e) => e !== entry);
  }
}

// ---------------------------------------------------------------------------
// Session category (optional, set any time)
// ---------------------------------------------------------------------------
sessionCategorySelect.addEventListener("change", async () => {
  const value = sessionCategorySelect.value || null;
  categoryStatus.textContent = "Saving…";

  if (!currentSessionId) {
    const { data, error } = await sb
      .from(SESSIONS_TABLE)
      .upsert(
        { user_id: currentUser.id, session_date: currentWorkoutDate, category: value },
        { onConflict: "user_id,session_date" }
      )
      .select()
      .single();
    if (error) {
      categoryStatus.textContent = "Couldn't save: " + error.message;
      return;
    }
    currentSessionId = data.id;
    sessionStatus.textContent = `Session for ${formatDateLong(currentWorkoutDate)}`;
  } else {
    const { error } = await sb.from(SESSIONS_TABLE).update({ category: value }).eq("id", currentSessionId);
    if (error) {
      categoryStatus.textContent = "Couldn't save: " + error.message;
      return;
    }
  }
  categoryStatus.textContent = "Saved ✓";
});

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------
wExportBtn.addEventListener("click", async () => {
  const start = wExportStartInput.value;
  const end = wExportEndInput.value;

  if (!start || !end) {
    wExportStatus.textContent = "Pick a start and end date first.";
    return;
  }

  wExportStatus.textContent = "Fetching…";

  const { data: sessions, error: sessionsError } = await sb
    .from(SESSIONS_TABLE)
    .select("id, session_date, category")
    .eq("user_id", currentUser.id)
    .gte("session_date", start)
    .lte("session_date", end);

  if (sessionsError) {
    wExportStatus.textContent = "Couldn't export: " + sessionsError.message;
    return;
  }
  if (!sessions || sessions.length === 0) {
    wExportStatus.textContent = "No workout sessions in that range.";
    return;
  }

  const sessionIds = sessions.map((s) => s.id);
  const sessionById = Object.fromEntries(sessions.map((s) => [s.id, s]));

  const { data: exs } = await sb
    .from(SESSION_EXERCISES_TABLE)
    .select("id, session_id, exercise_id, tracking_type")
    .in("session_id", sessionIds);

  const exerciseEntryById = Object.fromEntries((exs || []).map((e) => [e.id, e]));
  const exerciseNameById = Object.fromEntries(workoutExercises.map((e) => [e.id, e.exercise_name]));
  const sessionExerciseIds = (exs || []).map((e) => e.id);

  let sets = [];
  if (sessionExerciseIds.length > 0) {
    const { data } = await sb
      .from(SETS_TABLE)
      .select("*")
      .in("session_exercise_id", sessionExerciseIds)
      .order("set_number", { ascending: true });
    sets = data || [];
  }

  if (sets.length === 0) {
    wExportStatus.textContent = "No logged sets in that range.";
    return;
  }

  const columns = [
    "Date",
    "Category",
    "Exercise",
    "Tracking type",
    "Set",
    "Weight",
    "Reps",
    "Time (s)",
    "1RM",
  ];
  const rows = sets.map((set) => {
    const ex = exerciseEntryById[set.session_exercise_id];
    const session = ex ? sessionById[ex.session_id] : null;
    return [
      session ? session.session_date : "",
      session && session.category ? session.category : "",
      ex ? exerciseNameById[ex.exercise_id] || "" : "",
      ex ? TRACKING_LABELS[ex.tracking_type] || ex.tracking_type : "",
      set.set_number,
      set.weight ?? "",
      set.reps ?? "",
      set.time_seconds ?? "",
      set.one_rep_max ?? "",
    ];
  });

  const csv = [columns.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join(
    "\r\n"
  );
  downloadCSV(csv, `workouts_${start}_to_${end}.csv`);
  wExportStatus.textContent = `Downloaded ${sets.length} set${sets.length === 1 ? "" : "s"}.`;
});
