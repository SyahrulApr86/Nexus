> Klasifikasi: **INTERNAL**

# Nexus

Aplikasi catatan markdown di web, mirip Obsidian: `[[wikilink]]`, backlink, tag, graph view, dan daily note. Bisa dipakai dari laptop maupun HP. Setiap catatan tetap berupa markdown murni, dan seluruh vault bisa diekspor ke `.zip` yang langsung terbaca oleh Obsidian.

## Fitur

Antarmuka berbahasa Inggris dengan tata letak Obsidian: ribbon, file explorer dan search di kiri, tab dan split pane di tengah, backlink, outgoing links, tags, dan outline di kanan, serta status bar.

| Area | Fitur |
|---|---|
| Editor | CodeMirror 6, Literata untuk isi catatan, autocomplete `[[` dan `#tag`, autosave, mode baca |
| Link | `[[Note]]`, `[[Note\|alias]]`, `[[Note#heading]]`, `![[embed]]` (masih berupa link), Ctrl/Cmd+klik untuk membuka, link yang belum ada dibuat saat diklik |
| Rename | Ganti nama atau pindah catatan otomatis memperbarui semua link yang mengarah ke catatan itu |
| Navigasi | File explorer (keyboard: panah, Enter, F2, Delete, Shift+F10), tab dengan riwayat ←/→ per tab, split ke kanan, quick switcher, command palette |
| Panel kanan | Linked mentions (dengan konteks baris), unlinked mentions dengan tombol Link, outgoing links, tags, outline |
| Cari | Full-text search Postgres; `#tag` di kotak cari menampilkan catatan bertag |
| Graph | Tab graph view (force-directed, zoom, pan, pinch, filter nama atau `#tag`), mode daftar untuk keyboard dan screen reader |
| Lainnya | Daily note, checklist yang bisa diklik di mode baca, `==highlight==`, tema ikut sistem/terang/navy |
| Data | Impor vault Obsidian (`.zip` atau `.md`) dan ekspor `.zip` dari Settings |
| Akun | Email + password (Better Auth), skema sudah multi-user dan multi-vault |

### Hotkey

| Aksi | Tombol |
|---|---|
| Quick switcher | `Ctrl/⌘+O` |
| Command palette | `Ctrl/⌘+P` |
| Catatan baru | `Alt+N` |
| Mode baca / edit | `Ctrl/⌘+E` |
| Cari di semua catatan | `Ctrl/⌘+Shift+F` |
| Graph view | `Ctrl/⌘+G` |
| Daily note | `Ctrl/⌘+D` |
| Tab baru / tutup tab | `Alt+T` / `Alt+W` |
| Tab berikut / sebelumnya | `Alt+]` / `Alt+[` |
| Kembali / maju | `Ctrl/⌘+Alt+←` / `Ctrl/⌘+Alt+→` |
| Settings | `Ctrl/⌘+,` |

Browser mengunci `Ctrl+N`, `Ctrl+T`, `Ctrl+W`, dan `Ctrl+Tab`, jadi aksi itu memakai `Alt`.

## Desain

- Palet pemilik: navy `#02070A`, biru `#0297DE` (link, item aktif, fokus), oranye `#FC734D` (tag, highlight, hasil cari). Semua pasangan teks ≥ 4.5:1.
- Font: Literata (isi catatan), Hanken Grotesk (UI), JetBrains Mono (kode), di-host sendiri oleh `next/font`.
- Catatan proses: `PRODUCT.md` (kebenaran produk), `.impeccable/surfaces/` (kontrak arah per halaman), `.taste-skill/app/direction.json` (gaya app yang dibagikan design-taste).

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

## Pasang sebagai aplikasi (PWA)

Nexus bisa di-install di HP dan desktop. Manifest ada di `src/app/manifest.ts` (disajikan di `/manifest.webmanifest`): jendela `standalone`, langsung membuka `/vault`, warna navy `#02070a`.

- Chrome/Edge (desktop dan Android): pilih Install dari ikon di address bar atau dari menu browser.
- Safari di iPhone/iPad: Share, lalu Add to Home Screen.

Chrome/Edge hanya menawarkan Install di HTTPS (atau `localhost`). Belum ada service worker, jadi belum ada mode offline: aplikasi yang ter-install tetap butuh koneksi ke server.

