import { fetchVocabulary } from "../_shared/airtable.js";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}

export async function onRequest(context) {
  try {
    const { items, config, cached } = await fetchVocabulary(context.env);
    return json({
      items,
      fieldMap: config.fieldMap,
      tableName: config.tableLabel || config.tableName,
      configSource: config.source,
      cached
    });
  } catch (error) {
    return json({
      error: error.message || "Errore inatteso durante il caricamento del vocabolario."
    }, error.status || 500);
  }
}

