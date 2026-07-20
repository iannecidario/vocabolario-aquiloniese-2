# Pubblicazione su Cloudflare Pages + Functions

Questa configurazione mantiene l'app esistente e aggiunge le API per Cloudflare:

- `public/`: interfaccia del vocabolario.
- `functions/api/vocabulary.js`: API dati Airtable.
- `functions/api/audio/[recordId]/[attachmentId].js`: proxy audio MP3.
- `functions/_shared/airtable.js`: logica condivisa Airtable.
- `wrangler.toml`: configurazione Pages.

## Impostazioni Cloudflare Pages

Nel progetto Cloudflare Pages collegato a GitHub:

- Production branch: `main`
- Build command: `exit 0`
- Build output directory: `public`

## Variabili ambiente

In `Settings > Environment variables`, aggiungere:

```text
AIRTABLE_TOKEN
AIRTABLE_BASE_ID=appV4KvPG7wmYJ9ju
AIRTABLE_TABLE_NAME=Lessico aquiloniese
AIRTABLE_WORD_FIELD=Lemma
AIRTABLE_DEFINITION_FIELD=Significato
AIRTABLE_ENGLISH_FIELD=Inglese
AIRTABLE_SEMANTIC_FIELD=Campo semantico
AIRTABLE_GRAMMAR_FIELD=Grammatica
AIRTABLE_ETYMOLOGY_FIELD=Etimologia
AIRTABLE_IMAGE_FIELD=Immagine
AIRTABLE_AUDIO_FIELD=Pronuncia
```

Opzionali, solo se servono:

```text
AIRTABLE_PHONETIC_FIELD
AIRTABLE_LANGUAGE_FIELD
AIRTABLE_CATEGORY_FIELD
AIRTABLE_VIEW_NAME
```

Non caricare mai `.env` su GitHub.


## Modalita embed iframe

La modalita incorporata si apre con:

```text
https://vocabolario-aquiloniese-2.pages.dev/?embed=true
```

Prima di pubblicare su un sito esterno, modifica `public/_headers` sostituendo:

```text
https://www.DOMINIO-AUTORIZZATO.it
```

con il dominio reale autorizzato a incorporare il vocabolario.
