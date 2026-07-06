const linkedBaseId = "appV4KvPG7wmYJ9ju";
const cacheTtlMs = 10 * 60 * 1000;

let vocabularyCache = null;
let vocabularyCacheExpiresAt = 0;
let vocabularyCachePromise = null;

function readEnv(env) {
  return {
    token: env.AIRTABLE_TOKEN,
    baseId: env.AIRTABLE_BASE_ID || linkedBaseId,
    tableName: env.AIRTABLE_TABLE_NAME,
    viewName: env.AIRTABLE_VIEW_NAME
  };
}

function readFieldOverrides(env) {
  return {
    word: env.AIRTABLE_WORD_FIELD,
    phonetic: env.AIRTABLE_PHONETIC_FIELD,
    definition: env.AIRTABLE_DEFINITION_FIELD,
    english: env.AIRTABLE_ENGLISH_FIELD,
    semantic: env.AIRTABLE_SEMANTIC_FIELD,
    grammar: env.AIRTABLE_GRAMMAR_FIELD,
    etymology: env.AIRTABLE_ETYMOLOGY_FIELD,
    image: env.AIRTABLE_IMAGE_FIELD,
    language: env.AIRTABLE_LANGUAGE_FIELD,
    category: env.AIRTABLE_CATEGORY_FIELD,
    audio: env.AIRTABLE_AUDIO_FIELD
  };
}

