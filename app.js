const DB_NAME = "to-my-future-self";
const STORE_NAME = "capsules";
const composeDialog = document.querySelector("#compose-dialog");
const detailDialog = document.querySelector("#detail-dialog");
const form = document.querySelector("#compose-form");
const entryKind = document.querySelector("#entry-kind");
const grid = document.querySelector("#capsule-grid");
const emptyState = document.querySelector("#empty-state");
const searchInput = document.querySelector("#search-input");
const photoInput = document.querySelector("#photo-input");
const photoPreview = document.querySelector("#photo-preview");
const errorMessage = document.querySelector("#form-error");
const toast = document.querySelector("#toast");
const objectUrls = new Set();
let capsules = [];
let selectedFilter = "all";
let selectedAttachments = [];
let toastTimer;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function storeCapsule(capsule, mode = "readwrite") {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, mode);
    const store = transaction.objectStore(STORE_NAME);
    const request = mode === "readonly" ? store.getAll() : store.put(capsule);
    transaction.oncomplete = () => {
      db.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || request.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("The browser could not save this capsule."));
    };
  });
}

async function removeCapsule(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      db.close();
      reject(transaction.error || new Error("The browser could not remove this capsule."));
    };
  });
}

function isReady(capsule) {
  return new Date(capsule.unlockAt).getTime() <= Date.now();
}

function formatDate(value, options = { month: "short", day: "numeric", year: "numeric" }) {
  return new Intl.DateTimeFormat(undefined, options).format(new Date(value));
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function createObjectURL(blob) {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

function clearObjectURLs() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls.clear();
}

function normalizeCapsule(capsule) {
  const attachments = capsule.attachments || (capsule.images || []).map((image) => ({
    name: image.name,
    type: image.type,
    mediaType: "image",
    blob: image.blob,
  }));
  return { ...capsule, kind: capsule.kind || "letter", attachments };
}

function capsuleLabel(kind) {
  return ({
    letter: "Letter to myself",
    journal: "Journal entry",
    memory: "Photo & video memory",
    life: "Life right now",
  })[kind] || "Time capsule";
}

function attachmentWord(attachments) {
  const videos = attachments.filter((item) => item.mediaType === "video").length;
  const music = attachments.filter((item) => item.mediaType === "audio").length;
  const photos = attachments.length - videos - music;
  const parts = [];
  if (photos) parts.push(`${photos} photo${photos === 1 ? "" : "s"}`);
  if (videos) parts.push(`${videos} video${videos === 1 ? "" : "s"}`);
  if (music) parts.push(`${music} audio ${music === 1 ? "track" : "tracks"}`);
  return parts.join(" · ");
}

function makeCard(capsule) {
  const ready = isReady(capsule);
  const card = document.createElement("article");
  card.className = "capsule-card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.setAttribute("aria-label", `${ready ? "Open" : "View locked"} capsule: ${capsule.title}`);
  const icon = capsule.kind === "memory" ? "▧" : capsule.kind === "life" ? "♡" : capsule.kind === "journal" ? "▤" : "✎";
  const excerpt = ready
    ? capsule.body || `${capsule.attachments.length} ${capsule.attachments.length === 1 ? "moment" : "moments"} saved for you.`
    : "A little memory from past you, waiting for the right day.";
  const mediaPreview = ready && capsule.attachments.length
    ? `<div class="card-media-preview">${capsule.attachments.slice(0, 3).map((attachment) => (
      attachment.mediaType === "video"
        ? `<span class="video-preview"><span aria-hidden="true">▶</span> VIDEO</span>`
        : attachment.mediaType === "audio"
          ? `<span class="audio-preview"><span aria-hidden="true">♫</span> AUDIO</span>`
        : `<img src="${createObjectURL(attachment.blob)}" alt="" loading="lazy">`
    )).join("")}</div>`
    : "";
  card.innerHTML = `
    <div class="card-top">
      <span class="kind-label"><span class="kind-icon">${icon}</span>${capsuleLabel(capsule.kind)}</span>
      <span class="lock-icon" aria-hidden="true">${ready ? "♡" : "⌑"}</span>
    </div>
    <h3>${escapeHTML(capsule.title)}</h3>
    <p class="card-excerpt">${escapeHTML(excerpt)}</p>
    ${mediaPreview}
    <div class="card-bottom"><span class="card-date">◷ ${escapeHTML(formatDate(capsule.unlockAt))}</span><span class="card-status ${ready ? "ready" : ""}">${ready ? "Ready to open" : "Still tucked away"}</span></div>
    ${capsule.attachments.length ? `<span class="card-photos">${escapeHTML(attachmentWord(capsule.attachments))} tucked inside</span>` : ""}
  `;
  card.addEventListener("click", () => openCapsule(capsule.id));
  card.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openCapsule(capsule.id);
    }
  });
  return card;
}

