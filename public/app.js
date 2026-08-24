const grid = document.querySelector("#wordGrid");
const statusEl = document.querySelector("#status");
const template = document.querySelector("#wordTemplate");
const searchInput = document.querySelector("#searchInput");
const italianFilter = document.querySelector("#italianFilter");
const englishFilter = document.querySelector("#englishFilter");
const semanticFilter = document.querySelector("#semanticFilter");
const clearFilters = document.querySelector("#clearFilters");
const loadMore = document.querySelector("#loadMore");
const alphabetBar = document.querySelector("#alphabetBar");
const semanticActive = document.querySelector("#semanticActive");
const semanticActiveLabel = document.querySelector("#semanticActiveLabel");
const clearSemanticFilter = document.querySelector("#clearSemanticFilter");
const detailOverlay = document.querySelector("#detailOverlay");
const detailCard = document.querySelector("#detailCard");
const detailClose = document.querySelector("#detailClose");
const detailWord = document.querySelector("#detailWord");
const detailPhonetic = document.querySelector("#detailPhonetic");
const detailDefinition = document.querySelector("#detailDefinition");
const detailEnglish = document.querySelector("#detailEnglish");
const detailExtra = document.querySelector("#detailExtra");
const detailTags = document.querySelector("#detailTags");
const detailPlay = document.querySelector("#detailPlay");
const detailAudio = document.querySelector("#detailAudio");
const dictionaryView = document.querySelector("#dictionaryView");
const locutionsView = document.querySelector("#locutionsView");
const openLocutions = document.querySelector("#openLocutions");
const closeLocutions = document.querySelector("#closeLocutions");
const locutionsStatus = document.querySelector("#locutionsStatus");
const locutionsList = document.querySelector("#locutionsList");
const suggestionsView = document.querySelector("#suggestionsView");
const openSuggestions = document.querySelector("#openSuggestions");
const closeSuggestions = document.querySelector("#closeSuggestions");
const suggestionsForm = document.querySelector("#suggestionsForm");
const suggestionsMessage = document.querySelector("#suggestionsMessage");
const suggestionsSuccess = document.querySelector("#suggestionsSuccess");
const submitSuggestion = document.querySelector("#submitSuggestion");
const suggestAnother = document.querySelector("#suggestAnother");
const suggestedWord = document.querySelector("#suggestedWord");
const embedParam = new URLSearchParams(window.location.search).get("embed");
const isEmbedMode = embedParam === "true" || window.location.pathname.replace(/\/+$/, "") === "/embed";
const resizeMessageType = "VOCABOLARIO_RESIZE";
let resizeFrame = 0;

if (isEmbedMode) {
  document.documentElement.classList.add("embed-mode");
  document.body.classList.add("embed-mode");
}

function getEmbedHeight() {
  const body = document.body;
  const html = document.documentElement;
  return Math.ceil(Math.max(
    body.scrollHeight,
    body.offsetHeight,
    html.clientHeight,
    html.scrollHeight,
    html.offsetHeight
  ));
}

function postEmbedHeight() {
  if (!isEmbedMode || !window.parent || window.parent === window) return;
  window.parent.postMessage({
    type: resizeMessageType,
    height: getEmbedHeight()
  }, "*");
}

function scheduleEmbedResize() {
  if (!isEmbedMode) return;
  window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    postEmbedHeight();
    window.setTimeout(postEmbedHeight, 120);
  });
}

let vocabulary = [];
let currentAudio = null;
let visibleLimit = 96;
let renderTimer = null;
let activeLetter = "";
let locutions = [];
let locutionsLoaded = false;
let locutionsPromise = null;
let dictionaryScrollTop = 0;
let detailReturnScroll = null;
let suggestionsScrollTop = 0;
let suggestionFormStartedAt = Date.now();

const initialVisibleLimit = 96;
const visibleLimitStep = 96;
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

function clean(value) {
  return String(value || "").trim();
}

function normalizeText(value) {
  return clean(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("error", isError);
  scheduleEmbedResize();
}

function uniqueOptions(items, key) {
  return [...new Set(items.flatMap((item) => clean(item[key]).split(",").map((value) => clean(value))).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, "it"));
}

function fillSelect(select, values) {
  const first = select.querySelector("option");
  select.replaceChildren(first);
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.append(option);
  });
}

