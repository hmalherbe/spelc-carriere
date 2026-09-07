import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import {
  GRILLES,
  GRADE_MAPPINGS,
  VALEUR_DU_POINT,
  computeEchelonPromotion,
  computeBASeuils,
  type GrilleCode,
  type PromuBA,
} from "@spelc/domain";

const prisma = new PrismaClient();

async function seedReferenceData() {
  console.log("Seeding grille indiciaire...");
  for (const [code, rows] of Object.entries(GRILLES)) {
    await prisma.grille.upsert({
      where: { code },
      update: {},
      create: { code, label: code },
    });
    for (const row of rows) {
      await prisma.echelonRow.upsert({
        where: { grilleCode_echelon: { grilleCode: code, echelon: String(row.echelon) } },
        update: {
          echelonSuivant: String(row.echelonSuivant),
          indice: row.indice,
          dureeAnnees: row.duree === "MAX" ? null : row.duree,
          dureeAlternative:
            row.dureeAvantVivier2 === undefined
              ? null
              : row.dureeAvantVivier2 === "MAX"
                ? null
                : row.dureeAvantVivier2,
        },
        create: {
          grilleCode: code,
          echelon: String(row.echelon),
          echelonSuivant: String(row.echelonSuivant),
          indice: row.indice,
          dureeAnnees: row.duree === "MAX" ? null : row.duree,
          dureeAlternative:
            row.dureeAvantVivier2 === undefined
              ? null
              : row.dureeAvantVivier2 === "MAX"
                ? null
                : row.dureeAvantVivier2,
        },
      });
    }
  }

  console.log("Seeding grade -> grille mappings...");
  for (const g of GRADE_MAPPINGS) {
    await prisma.gradeMapping.upsert({
      where: { grade: g.grade },
      update: {
        grilleCode: g.grille,
        degre: g.degre,
        accesHorsClasse: g.accesHorsClasse,
        accesClasseExceptionnelle: g.accesClasseExceptionnelle,
      },
      create: {
        grade: g.grade,
        grilleCode: g.grille,
        degre: g.degre,
        accesHorsClasse: g.accesHorsClasse,
        accesClasseExceptionnelle: g.accesClasseExceptionnelle,
      },
    });
  }

  console.log("Seeding valeur du point...");
  const existingValeurDuPoint = await prisma.valeurDuPoint.findFirst({ orderBy: { applicableA: "desc" } });
  if (!existingValeurDuPoint) {
    await prisma.valeurDuPoint.create({
      data: { valeur: VALEUR_DU_POINT, applicableA: new Date("2023-07-01") },
    });
  }
}

async function seedUsers() {
  console.log("Seeding demo users...");
  const users = [
    { email: "admin@spelc.example", name: "Admin Spelc", role: "ADMIN" as const, password: "admin1234" },
    { email: "gestionnaire@spelc.example", name: "Gestionnaire Spelc", role: "GESTIONNAIRE" as const, password: "gest1234" },
  ];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 10);
    await prisma.user.upsert({
      where: { email: u.email },
      update: {},
      create: { email: u.email, name: u.name, role: u.role, passwordHash },
    });
  }
}

/** Demo dataset: a handful of teachers with plausible snapshots, so the API/UI has something
 * to show before the real PDF import pipeline exists. Not meant to look like real people. */
