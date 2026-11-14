INTERNAL

# Layanan kolaborasi real-time (`collab/`)

Service Node terpisah yang menyinkronkan satu catatan antar-perangkat secara live dengan CRDT Yjs. Next.js tidak berubah: service ini berbagi database dan cookie sesi dengan app, dan menulis balik catatan lewat fungsi yang sama dengan `PATCH /api/notes/:id`.

```
browser ── wss://domain/collab?note=<id> ──▶ reverse proxy ──▶ collab :3001 ──▶ Postgres (note, note_ydoc, session)
browser ── https://domain/api/...        ──▶ reverse proxy ──▶ app    :3000 ──┘   │
                                                                   NOTIFY nexus_note_content ──▶ collab
```

## Pilihan paket

Versi dipin persis di `package.json`, semuanya lisensi MIT, semuanya lolos `minimumReleaseAge` (24 jam) dan `trustPolicy` di `pnpm-workspace.yaml`. Versi dicek di npm registry pada 2026-11-14.

| Paket | Versi | Lisensi | Peran |
|---|---|---|---|
| `yjs` | 13.6.33 | MIT | CRDT, `Y.Doc` per catatan, `Y.Text "content"` |
| `y-protocols` | 1.0.7 | MIT | Pesan sync (step 1, step 2, update) dan awareness |
| `lib0` | 0.2.120 | MIT | Encoder/decoder biner dan `simpleDiffString` (dipakai Yjs sendiri) |
| `ws` | 8.22.2 | MIT | WebSocket server. 8.23.0 terbit 2026-11-12, belum lolos umur minimum saat dipasang |
| `esbuild` | 0.28.2 (dev) | MIT | Bundle `build/collab/server.mjs` tanpa dependensi runtime. Versi yang sama sudah ada di lockfile lewat drizzle-kit |
| `@types/ws` | 8.18.2 (dev) | MIT | Tipe untuk `ws` |
| `y-websocket` | 3.1.0 | MIT | Klien `WebsocketProvider` di editor (`src/components/workspace/collab/session.ts`) dan di tes protokol server |
| `y-codemirror.next` | 0.3.6 | MIT | `yCollab`: mengikat CodeMirror ke `Y.Text` dan menggambar kursor orang lain. Dicek di registry 2026-11-14, terbit 2026-08-18 |

Alternatif yang ditimbang:

- **Hocuspocus (`@hocuspocus/server` 4.8.0, MIT).** Lengkap (hook auth, persistence, debounce), tapi membawa `crossws`, `async-mutex`, `kleur`, `@hocuspocus/common`, dan memakai protokolnya sendiri di atas y-protocols, sehingga klien harus `@hocuspocus/provider`. Auth Nexus (cookie Better Auth + akses vault) dan alur simpan (PATCH path, 409, merge REST) tetap harus ditulis sendiri, jadi keuntungannya kecil.
- **Utilitas server y-websocket.** y-websocket 3.x tidak lagi membawa server; utilitasnya ada di `@y/websocket-server` (0.1.5, MIT, masih 0.x) dan contohnya tanpa auth maupun simpan lewat path PATCH. Protokolnya hanya sekitar 100 baris di atas y-protocols, jadi ditulis sendiri di `src/room.ts`.

Hasilnya: empat dependensi runtime kecil yang sudah dipakai ekosistem Yjs, dan protokol yang kompatibel dengan `y-websocket` `WebsocketProvider` apa adanya.

## Berkas

| Berkas | Isi |
|---|---|
| `src/main.ts` | Entry point, baca env, tutup rapi saat SIGTERM/SIGINT (simpan semua catatan terbuka dulu) |
| `src/config.ts` | Semua pengaturan dan batas, dari env |
| `src/server.ts` | HTTP + upgrade WebSocket, pemeriksaan saat connect, batas koneksi, idle, heartbeat, cek sesi berkala, LISTEN |
| `src/room.ts` | Satu catatan live: `Y.Doc`, awareness, sync, simpan dengan debounce, merge tulisan REST |
| `src/merge.ts` | Aturan merge teks REST ke dokumen live (fungsi murni) |
| `src/auth.ts` | Verifikasi cookie bertanda tangan Better Auth, sesi, akses catatan |
| `src/store.ts` | Baca catatan, baca/tulis `note_ydoc` |
| `build.mjs` | Bundle esbuild. `server-only`, `next/headers`, dan instance Better Auth diganti stub karena tidak dipanggil di service ini |

