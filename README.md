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
| Cari | Full-text search Postgres dengan operator ala Obsidian (lihat [Sintaks pencarian](#sintaks-pencarian)); `#tag` saja di kotak cari menampilkan catatan bertag |
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

### Sintaks pencarian

Kotak Search memakai operator ala Obsidian. Huruf besar/kecil tidak dibedakan, termasuk nama operator dan `OR`.

| Sintaks | Arti | Contoh |
|---|---|---|
| `kata kata` | Semua kata harus ada, dicocokkan sebagai awalan (`rea` menemukan `reading`) | `rapat anggaran` |
| `"frasa"` | Kata berurutan, kata terakhir sebagai awalan | `"daftar bacaan"` |
| `-kata`, `-"frasa"` | Kecualikan; berlaku juga untuk operator dan grup | `rendang -santan`, `-tag:arsip`, `-(a OR b)` |
| `a OR b` | Salah satu cocok. Spasi (AND) mengikat lebih kuat: `a b OR c` berarti `(a b) OR c` | `rendang OR soto` |
| `( … )` | Pengelompokan | `(rendang OR soto) tag:resep` |
| `file:teks` | Nama catatan mengandung teks | `file:roadmap`, `file:"rapat mingguan"` |
| `path:teks` | Path catatan mengandung teks (cari per folder) | `path:Projects/Nexus` |
| `tag:#nama` atau `tag:nama` | Catatan punya tag itu atau tag turunannya (`nama/…`) | `tag:project` juga menemukan `#project/nexus` |
| `line:( … )` | Semua term ada di baris yang sama | `line:(campur tepung)`, `line:"brown fox"`, `line:(mix -flour)` |

- Query kosong atau yang hanya berisi operator (misalnya `tag:resep` atau `-draft`) mengembalikan catatan yang lolos filter, urut path, tanpa snippet. Snippet dengan penanda `<< >>` hanya muncul kalau ada kata atau frasa positif.
- Input rusak tidak menghasilkan error: kutip yang tidak ditutup berlaku sampai akhir, sedangkan kurung yang tidak seimbang, `-` sendirian, `OR` yang menggantung, dan operator kosong diabaikan. Query dipotong 200 karakter dan hasil maksimal 50 catatan. Untuk mencari kata "or", tulis `"or"`.
- Setiap kata disaring menjadi huruf (beserta tanda diakritiknya), angka, `_`, dan `-` sebelum masuk `to_tsquery`, jadi karakter seperti `' & | ! : * ( ) \` tidak pernah menjadi sintaks tsquery. Semua nilai dari query dikirim sebagai parameter SQL lewat template `sql` Drizzle, wildcard `LIKE` (`%`, `_`, `\`) di-escape, dan setiap query selalu dibatasi `vault_id` milik user.
- Kata dan frasa dicocokkan ke kolom `note.search` (tsvector `simple` dengan indeks GIN), satu `@@` per kelompok AND/OR, sehingga indeks GIN tetap terpakai.
- `line:` dijalankan di SQL, bukan dengan regex atau filter di TypeScript: konten dipecah per baris dengan `string_to_table`, lalu tiap baris diuji dengan `to_tsvector('simple', baris) @@ to_tsquery(...)`. Aturan katanya sama dengan pencarian biasa (awalan, frasa, negasi), tidak ada regex yang dibangun dari input user, dan isi catatan tidak perlu dikirim ke aplikasi. Kandidat dipersempit dulu oleh indeks GIN sebelum baris dipecah.
- Implementasi: `src/lib/search.ts` (`parseQuery` mengubah query menjadi AST, lalu AST diterjemahkan ke SQL).

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
src/db/schema.ts              skema (auth + vault, folder, note, link, tag)
src/lib/notes.ts              logika vault: CRUD, indexing link/tag, rename + rewrite link, search, graph, impor/ekspor
src/lib/search.ts             pencarian ala Obsidian: parser query (AST) dan penerjemahnya ke SQL, dipakai /api/search
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
