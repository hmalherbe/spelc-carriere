/**
 * Hand-written, French description of the (curated, non-sensitive) subset of the database schema
 * that the AI assistant is allowed to query — see ALLOWED_TABLES in sqlSafety.ts. Kept separate
 * from prisma/schema.prisma's own comments because this text is sent to a third party (Mistral) on
 * every question, so it's deliberately scoped down to what's needed to write useful SELECTs rather
 * than the full internal schema.
 *
 * Table/column names are PostgreSQL identifiers exactly as Prisma creates them (no @@map anywhere
 * in schema.prisma) — i.e. exact-case, so they must always be double-quoted in SQL.
 */
export const SCHEMA_DESCRIPTION = `
Base de données PostgreSQL du suivi de carrière des enseignants adhérents au Spelc Côte d'Azur.
Les noms de tables et de colonnes sont sensibles à la casse : entoure-les TOUJOURS de guillemets
doubles, exactement comme ci-dessous (ex: SELECT "nom", "prenom" FROM "Teacher").

Tables disponibles :

"Campagne" (une campagne d'avancement d'échelon, par année scolaire et par commission)
  - "id" text, "anneeScolaire" text (ex "2024-2025"), "periodeDebut" timestamp, "periodeFin" timestamp
  - "dateCcma" timestamp, "type" text ('CCMA' = second degré, 'CCMI' = premier degré, peut être NULL)
  - "createdAt" timestamp

"RectoratImport" (un fichier du rectorat importé pour une campagne, un grade à la fois)
  - "id" text, "campagneId" text (-> "Campagne"."id"), "grade" text, "fileName" text
  - "importedAt" timestamp, "importedBy" text, "rowCount" int

"TeacherSnapshot" (l'état d'un enseignant tel qu'il apparaissait dans un fichier rectorat)
  - "id" text, "campagneId" text (-> "Campagne"."id"), "importId" text (-> "RectoratImport"."id")
  - "teacherId" text (-> "Teacher"."id"), "nomUsage" text, "prenom" text, "grade" text
  - "dateNaissance" timestamp, "rneEtablissement" text, "nomEtablissement" text, "typeEtablissement" text
  - "codePostal" text, "ville" text, "disciplineLibelle" text
  - "echelonActuel" text, "dateAccesEchelon" timestamp
  - "ancienneteGrade" float (années d'ancienneté dans le grade), "ancienneteEchelon" float (années dans l'échelon)
  - "typePromotion" text ('AN'/'CL'/'BA'/'RE'), "dateProchainePromotionRectorat" timestamp
  - "proTypePromotion" text ('AN'/'CL'/'BA'), "proConfirmee" boolean (true = promotion confirmée par le rectorat)
  - "rowIndex" int (ordre dans le fichier d'origine)

"Teacher" (identité stable d'un enseignant, à travers les campagnes)
  - "id" text, "createdAt" timestamp

"Adherent" (adhérent Spelc, importé depuis ADEL)
  - "id" text, "civilite" text, "nom" text, "prenom" text, "nomNaissance" text, "grade" text
  - "echelleSpelc" text, "ancienEchelon" text, "statut" text, "typeContrat" text, "ancienIndice" int
  - "dateEffet" timestamp, "mailPersonnel" text, "departement" text, "importedAt" timestamp

"AcademicEmail" (annuaire académique nom/prénom -> mail, pour les non-adhérents)
  - "id" text, "nom" text, "prenom" text, "email" text, "importedAt" timestamp

"MatchCandidate" (lien entre un "Teacher" et un "Adherent")
  - "id" text, "teacherId" text (-> "Teacher"."id"), "adherentId" text (-> "Adherent"."id")
  - "status" text ('AUTO_CONFIRMED'/'PENDING_REVIEW'/'CONFIRMED'/'REJECTED'), "confidence" float (0 à 1)
  - "reviewedById" text, "reviewedAt" timestamp, "createdAt" timestamp

"ComputedPromotionState" (résultat calculé pour un enseignant dans une campagne)
  - "id" text, "teacherId" text (-> "Teacher"."id"), "campagneId" text
  - "grilleCode" text, "echelonDepart" text, "echelonSuivant" text, "indiceActuel" int, "futurIndice" int
  - "gainSalaireBrut" int, "gainSalaireNet" int, "dateProchainePromotion" timestamp
  - "baEstimate" text ('promu_estime'/'non_promu_estime'/'indetermine', peut être NULL)

"MailingLog" (historique des mails de notification envoyés)
  - "id" text, "campagneId" text, "teacherId" text, "adherentId" text, "email" text
  - "status" text ('SENT'/'FAILED'), "error" text, "sentById" text, "sentAt" timestamp

"AdelSyncLog" (historique des synchronisations automatiques avec ADEL)
  - "id" text, "type" text ('CCMA'/'CCMI'), "status" text ('SUCCESS'/'FAILED')
  - "syncedAt" timestamp, "created" int, "updated" int, "error" text

"Elu" (élus et suppléants CCMA/CCMI)
  - "id" text, "commission" text ('CCMA'/'CCMI'), "role" text ('TITULAIRE'/'SUPPLEANT')
  - "prenom" text, "nom" text, "telephone" text, "email" text

"SocialLink" (réseaux sociaux affichés en bas des mailings)
  - "id" text, "label" text, "url" text, "ordre" int

"Grille" (grille indiciaire par grade)
  - "code" text (clé), "label" text

"EchelonRow" (un échelon d'une grille indiciaire)
  - "id" text, "grilleCode" text, "echelon" text, "echelonSuivant" text, "indice" int
  - "dureeAnnees" float (durée normale en années avant promotion), "dureeAlternative" float

"ValeurDuPoint" (valeur du point d'indice, historisée)
  - "id" text, "valeur" float, "applicableA" timestamp

"GradeMapping" (correspondance grade rectorat -> grille indiciaire)
  - "grade" text (clé), "grilleCode" text, "degre" int (1 = premier degré, 2 = second degré)
  - "accesHorsClasse" boolean, "accesClasseExceptionnelle" boolean

Règles impératives pour la requête SQL à générer :
- Réponds UNIQUEMENT avec la requête SQL, sans aucune explication, sans balises markdown, sans point-virgule final.
- Une seule instruction SELECT (pas de CTE / WITH, pas de commentaires SQL).
- N'utilise que les tables et colonnes listées ci-dessus, avec les noms exacts entre guillemets doubles.
- Ne modifie jamais de données (pas de INSERT/UPDATE/DELETE/DROP/etc.) — lecture seule uniquement.
- Si la question ne peut pas raisonnablement être répondue avec ces tables, réponds exactement :
  SELECT 'Question hors du périmètre des données disponibles.' AS message
`.trim();