## Kontrak untuk editor (track berikutnya)

- URL: `${NEXT_PUBLIC_COLLAB_URL ?? origin halaman, skema ws/wss}/collab?note=<noteId>`. Bentuk `/collab/<noteId>` juga diterima, yaitu bentuk yang dibuat `new WebsocketProvider(baseUrl + "/collab", noteId, doc)` dari `y-websocket`.
- Auth: cookie sesi Better Auth yang sudah ada dikirim browser otomatis (same-site). Tidak ada token di URL.
- Dokumen: `doc.getText("content")`, berisi markdown utuh termasuk frontmatter. Ikat ke CodeMirror dengan `yCollab(ytext, provider.awareness, { undoManager })` dari `y-codemirror.next` (0.3.6, MIT). Dipasang di `src/components/workspace/collab/binding.ts`.
- Awareness: `awareness.setLocalStateField("user", { name, color, colorLight })`, bentuk yang dibaca `y-codemirror.next`. Server menimpa `user.name` dengan nama akun dari sesi, jadi nama tidak bisa dipalsukan. Warna dipilih klien dari token palet.
- Offline: editor tidak menyimpan `Y.Doc` di klien; ketikan offline lewat outbox REST, dan setiap koneksi mulai dari `Y.Doc` baru (lihat README utama, "Di editor"). Opsi menyimpan `Y.Doc` (mis. `y-indexeddb`) tetap didukung server: Server menyimpan state Yjs di `note_ydoc`, jadi sync berikutnya hanya mengirim selisih dan tidak menggandakan teks, juga setelah server restart.
- Simpan: selama socket terbuka, editor tidak perlu `PATCH` konten. Server menulis `note.content` 2 detik setelah ketikan terakhir (paling lambat 10 detik saat terus mengetik). Rename tetap lewat `PATCH { path }`.
- Pengakuan persistensi (pesan tipe `7`, kompatibel mundur): klien yang memahaminya mengirim `[7]` sekali setelah socket terbuka; service menjawab `[7, 0]` lalu `[7, n]` setiap kali tulisan ke database (`note.content` dan `note_ydoc`) selesai, dengan `n` = nomor `ack` terbaru dari awareness klien itu yang sudah tercakup tulisan tersebut. Klien yang tidak pernah mengirim `[7]` (y-websocket biasa) tidak pernah menerima tipe `7`, dan service lama mengabaikan `[7]`. Editor memakai ini untuk label simpan: "Saved" setelah pengakuan, "Syncing…" di antaranya, "Synced" bila service tidak melaporkan simpan.
- Kode penutupan socket:

| Kode | Arti | Saran klien |
|---|---|---|
| 4401 | Sesi habis, logout, atau dicabut | Berhenti reconnect, arahkan ke login |
| 4404 | Catatan dihapus | Berhenti reconnect, tutup tab catatan |
| 4408 | Idle (tidak ada pesan apa pun selama `COLLAB_IDLE_TIMEOUT_MS`) | Reconnect saat ada aktivitas |
| 4413 | Update akan membuat catatan melebihi 5 MiB, ditolak dan tidak diterapkan | Beri tahu pengguna, jangan reconnect dengan state yang sama |
| 1009 | Frame melebihi `COLLAB_MAX_MESSAGE_BYTES` | Sama seperti 4413 |
| 1001 | Server berhenti (deploy) | Reconnect dengan backoff |