function renderGrid(target, entries, empty, count, singular, plural) {
  const targetGrid = document.querySelector(target);
  targetGrid.replaceChildren(...entries.map(makeCard));
  targetGrid.hidden = entries.length === 0;
  document.querySelector(empty).hidden = entries.length > 0;
  document.querySelector(count).textContent = `${entries.length} ${entries.length === 1 ? singular : plural}`;
}

function renderCapsules() {
  clearObjectURLs();
  const query = searchInput.value.trim().toLocaleLowerCase();
  const counts = { all: capsules.length, waiting: 0, ready: 0 };
  capsules.forEach((capsule) => { counts[isReady(capsule) ? "ready" : "waiting"] += 1; });
  Object.entries(counts).forEach(([key, count]) => {
    document.querySelector(`[data-count="${key}"]`).textContent = count;
  });

  const matchesSearch = (capsule) => `${capsule.title} ${capsule.body} ${capsule.kind}`.toLocaleLowerCase().includes(query);
  const visible = capsules
    .filter((capsule) => selectedFilter === "all" || (selectedFilter === "ready" ? isReady(capsule) : !isReady(capsule)))
    .filter(matchesSearch)
    .sort((a, b) => new Date(a.unlockAt) - new Date(b.unlockAt));
  grid.replaceChildren(...visible.map(makeCard));
  const hasCapsules = capsules.length > 0;
  emptyState.hidden = visible.length > 0;
  grid.hidden = visible.length === 0;
  if (!hasCapsules) {
    document.querySelector("#empty-title").textContent = "Your story starts here.";
    document.querySelector("#empty-description").textContent = "Write a note to the you of tomorrow, next year, or whenever you need it.";
  } else {
    document.querySelector("#empty-title").textContent = query ? "No memories found." : "Nothing tucked away here.";
    document.querySelector("#empty-description").textContent = query ? "Try another search, or clear the search to see your capsules." : "Try another filter to find your capsules.";
  }

  const sorted = [...capsules].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const letters = sorted.filter((capsule) => capsule.kind === "letter" || capsule.kind === "journal");
  const memories = sorted.filter((capsule) => capsule.kind === "memory");
  const snapshots = sorted.filter((capsule) => capsule.kind === "life");
  renderGrid("#letters-grid", letters, "#letters-empty", "#letters-count", "letter", "letters");
  renderGrid("#memories-grid", memories, "#memories-empty", "#memories-count", "memory", "memories");
  renderGrid("#life-grid", snapshots, "#life-empty", "#life-count", "snapshot", "snapshots");
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2800);
}

function setDefaultUnlockDate() {
  const date = new Date();
  date.setFullYear(date.getFullYear() + 1);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  document.querySelector("#unlock-date").value = date.toISOString().slice(0, 16);
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  document.querySelector("#unlock-date").min = now.toISOString().slice(0, 16);
}

function formatDateInput(date) {
  const localDate = new Date(date);
  localDate.setMinutes(localDate.getMinutes() - localDate.getTimezoneOffset());
  return localDate.toISOString().slice(0, 16);
}

function applyMilestone(value) {
  const date = new Date();
  const hints = {
    custom: "For a birthday or graduation, choose the actual date above.",
    "1-month": "A little note to open next month.",
    "1-year": "A note for the you one year from today.",
    "5-years": "A note for the you five years from today.",
    "18th-birthday": "Choose the date of your 18th birthday above.",
    "21st-birthday": "Choose the date of your 21st birthday above.",
    graduation: "Choose your graduation day above.",
  };
  if (value === "1-month") date.setMonth(date.getMonth() + 1);
  if (value === "1-year") date.setFullYear(date.getFullYear() + 1);
  if (value === "5-years") date.setFullYear(date.getFullYear() + 5);
  if (["1-month", "1-year", "5-years"].includes(value)) {
    document.querySelector("#unlock-date").value = formatDateInput(date);
  }
  document.querySelector("#milestone-hint").textContent = hints[value] || hints.custom;
}

