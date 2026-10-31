// AUTO-EXTRACTED from the Spelc central .xlsm (sheet "Données") — DO NOT hand-edit.
// Source: named ranges AGR, PROFS, HC_AGR, EXC_PROFS, etc. in the original workbook.

export type EchelonCode = number | string; // numeric echelons, or 'A1'/'A2'/'A3'/'B2'/'B3' for agrégés hors classe/classe exceptionnelle

export interface EchelonRow {
  echelon: EchelonCode;
  echelonSuivant: EchelonCode;
  indice: number;
  /** duree in years before next echelon, or 'MAX' if this is the ceiling echelon */
  duree: number | 'MAX';
  /**
   * A grille-dependent alternate duration, kept alongside `duree` for historical/edge-case
   * calculations:
   *  - for HC_AGR/HC_PROFS/HC_PEGC: the duree (years) that applied before the 2017 'PPCR' reform
   *    introduced the "vivier 2" rule for hors-classe access
   *  - for MA_1/MA_2: the shorter duree (years) that applies for a promotion "au choix" rather
   *    than "à l'ancienneté"
   */
  dureeAvantVivier2?: number | "MAX";
}

export type GrilleCode =
  | "AGR"
  | "AECE"
  | "BI_ADM"
  | "PROFS"
  | "INSTIT"
  | "PEGC"
  | "HC_AGR"
  | "HC_PROFS"
  | "HC_PEGC"
  | "EXC_AGR"
  | "EXC_PROFS"
  | "EXC_PEGC"
  | "MA_1"
  | "MA_2"
  | "CHAIRE_SUP";