Handshake yang ditolak dijawab HTTP biasa tanpa socket: 400 id bukan UUID, 401 tanpa sesi valid, 403 Origin salah, 404 catatan tidak ada atau bukan milik pengguna (keduanya sama agar id tidak bisa ditebak), 429 batas koneksi per pengguna, 503 batas total.

## Keamanan

- **Kontrol akses.** Setiap upgrade memeriksa: (1) header `Origin` harus sama dengan origin `BETTER_AUTH_URL` atau `NEXT_PUBLIC_APP_URL`, tanpa Origin ditolak (mencegah cross-site WebSocket hijacking); (2) cookie `better-auth.session_token` (atau `__Secure-...` saat https) diverifikasi HMAC-SHA256 dengan `BETTER_AUTH_SECRET`, perbandingan timing-safe; (3) baris `session` masih ada dan belum kedaluwarsa; (4) catatan ada di vault milik pengguna. Socket ditutup saat sesi kedaluwarsa, dan setiap `COLLAB_SESSION_CHECK_MS` semua sesi yang terhubung dicek ulang sehingga logout memutus socket dalam satu menit.
- **Validasi input dan batas sumber daya.** `maxPayload` per frame, hanya frame biner, pesan rusak menutup socket (1003), update yang membuat catatan melebihi `LIMITS.noteBytes` dicoba dulu di salinan dan ditolak (4413), batas koneksi per pengguna dan total, idle timeout, ping/pong untuk socket mati, `perMessageDeflate` mati (menghindari zip bomb dan beban CPU).
- **Integritas data.** Konten ditulis lewat `updateContent` dari `src/lib/notes.ts` dengan `baseUpdatedAt` (pemeriksaan optimistis yang sama dengan PATCH), sehingga revisi, indeks link/tag, dan kuota vault berlaku. Kalau tulisan REST masuk duluan (409), tulisan itu di-merge ke dokumen lalu disimpan ulang, tidak ditimpa.
- **Logging.** Error hanya dicatat kelas dan kodenya (`logError`), tidak pernah isi catatan, token, atau URL database.
- **Least privilege.** Di compose service memakai role `nexus_app` (tanpa DDL). `LISTEN` tidak butuh hak tambahan.

## Persistensi

- `Y.Doc` per catatan, dibuat saat socket pertama tersambung dan dibuang (setelah disimpan) saat socket terakhir lepas.
- Tabel `note_ydoc(note_id pk → note.id on delete cascade, state bytea, updated_at)` menyimpan `Y.encodeStateAsUpdate(doc)`. Load pertama mengisi `Y.Text` dari `note.content` lalu langsung menyimpan state, supaya semua klien berbagi satu riwayat.
- `note.content` tetap sumber kebenaran. Saat load, kalau teks dari `note_ydoc` berbeda dari `note.content` (ditulis lewat REST ketika tidak ada yang terhubung, atau crash di antara dua tulisan), selisihnya diterapkan ke `Y.Text`.
- Migrasi `drizzle/0005_note_ydoc.sql` juga memasang trigger `note_content_notify` (UPDATE OF content) dan `note_delete_notify` (DELETE) yang memanggil `pg_notify('nexus_note_content', note_id)`. Service mendengarkan channel itu, jadi PATCH, rewrite link saat rename, restore revisi, dan impor sampai ke dokumen live tanpa mengubah route Next.js.
- Merge tulisan REST (`src/merge.ts`): kalau tidak ada ketikan yang belum tersimpan, teks REST diterapkan sebagai diff. Kalau ada, dan keduanya menyentuh bagian berbeda, keduanya dipertahankan. Kalau bertumpuk, tulisan REST menang seperti simpan biasa (teks sebelumnya tetap ada di riwayat catatan). Diff berbasis satu wilayah (prefix/suffix), cukup untuk jendela 2 detik.

## Menjalankan

Lokal (Postgres dari `pnpm db:up`, env dari `.env` lalu `.env.local`):

```bash
pnpm db:migrate
pnpm dev                 # app di :3000
pnpm collab:dev          # bundle lalu jalankan service di 127.0.0.1:${COLLAB_PORT:-3001}
curl localhost:3001/healthz
```