function updateComposerKind() {
  const isMemory = entryKind.value === "memory";
  const body = document.querySelector("#entry-body");
  body.required = !isMemory;
  document.querySelector("#body-optional").hidden = !isMemory;
  document.querySelector("#sharing-options").hidden = isMemory;
  document.querySelector("#attachment-label").innerHTML = isMemory
    ? 'Add photos, videos, or music <span class="optional-label">· required</span>'
    : 'Add photos, videos, or music <span class="optional-label">· optional</span>';
  document.querySelector("#attachment-hint").textContent = isMemory
    ? "Choose at least one photo, video, or music file to save this memory."
    : "Add photos, videos, or music to this letter or journal entry.";
  document.querySelector("#attachment-label").parentElement.parentElement.classList.toggle("memory-required", isMemory);
  document.querySelector("#entry-body").placeholder = isMemory
    ? "Add a caption or a few details to go with these memories..."
    : "Dear future me,\n\nRight now, I’m thinking about...";
}

function setAttachmentPreviews() {
  photoPreview.replaceChildren();
  selectedAttachments.forEach((attachment, index) => {
    const wrap = document.createElement("div");
    wrap.className = "photo-thumb-wrap";
    const preview = attachment.mediaType === "audio"
      ? document.createElement("span")
      : attachment.mediaType === "video" ? document.createElement("video") : document.createElement("img");
    preview.className = attachment.mediaType === "audio" ? "file-preview audio-preview" : "photo-thumb";
    if (attachment.mediaType === "audio") {
      preview.textContent = `♫ ${attachment.name}`;
    } else {
      preview.src = createObjectURL(attachment.blob);
      preview.alt = attachment.name;
      if (attachment.mediaType === "video") preview.muted = true;
    }
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-photo";
    remove.textContent = "×";
    remove.setAttribute("aria-label", `Remove ${attachment.name}`);
    remove.addEventListener("click", () => {
      selectedAttachments.splice(index, 1);
      clearObjectURLs();
      setAttachmentPreviews();
    });
    wrap.append(preview, remove);
    photoPreview.append(wrap);
  });
}

function openCompose(kind = "letter") {
  form.reset();
  selectedAttachments = [];
  clearObjectURLs();
  setAttachmentPreviews();
  errorMessage.hidden = true;
  entryKind.value = kind;
  setDefaultUnlockDate();
  document.querySelector("#milestone-select").value = "custom";
  applyMilestone("custom");
  updateComposerKind();
  composeDialog.showModal();
  document.querySelector("#entry-title").focus();
}