function searchableText(item) {
  return [
    item.word,
    item.phonetic,
    item.definition,
    item.english,
    item.semantic,
    item.language,
    item.category
  ].map(clean).join(" ").toLowerCase();
}

function prepareItem(item) {
  const semanticValues = clean(item.semantic).split(",").map((value) => clean(value)).filter(Boolean);
  return {
    ...item,
    _definitionText: clean(item.definition).toLowerCase(),
    _englishText: clean(item.english).toLowerCase(),
    _searchText: searchableText(item),
    _lemmaInitial: normalizeText(item.word).charAt(0).toUpperCase(),
    _semanticValues: semanticValues
  };
}

function getFilteredItems() {
  const query = clean(searchInput.value).toLowerCase();
  const italian = clean(italianFilter.value).toLowerCase();
  const english = clean(englishFilter.value).toLowerCase();
  const semantic = semanticFilter.value;

  return vocabulary.filter((item) => {
    const matchesLetter = !activeLetter || item._lemmaInitial === activeLetter;
    const matchesQuery = !query || item._searchText.includes(query);
    const matchesItalian = !italian || item._definitionText.includes(italian);
    const matchesEnglish = !english || item._englishText.includes(english);
    const matchesSemantic = !semantic || item._semanticValues.includes(semantic);
    return matchesLetter && matchesQuery && matchesItalian && matchesEnglish && matchesSemantic;
  });
}

function makeTag(text, className = "") {
  const tag = document.createElement("span");
  tag.className = `tag ${className}`.trim();
  tag.textContent = text;
  return tag;
}

function makeSemanticTag(text) {
  const tag = document.createElement("button");
  tag.className = "tag semantic";
  tag.type = "button";
  tag.textContent = text;
  tag.dataset.semanticValue = text;
  tag.classList.toggle("is-active", semanticFilter.value === text);
  tag.setAttribute("aria-pressed", String(semanticFilter.value === text));
  tag.title = `Filtra per ${text}`;
  tag.addEventListener("click", (event) => {
    event.stopPropagation();
    applySemanticFilter(text);
  });
  return tag;
}

function applySemanticFilter(value) {
  semanticFilter.value = value;
  visibleLimit = initialVisibleLimit;
  updateSemanticState();
  render();
}

function updateSemanticState() {
  const value = clean(semanticFilter.value);
  semanticActive.hidden = !value;
  semanticActiveLabel.textContent = value;
}

function sortByLemma(items) {
  return [...items].sort((a, b) => clean(a.word).localeCompare(clean(b.word), "it", { sensitivity: "base" }));
}

function setElementText(element, value) {
  const text = clean(value);
  element.textContent = text;
  element.hidden = !text;
}

function makeDetailRow(label, value) {
  const text = clean(value);
  if (!text) return null;
  const row = document.createElement("section");
  row.className = "detail-row";
  const title = document.createElement("h3");
  const content = document.createElement("p");
  title.textContent = label;
  content.textContent = text;
  row.append(title, content);
  return row;
}

function makeLocutionsSection(locutions) {
  const items = (Array.isArray(locutions) ? locutions : []).filter((item) => clean(item?.locution));
  if (!items.length) return null;

  const section = document.createElement("section");
  section.className = "detail-row detail-locutions";
  const title = document.createElement("h3");
  title.textContent = "Locuzioni";
  const list = document.createElement("div");
  list.className = "locution-list";

  items.forEach((item) => {
    const entry = document.createElement("div");
    entry.className = "locution-item";
    // Contenitore separato, pronto per un futuro collegamento interno al lemma.
    const locution = document.createElement("p");
    locution.className = "locution-item__text";
    locution.textContent = clean(item.locution);
    entry.append(locution);

    const meaningText = clean(item.meaning);
    if (meaningText) {
      const meaning = document.createElement("p");
      meaning.className = "locution-item__meaning";
      meaning.textContent = meaningText;
      entry.append(meaning);
    }
    list.append(entry);
  });

  section.append(title, list);
  return section;
}

