USE pendataan_pemilih;

ALTER TABLE pemilih
  MODIFY COLUMN nik VARCHAR(32) NULL;

UPDATE pemilih
SET nik = NULL
WHERE TRIM(COALESCE(nik, '')) = '';

ALTER TABLE log_duplikat
  MODIFY COLUMN nik_target VARCHAR(32) NOT NULL;
