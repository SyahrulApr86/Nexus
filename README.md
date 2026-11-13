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
| Data | Impor vault Obsidian (`.zip` atau `.md`, termasuk lampiran) dan ekspor `.zip` dari Settings |
| Lampiran | Gambar, PDF, audio, dan video disimpan di disk server (lihat [Lampiran](#lampiran)); API sudah ada, UI tempel/seret menyusul |
| Akun | Email + password (Better Auth), skema sudah multi-user dan multi-vault |

### Markdown ala Obsidian di mode baca

- Callout `> [!note]`, `> [!warning]+ Judul`, `> [!faq]- Judul` (bisa dilipat), semua tipe dan alias Obsidian
- Matematika `$inline$` dan `$$blok$$` (KaTeX, `trust` mati); "$5 dan $10" tetap teks
- Diagram Mermaid di blok ```` ```mermaid ```` (dimuat hanya bila dipakai, `securityLevel: strict`, warna ikut tema)
- Embed catatan `![[Catatan]]` dan `![[Catatan#Heading]]` saat berdiri sendiri di satu baris (maksimal 2 tingkat, siklus dicegah)
- Komentar `%%…%%` disembunyikan; footnote `[^1]` menggulir di dalam catatan
- Lampiran: `![[foto.png]]`, `![[foto.png|300]]`, `![[foto.png|300x200]]`, `![alt](foto.png)`, `![alt](sub/nama%20file.png)` menjadi `<img loading="lazy">`; audio dan video menjadi pemutar dengan kontrol; PDF menjadi kartu link yang terbuka di tab baru. Target dicari seperti Obsidian: path persis dulu, lalu nama file dengan path terpendek. Lampiran yang tidak ada tampil sebagai label pudar seperti link catatan yang belum ada, tetapi tidak bisa diklik. Gambar eksternal `![](https://…)` sengaja dirender sebagai link, bukan `<img>` (lihat CSP di bawah).

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
cp .env.example .env          # POSTGRES_PASSWORD: openssl rand -hex 32, BETTER_AUTH_SECRET: openssl rand -base64 32
pnpm install
pnpm db:up                    # Postgres di 127.0.0.1:5442
pnpm db:migrate
pnpm dev                      # http://localhost:3000
```

Pendaftaran tertutup secara default. Untuk membuat akun pertama, set `NEXUS_ALLOW_SIGNUP=true` di `.env`, jalankan ulang `pnpm dev`, buka `/signup`, buat akun, lalu masuk ke `/vault`. Setelah itu kembalikan ke `false`.

## Deploy (VPS mana pun)

```bash
# .env di server (lihat .env.example):
#   POSTGRES_PASSWORD, APP_DB_PASSWORD   openssl rand -hex 32 (harus aman untuk URL)
#   BETTER_AUTH_SECRET                   openssl rand -base64 32
#   BETTER_AUTH_URL=https://domain-anda  wajib https
docker compose --profile prod up -d --build
```

Compose menjalankan tiga service: `db` (Postgres), `migrate` (menerapkan migrasi lalu berhenti), dan `app` (server Next.js standalone, user non-root, healthcheck, log dirotasi 5 x 10 MB). Pasang reverse proxy (Caddy/Nginx) dengan HTTPS di depan `127.0.0.1:APP_PORT` (default 3000).

Kalau pool network Docker di host penuh, atur `NEXUS_SUBNET` di `.env`.

Lampiran disimpan di volume `appdata` (`/data` di container `app`, diatur lewat `NEXUS_DATA_DIR`), terpisah dari database. Backup yang lengkap selalu berisi keduanya, diambil berdekatan:

```bash
docker compose exec -T db pg_dump -U nexus nexus > nexus-$(date +%F).sql
docker compose --profile prod exec -T app tar czf - -C /data . > nexus-data-$(date +%F).tgz
```

Restore: pulihkan database, lalu ekstrak arsip ke volume `appdata` (misalnya `docker compose --profile prod exec -T app tar xzf - -C /data < nexus-data-<tanggal>.tgz`). Database tanpa volume berarti lampiran tampil sebagai file hilang; volume tanpa database tidak berguna (file disimpan dengan nama hash).

Pindah server: ekspor vault (`Ctrl+P` lalu pilih "Ekspor vault", berisi catatan dan lampiran), atau backup di atas, lalu jalankan compose di server baru.

### Keamanan deploy

| Aturan | Alasan |
|---|---|
| Port app hanya di `127.0.0.1` (sudah begitu di `docker-compose.yml`). Jangan ubah ke `0.0.0.0`, dan pastikan `http://<ip-server>:3000` tidak bisa dibuka dari luar. | Kalau Next bisa dicapai langsung, klien bebas mengisi `X-Forwarded-For` sendiri dan lolos dari rate limit login, dan cookie lewat HTTP polos. |
| Reverse proxy **menimpa** `X-Forwarded-For` dengan alamat peer, bukan menambahkannya. Nginx: `proxy_set_header X-Forwarded-For $remote_addr;` (bukan `$proxy_add_x_forwarded_for`). Caddy: biarkan default dan jangan set `trusted_proxies`. | Rate limit Better Auth (sign-in 5 per menit, sign-up 5 per jam per IP) memakai header ini. Kalau ada lebih dari satu proxy, isi `NEXUS_TRUSTED_PROXIES` dengan IP/CIDR proxy itu. |
| Batasi ukuran body di proxy juga. Nginx: `client_max_body_size 51m;` di `location /api/vault/import`, `26m` di `location = /api/attachments`, `12m` di tempat lain. Caddy: `request_body { max_size 51MB }`. | Lapisan kedua. App sendiri menolak body di atas batas (impor 51 MiB, lampiran 26 MiB, catatan 12 MiB, lainnya 16 KiB sampai 512 KiB) sebelum membacanya utuh. |
| `BETTER_AUTH_URL` harus `https://`. App menolak start di production dengan URL `http://` selain localhost. | Better Auth menandai cookie `Secure` hanya kalau URL-nya https. |
| `NEXUS_ALLOW_SIGNUP=false` (default). Nyalakan hanya untuk membuat akun pemilik, lalu matikan lagi dan restart `app`. | Tanpa itu siapa pun di internet bisa membuat akun di server Anda. Saat mati, `/signup` dialihkan ke `/login` dan API sign-up menolak dengan 400. |
| App terhubung ke database sebagai `nexus_app` (tanpa superuser, hanya SELECT/INSERT/UPDATE/DELETE). `nexus` hanya dipakai `migrate`. | Celah di app tidak bisa membaca file server atau membuat role lewat Postgres. |

Role `nexus_app` dibuat otomatis oleh skrip init saat volume `pgdata` pertama kali dibuat. Untuk volume yang sudah ada, jalankan sekali (setelah `APP_DB_PASSWORD` diisi di `.env`):

```bash
docker compose up -d db   # memasang skrip init ke container db
docker compose exec -T db sh /docker-entrypoint-initdb.d/10-app-role.sh
docker compose --profile prod up -d --build
```

Header keamanan diset oleh app (`next.config.ts`): `Content-Security-Policy` (tanpa nonce; `script-src 'self' 'unsafe-inline'`, `img-src 'self' data: blob:`, `media-src 'self'`, `frame-ancestors 'none'`, `connect-src 'self'`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Strict-Transport-Security` (production, tanpa `includeSubDomains`), dan `Cache-Control: private, no-store` untuk `/api/*` kecuali `/api/attachments/file` (lihat [Lampiran](#lampiran)). Gambar dari domain lain sengaja tidak diizinkan: kalau boleh, sebuah catatan bisa membuat browser pembacanya menghubungi pihak ketiga (tracking pixel, bocor IP), jadi mode baca menampilkannya sebagai link. `X-Powered-By` dimatikan. Proxy tidak perlu menambah header yang sama.

Batas lain di app: catatan maksimal 5 MiB, path 500 karakter dan 32 tingkat folder, vault maksimal 20.000 catatan dan 500 MiB, 1.000 link dan 200 tag terindeks per catatan. Impor `.zip` dibaca sebagai stream dengan batas byte nyata (5 MiB per catatan, 200 MiB per impor, 100.000 entri, 15 detik), satu impor per vault sekaligus, 10 impor per user per jam. Ekspor di-stream per 200 catatan, satu per vault sekaligus, 20 per user per jam. Permintaan yang mengubah data dari origin lain ditolak (cek `Sec-Fetch-Site` dan `Origin`), dan body JSON wajib `Content-Type: application/json`.

### Dependensi

- `pnpm-workspace.yaml` mewajibkan versi berumur minimal 24 jam (`minimumReleaseAge`) dan menolak versi dengan bukti publikasi yang lebih lemah dari versi sebelumnya (`trustPolicy: no-downgrade`). Pengecualian hanya untuk satu `paket@versi` yang sudah ditinjau, di `trustPolicyExclude`.
- `pnpm audit` menjalankan `pnpm audit --prod --audit-level high`. Jalankan sebelum rilis dan setiap minggu; `next`, `react`, `react-dom`, dan `eslint-config-next` dipin persis, jadi patch keamanan hanya masuk lewat update manual.

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
| `pnpm test:unit` | `tests/unit`: parser dan renderer markdown (termasuk payload XSS dan regresi ReDoS), ekstraksi zip impor (zip bomb, batas entri), pembaca body, cek origin, header keamanan. Tanpa database. |
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
src/db/schema.ts              skema (auth + vault, folder, note, link, tag, note_revision, bookmark, attachment)
src/lib/notes.ts              logika vault: CRUD, indexing link/tag, rename + rewrite link, search, graph, impor/ekspor
src/lib/attachments.ts        lampiran: unggah, daftar, hapus, kuota, impor/ekspor (satu transaksi dengan catatan)
src/lib/attachments/          deteksi tipe dari magic bytes (sniff.ts), aturan path, penyimpanan blob di disk
src/lib/markdown/attachments.ts  lookup lampiran ala Obsidian dan render gambar/audio/video/kartu PDF
src/lib/search.ts             pencarian ala Obsidian: parser query (AST) dan penerjemahnya ke SQL, dipakai /api/search
src/lib/history.ts            riwayat catatan: kebijakan snapshot, retensi, baca revisi
src/lib/bookmarks.ts          bookmark: tambah, hapus, urutkan
src/lib/markdown/parse.ts     ekstraksi wikilink, tag, heading, frontmatter (dipakai server dan client)
src/lib/markdown/render.ts    markdown ke HTML (sanitized) untuk mode baca
src/app/api/*                 REST API (semua query dibatasi ke vault milik user)
src/components/workspace/*    UI: editor, file tree, panel, palette, graph
tests/unit/                   tes parser dan renderer markdown, tanpa database
tests/integration/            tes fungsi vault terhadap Postgres (database nexus_test)
.github/workflows/ci.yml      CI: typecheck, lint, tes, build, image Docker
```

## API riwayat catatan dan bookmark

Backend untuk dua core plugin Obsidian, File recovery dan Bookmarks. UI-nya belum ada. Semua endpoint butuh session login dan hanya membaca atau mengubah vault milik user. Catatan, revisi, atau bookmark dari vault lain dijawab `404`.

### Riwayat catatan

Sebelum isi catatan ditimpa (autosave, impor yang menimpa catatan, rewrite link saat rename, restore), isi lama disimpan sebagai revisi di tabel `note_revision`.

| Aturan | Nilai |
|---|---|
| Jarak antar revisi per catatan | Minimal 5 menit. Restore dan impor selalu menyimpan isi yang ditimpanya. |
| Tidak disimpan | Isi tidak berubah, atau isi lama sama dengan revisi terbaru |
| Retensi | 50 revisi terbaru per catatan. Revisi yang lebih tua dari 30 hari langsung tidak tampil di API dan dihapus dari tabel saat catatan itu menyimpan revisi berikutnya; belum ada job pembersihan berkala. |

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

## Lampiran

Gambar, PDF, audio, dan video per vault. Metadata di tabel `attachment` (`path` unik per vault, lengkap dengan ekstensi; `mime`; `size`; `sha256`), isi file di disk:

```
<NEXUS_DATA_DIR>/attachments/<vaultId>/<sha256>
```

`NEXUS_DATA_DIR` default `./data` saat development (sudah di `.gitignore`) dan `/data` di image Docker (volume `appdata`, dapat ditulis user non-root `nexus`). File disimpan berdasarkan hash, jadi file yang sama di satu vault hanya disimpan sekali; penulisan atomik (file sementara, `fsync`, lalu `rename`). Blob dihapus saat baris terakhir yang memakainya dihapus.

| Aturan | Nilai |
|---|---|
| Tipe yang diterima | Ditentukan dari magic bytes, bukan dari nama atau `Content-Type` klien: png, jpeg, gif, webp, avif, svg, pdf, mp3, m4a, ogg, wav, mp4, webm. Ekstensi harus cocok dengan isi, jadi HTML yang dinamai `.png` ditolak (`415`). |
| SVG | Diterima, tetapi selalu dikirim sebagai unduhan (`Content-Disposition: attachment`). Di mode baca tampil lewat `<img>`, yang tidak pernah menjalankan script. |
| Ukuran | 25 MiB per file, 1 GiB per vault (dihitung di SQL, blob yang sama dihitung sekali), 20.000 lampiran per vault, 120 unggahan per user per menit |
| Path | Aturan yang sama dengan catatan (500 karakter, 32 tingkat, tanpa segmen `.`/`..`), ekstensi tetap. Nama yang sudah dipakai menjadi `foto 1.png`, `foto 2.png`. Mengunggah isi yang sama ke path yang sama mengembalikan lampiran yang sudah ada. |

| Method | Endpoint | Hasil |
|---|---|---|
| POST | `/api/attachments`, multipart: `file` (tepat satu) dan `folder` (opsional) | `201 { id, path, mime, size }`. Editor lalu menyisipkan `![[<path>]]`. |
| GET | `/api/attachments?after=<path>&limit=<1..500>` | `{ items: [{ id, path, mime, size, sha256, createdAt }], next }`, urut path. `next` adalah `after` untuk halaman berikutnya, `null` di halaman terakhir. |
| GET | `/api/attachments/file?path=<path>&v=<16 hex pertama sha256>` | Isi file dengan `Content-Type` tersimpan, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`, `Content-Disposition` inline (gambar, PDF, audio, video) atau attachment (SVG), `ETag` berupa sha256, dukungan `Range` (206/416) untuk seek audio dan video. Dengan `v` yang cocok: `Cache-Control: private, max-age=31536000, immutable`; tanpa itu `private, no-cache` (revalidasi, `304`). |
| DELETE | `/api/attachments?path=<path>` | Menghapus lampiran. `404` kalau tidak ada. |

Impor `.zip` ikut membawa lampiran dengan aturan yang sama (lampiran di atas 25 MiB dilewati dan dilaporkan di `skipped`), dihitung ke batas 200 MiB per impor, dan ditulis dalam satu transaksi dengan catatan. Dry run (`?dryRun=1`) melaporkan path lampiran yang akan ditimpa di `conflicts` (dengan ekstensi) dan di `attachmentConflicts`. Ekspor menyertakan lampiran di path aslinya.

Renderer tidak pernah mengakses database: pemanggil memberikan lookup (`createAttachmentLookup` dari `src/lib/markdown/attachments.ts`, diisi dari `GET /api/attachments`) sebagai argumen ketiga `renderMarkdown`.

## Belum ada (roadmap)

- Live preview ala Obsidian (sembunyikan sintaks markdown di baris yang tidak aktif)
- UI lampiran: tempel/seret gambar di editor, daftar lampiran di file explorer (API sudah ada)
- Lampiran ikut dipindah atau dihapus saat folder induknya di-rename atau dihapus; pembersihan blob yatim saat vault dihapus
- Callout `> [!note]`, Mermaid, LaTeX/KaTeX
- Template, serta UI untuk bookmark dan riwayat versi catatan (API sudah ada)
- Canvas (`.canvas`), publish halaman publik, kolaborasi real-time (Yjs)
- Service worker dan mode offline untuk PWA
- Siap dipasarkan: verifikasi email dan reset password (perlu provider email), rate limit yang bertahan saat restart (sekarang di memori satu proses), billing, kebijakan privasi sesuai UU PDP