function localAudioSource(item, audio) {
  if (!item?.id || !audio?.id) return null;
  return {
    ...audio,
    url: `/api/audio/${encodeURIComponent(item.id)}/${encodeURIComponent(audio.id)}`
  };
}

function closeDetail() {
  detailOverlay.hidden = true;
  detailAudio.pause();
  detailAudio.removeAttribute("src");
  delete detailAudio.dataset.src;
  delete detailAudio.dataset.type;
  detailPlay.dataset.state = "idle";
  document.body.classList.remove("detail-open");
  if (detailReturnScroll !== null) {
    const scrollTop = detailReturnScroll;
    detailReturnScroll = null;
    window.requestAnimationFrame(() => window.scrollTo({ top: scrollTop, behavior: "instant" }));
  }
  scheduleEmbedResize();
}

function openDetail(item, options = {}) {
  if (currentAudio) currentAudio.pause();
  detailReturnScroll = Number.isFinite(options.returnScroll) ? options.returnScroll : null;

  detailWord.textContent = item.word || "Senza parola";
  setElementText(detailPhonetic, item.phonetic);
  setElementText(detailDefinition, item.definition);
  setElementText(detailEnglish, item.english);
  detailExtra.replaceChildren();
  detailTags.replaceChildren();
  detailCard.querySelector(".detail-locutions")?.remove();

  const firstAudio = localAudioSource(item, item.audio?.[0]);
  if (firstAudio) {
    detailAudio.dataset.src = firstAudio.url;
    detailAudio.dataset.type = firstAudio.type || "audio/mpeg";
    detailAudio.removeAttribute("src");
    detailPlay.disabled = false;
    detailPlay.title = firstAudio.filename || "Riproduci audio";
  } else {
    detailAudio.removeAttribute("src");
    delete detailAudio.dataset.src;
    delete detailAudio.dataset.type;
    detailPlay.disabled = true;
    detailPlay.title = "Nessun audio disponibile";
  }

  [
    makeDetailRow("Grammatica", item.grammar),
    makeDetailRow("Etimologia", item.etymology)
  ].filter(Boolean).forEach((row) => detailExtra.append(row));

  if (item.images?.length) {
    const gallery = document.createElement("section");
    gallery.className = "detail-row detail-gallery";
    const title = document.createElement("h3");
    title.textContent = "Immagine";
    const images = document.createElement("div");
    images.className = "detail-images";
    item.images.forEach((image) => {
      const img = document.createElement("img");
      img.src = image.url;
      img.alt = image.filename || item.word || "Immagine";
      img.loading = "lazy";
      images.append(img);
    });
    gallery.append(title, images);
    detailExtra.append(gallery);
  }

  clean(item.semantic).split(",").map((value) => clean(value)).filter(Boolean).forEach((value) => {
    detailTags.append(makeSemanticTag(value));
  });
  if (clean(item.language)) detailTags.append(makeTag(item.language));
  if (clean(item.category)) detailTags.append(makeTag(item.category, "category"));

  const locutionsSection = makeLocutionsSection(item.locutions);
  if (locutionsSection) detailCard.insertBefore(locutionsSection, detailAudio);

  detailOverlay.hidden = false;
  document.body.classList.add("detail-open");
  scheduleEmbedResize();
}

function locutionInitial(value) {
  return normalizeText(value).charAt(0).toUpperCase();
}

function sortLocutions(items) {
  return [...items].sort((a, b) => clean(a.locution).localeCompare(clean(b.locution), "it", { sensitivity: "base" }));
}

function setLocutionsStatus(message, isError = false) {
  locutionsStatus.textContent = message;
  locutionsStatus.classList.toggle("error", isError);
  locutionsStatus.hidden = !message;
  scheduleEmbedResize();
}

