# Alur akses dan transaksi revisi

Acuan antarmuka dan penamaan peran ada pada Bab III Revisi Lengkap. Panduan operasi terkini ada pada [README](../README.md).

| Tahap | Peran dan hasil |
|---|---|
| Akses | Peminjam atau Penyewa (Pemilik Barang) memilih peran saat daftar. Setelah akun disimpan, autentikasi membuka dashboard sesuai peran. Petugas Mitra memakai akun internal. |
| Penawaran | Pemilik membuat, memperbarui, atau menyembunyikan penawaran miliknya. |
| Cari | Peminjam memilih kebutuhan, interval, dan anggaran. SQLite menyaring kandidat. Sentence Transformer memberi peringkat jika tersedia. |
| Pengajuan dan bayaran | Peminjam menyetujui ketentuan, pemilik memutuskan, dan pembayaran simulasi menerbitkan kode. |
| Serah terima | Petugas memindai dan mengonfirmasi kondisi. Pengambilan memerlukan kode. |
| Selesai | Petugas mengonfirmasi terima kembali dan pemilik menutup pemeriksaan akhir. |