async function openCapsule(id) {
  const capsule = capsules.find((item) => item.id === id);
  if (!capsule) return;
  const ready = isReady(capsule);
  const content = document.querySelector("#detail-content");
  content.replaceChildren();

  const header = document.createElement("div");
  header.className = "detail-header";
  const shareEnabled = capsule.shareEnabled && (capsule.kind === "letter" || capsule.kind === "journal");
  header.innerHTML = `<div><div class="detail-meta">${escapeHTML(capsuleLabel(capsule.kind))} · ${ready ? "Ready to open" : "Still tucked away"}${shareEnabled ? " · Share option enabled" : ""}</div><h2 class="detail-title" id="detail-title">${escapeHTML(capsule.title)}</h2><div class="detail-date">Saved ${escapeHTML(formatDate(capsule.createdAt))} · Opens ${escapeHTML(formatDate(capsule.unlockAt))}${capsule.milestone && capsule.milestone !== "custom" ? ` · ${escapeHTML(capsule.milestoneLabel)}` : ""}</div></div>`;
  const close = document.createElement("button");
  close.className = "icon-button";
  close.type = "button";
  close.textContent = "×";
  close.setAttribute("aria-label", "Close capsule");
  close.addEventListener("click", () => detailDialog.close());
  header.append(close);
  content.append(header);

  if (ready) {
    if (capsule.body) {
      const body = document.createElement("p");
      body.className = "detail-body";
      body.textContent = capsule.body;
      content.append(body);
    }
    if (capsule.attachments.length) {
      const media = document.createElement("div");
      media.className = "detail-media";
      capsule.attachments.forEach((attachment) => {
        const element = attachment.mediaType === "video"
          ? document.createElement("video")
          : attachment.mediaType === "audio" ? document.createElement("audio") : document.createElement("img");
        element.className = attachment.mediaType === "video"
          ? "detail-video" : attachment.mediaType === "audio" ? "detail-audio" : "detail-photo";
        element.src = createObjectURL(attachment.blob);
        element.alt = attachment.name;
        if (attachment.mediaType === "video" || attachment.mediaType === "audio") element.controls = true;
        media.append(element);
      });
      content.append(media);
    }
  } else {
    const locked = document.createElement("div");
    locked.className = "detail-locked";
    locked.innerHTML = `<span class="lock-icon" aria-hidden="true">⌑</span><p>This memory is still tucked away.<br>Come back on <strong>${escapeHTML(formatDate(capsule.unlockAt, { weekday: "long", month: "long", day: "numeric", year: "numeric" }))}</strong> to open it.</p>`;
    content.append(locked);
  }

  const actions = document.createElement("div");
  actions.className = "detail-actions";
  const remove = document.createElement("button");
  remove.className = "delete-button";
  remove.type = "button";
  remove.textContent = "Delete capsule";
  remove.addEventListener("click", async () => {
    if (!window.confirm("Delete this capsule and its photos or videos? This cannot be undone.")) return;
    try {
      await removeCapsule(capsule.id);
      capsules = capsules.filter((item) => item.id !== capsule.id);
      detailDialog.close();
      renderCapsules();
      showToast("Capsule deleted.");
    } catch (error) {
      showToast(`Could not delete capsule: ${error.message}`);
    }
  });
  const closeAction = document.createElement("button");
  closeAction.className = "button button-outline";
  closeAction.type = "button";
  closeAction.textContent = "Close";
  closeAction.addEventListener("click", () => detailDialog.close());
  const actionButtons = document.createElement("div");
  actionButtons.className = "detail-action-buttons";
  if (ready && shareEnabled) {
    const share = document.createElement("button");
    share.className = "button button-coral";
    share.type = "button";
    share.textContent = "Share with family & friends";
    share.addEventListener("click", () => shareCapsule(capsule));
    actionButtons.append(share);
  }
  actionButtons.append(closeAction);
  actions.append(remove, actionButtons);
  content.append(actions);
  detailDialog.showModal();
}

async function shareCapsule(capsule) {
  const text = `${capsule.title}\n\n${capsule.body}`;
  try {
    if (navigator.share) {
      try {
        await navigator.share({ title: capsule.title, text });
        showToast("Share options opened.");
        return;
      } catch (error) {
        if (error.name === "AbortError") return;
        if (!navigator.clipboard?.writeText) throw error;
      }
    }
    if (!navigator.clipboard?.writeText) {
      throw new Error("Sharing or clipboard access is not available in this browser.");
    }
    await navigator.clipboard.writeText(text);
    showToast("Letter copied. You can paste it into a message.");
  } catch (error) {
    showToast(`Could not share this letter: ${error.message}`);
  }
}