function makeRepertoryEntry(item, vocabularyById) {
  const linkedLemma = (item.lemmaIds || []).map((id) => vocabularyById.get(id)).find(Boolean);
  const entry = document.createElement(linkedLemma ? "button" : "div");
  entry.className = "repertory-locution";

  if (linkedLemma) {
    entry.type = "button";
    entry.setAttribute("aria-label", `${item.locution}. Apri il lemma ${linkedLemma.word}`);
    entry.addEventListener("click", () => {
      openDetail(linkedLemma, { returnScroll: window.scrollY });
    });
  }

  const title = document.createElement("p");
  title.className = "repertory-locution__title";
  title.textContent = item.locution;
  entry.append(title);

  if (clean(item.meaning)) {
    const meaning = document.createElement("p");
    meaning.className = "repertory-locution__meaning";
    meaning.textContent = item.meaning;
    entry.append(meaning);
  }

  return entry;
}

function renderLocutions() {
  const vocabularyById = new Map(vocabulary.map((item) => [item.id, item]));
  const groups = new Map();
  sortLocutions(locutions).forEach((item) => {
    const initial = locutionInitial(item.locution);
    if (!initial) return;
    if (!groups.has(initial)) groups.set(initial, []);
    groups.get(initial).push(item);
  });

  const fragment = document.createDocumentFragment();
  groups.forEach((items, letter) => {
    const group = document.createElement("section");
    group.className = "locutions-group";
    group.setAttribute("aria-labelledby", `locutions-letter-${letter}`);
    const heading = document.createElement("h3");
    heading.id = `locutions-letter-${letter}`;
    heading.textContent = letter;
    const entries = document.createElement("div");
    entries.className = "locutions-group__items";
    items.forEach((item) => entries.append(makeRepertoryEntry(item, vocabularyById)));
    group.append(heading, entries);
    fragment.append(group);
  });

  locutionsList.replaceChildren(fragment);
  setLocutionsStatus(locutions.length ? `${locutions.length} locuzioni` : "Nessuna locuzione disponibile.");
  scheduleEmbedResize();
}

async function loadLocutions() {
  if (locutionsLoaded) return renderLocutions();
  if (locutionsPromise) return locutionsPromise;

  setLocutionsStatus("Caricamento delle locuzioni...");
  locutionsPromise = fetch("/api/locutions")
    .then(async (response) => {
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Errore di caricamento delle locuzioni.");
      locutions = payload.items || [];
      locutionsLoaded = true;
      renderLocutions();
    })
    .catch((error) => setLocutionsStatus(error.message, true))
    .finally(() => {
      locutionsPromise = null;
    });

  return locutionsPromise;
}

function showLocutionsView() {
  dictionaryScrollTop = window.scrollY;
  dictionaryView.hidden = true;
  locutionsView.hidden = false;
  openLocutions.setAttribute("aria-pressed", "true");
  window.scrollTo({ top: 0, behavior: "instant" });
  loadLocutions();
  scheduleEmbedResize();
}

function showDictionaryView() {
  locutionsView.hidden = true;
  suggestionsView.hidden = true;
  dictionaryView.hidden = false;
  openLocutions.setAttribute("aria-pressed", "false");
  openSuggestions.setAttribute("aria-pressed", "false");
  window.requestAnimationFrame(() => window.scrollTo({ top: dictionaryScrollTop, behavior: "instant" }));
  scheduleEmbedResize();
}

function setSuggestionsMessage(message, isError = false) {
  suggestionsMessage.textContent = message;
  suggestionsMessage.classList.toggle("error", isError);
  suggestionsMessage.hidden = !message;
  scheduleEmbedResize();
}

function resetSuggestionForm() {
  suggestionsForm.reset();
  suggestionsForm.hidden = false;
  suggestionsSuccess.hidden = true;
  submitSuggestion.disabled = false;
  submitSuggestion.textContent = "Invia la proposta";
  suggestionFormStartedAt = Date.now();
  setSuggestionsMessage("");
  suggestedWord.focus();
}

function showSuggestionsView() {
  suggestionsScrollTop = window.scrollY;
  dictionaryView.hidden = true;
  locutionsView.hidden = true;
  suggestionsView.hidden = false;
  openLocutions.setAttribute("aria-pressed", "false");
  openSuggestions.setAttribute("aria-pressed", "true");
  suggestionFormStartedAt = Date.now();
  window.scrollTo({ top: 0, behavior: "instant" });
  window.requestAnimationFrame(() => suggestedWord.focus());
  scheduleEmbedResize();
}