async function seedDemoCampagne() {
  console.log("Seeding demo campagne + teachers...");

  const campagne = await prisma.campagne.upsert({
    where: { id: "campagne-2024-2025-demo" },
    update: {},
    create: {
      id: "campagne-2024-2025-demo",
      anneeScolaire: "2024-2025",
      periodeDebut: new Date("2024-09-01"),
      periodeFin: new Date("2025-08-31"),
      dateCcma: new Date("2025-04-01"),
    },
  });

  const rectoratImport = await prisma.rectoratImport.upsert({
    where: { id: "import-demo-certifies-cn" },
    update: {},
    create: {
      id: "import-demo-certifies-cn",
      campagneId: campagne.id,
      grade: "4531 : ECR PROFESSEUR CERTIFIE CL. NORMALE",
      fileName: "demo-CERTIFIESCN.pdf",
      rowCount: 6,
    },
  });

  interface DemoTeacher {
    id: string;
    nom: string;
    prenom: string;
    grade: string;
    grille: GrilleCode;
    echelon: number;
    dateAcces: string;
    avis?: number;
    ancienneteGrade?: number;
    ancienneteEchelon?: number;
  }

  const demoTeachers: DemoTeacher[] = [
    { id: "t-demo-1", nom: "MARTIN", prenom: "Camille", grade: "CERTIFIE", grille: "PROFS", echelon: 5, dateAcces: "2023-09-01" },
    { id: "t-demo-2", nom: "DUBOIS", prenom: "Julien", grade: "CERTIFIE", grille: "PROFS", echelon: 6, dateAcces: "2022-09-01", avis: 4, ancienneteGrade: 2.8, ancienneteEchelon: 2.2 },
    { id: "t-demo-3", nom: "PETIT", prenom: "Sophie", grade: "CERTIFIE", grille: "PROFS", echelon: 6, dateAcces: "2022-03-01", avis: 3, ancienneteGrade: 2.2, ancienneteEchelon: 1.6 },
    { id: "t-demo-4", nom: "BERNARD", prenom: "Antoine", grade: "AGREGE", grille: "AGR", echelon: 8, dateAcces: "2021-09-01", avis: 4 },
    { id: "t-demo-5", nom: "ROBERT", prenom: "Lea", grade: "CERTIFIE", grille: "PROFS", echelon: 3, dateAcces: "2024-09-01" },
  ];

  for (const dt of demoTeachers) {
    await prisma.teacher.upsert({ where: { id: dt.id }, update: {}, create: { id: dt.id } });

    await prisma.teacherSnapshot.upsert({
      where: { id: `${dt.id}-snap` },
      update: {},
      create: {
        id: `${dt.id}-snap`,
        campagneId: campagne.id,
        importId: rectoratImport.id,
        teacherId: dt.id,
        nomUsage: dt.nom,
        prenom: dt.prenom,
        grade: dt.grade,
        echelonActuel: String(dt.echelon),
        dateAccesEchelon: new Date(dt.dateAcces),
        avisEvaluation: dt.avis ?? null,
        ancienneteGrade: dt.ancienneteGrade ?? null,
        ancienneteEchelon: dt.ancienneteEchelon ?? null,
        typePromotion: "AN",
      },
    });

    const promotion = computeEchelonPromotion({
      grille: dt.grille,
      echelonDepart: dt.echelon,
      dateDernierChangementEchelon: dt.dateAcces,
    });

    await prisma.computedPromotionState.upsert({
      where: { teacherId_campagneId: { teacherId: dt.id, campagneId: campagne.id } },
      update: {},
      create: {
        teacherId: dt.id,
        campagneId: campagne.id,
        grilleCode: promotion.grille,
        echelonDepart: String(promotion.echelonDepart),
        echelonSuivant: String(promotion.echelonSuivant),
        indiceActuel: promotion.indiceActuel,
        futurIndice: promotion.futurIndice,
        gainSalaireBrut: promotion.gainSalaireBrut,
        gainSalaireNet: promotion.gainSalaireNet,
        dateProchainePromotion: promotion.dateProchainePromotion ? new Date(promotion.dateProchainePromotion) : null,
      },
    });
  }

  // BA threshold demo: two teachers "promoted" at échelon 6 this campaign -> infer a seuil, then
  // show it applied (as an estimate) to the third échelon-6 teacher who hasn't been resolved yet.
  const promusBA: PromuBA[] = [
    { grade: "CERTIFIE", echelonDepart: 6, barreme: 4, ancienneteGrade: 2.5, ancienneteEchelon: 2.0, age: 400101 },
    { grade: "CERTIFIE", echelonDepart: 6, barreme: 3, ancienneteGrade: 3.0, ancienneteEchelon: 2.5, age: 380601 },
  ];
  const seuils = computeBASeuils(promusBA);
  for (const s of seuils) {
    await prisma.baSeuil.upsert({
      where: { campagneId_grade_echelonDepart: { campagneId: campagne.id, grade: s.grade, echelonDepart: s.echelonDepart } },
      update: {},
      create: {
        campagneId: campagne.id,
        grade: s.grade,
        echelonDepart: s.echelonDepart,
        nombrePromusBa: s.nombrePromusBA,
        minBareme: s.minBarreme,
        minAncienneteGrade: s.minAncienneteGrade,
        minAncienneteEchelon: s.minAncienneteEchelon,
        minAge: s.minAge,
      },
    });
  }

  // Adhérents + matching demo: one auto-confirmed, one pending review (ambiguous), one unmatched adherent.
  const adherent1 = await prisma.adherent.upsert({
    where: { id: "a-demo-1" },
    update: {},
    create: { id: "a-demo-1", nom: "MARTIN", prenom: "Camille", grade: "CERTIFIE", mailPersonnel: "camille.martin@example.com" },
  });
  await prisma.matchCandidate.upsert({
    where: { id: "m-demo-1" },
    update: {},
    create: { id: "m-demo-1", teacherId: "t-demo-1", adherentId: adherent1.id, status: "AUTO_CONFIRMED", confidence: 0.98 },
  });

  const adherent2 = await prisma.adherent.upsert({
    where: { id: "a-demo-2" },
    update: {},
    create: { id: "a-demo-2", nom: "DUBOIS", prenom: "Julien", grade: "CERTIFIE", mailPersonnel: "j.dubois@example.com" },
  });
  await prisma.matchCandidate.upsert({
    where: { id: "m-demo-2" },
    update: {},
    create: { id: "m-demo-2", teacherId: "t-demo-2", adherentId: adherent2.id, status: "PENDING_REVIEW", confidence: 0.62 },
  });

  const adherent3 = await prisma.adherent.upsert({
    where: { id: "a-demo-3" },
    update: {},
    create: { id: "a-demo-3", nom: "GARCIA", prenom: "Manon", grade: "CERTIFIE", mailPersonnel: "manon.garcia@example.com" },
  });
  await prisma.matchCandidate.upsert({
    where: { id: "m-demo-3" },
    update: {},
    create: { id: "m-demo-3", adherentId: adherent3.id, status: "PENDING_REVIEW", confidence: 0.0 },
  });
}

/** Real admin account for production, created from env vars rather than a hard-coded demo
 * password. Idempotent (upsert) — safe to run on every container start. */
async function seedProductionAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.log("ADMIN_EMAIL/ADMIN_PASSWORD non définis — aucun compte admin créé (données de référence seedées quand même).");
    return;
  }
  console.log(`Seeding le compte admin (${email})...`);
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, name: "Admin", role: "ADMIN", passwordHash },
  });
}

async function main() {
  await seedReferenceData();

  // SEED_DEMO_DATA is meant for local dev only — production must never ship the demo accounts
  // (admin1234, a weak hard-coded password) or fake teachers/adhérents.
  if (process.env.SEED_DEMO_DATA === "true") {
    await seedUsers();
    await seedDemoCampagne();
  } else {
    await seedProductionAdmin();
  }

  console.log("Seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