Ikon berupa tanda `[[ ]]` dari JetBrains Mono Bold (OFL), biru `#0297DE` di atas navy `#02070A`, dibuat dengan ImageMagick dan dipaskan ke grid piksel di tiap ukuran: `src/app/favicon.ico` (16/32/48), `src/app/icon.png` (512), `src/app/apple-icon.png` (180), `public/icons/` (192, 512, maskable 512).

## Alur kerja git

- Branch integrasi: `develop`. Commit memakai format conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `design:`).
- Setiap agen yang mengubah file bekerja di worktree dan branch sendiri (`../nexus-worktrees/<nama>`), lalu di-merge ke `develop`.

## Perubahan skema

```bash
# edit src/db/schema.ts
pnpm db:generate   # buat file SQL di drizzle/
pnpm db:migrate
```

## Tes

| Perintah | Cakupan |
|---|---|
| `pnpm test:unit` | `tests/unit`: parser dan renderer markdown, termasuk payload XSS. Tanpa database. |
| `pnpm test:integration` | `tests/integration`: fungsi vault di `src/lib/notes.ts` terhadap Postgres. |
| `pnpm test` | Keduanya. |

Tes integrasi memakai database `nexus_test`, terpisah dari database `nexus` milik `pnpm dev`. Dengan service `db` dari `pnpm db:up` sudah jalan:

```bash
docker compose exec -T db psql -U nexus -c "CREATE DATABASE nexus_test"   # sekali saja
export TEST_DATABASE_URL="postgres://nexus:$(grep ^POSTGRES_PASSWORD= .env | cut -d= -f2-)@127.0.0.1:5442/nexus_test"
DATABASE_URL="$TEST_DATABASE_URL" node scripts/migrate.mjs   # ulangi setiap ada migrasi baru di drizzle/
pnpm test
```

- `export` hanya berlaku di shell tempat ia dijalankan. Perintah di atas menyusun URL dari `.env` tanpa mencetak password; kalau password memuat `/`, `@`, `:`, `#`, atau `?`, karakter itu harus di-percent-encode di URL.
- Tanpa `TEST_DATABASE_URL`, tes integrasi di-skip dengan pesan. Di CI (variabel `CI` terisi) kondisi yang sama membuat run gagal.
- Database yang namanya tidak mengandung `test` ditolak, karena tes menulis dan menghapus data.
- Setiap file tes membuat user dengan dua vault sendiri, lalu menghapusnya setelah selesai.
- Di checkout baru, jalankan `pnpm exec next typegen` sebelum `pnpm typecheck`. Tipe route seperti `LayoutProps` dibuat oleh Next.

CI (`.github/workflows/ci.yml`) berjalan di setiap push dan pull request: typecheck, ESLint, tes unit, tes integrasi terhadap service `postgres:17-alpine` setelah migrasi diterapkan, `next build`, dan `docker build --target runner`.

## Struktur

```
src/db/schema.ts              skema (auth + vault, folder, note, link, tag)
src/lib/notes.ts              logika vault: CRUD, indexing link/tag, rename + rewrite link, search, graph, impor/ekspor
src/lib/markdown/parse.ts     ekstraksi wikilink, tag, heading, frontmatter (dipakai server dan client)
src/lib/markdown/render.ts    markdown ke HTML (sanitized) untuk mode baca
src/app/api/*                 REST API (semua query dibatasi ke vault milik user)
src/components/workspace/*    UI: editor, file tree, panel, palette, graph
tests/unit/                   tes parser dan renderer markdown, tanpa database
tests/integration/            tes fungsi vault terhadap Postgres (database nexus_test)
.github/workflows/ci.yml      CI: typecheck, lint, tes, build, image Docker
```

## Belum ada (roadmap)

- Live preview ala Obsidian (sembunyikan sintaks markdown di baris yang tidak aktif)
- Lampiran gambar/PDF (butuh object storage S3-compatible) dan transclusion `![[note]]`
- Callout `> [!note]`, Mermaid, LaTeX/KaTeX
- Template, bookmark, riwayat versi catatan
- Canvas (`.canvas`), publish halaman publik, kolaborasi real-time (Yjs)
- Service worker dan mode offline untuk PWA
- Siap dipasarkan: verifikasi email dan reset password (perlu provider email), rate limit, kuota per user, billing, kebijakan privasi sesuai UU PDP