function closeSuggestionsView() {
  suggestionsView.hidden = true;
  dictionaryView.hidden = false;
  openSuggestions.setAttribute("aria-pressed", "false");
  window.requestAnimationFrame(() => window.scrollTo({ top: suggestionsScrollTop, behavior: "instant" }));
  scheduleEmbedResize();
}

async function sendSuggestion(event) {
  event.preventDefault();
  setSuggestionsMessage("");

  if (!suggestionsForm.reportValidity()) return;

  const form = new FormData(suggestionsForm);
  const payload = {
    parolaSuggerita: clean(form.get("parolaSuggerita")),
    significato: clean(form.get("significato")),
    esempioUso: clean(form.get("esempioUso")),
    cognome: clean(form.get("cognome")),
    nome: clean(form.get("nome")),
    website: clean(form.get("website")),
    formStartedAt: suggestionFormStartedAt
  };

  submitSuggestion.disabled = true;
  submitSuggestion.textContent = "Invio in corso...";

  try {
    const response = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Non è stato possibile inviare la proposta. Riprova.");

    suggestionsForm.hidden = true;
    suggestionsSuccess.hidden = false;
    suggestionsSuccess.focus?.();
  } catch (error) {
    setSuggestionsMessage(error.message || "Non è stato possibile inviare la proposta. Riprova.", true);
  } finally {
    submitSuggestion.disabled = false;
    submitSuggestion.textContent = "Invia la proposta";
    scheduleEmbedResize();
  }
}

function playAudio(audio, play, source) {
  if (!source?.url) return;
  const nextUrl = new URL(source.url, window.location.href).href;
  if (audio.src !== nextUrl) {
    audio.src = nextUrl;
    audio.type = source.type || "audio/mpeg";
    audio.load();
  }
  if (currentAudio && currentAudio !== audio) currentAudio.pause();
  currentAudio = audio;
  if (audio.paused) {
    return audio.play()
      .then(() => {
        play.dataset.state = "playing";
      })
      .catch((error) => {
        play.dataset.state = "idle";
        console.warn("Audio non avviato:", error.message);
      });
  }
  audio.pause();
  return Promise.resolve();
}

function buildAlphabetBar() {
  alphabet.forEach((letter) => {
    const button = document.createElement("button");
    button.className = "alpha-button";
    button.type = "button";
    button.dataset.letter = letter;
    button.textContent = letter;
    alphabetBar.append(button);
  });
}

function updateActiveLetter() {
  document.querySelectorAll("[data-letter]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.letter === activeLetter);
  });
}

function scheduleRender() {
  window.clearTimeout(renderTimer);
  renderTimer = window.setTimeout(render, 120);
}

function render() {
  const filteredItems = sortByLemma(getFilteredItems());
  const items = filteredItems.slice(0, visibleLimit);
  grid.replaceChildren();

  items.forEach((item) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const title = node.querySelector("h2");
    const phonetic = node.querySelector(".phonetic");
    const definition = node.querySelector(".definition");
    const english = node.querySelector(".english");
    const play = node.querySelector(".play");
    const audio = node.querySelector("audio");
    const tags = node.querySelector(".tags");
    const firstAudio = localAudioSource(item, item.audio?.[0]);

    node.tabIndex = 0;
    node.setAttribute("role", "button");
    node.setAttribute("aria-label", `Apri ${item.word || "vocabolo"}`);
    title.textContent = item.word || "Senza parola";
    phonetic.textContent = item.phonetic;
    definition.textContent = item.definition;
    definition.hidden = !clean(item.definition);
    english.textContent = item.english;
    english.hidden = !clean(item.english);

    clean(item.semantic).split(",").map((value) => clean(value)).filter(Boolean).forEach((value) => {
      tags.append(makeSemanticTag(value));
    });
    if (clean(item.language)) tags.append(makeTag(item.language));
    if (clean(item.category)) tags.append(makeTag(item.category, "category"));

    if (firstAudio) {
      play.title = firstAudio.filename || "Riproduci audio";
      play.addEventListener("pointerdown", (event) => {
        event.stopPropagation();
        event.preventDefault();
        playAudio(audio, play, firstAudio);
      });
      play.addEventListener("click", (event) => {
        event.stopPropagation();
        if (event.detail === 0) playAudio(audio, play, firstAudio);
      });
      audio.addEventListener("pause", () => {
        play.dataset.state = "idle";
      });
      audio.addEventListener("ended", () => {
        play.dataset.state = "idle";
      });
    } else {
      play.disabled = true;
      play.title = "Nessun audio disponibile";
    }

    node.addEventListener("click", () => openDetail(item));
    node.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openDetail(item);
      }
    });

    grid.append(node);
  });

  const total = vocabulary.length;
  const shown = filteredItems.length;
  const visible = items.length;
  loadMore.hidden = visible >= shown;
  setStatus(total ? `${visible} di ${shown} voci` : "Nessuna voce trovata.");
  scheduleEmbedResize();
}

