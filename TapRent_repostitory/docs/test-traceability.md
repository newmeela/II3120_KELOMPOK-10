# Keterlacakan kebutuhan dan pengujian TapRent

Acuan desain adalah Deliverable 2 TapRent versi (9). Hasil aktual dicatat pada [laporan pengujian](report/LAPORAN_PENGUJIAN.md) dan [jejak API](../tests/evidence/jejak_api.json).

| Kasus | Kebutuhan | Alur atau aturan | Cakupan |
|---|---|---|---|
| UT-01 | TR-01, TR-03, TR-04, TR-07, TR-10 | TB-1 sampai TB-5 | Pencarian hingga transaksi selesai |
| UT-02 | TR-03 | TB-2, BR-03, BR-05 | Jadwal bentrok dan reservasi paralel |
| UT-03 | TR-01 | TB-1, BR-01 dan BR-02 | Jalur kata kunci saat embedding gagal |
| UT-04 | TR-05 | SP-RFID, BR-08–10 | Validasi tag, duplikat dan konfirmasi pada simulasi |
| UT-05 | TR-10 | TB-4, OP-18 | Validasi kode dan isolasi akses antar akun Penyewa |
| UT-06 | TR-04, TR-07 | TB-5, BR-13 | Waktu terima berbeda dari waktu pemeriksaan akhir |
| UT-07 | TR-05 | RF-6, BR-15 | Indikator perangkat simulasi putus dan catatan sementara |

Uji komponen tambahan berada di tests/test_components.py. Salinan laporan Word Bab III juga tersedia di docs/report/.
