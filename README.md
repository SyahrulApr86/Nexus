> Klasifikasi: **INTERNAL**

# Nexus

Aplikasi catatan markdown di web, mirip Obsidian: `[[wikilink]]`, backlink, tag, graph view, dan daily note. Bisa dipakai dari laptop maupun HP. Setiap catatan tetap berupa markdown murni, dan seluruh vault bisa diekspor ke `.zip` yang langsung terbaca oleh Obsidian.

## Fitur (fase 1)

| Area | Fitur |
|---|---|
| Editor | CodeMirror 6, heading berukuran, autocomplete `[[` dan `#tag`, autosave, mode baca (`Ctrl+E`) |
| Link | `[[Note]]`, `[[Note\|alias]]`, `[[Note#heading]]`, `![[embed]]` (masih berupa link), Ctrl/Cmd+klik untuk membuka, link yang belum ada otomatis dibuat saat diklik |
| Rename | Ganti nama atau pindah catatan otomatis memperbarui semua link yang mengarah ke catatan itu |
| Navigasi | File tree dengan folder dan drag-drop, tab, quick switcher (`Ctrl+O`), command palette (`Ctrl+P`) |
| Panel | Backlink, link keluar, outline heading |
| Cari | Full-text search Postgres (prefix match, snippet ber-highlight) |
| Tag | `#tag`, tag bertingkat `#a/b`, tag dari frontmatter YAML |
| Graph | Force-directed, zoom/pan/pinch, filter, node "belum ada" |
| Lainnya | Daily note (`Ctrl+D`), checklist yang bisa diklik di mode baca, `==highlight==`, tema terang/gelap |
| Data | Impor vault Obsidian (`.zip` atau `.md`), ekspor ke `.zip` |
| Akun | Email + password (Better Auth), skema sudah multi-user dan multi-vault |

## Stack

Next.js 16 (App Router, Cache Components) · PostgreSQL 17 · Drizzle ORM · Better Auth · CodeMirror 6 · unified/remark · d3-force · Tailwind CSS 4

## Menjalankan di lokal

Prasyarat: Node 24+, pnpm, Docker.

```bash
cp .env.example .env          # isi POSTGRES_PASSWORD dan BETTER_AUTH_SECRET (openssl rand -base64 32)
pnpm install
pnpm db:up                    # Postgres di 127.0.0.1:5442
pnpm db:migrate
pnpm dev                      # http://localhost:3000
```

Buka `/signup`, buat akun, lalu masuk ke `/vault`.

## Deploy (VPS mana pun)

```bash
# .env di server: POSTGRES_PASSWORD, BETTER_AUTH_SECRET, BETTER_AUTH_URL=https://domain-anda
docker compose --profile prod up -d --build
```

Compose menjalankan tiga service: `db` (Postgres), `migrate` (menerapkan migrasi lalu berhenti), dan `app` (server Next.js standalone, user non-root). Pasang reverse proxy (Caddy/Nginx) dengan HTTPS di depan port `APP_PORT` (default 3000).

Kalau pool network Docker di host penuh, atur `NEXUS_SUBNET` di `.env`.

Pindah server: ekspor vault (`Ctrl+P` lalu pilih "Ekspor vault"), atau `pg_dump` database, lalu jalankan compose di server baru.

## Perubahan skema

```bash
# edit src/db/schema.ts
pnpm db:generate   # buat file SQL di drizzle/
pnpm db:migrate
```

## Struktur

```
src/db/schema.ts              skema (auth + vault, folder, note, link, tag)
src/lib/notes.ts              logika vault: CRUD, indexing link/tag, rename + rewrite link, search, graph, impor/ekspor
src/lib/markdown/parse.ts     ekstraksi wikilink, tag, heading, frontmatter (dipakai server dan client)
src/lib/markdown/render.ts    markdown ke HTML (sanitized) untuk mode baca
src/app/api/*                 REST API (semua query dibatasi ke vault milik user)
src/components/workspace/*    UI: editor, file tree, panel, palette, graph
```

## Belum ada (roadmap)

- Live preview ala Obsidian (sembunyikan sintaks markdown di baris yang tidak aktif)
- Lampiran gambar/PDF (butuh object storage S3-compatible) dan transclusion `![[note]]`
- Callout `> [!note]`, Mermaid, LaTeX/KaTeX
- Template, bookmark, riwayat versi catatan
- Canvas (`.canvas`), publish halaman publik, kolaborasi real-time (Yjs)
- Siap dipasarkan: verifikasi email dan reset password (perlu provider email), rate limit, kuota per user, billing, kebijakan privasi sesuai UU PDP