Dalam dev, browser di `http://localhost:3000` bisa membuka `ws://localhost:3001/collab?note=<id>` langsung: cookie tidak terikat port, dan Origin-nya `http://localhost:3000`. Set `NEXT_PUBLIC_COLLAB_URL=ws://localhost:3001` untuk editor.

Produksi: `docker compose --profile prod up -d --build` menjalankan service `collab` dari image yang sama dengan `app` (`node collab/server.mjs`), di `127.0.0.1:${COLLAB_PORT:-3001}`.

### Reverse proxy

Caddy:

```caddyfile
domain-anda.com {
	handle /collab* {
		reverse_proxy 127.0.0.1:3001
	}
	handle {
		reverse_proxy 127.0.0.1:3000
	}
}
```

Nginx:

```nginx
location /collab {
    proxy_pass http://127.0.0.1:3001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header Origin $http_origin;
    proxy_read_timeout 300s;      # lebih panjang dari COLLAB_IDLE_TIMEOUT_MS
}
```

Dengan proxy di satu domain, `NEXT_PUBLIC_COLLAB_URL` tidak perlu diisi.

## Pengaturan (env)

| Variabel | Default | Arti |
|---|---|---|
| `DATABASE_URL` | wajib | Database yang sama dengan app |
| `BETTER_AUTH_SECRET` | wajib | Sama dengan app; memverifikasi cookie sesi |
| `BETTER_AUTH_URL`, `NEXT_PUBLIC_APP_URL` | minimal satu | Origin yang boleh membuka socket. https membuat nama cookie `__Secure-better-auth.session_token` |
| `COLLAB_PORT` / `COLLAB_HOST` | 3001 / 127.0.0.1 | Listener (compose: 0.0.0.0 di dalam container) |
| `COLLAB_MAX_CONNECTIONS` | 1000 | Total socket |
| `COLLAB_MAX_CONNECTIONS_PER_USER` | 20 | Socket per akun (tab x perangkat) |
| `COLLAB_MAX_MESSAGE_BYTES` | 6 MiB | Frame terbesar; harus muat satu catatan penuh (5 MiB) saat sync pertama klien yang mengedit offline |
| `COLLAB_IDLE_TIMEOUT_MS` | 120000 | Tutup socket tanpa pesan (awareness dikirim klien tiap 15 detik) |
| `COLLAB_HEARTBEAT_MS` | 30000 | Interval ping |
| `COLLAB_SESSION_CHECK_MS` | 60000 | Interval cek ulang sesi |
| `COLLAB_PERSIST_DEBOUNCE_MS` | 2000 | Jeda setelah ketikan terakhir sebelum disimpan |
| `COLLAB_PERSIST_MAX_WAIT_MS` | 10000 | Paling lama menunggu saat terus mengetik |

## Tes

`tests/integration/collab.test.ts` (butuh `TEST_DATABASE_URL`): dua klien `WebsocketProvider` konvergen dan saling melihat awareness, penolakan auth (tanpa cookie, tanda tangan salah, Origin salah, catatan orang lain, sesi kedaluwarsa, id tidak valid), batas koneksi per pengguna, batas ukuran frame, simpan lewat path PATCH (link dan tag terindeks) lalu reconnect setelah server restart tanpa teks ganda, PATCH REST saat dokumen live di-merge tanpa menghilangkan ketikan yang belum tersimpan, dan hapus catatan menutup socket dengan 4404. `tests/integration/collab-merge.test.ts` menguji aturan merge dan helper handshake tanpa database.

## Batasan yang diketahui

- Satu proses. Room ada di memori proses itu; untuk lebih dari satu replika perlu sticky routing per catatan atau pub/sub antar-proses.
- Akses hanya pemilik vault. Vault bersama cukup mengubah `noteAccess` di `src/auth.ts`.
- Kalau simpan ditolak kuota vault, ketikan tetap di memori dan dicoba lagi pada perubahan berikutnya; belum ada pesan ke klien.