export const GRILLES: Record<GrilleCode, EchelonRow[]> = {
  "AGR": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 455,
      "duree": 1
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 503,
      "duree": 1
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 518,
      "duree": 2
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 547,
      "duree": 2
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 584,
      "duree": 2.5
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 623,
      "duree": 3
    },
    {
      "echelon": 7,
      "echelonSuivant": 8,
      "indice": 664,
      "duree": 3
    },
    {
      "echelon": 8,
      "echelonSuivant": 9,
      "indice": 715,
      "duree": 3.5
    },
    {
      "echelon": 9,
      "echelonSuivant": 10,
      "indice": 762,
      "duree": 4
    },
    {
      "echelon": 10,
      "echelonSuivant": 11,
      "indice": 805,
      "duree": 4
    },
    {
      "echelon": 11,
      "echelonSuivant": 11,
      "indice": 835,
      "duree": "MAX"
    }
  ],
  "AECE": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 337,
      "duree": 1
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 355,
      "duree": 1
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 376,
      "duree": 1
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 392,
      "duree": 2
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 410,
      "duree": 3
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 436,
      "duree": 3
    },
    {
      "echelon": 7,
      "echelonSuivant": 8,
      "indice": 455,
      "duree": 3
    },
    {
      "echelon": 8,
      "echelonSuivant": 9,
      "indice": 481,
      "duree": 3.5
    },
    {
      "echelon": 9,
      "echelonSuivant": 10,
      "indice": 511,
      "duree": 3.5
    },
    {
      "echelon": 10,
      "echelonSuivant": 11,
      "indice": 542,
      "duree": 4.5
    },
    {
      "echelon": 11,
      "echelonSuivant": 11,
      "indice": 565,
      "duree": "MAX"
    }
  ],
  "BI_ADM": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 407,
      "duree": 1
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 445,
      "duree": 1
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 452,
      "duree": 2
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 473,
      "duree": 2
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 501,
      "duree": 2.5
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 525,
      "duree": 3
    },
    {
      "echelon": 7,
      "echelonSuivant": 8,
      "indice": 551,
      "duree": 3
    },
    {
      "echelon": 8,
      "echelonSuivant": 9,
      "indice": 593,
      "duree": 3.5
    },
    {
      "echelon": 9,
      "echelonSuivant": 10,
      "indice": 635,
      "duree": 4
    },
    {
      "echelon": 10,
      "echelonSuivant": 11,
      "indice": 675,
      "duree": 4
    },
    {
      "echelon": 11,
      "echelonSuivant": 11,
      "indice": 703,
      "duree": "MAX"
    }
  ],
  "PROFS": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 395,
      "duree": 1
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 446,
      "duree": 1
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 453,
      "duree": 2
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 466,
      "duree": 2
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 481,
      "duree": 2.5
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 497,
      "duree": 3
    },
    {
      "echelon": 7,
      "echelonSuivant": 8,
      "indice": 524,
      "duree": 3
    },
    {
      "echelon": 8,
      "echelonSuivant": 9,
      "indice": 562,
      "duree": 3.5
    },
    {
      "echelon": 9,
      "echelonSuivant": 10,
      "indice": 595,
      "duree": 4
    },
    {
      "echelon": 10,
      "echelonSuivant": 11,
      "indice": 634,
      "duree": 4
    },
    {
      "echelon": 11,
      "echelonSuivant": 11,
      "indice": 678,
      "duree": "MAX"
    }
  ],
  "INSTIT": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 361,
      "duree": 0.75
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 371,
      "duree": 0.75
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 383,
      "duree": 1
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 390,
      "duree": 1.5
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 400,
      "duree": 1.5
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 413,
      "duree": 1.5
    },
    {
      "echelon": 7,
      "echelonSuivant": 8,
      "indice": 422,
      "duree": 3
    },
    {
      "echelon": 8,
      "echelonSuivant": 9,
      "indice": 443,
      "duree": 3.5
    },
    {
      "echelon": 9,
      "echelonSuivant": 10,
      "indice": 464,
      "duree": 4
    },
    {
      "echelon": 10,
      "echelonSuivant": 11,
      "indice": 499,
      "duree": 4
    },
    {
      "echelon": 11,
      "echelonSuivant": 11,
      "indice": 538,
      "duree": "MAX"
    }
  ],
  "PEGC": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 335,
      "duree": 1
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 353,
      "duree": 1.5
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 373,
      "duree": 1.5
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 390,
      "duree": 2.5
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 408,
      "duree": 3
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 429,
      "duree": 3
    },
    {
      "echelon": 7,
      "echelonSuivant": 8,
      "indice": 448,
      "duree": 3
    },
    {
      "echelon": 8,
      "echelonSuivant": 9,
      "indice": 472,
      "duree": 3.5
    },
    {
      "echelon": 9,
      "echelonSuivant": 10,
      "indice": 496,
      "duree": 3.5
    },
    {
      "echelon": 10,
      "echelonSuivant": 11,
      "indice": 525,
      "duree": 3.5
    },
    {
      "echelon": 11,
      "echelonSuivant": 11,
      "indice": 554,
      "duree": "MAX"
    }
  ],
  "HC_AGR": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 762,
      "duree": 2,
      "dureeAvantVivier2": 9
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 805,
      "duree": 2,
      "dureeAvantVivier2": 7
    },
    {
      "echelon": 3,
      "echelonSuivant": "A1",
      "indice": 835,
      "duree": 3,
      "dureeAvantVivier2": 5
    },
    {
      "echelon": "A1",
      "echelonSuivant": "A2",
      "indice": 895,
      "duree": 1,
      "dureeAvantVivier2": 2
    },
    {
      "echelon": "A2",
      "echelonSuivant": "A3",
      "indice": 930,
      "duree": 1,
      "dureeAvantVivier2": 1
    },
    {
      "echelon": "A3",
      "echelonSuivant": "A3",
      "indice": 977,
      "duree": "MAX",
      "dureeAvantVivier2": 0
    }
  ],
  "HC_PROFS": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 595,
      "duree": 2,
      "dureeAvantVivier2": 12
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 629,
      "duree": 2,
      "dureeAvantVivier2": 10
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 673,
      "duree": 2.5,
      "dureeAvantVivier2": 8
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 720,
      "duree": 2.5,
      "dureeAvantVivier2": 5.5
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 768,
      "duree": 3,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 811,
      "duree": 3,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 7,
      "echelonSuivant": 7,
      "indice": 826,
      "duree": "MAX",
      "dureeAvantVivier2": 0
    }
  ],
  "HC_PEGC": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 471,
      "duree": 2,
      "dureeAvantVivier2": 14
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 495,
      "duree": 3,
      "dureeAvantVivier2": 12
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 524,
      "duree": 3,
      "dureeAvantVivier2": 9
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 553,
      "duree": 3,
      "dureeAvantVivier2": 6
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 626,
      "duree": 3,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 6,
      "echelonSuivant": 6,
      "indice": 672,
      "duree": "MAX",
      "dureeAvantVivier2": 0
    }
  ],
  "EXC_AGR": [
    {
      "echelon": 1,
      "echelonSuivant": "A1",
      "indice": 835,
      "duree": 2.5
    },
    {
      "echelon": "A1",
      "echelonSuivant": "A2",
      "indice": 895,
      "duree": 1
    },
    {
      "echelon": "A2",
      "echelonSuivant": "A3",
      "indice": 930,
      "duree": 1
    },
    {
      "echelon": "A3",
      "echelonSuivant": "B2",
      "indice": 977,
      "duree": 1
    },
    {
      "echelon": "B1",
      "echelonSuivant": "B2",
      "indice": 977,
      "duree": 1
    },
    {
      "echelon": "B2",
      "echelonSuivant": "B3",
      "indice": 1018,
      "duree": 1
    },
    {
      "echelon": "B3",
      "echelonSuivant": "B3",
      "indice": 1072,
      "duree": "MAX"
    }
  ],
  "EXC_PROFS": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 700,
      "duree": 2
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 740,
      "duree": 2
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 780,
      "duree": 2.5
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 835,
      "duree": 3
    },
    {
      "echelon": 5,
      "echelonSuivant": "A2",
      "indice": 895,
      "duree": 1
    },
    {
      "echelon": "A2",
      "echelonSuivant": "A3",
      "indice": 930,
      "duree": 1
    },
    {
      "echelon": "A3",
      "echelonSuivant": "A3",
      "indice": 977,
      "duree": "MAX"
    }
  ],
  "EXC_PEGC": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 626,
      "duree": 1
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 678,
      "duree": 2.5
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 720,
      "duree": 2.5
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 768,
      "duree": 2.5
    },
    {
      "echelon": 5,
      "echelonSuivant": 5,
      "indice": 811,
      "duree": 3
    },
    {
      "echelon": 6,
      "echelonSuivant": 6,
      "indice": 821,
      "duree": "MAX"
    }
  ],
  "MA_1": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 357,
      "duree": 3,
      "dureeAvantVivier2": 2.5
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 381,
      "duree": 3,
      "dureeAvantVivier2": 2.5
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 400,
      "duree": 3,
      "dureeAvantVivier2": 2.5
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 421,
      "duree": 4,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 444,
      "duree": 4,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 465,
      "duree": 4,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 7,
      "echelonSuivant": 8,
      "indice": 489,
      "duree": 4,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 8,
      "echelonSuivant": 8,
      "indice": 512,
      "duree": "MAX",
      "dureeAvantVivier2": "MAX"
    }
  ],
  "MA_2": [
    {
      "echelon": 1,
      "echelonSuivant": 2,
      "indice": 326,
      "duree": 3,
      "dureeAvantVivier2": 2.5
    },
    {
      "echelon": 2,
      "echelonSuivant": 3,
      "indice": 340,
      "duree": 3,
      "dureeAvantVivier2": 2.5
    },
    {
      "echelon": 3,
      "echelonSuivant": 4,
      "indice": 356,
      "duree": 3,
      "dureeAvantVivier2": 2.5
    },
    {
      "echelon": 4,
      "echelonSuivant": 5,
      "indice": 378,
      "duree": 4,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 5,
      "echelonSuivant": 6,
      "indice": 389,
      "duree": 4,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 6,
      "echelonSuivant": 7,
      "indice": 400,
      "duree": 4,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 7,
      "echelonSuivant": 8,
      "indice": 421,
      "duree": 4,
      "dureeAvantVivier2": 3
    },
    {
      "echelon": 8,
      "echelonSuivant": 8,
      "indice": 452,
      "duree": "MAX",
      "dureeAvantVivier2": "MAX"
    }
  ],
  // Professeur de chaire supérieure — Données!M58:P68 du classeur source (fourni par l'utilisateur,
  // 2026-11-01, et confirmé directement dans le classeur). Échelons 6 et 7 composites
  // ("6-HEA1"/"6-HEA2"/"6-HEA3", "7-HEB1"/"7-HEB2"/"7-HEB3") : le classeur ne sépare pas ici
  // "échelon" et "chevron" en deux axes distincts comme pour HC_AGR/EXC_AGR — le code brut EST le
  // nom complet de la position, gardé tel quel plutôt que traduit en "A1"/"B2".
  "CHAIRE_SUP": [
    { "echelon": 1, "echelonSuivant": 2, "indice": 673, "duree": 2 },
    { "echelon": 2, "echelonSuivant": 3, "indice": 710, "duree": 2 },
    { "echelon": 3, "echelonSuivant": 4, "indice": 757, "duree": 2 },
    { "echelon": 4, "echelonSuivant": 5, "indice": 800, "duree": 2 },
    { "echelon": 5, "echelonSuivant": "6-HEA1", "indice": 830, "duree": 4.5 },
    { "echelon": "6-HEA1", "echelonSuivant": "6-HEA2", "indice": 890, "duree": 1 },
    { "echelon": "6-HEA2", "echelonSuivant": "6-HEA3", "indice": 925, "duree": 1 },
    { "echelon": "6-HEA3", "echelonSuivant": "7-HEB1", "indice": 972, "duree": 1 },
    { "echelon": "7-HEB1", "echelonSuivant": "7-HEB2", "indice": 972, "duree": 1 },
    { "echelon": "7-HEB2", "echelonSuivant": "7-HEB3", "indice": 1013, "duree": 1 },
    { "echelon": "7-HEB3", "echelonSuivant": "7-HEB3", "indice": 1067, "duree": "MAX" }
  ]
};