async function loadVocabulary() {
  try {
    const response = await fetch("/api/vocabulary");
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Errore di caricamento.");

    vocabulary = sortByLemma((payload.items || []).map(prepareItem));
    fillSelect(semanticFilter, uniqueOptions(vocabulary, "semantic"));
    updateSemanticState();
    render();
    if (locutionsLoaded) renderLocutions();
  } catch (error) {
    setStatus(error.message, true);
  }
}

[searchInput, italianFilter, englishFilter, semanticFilter].forEach((control) => {
  control.addEventListener("input", () => {
    visibleLimit = initialVisibleLimit;
    if (control === semanticFilter) updateSemanticState();
    scheduleRender();
  });
});

document.querySelector(".alphabet-nav").addEventListener("click", (event) => {
  const button = event.target.closest("[data-letter]");
  if (!button) return;
  activeLetter = button.dataset.letter;
  visibleLimit = initialVisibleLimit;
  updateActiveLetter();
  render();
});

clearFilters.addEventListener("click", () => {
  searchInput.value = "";
  italianFilter.value = "";
  englishFilter.value = "";
  semanticFilter.value = "";
  activeLetter = "";
  visibleLimit = initialVisibleLimit;
  updateActiveLetter();
  updateSemanticState();
  window.clearTimeout(renderTimer);
  render();
});

clearSemanticFilter.addEventListener("click", () => {
  semanticFilter.value = "";
  visibleLimit = initialVisibleLimit;
  updateSemanticState();
  render();
});

loadMore.addEventListener("click", () => {
  visibleLimit += visibleLimitStep;
  render();
});

detailClose.addEventListener("click", closeDetail);
openLocutions.addEventListener("click", showLocutionsView);
closeLocutions.addEventListener("click", showDictionaryView);
openSuggestions.addEventListener("click", showSuggestionsView);
closeSuggestions.addEventListener("click", closeSuggestionsView);
suggestionsForm.addEventListener("submit", sendSuggestion);
suggestAnother.addEventListener("click", resetSuggestionForm);

detailOverlay.addEventListener("click", (event) => {
  if (event.target === detailOverlay) closeDetail();
});

detailPlay.addEventListener("pointerdown", (event) => {
  event.stopPropagation();
  event.preventDefault();
  playAudio(detailAudio, detailPlay, {
    url: detailAudio.dataset.src,
    type: detailAudio.dataset.type
  });
});

detailPlay.addEventListener("click", (event) => {
  event.stopPropagation();
  if (event.detail === 0) {
    playAudio(detailAudio, detailPlay, {
      url: detailAudio.dataset.src,
      type: detailAudio.dataset.type
    });
  }
});

detailAudio.addEventListener("pause", () => {
  detailPlay.dataset.state = "idle";
});

detailAudio.addEventListener("ended", () => {
  detailPlay.dataset.state = "idle";
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !detailOverlay.hidden) closeDetail();
});

if (isEmbedMode) {
  window.addEventListener("load", scheduleEmbedResize);
  window.addEventListener("resize", scheduleEmbedResize);
  if ("ResizeObserver" in window) {
    const resizeObserver = new ResizeObserver(scheduleEmbedResize);
    resizeObserver.observe(document.body);
    resizeObserver.observe(document.documentElement);
  }
}

buildAlphabetBar();
loadVocabulary();