function renderPage() {
  const route = location.hash.slice(1) || "home";
  const validRoutes = ["home", "letters", "memories", "life-right-now"];
  const page = validRoutes.includes(route) ? route : "home";
  if (route !== page) history.replaceState(null, "", `#${page}`);
  document.querySelectorAll(".page-view").forEach((view) => {
    view.hidden = view.dataset.page !== page;
  });
  document.querySelectorAll("[data-page-link]").forEach((link) => {
    const active = link.dataset.pageLink === page;
    link.classList.toggle("active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  if (page === "life-right-now") document.querySelector("#snapshot-today").textContent = formatDate(new Date(), { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  window.scrollTo(0, 0);
}

document.querySelectorAll("[data-open-compose]").forEach((button) => {
  button.addEventListener("click", () => openCompose(button.dataset.kind || "letter"));
});
document.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => composeDialog.close()));
document.querySelectorAll("[data-filter]").forEach((button) => {
  button.addEventListener("click", () => {
    selectedFilter = button.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((tab) => tab.classList.toggle("active", tab === button));
    renderCapsules();
  });
});
document.querySelector("#milestone-select").addEventListener("change", (event) => applyMilestone(event.target.value));
entryKind.addEventListener("change", updateComposerKind);
searchInput.addEventListener("input", renderCapsules);
photoInput.addEventListener("change", () => {
  const files = Array.from(photoInput.files || []);
  const valid = files.filter((file) => file.type.startsWith("image/") || file.type.startsWith("video/") || file.type.startsWith("audio/"));
  selectedAttachments.push(...valid.map((file) => ({
    name: file.name,
    type: file.type,
    mediaType: file.type.startsWith("video/") ? "video" : file.type.startsWith("audio/") ? "audio" : "image",
    blob: file,
  })));
  photoInput.value = "";
  clearObjectURLs();
  setAttachmentPreviews();
});
detailDialog.addEventListener("close", () => {
  clearObjectURLs();
  renderCapsules();
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  errorMessage.hidden = true;
  const data = new FormData(form);
  const unlockAt = new Date(data.get("unlockAt"));
  const kind = data.get("kind");
  if (!Number.isFinite(unlockAt.getTime())) {
    errorMessage.textContent = "Please choose a valid date to open your capsule.";
    errorMessage.hidden = false;
    return;
  }
  const title = data.get("title").trim();
  const body = data.get("body").trim();
  if (!title || (kind !== "memory" && !body) || (kind === "memory" && selectedAttachments.length === 0)) {
    errorMessage.textContent = kind === "memory"
      ? "Add a title and at least one photo, video, or music file before sealing this memory."
      : "Add a title and a note before sealing your capsule.";
    errorMessage.hidden = false;
    return;
  }
  const selectedMilestone = document.querySelector("#milestone-select").value;
  const capsule = {
    id: crypto.randomUUID(),
    title,
    kind,
    body,
    shareEnabled: kind !== "memory" && data.get("sharing") === "share",
    milestone: selectedMilestone,
    milestoneLabel: document.querySelector("#milestone-select").selectedOptions[0].textContent,
    unlockAt: unlockAt.toISOString(),
    createdAt: new Date().toISOString(),
    attachments: selectedAttachments.map((attachment) => ({ ...attachment })),
  };
  try {
    await storeCapsule(capsule);
    capsules.unshift(capsule);
    composeDialog.close();
    renderCapsules();
    showToast(kind === "memory" ? "Your memory is safely tucked away." : "Your capsule is safely tucked away.");
  } catch (error) {
    errorMessage.textContent = `Could not save your capsule. Your browser may be low on storage. ${error.message || ""}`.trim();
    errorMessage.hidden = false;
  }
});

document.querySelector("#snapshot-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const snapshotError = document.querySelector("#snapshot-error");
  snapshotError.hidden = true;
  const formData = new FormData(event.currentTarget);
  const body = formData.get("body").trim();
  if (!body) {
    snapshotError.textContent = "Add a few lines about life right now before saving.";
    snapshotError.hidden = false;
    return;
  }
  const date = new Date();
  const dateLabel = formatDate(date);
  const notes = [
    formData.get("place").trim() && `Where I am: ${formData.get("place").trim()}`,
    formData.get("feeling").trim() && `How I feel: ${formData.get("feeling").trim()}`,
    formData.get("loving").trim() && `What I love lately: ${formData.get("loving").trim()}`,
    formData.get("lookingForward").trim() && `What I’m looking forward to: ${formData.get("lookingForward").trim()}`,
    body,
  ].filter(Boolean);
  const capsule = {
    id: crypto.randomUUID(),
    kind: "life",
    title: document.querySelector("#snapshot-title").value.trim() || `My life right now · ${dateLabel}`,
    body: notes.join("\n\n"),
    milestone: "custom",
    milestoneLabel: "",
    unlockAt: date.toISOString(),
    createdAt: date.toISOString(),
    attachments: [],
  };
  try {
    await storeCapsule(capsule);
    capsules.unshift(capsule);
    event.currentTarget.reset();
    renderCapsules();
    showToast("Snapshot saved. This is your life, right now.");
  } catch (error) {
    snapshotError.textContent = `Could not save your snapshot. ${error.message || ""}`.trim();
    snapshotError.hidden = false;
  }
});

window.addEventListener("hashchange", renderPage);
window.addEventListener("storage", () => renderCapsules());
composeDialog.addEventListener("close", () => {
  clearObjectURLs();
  selectedAttachments = [];
  photoPreview.replaceChildren();
});

async function start() {
  renderPage();
  try {
    capsules = (await storeCapsule(undefined, "readonly") || []).map(normalizeCapsule);
    renderCapsules();
  } catch (error) {
    document.querySelector("#empty-title").textContent = "Storage isn’t available.";
    document.querySelector("#empty-description").textContent = `Your browser could not open local storage. Please use a modern browser with site storage enabled. ${error.message || ""}`.trim();
    emptyState.hidden = false;
    grid.hidden = true;
  }
}

start();
window.setInterval(() => {
  if (!composeDialog.open && !detailDialog.open) renderCapsules();
}, 60_000);