function defaultFieldMap(env) {
  const overrides = readFieldOverrides(env);
  return {
    word: overrides.word || "Word",
    phonetic: overrides.phonetic || "Phonetic",
    definition: overrides.definition || "Definition",
    english: overrides.english || "Inglese",
    semantic: overrides.semantic || "Campi semantici",
    grammar: overrides.grammar || "Grammatica",
    etymology: overrides.etymology || "Etimologia",
    image: overrides.image || "Immagine",
    language: overrides.language || "Language",
    category: overrides.category || "Category",
    audio: overrides.audio || "Audio"
  };
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function findField(fields, candidates, types = []) {
  const allowed = new Set(types);
  const usable = fields.filter((field) => !allowed.size || allowed.has(field.type));
  const normalizedCandidates = candidates.map(normalizeName);

  return (
    usable.find((field) => normalizedCandidates.includes(normalizeName(field.name))) ||
    usable.find((field) => normalizedCandidates.some((candidate) => normalizeName(field.name).includes(candidate))) ||
    null
  );
}

async function fetchSchema(config) {
  const response = await fetch(`https://api.airtable.com/v0/meta/bases/${config.baseId}/tables`, {
    headers: {
      authorization: `Bearer ${config.token}`
    }
  });

  if (!response.ok) {
    const details = await response.text();
    const tokenHint = config.token && config.token.length < 40
      ? " Sembra che tu abbia inserito il Token ID, non il token segreto completo."
      : "";
    const error = new Error(`Non riesco a leggere lo schema Airtable (${response.status}).${tokenHint} Dettaglio: ${details}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function inferFieldMap(env, table) {
  const overrides = readFieldOverrides(env);
  const fields = table.fields || [];
  const textTypes = ["singleLineText", "multilineText", "richText", "email", "url", "phoneNumber", "formula"];
  const optionTypes = ["singleSelect", "multipleSelects", "singleLineText", "formula"];
  const audioField =
    overrides.audio ||
    findField(fields, ["audio", "mp3", "suono", "sound", "pronuncia audio", "file audio"], ["multipleAttachments"])?.name ||
    findField(fields, ["attachment", "allegato", "file"], ["multipleAttachments"])?.name ||
    fields.find((field) => field.type === "multipleAttachments")?.name ||
    "Audio";

  return {
    word: overrides.word || findField(fields, ["word", "parola", "lemma", "termine", "term", "vocabolo"], textTypes)?.name || fields[0]?.name || "Word",
    phonetic: overrides.phonetic || findField(fields, ["phonetic", "fonetica", "ipa", "pronuncia", "pronunciation", "trascrizione"], textTypes)?.name || "Phonetic",
    definition: overrides.definition || findField(fields, ["definition", "definizione", "meaning", "significato", "descrizione", "note"], textTypes)?.name || "Definition",
    english: overrides.english || findField(fields, ["english", "inglese", "traduzione inglese"], textTypes)?.name || "Inglese",
    semantic: overrides.semantic || findField(fields, ["campi semantici", "campo semantico", "semantic fields", "semantic field", "semantica"], optionTypes)?.name || "Campi semantici",
    grammar: overrides.grammar || findField(fields, ["grammar", "grammatica", "categoria grammaticale"], textTypes)?.name || "Grammatica",
    etymology: overrides.etymology || findField(fields, ["etymology", "etimologia", "origine"], textTypes)?.name || "Etimologia",
    image: overrides.image || findField(fields, ["image", "immagine", "foto", "picture"], ["multipleAttachments"])?.name || "Immagine",
    language: overrides.language || findField(fields, ["language", "lingua", "lang"], optionTypes)?.name || "Language",
    category: overrides.category || findField(fields, ["category", "categoria", "type", "tipo", "classe", "gruppo"], optionTypes)?.name || "Category",
    audio: audioField
  };
}

function pickVocabularyTable(tables, tableName) {
  if (tableName) {
    return tables.find((table) => table.name === tableName || table.id === tableName);
  }

  return (
    tables.find((table) => (table.fields || []).some((field) => field.type === "multipleAttachments" && /audio|mp3|suono|sound|pronuncia/i.test(field.name))) ||
    tables.find((table) => (table.fields || []).some((field) => field.type === "multipleAttachments")) ||
    tables[0]
  );
}

async function resolveAirtableConfig(env, config) {
  const hasManualConfig = config.tableName && env.AIRTABLE_AUDIO_FIELD;
  if (hasManualConfig) {
    try {
      const schema = await fetchSchema(config);
      const table = pickVocabularyTable(schema.tables || [], config.tableName);
      if (table) {
        const fieldMap = defaultFieldMap(env);
        return {
          tableName: config.tableName,
          tableLabel: table.name,
          fieldMap,
          linkedTables: findLinkedTables(table, fieldMap),
          schema,
          source: "manuale"
        };
      }
    } catch {
      // Manual configuration can still work without schema access.
    }

    return {
      tableName: config.tableName,
      fieldMap: defaultFieldMap(env),
      source: "manuale"
    };
  }

  const schema = await fetchSchema(config);
  const table = pickVocabularyTable(schema.tables || [], config.tableName);
  if (!table) {
    const error = new Error("Non ho trovato tabelle nella base Airtable.");
    error.status = 404;
    throw error;
  }

  const fieldMap = inferFieldMap(env, table);
  return {
    tableName: table.id,
    tableLabel: table.name,
    fieldMap,
    linkedTables: findLinkedTables(table, fieldMap),
    schema,
    source: "auto"
  };
}

function findLinkedTables(table, fieldMap) {
  const fields = table.fields || [];
  const semanticField = fields.find((field) => field.name === fieldMap.semantic);
  return {
    semantic: semanticField?.options?.linkedTableId || null
  };
}

function attachmentToAudio(file) {
  if (!file || !file.url) return null;
  return {
    id: file.id,
    filename: file.filename || "audio.mp3",
    url: file.url,
    type: file.type || "audio/mpeg",
    size: file.size || null
  };
}

function attachmentToImage(file) {
  if (!file || !file.url) return null;
  return {
    id: file.id,
    filename: file.filename || "immagine",
    url: file.url,
    type: file.type || "image/jpeg",
    size: file.size || null,
    width: file.width || null,
    height: file.height || null
  };
}

function fieldValueToText(value, lookup = {}) {
  if (Array.isArray(value)) return value.map((item) => lookup[item] || item).join(", ");
  return value || "";
}

function normalizeRecord(record, fieldMap, linkedLookups = {}) {
  const fields = record.fields || {};
  const attachments = Array.isArray(fields[fieldMap.audio]) ? fields[fieldMap.audio] : [];
  const audio = attachments.map(attachmentToAudio).filter(Boolean);
  const imageAttachments = Array.isArray(fields[fieldMap.image]) ? fields[fieldMap.image] : [];
  const images = imageAttachments.map(attachmentToImage).filter(Boolean);

  return {
    id: record.id,
    word: fieldValueToText(fields[fieldMap.word]),
    phonetic: fieldValueToText(fields[fieldMap.phonetic]),
    definition: fieldValueToText(fields[fieldMap.definition]),
    english: fieldValueToText(fields[fieldMap.english]),
    semantic: fieldValueToText(fields[fieldMap.semantic], linkedLookups.semantic),
    grammar: fieldValueToText(fields[fieldMap.grammar]),
    etymology: fieldValueToText(fields[fieldMap.etymology]),
    images,
    language: fieldValueToText(fields[fieldMap.language]),
    category: fieldValueToText(fields[fieldMap.category]),
    audio,
    updatedAt: record.createdTime || null
  };
}

async function fetchRecords(config, tableNameOrId, viewName = "") {
  const encodedTable = encodeURIComponent(tableNameOrId);
  const url = new URL(`https://api.airtable.com/v0/${config.baseId}/${encodedTable}`);
  url.searchParams.set("pageSize", "100");
  if (viewName) url.searchParams.set("view", viewName);

  const records = [];
  let offset = "";

  do {
    if (offset) url.searchParams.set("offset", offset);
    const response = await fetch(url, {
      headers: {
        authorization: `Bearer ${config.token}`
      }
    });

    if (!response.ok) {
      const details = await response.text();
      const error = new Error(`Airtable ha risposto con ${response.status}: ${details}`);
      error.status = response.status;
      throw error;
    }

    const page = await response.json();
    records.push(...(page.records || []));
    offset = page.offset || "";
  } while (offset);

  return records;
}

async function buildLinkedLookups(config, resolvedConfig) {
  const semanticTableId = resolvedConfig.linkedTables?.semantic;
  const semanticTable = resolvedConfig.schema?.tables?.find((table) => table.id === semanticTableId);
  if (!semanticTableId || !semanticTable) return {};

  const primaryField = semanticTable.fields?.[0]?.name;
  if (!primaryField) return {};

  const records = await fetchRecords(config, semanticTableId);
  return {
    semantic: Object.fromEntries(records.map((record) => [record.id, fieldValueToText(record.fields?.[primaryField])]))
  };
}

export async function fetchVocabulary(env) {
  const now = Date.now();
  if (vocabularyCache && now < vocabularyCacheExpiresAt) {
    return {
      ...vocabularyCache,
      cached: true
    };
  }

  if (vocabularyCachePromise) return vocabularyCachePromise;

  vocabularyCachePromise = fetchVocabularyFromAirtable(env)
    .then((payload) => {
      vocabularyCache = payload;
      vocabularyCacheExpiresAt = Date.now() + cacheTtlMs;
      return {
        ...payload,
        cached: false
      };
    })
    .finally(() => {
      vocabularyCachePromise = null;
    });

  return vocabularyCachePromise;
}

async function fetchVocabularyFromAirtable(env) {
  const config = readEnv(env);
  const missing = Object.entries(config)
    .filter(([key, value]) => !["viewName", "tableName"].includes(key) && !value)
    .map(([key]) => key);

  if (missing.length) {
    const message = `Configurazione Airtable incompleta: ${missing.join(", ")}.`;
    const error = new Error(message);
    error.status = 500;
    throw error;
  }

  const resolvedConfig = await resolveAirtableConfig(env, config);
  const records = await fetchRecords(config, resolvedConfig.tableName, config.viewName);
  const linkedLookups = await buildLinkedLookups(config, resolvedConfig);

  return {
    items: records.map((record) => normalizeRecord(record, resolvedConfig.fieldMap, linkedLookups)).filter((item) => item.word || item.audio.length),
    config: resolvedConfig
  };
}

