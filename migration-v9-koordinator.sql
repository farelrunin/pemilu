USE pendataan_pemilih;

CREATE TABLE IF NOT EXISTS koordinator (
  id VARCHAR(20) PRIMARY KEY,
  nama VARCHAR(100) NOT NULL,
  created_at DATETIME DEFAULT NOW(),
  UNIQUE KEY uq_koordinator_nama (nama)
) ENGINE = InnoDB DEFAULT CHARSET = utf8mb4;

ALTER TABLE kader
  ADD COLUMN koordinator_id VARCHAR(20) NULL AFTER kordus;

ALTER TABLE kader
  ADD INDEX idx_kader_koordinator (koordinator_id);

ALTER TABLE kader
  ADD CONSTRAINT fk_kader_koordinator
  FOREIGN KEY (koordinator_id) REFERENCES koordinator(id)
  ON UPDATE CASCADE
  ON DELETE SET NULL;

INSERT INTO koordinator (id, nama)
SELECT LOWER(SUBSTRING(REPLACE(UUID(), '-', ''), 1, 20)), legacy.nama
FROM (
  SELECT DISTINCT TRIM(kordus) AS nama
  FROM kader
  WHERE TRIM(COALESCE(kordus, '')) <> ''
) AS legacy
LEFT JOIN koordinator ko ON ko.nama = legacy.nama
WHERE ko.id IS NULL;

UPDATE kader k
JOIN koordinator ko ON ko.nama = TRIM(k.kordus)
SET k.koordinator_id = ko.id
WHERE k.koordinator_id IS NULL
  AND TRIM(COALESCE(k.kordus, '')) <> '';
