import { fetchLocutions } from "../_shared/airtable.js";

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
    const { items, config, cached } = await fetchLocutions(context.env);
    return json({ items, tableName: config.tableName, fieldMap: config.fieldMap, cached });
  } catch (error) {
    return json({
      error: error.message || "Errore inatteso durante il caricamento delle locuzioni."
    }, error.status || 500);
  }
}
