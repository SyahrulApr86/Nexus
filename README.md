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

## Alur kerja git

- Branch integrasi: `develop`. Commit memakai format conventional commits (`feat:`, `fix:`, `docs:`, `chore:`, `design:`).
- Setiap agen yang mengubah file bekerja di worktree dan branch sendiri (`../nexus-worktrees/<nama>`), lalu di-merge ke `develop`.

## Perubahan skema

```bash
# edit src/db/schema.ts
pnpm db:generate   # buat file SQL di drizzle/
pnpm db:migrate
```

## Struktur

```
src/db/schema.ts              skema (auth + vault, folder, note, link, tag, note_revision, bookmark)
src/lib/notes.ts              logika vault: CRUD, indexing link/tag, rename + rewrite link, search, graph, impor/ekspor
src/lib/history.ts            riwayat catatan: kebijakan snapshot, retensi, baca revisi
src/lib/bookmarks.ts          bookmark: tambah, hapus, urutkan
src/lib/markdown/parse.ts     ekstraksi wikilink, tag, heading, frontmatter (dipakai server dan client)
src/lib/markdown/render.ts    markdown ke HTML (sanitized) untuk mode baca
src/app/api/*                 REST API (semua query dibatasi ke vault milik user)
src/components/workspace/*    UI: editor, file tree, panel, palette, graph
```

## API riwayat catatan dan bookmark

Backend untuk dua core plugin Obsidian, File recovery dan Bookmarks. UI-nya belum ada. Semua endpoint butuh session login dan hanya membaca atau mengubah vault milik user. Catatan, revisi, atau bookmark dari vault lain dijawab `404`.

### Riwayat catatan

Sebelum isi catatan ditimpa (autosave, impor yang menimpa catatan, rewrite link saat rename, restore), isi lama disimpan sebagai revisi di tabel `note_revision`.

| Aturan | Nilai |
|---|---|
| Jarak antar revisi per catatan | Minimal 5 menit. Restore selalu menyimpan isi yang ditimpanya. |
| Tidak disimpan | Isi tidak berubah, atau isi lama sama dengan revisi terbaru |
| Retensi | 50 revisi terbaru per catatan, tidak ada yang lebih tua dari 30 hari |

| Method | Endpoint | Hasil |
|---|---|---|
| GET | `/api/notes/[id]/history` | `[{ id, createdAt, reason, size, preview }]`, terbaru dulu. `size` dalam byte. `reason`: `autosave`, `rename`, `restore`, atau `import`. |
| GET | `/api/notes/[id]/history/[revisionId]` | `{ id, createdAt, reason, content }` |
| POST | `/api/notes/[id]/history/[revisionId]/restore` | Menulis isi revisi ke catatan lewat `updateContent`, lalu link dan tag di-reindex. Hasil `{ id, updatedAt }`. |

### Bookmark

Satu daftar catatan berurutan per vault, di tabel `bookmark`. Bookmark ikut terhapus saat catatannya dihapus.

| Method | Endpoint | Hasil |
|---|---|---|
| GET | `/api/bookmarks` | `[{ noteId, path, name, position }]`, urut `position` |
| POST | `/api/bookmarks`, body `{ noteId }` | Menambah di akhir daftar. Kalau catatan sudah di-bookmark, bookmark lama dikembalikan tanpa perubahan. |
| DELETE | `/api/bookmarks?noteId=` | Menghapus bookmark. `404` kalau catatan itu tidak di-bookmark. |
| PATCH | `/api/bookmarks`, body `{ order: noteId[] }` | Menomori ulang `position` sesuai `order`. Id yang tidak di-bookmark di vault ini diabaikan. Bookmark yang tidak disebut menyusul dengan urutan lamanya. Hasil daftar baru. |

## Belum ada (roadmap)

- Live preview ala Obsidian (sembunyikan sintaks markdown di baris yang tidak aktif)
- Lampiran gambar/PDF (butuh object storage S3-compatible) dan transclusion `![[note]]`
- Callout `> [!note]`, Mermaid, LaTeX/KaTeX
- Template, serta UI untuk bookmark dan riwayat versi catatan (API sudah ada)
- Canvas (`.canvas`), publish halaman publik, kolaborasi real-time (Yjs)
- Siap dipasarkan: verifikasi email dan reset password (perlu provider email), rate limit, kuota per user, billing, kebijakan privasi sesuai UU PDP
