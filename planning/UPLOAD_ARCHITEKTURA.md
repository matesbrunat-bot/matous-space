# Veřejný upload fotografií

## Stav

Implementace je připravená a lokálně ověřená. Produkční publikování je záměrně podmíněné existencí nasazeného Cloudflare Workeru a Turnstile site key. Bez těchto dvou hodnot generátor zachová dnešní veřejný web bez uploadovacího tlačítka.

## Tok dat

1. `matous.space` zůstává na GitHub Pages.
2. `static/public-upload.js` zmenší fotografii v prohlížeči, vytvoří náhled a odešle oba soubory s metadaty.
3. Cloudflare Worker ověří Origin, jednorázový Turnstile token, velikost, binární signaturu, rozměry, metadata a kvóty.
4. Worker přidělí UUID a uloží plný obrázek i náhled do R2.
5. Metadata jsou u plného R2 objektu; není potřeba katalogová databáze fotografií.
6. Nový snímek má stav `pending`. Veřejný `GET /v1/photos` vrací jen `approved` položky.
7. Veřejná sestava připojí schválené položky ke statickému `data/objects.json`. Stávající mapa, filtry, katalogové vazby a prohlížeč fotografií je zpracují stejně jako lokální snímky.

## Limity

- vstup v prohlížeči: 8 MiB,
- plný zpracovaný obrázek: 4 MiB a nejvýše 4096 px na delší straně,
- náhled: 512 KiB a nejvýše 900 px,
- nejvýše 40 milionů pixelů,
- 1 upload za 60 sekund z jedné IP,
- 10 uploadů denně z jedné IP,
- 25 uploadů a 100 MiB denně globálně,
- 2000 uploadů a 2 GiB celkem.

Kvóty se rezervují před zápisem do R2 a potvrzují až po úspěšném uložení obou souborů. Durable Object serializuje souběžné požadavky, takže paralelní uploady nemohou stejný limit obejít.

## Bezpečnostní vlastnosti

- povolené jsou pouze JPEG, PNG a WebP; SVG ani HTML se nepřijímají,
- MIME typ se porovnává s binární signaturou,
- rozměry se čtou z hlavičky skutečného obrázku,
- uživatel neurčuje R2 cestu ani ID,
- obrázky se servírují z odděleného originu s `nosniff`,
- metadata mají serverové délkové a rozsahové kontroly,
- RA je 0 až méně než 24 hodin, Dec −90 až +90 stupňů,
- veřejné API nemá PUT ani DELETE cestu,
- administrační cesty bez správného tokenu odpovídají 404,
- IP se pro kvóty ukládá pouze jako solený SHA-256 otisk,
- Turnstile token se ověřuje na serveru.

## Produkční prostředky

- Worker: `matous-space-uploads`,
- R2 bucket: `matous-space-photos`,
- preview bucket: `matous-space-photos-preview`,
- Durable Object: `UploadQuota`,
- secrets: `TURNSTILE_SECRET`, `IP_HASH_SALT`, `ADMIN_TOKEN`,
- vars: `ALLOWED_ORIGINS`, `TURNSTILE_HOSTNAMES`, `REQUIRE_APPROVAL`.

Secret hodnoty nepatří do Gitu. Lokální `.dev.vars` je ignorovaný.

## Publikování webu

```powershell
$env:ATLAS_UPLOAD_API_URL = "https://matous-space-uploads.<account>.workers.dev"
$env:ATLAS_TURNSTILE_SITE_KEY = "<public-site-key>"
python publish_web.py
```

Generátor vloží veřejnou konfiguraci, uploadovací modul a dialog. Když některá hodnota chybí, odstraní všechny tři části a nevznikne nefunkční tlačítko.

## Kontrola snímků

Pomocný skript `upload-worker/tools/admin.mjs` podporuje `list`, `approve` a `delete`. Neexistuje k němu veřejné webové rozhraní. Vyžaduje proměnné `UPLOAD_API_URL` a `ADMIN_TOKEN` pouze v prostředí procesu.
