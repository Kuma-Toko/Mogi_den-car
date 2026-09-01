-- Rename SoapNote to KarteEntry and add entry-type/structured fields so the
-- karte can hold formats beyond SOAP (free narrative, referral letters, ambulance records).
ALTER TABLE "SoapNote" RENAME TO "KarteEntry";
ALTER TABLE "KarteEntry" ADD COLUMN "entryType" TEXT NOT NULL DEFAULT 'SOAP';
ALTER TABLE "KarteEntry" ADD COLUMN "title" TEXT;
ALTER TABLE "KarteEntry" ADD COLUMN "narrative" TEXT NOT NULL DEFAULT '';
ALTER TABLE "KarteEntry" ADD COLUMN "detail" TEXT;
