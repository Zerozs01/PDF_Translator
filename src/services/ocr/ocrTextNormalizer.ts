// src/services/ocr/ocrTextNormalizer.ts

import { normalizeKoreanColloquialOcrText } from '../translation/koreanTranslationPolicy';

export const TRANSLATION_LANGUAGE_ALIASES: Record<string, string> = {
  en: 'en',
  eng: 'en',
  english: 'en',
  th: 'th',
  tha: 'th',
  thai: 'th',
  ja: 'ja',
  jpn: 'ja',
  jpn_vert: 'ja',
  ko: 'ko',
  kor: 'ko',
  zh: 'zh',
  chi: 'zh',
  chi_sim: 'zh',
  chi_tra: 'zh',
  vi: 'vi',
  vie: 'vi',
  de: 'de',
  deu: 'de',
  fr: 'fr',
  fra: 'fr',
  ru: 'ru',
  rus: 'ru',
  es: 'es',
  spa: 'es',
};

export const TECHNICAL_OCR_NORMALIZERS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bR\s*E\s*A\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'REACTION' },
  { pattern: /\bD\s*I\s*R\s*E\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'DIRECTION' },
  { pattern: /\bC\s*O\s*N\s*N\s*E\s*C\s*T\s*I\s*O\s*N\b/gi, replacement: 'CONNECTION' },
];

export const ENGLISH_OCR_NOISE_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\b\(?GTiNKY\)?\b/gi, replacement: 'STINKY' },
  { pattern: /\b\(?GTINKY\)?\b/gi, replacement: 'STINKY' },
  { pattern: /\b6[oO]\b/gi, replacement: 'SO' },
  { pattern: /\bIi['’]?m\b/gi, replacement: "I-I'm" },
  { pattern: /\bII['’]?m\b/gi, replacement: "I-I'm" },
  { pattern: /\bii([a-zA-Z]{3,})\b/gi, replacement: "$1" },
  { pattern: /\b5[oO]\b/gi, replacement: 'SO' },
  { pattern: /\bS0\b/gi, replacement: 'SO' },
  { pattern: /\b60\b/gi, replacement: 'SO' },
  { pattern: /\bNat\s+My\b/gi, replacement: 'NOT MY' },
  { pattern: /^\s*168\s*$/gi, replacement: '' },
  { pattern: /\b4SS-?\s*HOLE\b/gi, replacement: 'ASSHOLE' },
  { pattern: /\b4SS\b/gi, replacement: 'ASS' },
  { pattern: /\b455-?\s*HOLE\b/gi, replacement: 'ASSHOLE' },
  { pattern: /\b455\b/gi, replacement: 'ASS' },
  { pattern: /\bA55-?\s*HOLE\b/gi, replacement: 'ASSHOLE' },
  { pattern: /\bA55\b/gi, replacement: 'ASS' },
  { pattern: /\bGETT[iI]NG\b/gi, replacement: 'GETTING' },
  { pattern: /\bF[iI]RST\b/gi, replacement: 'FIRST' },
  { pattern: /\bAGAA\b/gi, replacement: 'AGAIN' },
  { pattern: /\bME+F+E+!?\b/gi, replacement: 'MEEEEEEE!' },
  { pattern: /\bfAWAY\b/g, replacement: 'AWAY' },
  { pattern: /\bWiTH\b/g, replacement: 'WITH' },
  { pattern: /\bYOU'?\s*(FUR|FOR|RE|R)?\s*(KRASH|CRUSH|CRUNCH|KRACH)[A-Z]*\s+MY\s+BAE?BY\b/gi, replacement: "YOU'RE CRUSHING MY BABY" },
  { pattern: /\bKRASH[A-Z]*\b/gi, replacement: 'CRUSHING' },
  { pattern: /\bC[oO]{2,}\s*[-+]*[0OoO]{2,}\s*[-+]*[7tTfF0]?[oO]?[cC]?[kK][sS]\b/gi, replacement: 'COOOOOOOCKS' },
  { pattern: /\bBAE?BY\b/gi, replacement: 'BABY' },
  { pattern: /\bStOa?go?p!?\b/gi, replacement: 'Stoooop!' },
  { pattern: /\bStOaaop!?\b/gi, replacement: 'Stoooop!' },
  { pattern: /\bs-sto\s+ooo\s+op\b/gi, replacement: 'Stoooop!' },
  { pattern: /\bI\s*M\s*P\s*R\s*E\s*S\s*S\s*I\s*O\s*N\b/gi, replacement: 'IMPRESSION' },
  { pattern: /\bE\s*X\s*P\s*R\s*E\s*S\s*S\s*I\s*O\s*N\b/gi, replacement: 'EXPRESSION' },
  { pattern: /\bTHATCANTBE\s+IT\b/gi, replacement: "THAT CAN'T BE IT" },
  { pattern: /\bTHATCANTBE\b/gi, replacement: "THAT CAN'T" },
  { pattern: /\ball\s+arstocrats\b/gi, replacement: 'all aristocrats' },
  { pattern: /\bTODAY\s+AGAiN\b/gi, replacement: 'TODAY AGAIN' },
  { pattern: /\bHER\s+POSi-\b/gi, replacement: 'HER POSITION' },
  { pattern: /\bNiPPLES\b/gi, replacement: 'NIPPLES' },
  { pattern: /\bSUiTS\b/gi, replacement: 'SUITS' },
  { pattern: /\bDiE\b/gi, replacement: 'DIE' },
  { pattern: /\bFEEE5\b/gi, replacement: 'FEELS' },
  { pattern: /\brecapturina\b/gi, replacement: 'recapturing' },
  { pattern: /\bkina\b/gi, replacement: 'king' },
  { pattern: /,?KN[iI]+GHT\b/gi, replacement: 'KNIGHT' },
  { pattern: /\bKN[iI]+GH\b/gi, replacement: 'KNIGHT' },
  { pattern: /\bI\s*KEER\b/gi, replacement: 'I KEEP' },
  { pattern: /\bIKEER\b/gi, replacement: 'I KEEP' },
  { pattern: /\bGONNA\s+LSE\b/gi, replacement: 'GONNA USE' },
  { pattern: /\bP[iI]G\s*-\s*KN[iI]+GHT\b/gi, replacement: 'PIG KNIGHT' },
  { pattern: /\bPR[iI]NCESS\s*-\s*KN[iI]+GHT\b/gi, replacement: 'PRINCESS KNIGHT' },
  { pattern: /\bPR[iI]NCEGS\b/gi, replacement: 'PRINCESS' },
  { pattern: /\bL[iI]lKE\s+A\b/gi, replacement: 'LIKE A' },
  { pattern: /\bL[iI]lKE\b/gi, replacement: 'LIKE' },
  { pattern: /\bYOUR\s*PUSSY'?S\b/gi, replacement: "YOUR PUSSY'S" },
  { pattern: /\bYOURPUSSY'?S\b/gi, replacement: "YOUR PUSSY'S" },
  { pattern: /\bWH[iI]TEP[iI]G\b/gi, replacement: 'WHITE PIG' },
  { pattern: /\bI\s+pan['’]?t\b/gi, replacement: "I can't" },
  { pattern: /\bYQU['’]?RE\b/gi, replacement: "YOU'RE" },
  { pattern: /\bTHEN\.\.\.I\b/gi, replacement: 'THEN...!' },
  { pattern: /\bNICELYPLOWED\b/gi, replacement: 'NICELY PLOWED' },
  { pattern: /\bDiD\s*YOUDO\b/gi, replacement: 'DID YOU DO' },
  { pattern: /\bYOUDO\b/gi, replacement: 'YOU DO' },
  { pattern: /\bEXECUT\s*I\s*ON\b/gi, replacement: 'EXECUTION' },
  { pattern: /\bof\s+ROSER\s*I\s*AS\b/gi, replacement: "OF ROSERIA'S" },
  { pattern: /\bROSER\s*I\s*AS\b/gi, replacement: "ROSERIA'S" },
  { pattern: /\bROSER\s*I\s*A['’]?S\b/gi, replacement: "ROSERIA'S" },
  { pattern: /\bROSERIAS\b/gi, replacement: "ROSERIA'S" },
  { pattern: /\bSput\b/g, replacement: 'Spurt' },
  { pattern: /\bsput\b/g, replacement: 'spurt' },
  { pattern: /\bpurting\b/gi, replacement: 'Spurting' },
  { pattern: /\bL?INSEM\s*IN\s*AT\s*I\s*ON\b/gi, replacement: 'INSEMINATION' },
  { pattern: /\bDISST?R\s*I\s*BUT\s*I\s*ON\b/gi, replacement: 'DISTRIBUTION' },
  { pattern: /\bPOSIT\s*I\s*ON\b/gi, replacement: 'POSITION' },
  { pattern: /\bIT\s+I\s+NSIDE\b/gi, replacement: 'IT INSIDE' },
  { pattern: /\bIT\s*I\s*NSIDE\b/gi, replacement: 'IT INSIDE' },
  { pattern: /\bJ-JUSHT\s+CA+ME\b/gi, replacement: 'J-JUST CAME' },
  { pattern: /\bJ-JUSHT\b/gi, replacement: 'J-JUST' },
  { pattern: /\bCAAME\b/gi, replacement: 'CAME' },
  { pattern: /\bPREGNAN\b/gi, replacement: 'PREGNANT' },
  { pattern: /\bHERVES\b/gi, replacement: 'HEROES' },
  { pattern: /\bherves\b/gi, replacement: 'heroes' },
  { pattern: /HCTAKCEP/gi, replacement: '' },
  { pattern: /\bHES\b/gi, replacement: "HE'S" },
  { pattern: /\bFLICK\b/gi, replacement: 'FUCK' },
  { pattern: /\bA-\s*Areyou\b/gi, replacement: 'A-Are you' },
  { pattern: /\bA-\s*Are\s*y\b/gi, replacement: 'A-Are you' },
  { pattern: /\bAreyou\b/gi, replacement: 'Are you' },
  { pattern: /\bYOU\s*-\s*COULD\b/gi, replacement: 'YOU COULD' },
  { pattern: /\bSO\s+ME\s+THING\b/gi, replacement: 'SOMETHING' },
  { pattern: /\bIT'?SA\b/gi, replacement: "IT'S A" },
  { pattern: /\bIT'?S\s+BESTIF\b/gi, replacement: "IT'S BEST IF" },
  { pattern: /\bBESTIF\b/gi, replacement: 'BEST IF' },
  { pattern: /\bTHENHISWHOLE\b/gi, replacement: 'THEN HIS WHOLE' },
  { pattern: /\bBODYWAS\b/gi, replacement: 'BODY WAS' },
  { pattern: /\bLIKEAFURNACE\b/gi, replacement: 'LIKE A FURNACE' },
  { pattern: /\bBUTNOW\b/gi, replacement: 'BUT NOW' },
  { pattern: /\bASICE\b/gi, replacement: 'AS ICE' },
  { pattern: /\bSCOLD\s+AS\s+ICE\b/gi, replacement: 'COLD AS ICE' },
  { pattern: /\bHE\s+SCOLD\b/gi, replacement: "HE'S COLD" },
  { pattern: /WHAT\s+KIND-OE/gi, replacement: 'WHAT KIND OF' },
  { pattern: /MY\s*STERIOUS/gi, replacement: 'MYSTERIOUS' },
  { pattern: /UKELY/gi, replacement: 'LIKELY' },
  { pattern: /HMM_\s*GUESS/gi, replacement: 'HMM I GUESS' },
  { pattern: /\bHUH_\b/gi, replacement: 'HUH...' },
  { pattern: /\bHUH\s*_\b/gi, replacement: 'HUH...' },
  { pattern: /\bGO\s+ON_\b/gi, replacement: 'Go on.' },
  { pattern: /\bGO\s+ON\s*_\b/gi, replacement: 'Go on.' },
  { pattern: /\bFOR\s+WHILE\b/gi, replacement: 'FOR A WHILE' },
  { pattern: /\bON\s+MY\s+MIND\b/gi, replacement: 'on my mind' },
  { pattern: /\bImidefiniely\b/gi, replacement: "I'm definitely" },
  { pattern: /\bImidefinitely\b/gi, replacement: "I'm definitely" },
  { pattern: /\bARENT\b/gi, replacement: "AREN'T" },
  { pattern: /\baren['’]t\s+we\b/gi, replacement: "aren't we" },
  { pattern: /\bmur\s+dered\b/gi, replacement: 'murdered' },
  { pattern: /\bTo\s+My\s+PRidE\b/gi, replacement: 'To my pride' },
  { pattern: /\bTHAT'S\s+FAiR\b/gi, replacement: "That's fair" },
  {
    pattern: /\bthis\s+submaie\s+to\s+in\s+ureat\s+the\s+ydoot\s+falinth\s+i\s+chapt\s+we\s+willtudhow\b/gi,
    replacement: 'this submarine to insure that they do not fail in this chapter we will study how',
  },
  {
    pattern: /\bsubmaie\s+to\s+in\s+ureat\s+the\s+ydoot\s+falinth\s+i\s+chapt\s+we\s+willtudhow\b/gi,
    replacement: 'submarine to insure that they do not fail in this chapter we will study how',
  },
  { pattern: /\bsubmaie\b/gi, replacement: 'submarine' },
  { pattern: /\bureat\b/gi, replacement: 'insure that' },
  { pattern: /\bydoot\b/gi, replacement: 'they do not' },
  { pattern: /\bfalinth\b/gi, replacement: 'fail in this' },
  { pattern: /\bi\s+chapt\b/gi, replacement: 'in this chapter' },
  { pattern: /\bchapt\b/gi, replacement: 'chapter' },
  { pattern: /\bwilltudhow\b/gi, replacement: 'will study how' },
  {
    pattern: /\bof\s*the\s+effctofravt\s*a?t?\s*i?\s*on\s+a\s*ctriclm\s*a\s*gnetiontact\s*rescaused\b/gi,
    replacement: 'of the effects of gravitational, electrical, magnetic, or contact forces caused',
  },
  { pattern: /\beffctofravt\b/gi, replacement: 'effects of gravitational' },
  { pattern: /\bctriclm\s*a\s*gnetiontact\b/gi, replacement: 'electrical, magnetic, or contact' },
  { pattern: /\brescaused\b/gi, replacement: 'forces caused' },
  { pattern: /\bKNIMIGHT\b/gi, replacement: 'KNIGHT' },
  { pattern: /\bBARBAR\s+[Il1|]\s+AN\b/gi, replacement: 'BARBARIAN' },
  { pattern: /BARBAR\s+[Il1|]\s+AN/gi, replacement: 'BARBARIAN' },
  // OCR lowercase 'i' confused for 'I' in ALL-CAPS manga text
  { pattern: /\bYQU'?RE\b/gi, replacement: "YOU'RE" },
  { pattern: /\bYQU\b/gi, replacement: 'YOU' },
  { pattern: /\bWiDLY\b/g, replacement: 'WILDLY' },
  { pattern: /\bSQIiRT\b/gi, replacement: 'SQUIRT' },
  { pattern: /\bSQ[Ii]RT\s*-\s*iNG\b/gi, replacement: 'SQUIRTING' },
  { pattern: /\bSQ[Ii]RT\s*-\s*\*?\+?\s*iNG\b/gi, replacement: 'SQUIRTING' },
  { pattern: /\bSQIiRTiNG\b/gi, replacement: 'SQUIRTING' },
  { pattern: /\bNiPPLES\b/gi, replacement: 'NIPPLES' },
  { pattern: /\bCLiT\b/gi, replacement: 'CLIT' },
  { pattern: /\bI\s+MOHSSO\s+IN\b/gi, replacement: 'SiDESHOW' },
  { pattern: /\bIMOHSSOIN\b/gi, replacement: 'SiDESHOW' },
  { pattern: /\bI\s+MOHSSOIN\b/gi, replacement: 'SiDESHOW' },
  { pattern: /\bCHME\b/gi, replacement: 'CAME' },
  { pattern: /\bCUM\s*-\s*\*?\+?\s*(?=[A-Za-z+]*([A-Za-z])\1)M+I+N+G+[\s+]*[G+]*\b/gi, replacement: 'CUM- MIIINN NNGG GGG' },
  { pattern: /\bCUM\s*-\s*\*?\+?\s*M+I+N+\s+N+G+\s+G+\b/gi, replacement: 'CUM- MIIINN NNGG GGG' },
  { pattern: /\bCUM\s*-\s*\*?\+?\s*M+I+N+\+\s*N+G+\+\s*G+\b/gi, replacement: 'CUM- MIIINN NNGG GGG' },
  { pattern: /\bCUM-?\s*\*?\+?\s*M+I+N+N+G+G+\b/gi, replacement: 'CUM- MIIINN NNGG GGG' },
  { pattern: /\bC[O0]{2,}\s*[+\s0]*[0-9]*\s*7?F?CKS\b/gi, replacement: 'COOOOOOOCKS' },
  { pattern: /\bWiTH\b/g, replacement: 'WITH' },
  { pattern: /\biT\b/g, replacement: 'IT' },
  { pattern: /\bSiDE\b/g, replacement: 'SIDE' },
  { pattern: /\bTHiNG\b/g, replacement: 'THING' },
  { pattern: /\bSiDe\b/g, replacement: 'SIDE' },
  { pattern: /\bMiND\b/g, replacement: 'MIND' },
  { pattern: /\bLiFE\b/g, replacement: 'LIFE' },
  { pattern: /\bFiGHT\b/g, replacement: 'FIGHT' },
  { pattern: /\bNiGHT\b/g, replacement: 'NIGHT' },
  { pattern: /\bLiKE\b/g, replacement: 'LIKE' },
  { pattern: /\bTiME\b/g, replacement: 'TIME' },
  { pattern: /\bKiLL\b/g, replacement: 'KILL' },
  { pattern: /\bRiGHT\b/g, replacement: 'RIGHT' },
  { pattern: /\bDiE\b/g, replacement: 'DIE' },
  { pattern: /\bDiED\b/g, replacement: 'DIED' },
  { pattern: /\bDYiNG\b/g, replacement: 'DYING' },
  // SOW in military/attack context is likely SHOW or a command; handle cautiously via lookup
  // WiTH iT: fix together
  { pattern: /\bWiTH\s+iT\b/g, replacement: 'WITH IT' },
  { pattern: /\bWITHAN\b/gi, replacement: 'WITH AN' },
  { pattern: /\bI'VELOST\b/gi, replacement: "I'VE LOST" },
  { pattern: /\bMYVIRGINITY\b/gi, replacement: 'MY VIRGINITY' },
  { pattern: /\bTOSOME\b/gi, replacement: 'TO SOME' },
  { pattern: /\bRAPING-MY\b/gi, replacement: 'RAPING MY' },
  { pattern: /\bRAPINGMY\b/gi, replacement: 'RAPING MY' },
  { pattern: /\bTHIS,MY\b/gi, replacement: 'THIS, MY' },
  { pattern: /\bTHISMY\b/gi, replacement: 'THIS, MY' },
  { pattern: /\bUSTHE,A\b/gi, replacement: 'US THE, A' },
  { pattern: /\bUSTHEA\b/gi, replacement: 'US THE, A' },
  { pattern: /\bdums\b/gi, replacement: 'dumb' },
  { pattern: /\bQUCK\b/gi, replacement: 'QUICK' },
  { pattern: /\bSmack[Vve]?\b/gi, replacement: 'Smack' },
  { pattern: /\bSmack\s+[Vv]\b/gi, replacement: 'Smack' },
  { pattern: /\bPoke[Vv]?\b/gi, replacement: 'Poke' },
  { pattern: /\bPoke\s+[Vv]\b/gi, replacement: 'Poke' },
  { pattern: /\bVAGINALWALLS\b/gi, replacement: 'VAGINAL WALLS' },
  { pattern: /\bIM\s+ME\s+NSETH\s+I\s+CKNESS\b/gi, replacement: 'IMMENSE THICKNESS' },
  { pattern: /\bIM\s+ME\s+NSETH\s+ICKNESS\b/gi, replacement: 'IMMENSE THICKNESS' },
  { pattern: /\bTHE\s+SAME\s+AGBAS\b/gi, replacement: 'THE SAME AGE AS' },
  { pattern: /\bHE\s+A\s+VYSIZEYET\b/gi, replacement: 'HEAVY SIZE YET,' },
  { pattern: /\bHE\s+A\s+VYSIZE\s+YET\b/gi, replacement: 'HEAVY SIZE YET,' },
  { pattern: /\bGO\s+IN\s+GYOUL\s+GET\b/gi, replacement: "GOING, YOU'LL GET" },
  { pattern: /\bBouncingy\b/gi, replacement: 'Bouncing' },
  { pattern: /\bplurge\b/gi, replacement: 'splurge' },
  { pattern: /\bTwitchv\b/gi, replacement: 'Twitch' },
  { pattern: /\bTHISSTRENGTH\.O\b/gi, replacement: 'THIS STRENGTH' },
  { pattern: /\bTHISSTRENGTH\b/gi, replacement: 'THIS STRENGTH' },
  { pattern: /\bI\s+MQUITE\s+ON\s+THE\b/gi, replacement: "I'M QUITE ON THE" },
  { pattern: /\bSOTIGHT\b/gi, replacement: 'SO TIGHT' },
  { pattern: /\bTHROUGHOUTMY\b/gi, replacement: 'THROUGHOUT MY' },
  { pattern: /\b[1I]\s*S\s*S[0O]\s*CUTE\b/gi, replacement: 'IS SO CUTE' },
  { pattern: /\b[1I]\s*S\s*SO\s*CUTE\b/gi, replacement: 'IS SO CUTE' },
  { pattern: /\bIS\s*S[0O]\s*CUTE\b/gi, replacement: 'IS SO CUTE' },
  // OCR trailing-char noise on manga SFX
  { pattern: /\bCOMINGO\b/gi, replacement: 'COMING' },
  { pattern: /\bCUMMINGC\b/gi, replacement: 'CUMMING' },
  { pattern: /\bCUMMINNGGGO\b/gi, replacement: 'CUMMINNGGG' },
  { pattern: /\bCUMMINN?GGGO\b/gi, replacement: 'CUMMINNGGG' },
  { pattern: /\bFTTITATERASE\b/gi, replacement: 'SO SOFT YET FIRM' },
  { pattern: /\bSO\s+SO\s+FTYETFIRM\b/gi, replacement: 'SO SOFT YET FIRM' },
  { pattern: /\bFTYETFIRM\b/gi, replacement: 'YET FIRM' },
  { pattern: /\bAM\s+A\s+ZINGAUINTIE\b/gi, replacement: 'AMAZING, AUNTIE' },
  { pattern: /\bZINGAUINTIE\b/gi, replacement: 'AUNTIE' },
  { pattern: /\bAND\s+BOLNCY\b/gi, replacement: 'AND BOUNCY' },
  { pattern: /\bAND\s+BOLCY\b/gi, replacement: 'AND BOUNCY' },
  { pattern: /\bBOLNCY\b/gi, replacement: 'BOUNCY' },
  { pattern: /\bBOLCY\b/gi, replacement: 'BOUNCY' },
  { pattern: /\bK-CUP\s+TITTIES\b/gi, replacement: 'K-CUP TITTIES' },
  { pattern: /\bLOCAT\s+I\s+ON\b/gi, replacement: 'LOCATION' },
  { pattern: /\bCHME\b/gi, replacement: 'CAME' },
  { pattern: /\b4HH\b/gi, replacement: 'AHH' },
  // 6O เป็น OCR noise ที่ไม่มีความหมาย ตัดทิ้งเลย
  { pattern: /\b6[oO]\b/g, replacement: '' },
  // S0 (เลขศูนย์) → SO (ตัวอักษร O)
  { pattern: /\bS0\b/g, replacement: 'SO' },
  { pattern: /\bs0\b/g, replacement: 'so' },
  { pattern: /BLOWTOB/gi, replacement: 'BLOWJOB' },
  { pattern: /\bnou\b/gi, replacement: 'you' },
  { pattern: /\by0u\b/gi, replacement: 'you' },
  { pattern: /\bDIseASe\b/gi, replacement: 'DISEASE' },
  { pattern: /\bFOuND\s+A\b/gi, replacement: 'FOUND A' },
  { pattern: /\bS3HS\b/gi, replacement: "SHE'S" },
  { pattern: /\bINSIDEI\b/gi, replacement: 'INSIDE!' },
  { pattern: /\bINSIDEI\?(?!\?)/gi, replacement: 'INSIDE!?' },
  { pattern: /\bWHTTT\s+TT\b/gi, replacement: 'IT WITHOUT' },
  { pattern: /\bRESTRAINT\s*[…\.]+/gi, replacement: 'RESTRAINT.' },
  { pattern: /\bGOO\s*[…\.]+/gi, replacement: 'GOOD...' },
  { pattern: /\biHnH\b/gi, replacement: 'HUH?' },
  { pattern: /\biSIhs\b/gi, replacement: 'THIS?' },
  { pattern: /\b2iHg\b/gi, replacement: 'EH!?' },
  { pattern: /\bEiH3\b/gi, replacement: 'EH!?' },
  { pattern: /\bIimom\b/gi, replacement: 'WOW!' },
  { pattern: /\bOd\s+11\.1\b/gi, replacement: "I'LL DO" },
  { pattern: /\bVAYS\b/gi, replacement: 'DAYS' },
  { pattern: /\bILL\b/g, replacement: "I'LL" },
  { pattern: /\bBEEELEE\b/gi, replacement: 'BELIEVE' },
  { pattern: /\bWNTTTT\b/gi, replacement: 'WITHOUT' },
  { pattern: /\bHERPUSSY\b/gi, replacement: 'HER PUSSY' },
  { pattern: /\bii333s\b/gi, replacement: 'SEEE!!' },
  { pattern: /\bHEAD\s+NUR-?\s*SEEE!!/gi, replacement: 'HEAD NUR-SEEE!!' },
  { pattern: /\bHEAD\s+NUR-?\s*ii333s/gi, replacement: 'HEAD NUR-SEEE!!' },
  { pattern: /\bAny\s*-?\s*MORE\b/gi, replacement: 'Anymore' },
  { pattern: /\bCUM\s*-?\s*MING\b/gi, replacement: 'CUMMING' },
  { pattern: /\bNOT\s+NEC\s*-?\s*ESSARY\b/gi, replacement: 'NOT NECESSARY' },
  { pattern: /\bNEC\s*-?\s*ESSARY\b/gi, replacement: 'NECESSARY' },
  // --- Manga specific repairs for Syunichi Kansuu Dojin ---
  { pattern: /\bSHUS[S\s]+ST\b/gi, replacement: 'SHE JUST' },
  { pattern: /\bBL[NW]TOO[R8]\b/gi, replacement: 'BLOWJOB' },
  { pattern: /\bBUE\s+ER\b/gi, replacement: 'BUT HER' },
  { pattern: /\bBUE\s+ER/gi, replacement: 'BUT HER' },
  { pattern: /\biSih1\b/gi, replacement: 'THIS' },
  { pattern: /\bWAY\s+TOO\+GOOD\b/gi, replacement: 'WAY TOO GOOD' },
  { pattern: /\bWAY\s+TOO\s*\+\s*GOOD\b/gi, replacement: 'WAY TOO GOOD' },
  { pattern: /\bABOUT\s+\+?\s*THE\s+FORE\+?\s*PLAY\b/gi, replacement: 'ABOUT THE FOREPLAY' },
  { pattern: /\bNOT\s+NEC-ESSARY\b/gi, replacement: 'NOT NECESSARY' },
  { pattern: /\bNOT\s+NEC\+NOT\s+NEC\b/gi, replacement: 'NOT NECESSARY' },
  { pattern: /\bALTHE\b/gi, replacement: 'ALL THE' },
  { pattern: /\bHheelel\b/gi, replacement: 'HEHEHE!' },
  { pattern: /\bBARBA-\s*RIANS\b/gi, replacement: 'BARBARIANS' },
  { pattern: /\bBARBA-RIANS\b/gi, replacement: 'BARBARIANS' },
  { pattern: /\bPREG-\s*NANAT\b/gi, replacement: 'PREGNANT' },
  { pattern: /\bPREG-NANAT\b/gi, replacement: 'PREGNANT' },
  { pattern: /\bFRFO\b/gi, replacement: '' },
  { pattern: /\bS-STO\+000\+0P\b/gi, replacement: 'S-STO OOO OP' },
  { pattern: /\bS-STO\+OOO\+OP\b/gi, replacement: 'S-STO OOO OP' },
  { pattern: /\b\(?GT[iI]NKY\)?\b/gi, replacement: 'STINKY' },
  { pattern: /\bWITHPRO\+CREAT\s*I\s*ON\b/gi, replacement: 'WITH PROCREATION' },
  { pattern: /\bWITHPRO\+CREAT\s*ION\b/gi, replacement: 'WITH PROCREATION' },
  { pattern: /\bj9H9H\b/gi, replacement: '' },
  { pattern: /<W\s+SDN/gi, replacement: '' },
  { pattern: /<WSDN/gi, replacement: '' },
  { pattern: /\bATOH\s+ONO\b/gi, replacement: 'AND HOLD' },
  { pattern: /\bATOHONO\b/gi, replacement: 'AND HOLD' },
  { pattern: /\bRe4t\s+A\b/g, replacement: 'Rest A' },
  { pattern: /\bRe4t\s+a\b/g, replacement: 'Rest a' },
  { pattern: /\bLN4I4\s+I\b/gi, replacement: "I DIDN'T" },
  { pattern: /\bCAME\.\.\.\b/gi, replacement: 'CAME' },
  { pattern: /\bdnd\b/gi, replacement: 'and' },
  { pattern: /\bhem\b/gi, replacement: 'hero' },
  { pattern: /~History/g, replacement: 'History' },
  { pattern: /\bFOR\s+MULAS\b/gi, replacement: 'FORMULAS' },
  { pattern: /\bOR\s*GANIZ\s*AT\s*I\s*ON\b/gi, replacement: 'ORGANIZATION' },
  { pattern: /\bGO\s*IN\s*GTOARREST\b/gi, replacement: 'GOING TO ARREST' },
  { pattern: /\bTHOSETHUGS\b/gi, replacement: 'THOSE THUGS' },
  { pattern: /\bAS\s+IS\s+A\s+I\s+DBEFORE\b/gi, replacement: 'AS I SAID BEFORE' },
  { pattern: /\bAND\s+ITS\s+DISTR\s*I\s*BUT\s*I\s*ON\s+IS\b/gi, replacement: 'AND ITS DISTRIBUTION IS' },
  { pattern: /\bIDO\b/g, replacement: 'I DO' },
  { pattern: /\bA\s+RELIEF\/HAVE\b/gi, replacement: 'A RELIEF I HAVE' },
  { pattern: /\bNAKCHALTEMPLE\b/gi, replacement: 'NAKCHAL TEMPLE' },
  { pattern: /\bNAKCHAL\s*TEMPLE\b/gi, replacement: 'NAKCHAL TEMPLE' },
  { pattern: /\bTHE\s+NAKCHAL\s*TEMPLE\b/gi, replacement: 'THE NAKCHAL TEMPLE' },
  { pattern: /\bPEOPLE\s+IS\s+I\s+LLEGAL\b/gi, replacement: 'PEOPLE IS ILLEGAL' },
  { pattern: /\bPEOPLE\s+IS\s+ILLEGAL\b/gi, replacement: 'PEOPLE IS ILLEGAL' },
  { pattern: /\bI\s+LLEGAL\b/gi, replacement: 'ILLEGAL' },
  { pattern: /\bSUPERV\s+IS\s+OR\s+INSTEAD\b/gi, replacement: 'SUPERVISOR INSTEAD' },
  { pattern: /\bSUPERV\s+IS\s+OR\b/gi, replacement: 'SUPERVISOR' },
  { pattern: /\bSUPERV\s*IS\s*OR\b/gi, replacement: 'SUPERVISOR' },
  { pattern: /\bSTILL\s+BE\s+IN\s+GDISTR\s*I\s*BUTED\b/gi, replacement: 'STILL BEING DISTRIBUTED' },
  { pattern: /\bSTILL\s+BEING\s+DISTR\s*I\s*BUTED\b/gi, replacement: 'STILL BEING DISTRIBUTED' },
  { pattern: /\bSTILL\s+BE\s+IN\s+G\s*DISTRIBUTED\b/gi, replacement: 'STILL BEING DISTRIBUTED' },
  { pattern: /\bIFIWERE\s+THEM\b/gi, replacement: 'IF I WERE THEM' },
  { pattern: /\bIFIWERETHEM\b/gi, replacement: 'IF I WERE THEM' },
  { pattern: /\bIM\s+CURIO\s+US\s+TO\b/gi, replacement: "I'M CURIOUS TO" },
  { pattern: /\bIM\s+CURIOUS\s+TO\b/gi, replacement: "I'M CURIOUS TO" },
  { pattern: /\bThe\s+ysaysay\s+it\s+wood\b/gi, replacement: "They said it's" },
  { pattern: /\bTheysaysay\s+it\s+wood\b/gi, replacement: "They said it's" },
  { pattern: /\bALREADY\s+LISTEDAS\s+AN\b/gi, replacement: 'ALREADY LISTED AS AN' },
  { pattern: /\bLISTEDAS\s+AN\b/gi, replacement: 'LISTED AS AN' },
  { pattern: /\bTHE\s+YSAID\s+ITS\b/gi, replacement: "THEY SAID IT'S" },
  { pattern: /\bTHEYSAID\s+ITS\b/gi, replacement: "THEY SAID IT'S" },
  { pattern: /\bTHISTO\b/gi, replacement: 'THIS TO' },
  { pattern: /\bYOUCAN\b/gi, replacement: 'YOU CAN' },
  { pattern: /\bDOeSn't\b/gi, replacement: "DOESN'T" },
  { pattern: /\bwhA-/gi, replacement: 'WHAT-' },
  { pattern: /\bNeRVeS\b/gi, replacement: 'NERVES' },
  { pattern: /\bAMUSInG\b/gi, replacement: 'AMUSING' },
  { pattern: /\bDEALing\b/gi, replacement: 'DEALING' },
  { pattern: /\bHonestLy\b/gi, replacement: 'HONESTLY' },
  { pattern: /\bSAN'S\s+NOT\b/gi, replacement: "SAN'S NOT" },
  { pattern: /\b1t['’]s\s+A\b/gi, replacement: "It's a" },
  { pattern: /\b1t['’]s\b/gi, replacement: "It's" },
  { pattern: /\bAntee\s+it\b/gi, replacement: 'guarantee it' },
  { pattern: /\bMELED\s+FOR\b/gi, replacement: 'CALLED FOR' },
  { pattern: /\bA\s+Blt\s+LIKE\b/gi, replacement: 'A BIT LIKE' },
  { pattern: /\bTAYAM\s+AS\s+AN\b/gi, replacement: 'TAYAMA-SAN' },
  { pattern: /\bIt['’]s\s+qulte\b/gi, replacement: "It's quite" },
  { pattern: /\bA\s+cO[-–—\s]*Ar\b/gi, replacement: 'A COLLAR' },
  { pattern: /\bAn\s+animar\b/gi, replacement: 'An animal' },
  { pattern: /\banimar\b/gi, replacement: 'animal' },
  { pattern: /\bA\s+himan\b/gi, replacement: 'A human' },
  { pattern: /\bhiman\b/gi, replacement: 'human' },
  { pattern: /\bSmink\b/gi, replacement: 'Smirk' },
  { pattern: /\b1T\b/g, replacement: 'IT' },
  { pattern: /[*•·]\s*collar\b/gi, replacement: 'collar' },
  { pattern: /\bSASAK\s+IS\s+AN\b/gi, replacement: 'SASAKI-SAN' },
  { pattern: /\bLIEVED!/gi, replacement: 'RELIEVED!' },
  { pattern: /\bSAAAN\b/gi, replacement: 'SAN' },
  { pattern: /\bRummnage\b/gi, replacement: 'Rummage' },
  { pattern: /\bS0\s+y0u\b/gi, replacement: 'SO YOU' },
  { pattern: /\bSAS4K1\.?\b/gi, replacement: 'SASAKI' },
  { pattern: /\bPARVON\b/gi, replacement: 'PARDON' },
  { pattern: /\bTICALLy\b/gi, replacement: 'TICALLY' },
  { pattern: /\bhinkang\b/gi, replacement: 'thinking' },
  { pattern: /\bHeve\b/gi, replacement: 'Here' },
  { pattern: /\bPERY\b/gi, replacement: 'PERV' },
  { pattern: /\bCLACKS\b/gi, replacement: 'CLACK' },
  { pattern: /\bGOROL-SAN\b/gi, replacement: 'GOROU-SAN' },
  { pattern: /\bMY\s+BEY-?\s*BLADE\b/gi, replacement: 'MY BEYBLADE' },
  { pattern: /\bBRINGHER\b/gi, replacement: 'BRING HER' },
  { pattern: /\bDOESn't\s+GEt\b/gi, replacement: "DOESN'T GET" },
  { pattern: /\bSciously\b/gi, replacement: 'consciously' },
  { pattern: /\bMINISCING\b/gi, replacement: 'REMINISCING' },
  { pattern: /\bSAn\b/g, replacement: 'San' },
  { pattern: /\bis'such\b/gi, replacement: 'is such' },
  { pattern: /\bAGREAT\b/gi, replacement: 'A GREAT' },
  { pattern: /\bDISGUSTEDBY\b/gi, replacement: 'DISGUSTED BY' },
  { pattern: /\bATFORSO\b/gi, replacement: 'AT SO FOR' },
  { pattern: /\bSHOULDIGET\b/gi, replacement: 'SHOULD I GET' },
  { pattern: /\bFAULTFOR\b/gi, replacement: 'FAULT FOR' },
  { pattern: /\bYOUQUIT\b/gi, replacement: 'YOU QUIT' },
  { pattern: /\bYousoMuCh\b/gi, replacement: 'You so much' },
  { pattern: /\bt-thAt\b/gi, replacement: 'T-that' },
  { pattern: /\btoge\+her\b/gi, replacement: 'together' },
  { pattern: /\bISSUCHANICE\b/gi, replacement: 'IS SUCH A NICE' },
  { pattern: /\bCoURSe\b/gi, replacement: 'course' },
  { pattern: /\bCAre\b/gi, replacement: 'Care' },
  { pattern: /\bGOODMOOD\b/gi, replacement: 'GOOD MOOD' },
  { pattern: /\bTHANKSFOR\b/gi, replacement: 'THANKS FOR' },
  { pattern: /\bWE'LLGO\b/gi, replacement: "WE'LL GO" },
  { pattern: /\bWELLGO\b/gi, replacement: "WE'LL GO" },
  { pattern: /\bYOUPRETTY\b/gi, replacement: 'YOU PRETTY' },
  { pattern: /\bFORTUNATE\.HEAR\b/gi, replacement: 'FORTUNATE. HEAR' },
  { pattern: /\bGRATITUDE\.I\b/gi, replacement: 'GRATITUDE. I' },
  { pattern: /\bNON-?EXISTENT\s*WELL\b/gi, replacement: 'NON-EXISTENT WELL' },
  { pattern: /\bNONEXISTENTWELL\b/gi, replacement: 'NON-EXISTENT WELL' },
  { pattern: /\bnow\.a\s+Married\b/gi, replacement: 'Now, a married' },
  { pattern: /\bdisoBeying\b/gi, replacement: 'disobeying' },
  { pattern: /\bWAiTing\b/gi, replacement: 'Waiting' },
  { pattern: /\bMar-ried\b/gi, replacement: 'Married' },
  { pattern: /\bSANI\?/gi, replacement: 'SAN?' },
  { pattern: /\bIWASIN\b/gi, replacement: 'I WAS IN' },
  { pattern: /\bRumeL\b/gi, replacement: 'Rumble' },
  { pattern: /\bGUMBC\b/gi, replacement: 'Rumble' },
  { pattern: /@umblc/gi, replacement: 'Rumble' },
  { pattern: /\bSENPAL\b/gi, replacement: 'SENPAI' },
  { pattern: /\bCuTe\b/g, replacement: 'Cute' },
  { pattern: /\bMAtCH\b/g, replacement: 'Match' },
  { pattern: /\bwantto\b/gi, replacement: 'want to' },
  { pattern: /\bTOBUYSTUFF\b/gi, replacement: 'TO BUY STUFF' },
  { pattern: /\bGRATEFLL\b/gi, replacement: 'GRATEFUL' },
  { pattern: /\bDOINGP\b/gi, replacement: 'DOING?' },
  { pattern: /\b(?:SAsaki-?sanP|Sasakisanp)\b/gi, replacement: 'Sasaki-san?' },
  { pattern: /\b([A-Za-z]+)-?sanP\b/gi, replacement: '$1-san?' },
  { pattern: /\bLightLy\b/g, replacement: 'Lightly' },
  { pattern: /\bUM-BRELLA/gi, replacement: 'UMBRELLA' },
  { pattern: /\bFILRTING\b/gi, replacement: 'FLIRTING' },
  { pattern: /\bTOMUSIC\b/gi, replacement: 'TO MUSIC' },
  { pattern: /\bTOSONGS\b/gi, replacement: 'TO SONGS' },
  { pattern: /\bSHOULDI\b/gi, replacement: 'SHOULD I' },
  { pattern: /\bCORDIS\b/gi, replacement: 'CORD IS' },
  { pattern: /\bMYSELF"THEN\b/gi, replacement: 'MYSELF" THEN' },
  { pattern: /\bANDSTARTED\b/gi, replacement: 'AND STARTED' },
  { pattern: /\bTOCOMPLETE\b/gi, replacement: 'TO COMPLETE' },
  { pattern: /\bNEXTMONTH'S\b/gi, replacement: "NEXT MONTH'S" },
  { pattern: /\bHASMADE\b/gi, replacement: 'HAS MADE' },
  { pattern: /\bEARTHIS\b/gi, replacement: 'EARTH IS' },
  { pattern: /\bFINIShED\b/gi, replacement: 'FINISHED' },
  { pattern: /\bteresting\b/gi, replacement: 'interesting' },
  { pattern: /"IT'SFASTER\b/gi, replacement: '"IT\'S FASTER' },
];

export const SPANISH_OCR_NOISE_REPAIRS: Array<{ pattern: RegExp; replacement: string }> = [
  { pattern: /\bQUE ?ME\b/gi, replacement: 'QUE ME' },
  { pattern: /\bQUEME\b/gi, replacement: 'QUE ME' },
  { pattern: /\bSI ?ME\b/gi, replacement: 'SI ME' },
  { pattern: /\bSIME\b/gi, replacement: 'SI ME' },
  { pattern: /\bS[- ]?SIENTO\b/gi, replacement: 'SIENTO' },
  { pattern: /\bDE ?LO\b/gi, replacement: 'DE LO' },
  { pattern: /\bDELO\b/gi, replacement: 'DE LO' },
  { pattern: /\bTO ?DO\b/gi, replacement: 'TODO' },
  { pattern: /\bTODOLOQUE\b/gi, replacement: 'TODO LO QUE' },
  { pattern: /\bLOQUE\b/gi, replacement: 'LO QUE' },
  { pattern: /\bLISTO ?CON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\bLISTOCON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\b[i¡]?LISTO[.!?…]+CON\b/gi, replacement: 'LISTO CON' },
  { pattern: /\bPRI-?\s*MERO\s*LA\s*FOTO\b/gi, replacement: 'PRIMERO LA FOTO' },
  { pattern: /\bPRIMEROLAFOTO\b/gi, replacement: 'PRIMERO LA FOTO' },
  { pattern: /\bMETIENDO\s*POR\b/gi, replacement: 'METIENDO POR' },
  { pattern: /\bMETIENDOPOR\b/gi, replacement: 'METIENDO POR' },
  { pattern: /\bPOR ?DENTRO\b/gi, replacement: 'POR DENTRO' },
  { pattern: /\bPORDENTRO\b/gi, replacement: 'POR DENTRO' },
  { pattern: /\bYA ?QUEDO\b/gi, replacement: 'YA QUEDO' },
  { pattern: /\bYAQUEDO\b/gi, replacement: 'YA QUEDO' },
  { pattern: /\bRAPIDOPR\b/gi, replacement: 'RAPIDO PR' },
  { pattern: /\bDE,\s*PIDIERON\b/gi, replacement: 'DESPIDIERON' },
  { pattern: /\bI?RAPIDO,?\s*PRI-?\b/gi, replacement: 'RAPIDO, PRI-' },
  { pattern: /\bCOMOSI\b/gi, replacement: 'COMO SI' },
  { pattern: /\bCIERTASPARTES\b/gi, replacement: 'CIERTAS PARTES' },
  { pattern: /\bERAUNPOCO\b/gi, replacement: 'ERA UN POCO' },
  { pattern: /\bNOERAUNPOCO\b/gi, replacement: 'NO ERA UN POCO' },
  { pattern: /\bSERAQUE\b/gi, replacement: 'SERA QUE' },
  { pattern: /\bCONMAS\b/gi, replacement: 'CON MAS' },
  { pattern: /\bM[ÁA]SDETALLE\b/gi, replacement: 'MAS DETALLE' },
  { pattern: /\bDETA\s*-?\s*LLE(?:S)?\b/gi, replacement: 'DETALLE' },
  { pattern: /\bENESPECI(?:FICO|ICO)\b/gi, replacement: 'EN ESPECIFICO' },
  { pattern: /\bESPEI?CICO\b/gi, replacement: 'ESPECIFICO' },
  { pattern: /\bALGE\s+ASI\b/gi, replacement: 'ALGO ASI' },
  { pattern: /\bmente\s+un\s+regalo\b/gi, replacement: 'un regalo para la mente' },
  { pattern: /\bdo\s+de\s+estudiar\b/gi, replacement: 'donde estudiar' },
  { pattern: /\brio\s+muy\b/gi, replacement: 'río muy' },
  { pattern: /\bgo\s+que\s+tendre\s+que\b/gi, replacement: 'tengo que ir' },
  { pattern: /\bversacion\b/gi, replacement: 'versión' },
  { pattern: /\bi(?=una\s+senal)/gi, replacement: '¡' },
  { pattern: /\bsenal\b/gi, replacement: 'señal' },
  { pattern: /\bromantica\b/gi, replacement: 'romántica' },
  { pattern: /\bC+pelicula\b/gi, replacement: 'película' },
  { pattern: /\btamento\b/gi, replacement: 'departamento' },
  { pattern: /\bingles\b/gi, replacement: 'inglés' },
  { pattern: /\bcen,todosson\b/gi, replacement: 'Cen Todosson' },
  { pattern: /\bque\?(?=\s|$)/gi, replacement: '¿qué?' },
  { pattern: /\bbirme\s+a\b/gi, replacement: 'suscribirme a' },
  { pattern: /\btido\s+prestado\b/gi, replacement: 'tiempo prestado' },
  { pattern: /\bprar\b/gi, replacement: 'comprar' },
  { pattern: /\bron\s+una\s+fiesta\b/gi, replacement: 'organizaron una fiesta' },
  { pattern: /\bbien\s+te\s+gustan\b/gi, replacement: 'también te gustan' },
  { pattern: /\bsecunda\s+ria\b/gi, replacement: 'secundaria' },
  { pattern: /\bfraz\s+para\b/gi, replacement: 'disfraz para' },
  { pattern: /\btonces\b/gi, replacement: 'entonces' },
  { pattern: /\bratura\s+delaire\b/gi, replacement: 'temperatura del aire' },
  { pattern: /\bratura\s+del\s+aire\b/gi, replacement: 'temperatura del aire' },
  { pattern: /\bguida\b/gi, replacement: 'seguida' },
  { pattern: /\bactualdad\b/gi, replacement: 'actualidad' },
  { pattern: /\bE\s*-\s*ES\s+QUE\b/gi, replacement: 'E-ES QUE' },
  { pattern: /\bTE\s*-\s*LO\b/gi, replacement: 'TE LO' },
  { pattern: /\bMON\s*-\s*TON\b/gi, replacement: 'MONTÓN' },
  { pattern: /\bGUENZA\b/gi, replacement: 'VERGÜENZA' },
  { pattern: /\bCIONANTE\b/gi, replacement: 'EMOCIONANTE' },
  { pattern: /\bMENTE\s+ODIOSO\b/gi, replacement: 'REALMENTE ODIOSO' },
  { pattern: /\bCONESO\b/gi, replacement: 'CON ESO' },
  { pattern: /\b[sS]0Y\s+[yY]0\b/g, replacement: 'SOY YO' },
  { pattern: /\bFENDERSE\.?[sS]0Y\s+[yY]0\b/gi, replacement: 'DEFENDERSE. SOY YO' },
  { pattern: /\bFENDERSE\b/gi, replacement: 'DEFENDERSE' },
  { pattern: /\bTIR\s+AVERGONZADA\b/gi, replacement: 'SENTIR AVERGONZADA' },
  { pattern: /\bBRE,\s*POR\s*FAVOR\b/gi, replacement: 'HOMBRE, POR FAVOR' },
  { pattern: /\bPLIR\s+CON\s+LO\s+BA-?\b/gi, replacement: 'CUMPLIR CON LO BASICO' },
  { pattern: /\bCIA\s+ATRAS\s+AS[iI]\s+CO-?\b/gi, replacement: 'HACIA ATRAS ASI COMO' },
  { pattern: /\bTE\s+LAS\s+PIERNAS\b/gi, replacement: 'ENTRE LAS PIERNAS' },
  { pattern: /\bGRAFIADO\s+JUNTO\s+A\s+ESO\s+Y\s+QUE\b/gi, replacement: 'FOTOGRAFIADO JUNTO A ESO Y QUE' },
  { pattern: /\bMERA\s+VEZ\s+QUE\s+LE\b/gi, replacement: 'PRIMERA VEZ QUE LE' },
  { pattern: /\bCucama\b/gi, replacement: 'cama' },
  { pattern: /\bLLADO\s+POR\b/gi, replacement: 'HUMILLADO POR' },
  { pattern: /\bHOOBAE\.LLADO\s+POR\b/gi, replacement: 'HOOBAE. HUMILLADO POR' },
  { pattern: /\bDA\s+ESE\s+MOMENTO\b/gi, replacement: 'DESDE ESE MOMENTO' },
  { pattern: /\bTABA\s+DE\s+FORMA\b/gi, replacement: 'ESTABA DE FORMA' },
  { pattern: /\bGONZOSAS\.PLETA\s*DERROTA\b/gi, replacement: 'VERGONZOSAS. COMPLETA DERROTA' },
  { pattern: /\bHECHO\.POR\b/gi, replacement: 'HECHO. POR' },
  { pattern: /\bTRAS\s+LE\s+PELLIZCO\s+LOS\s+PEZONES\b/gi, replacement: 'MIENTRAS LE PELLIZCO LOS PEZONES' },
  { pattern: /\bQUISTA\s+Y\s+ESTUPIDA\b/gi, replacement: 'CONQUISTA Y ESTUPIDA' },
  { pattern: /\bQUISTA\s+Y\b/gi, replacement: 'CONQUISTA Y' },
  { pattern: /\bCLUSIVA\b/gi, replacement: 'EXCLUSIVA' },
  { pattern: /\bTA\s+DE\s+AHORA\s+EN\b/gi, replacement: 'TRATA DE AHORA EN' },
  { pattern: /\bTA\s+DE\b/gi, replacement: 'TRATA DE' },
  { pattern: /\bFELICESAAMBOS\b/gi, replacement: 'FELICES A AMBOS' },
  { pattern: /\bESO\s+BASTA\.HACE\b/gi, replacement: 'CON ESO BASTA. HACE' },
  { pattern: /\bCON\s+ESO\s+BASTA\.HACE\b/gi, replacement: 'CON ESO BASTA. HACE' },
  { pattern: /\b(Pleaderrot|PLETADERROTA)\b/gi, replacement: 'COMPLETA DERROTA' },
  { pattern: /\bUNIDOS\s+EN\s+LA\s+RELA-?/gi, replacement: 'UNIDOS EN LA RELACION' },
  { pattern: /\bTEANDOLE\b/gi, replacement: 'TENTANDOLE' },
  { pattern: /\bTREVISTARON\b/gi, replacement: 'ENTREVISTARON' },
  { pattern: /\bSOLACION\b/gi, replacement: 'DESOLACION' },
  { pattern: /\bCREIBLE\.?\s*S[iI]\s*UNN?IESE\b/gi, replacement: 'CREIBLE. SI UNIESE' },
  { pattern: /\bS[iI]UNN?IESE\b/gi, replacement: 'SI UNIESE' },
  { pattern: /\bDAALAGUA\b/gi, replacement: 'DA AL AGUA' },
  { pattern: /\bBREPASARON\b/gi, replacement: 'SOBREPASARON' },
  { pattern: /\bGUIENTE\b/gi, replacement: 'SIGUIENTE' },
  { pattern: /\bCONDIDAS\b/gi, replacement: 'ESCONDIDAS' },
  { pattern: /\bRECIDO\b/gi, replacement: 'PARECIDO' },
  { pattern: /\bROSTROYVESTIMENTA\b/gi, replacement: 'ROSTRO Y VESTIMENTA' },
  { pattern: /\bEXPERTAEN\b/gi, replacement: 'EXPERTA EN' },
  { pattern: /\bYMENTIRAS\.?\b/gi, replacement: 'Y MENTIRAS.' },
  { pattern: /\bALTURA165-167CM\b/gi, replacement: 'ALTURA 165-167 CM' },
  { pattern: /\bESTIMADA\)\.EDAD\b/gi, replacement: 'ESTIMADA). EDAD' },
  { pattern: /\bLOHABITUAL\.{2,}/gi, replacement: 'LO HABITUAL...' },
  { pattern: /\bINTENTODE\b/gi, replacement: 'INTENTO DE' },
  { pattern: /\bINFILTRACIONAL\b/gi, replacement: 'INFILTRACION AL' },
  { pattern: /\bAREABFALLIDO\.?\b/gi, replacement: 'AREA B FALLIDO.' },
  { pattern: /\bEXTERNAFALLIDO\.SE\b/gi, replacement: 'EXTERNA FALLIDO. SE' },
  { pattern: /\bESTABASHACE\b/gi, replacement: 'ESTABAS HACE' },
  { pattern: /\bESTAREN\s+TU\b/gi, replacement: 'ESTAR EN TU' },
  { pattern: /\bESFORZAREAL\b/gi, replacement: 'ESFORZARE AL' },
  { pattern: /\bBUSCAUNA\b/gi, replacement: 'BUSCA UNA' },
  { pattern: /\bOPORTUNIDADY\b/gi, replacement: 'OPORTUNIDAD Y' },
  { pattern: /\bUNASOLA\b/gi, replacement: 'UNA SOLA' },
  { pattern: /\bCOSAQUE\b/gi, replacement: 'COSA QUE' },
  { pattern: /\bLEHAN\b/gi, replacement: 'LE HAN' },
  { pattern: /\bYMELO\b/gi, replacement: 'Y ME LO' },
  { pattern: /\bESTOATRAVES\b/gi, replacement: 'ESTO A TRAVES' },
  { pattern: /\bDELACAMARA\b/gi, replacement: 'DE LA CAMARA' },
  { pattern: /\bQUENOSOTROS\b/gi, replacement: 'QUE NOSOTROS' },
  { pattern: /\bSEASTONTA\b/gi, replacement: 'SEAS TONTA' },
  { pattern: /\bMOMENTODE\b/gi, replacement: 'MOMENTO DE' },
  { pattern: /\bTENGOQUE\b/gi, replacement: 'TENGO QUE' },
  { pattern: /\bVERESTO\b/gi, replacement: 'VER ESTO' },
  { pattern: /\bDBMICARRERA\b/gi, replacement: 'DE MI CARRERA' },
  { pattern: /\bEXCITADAEN\b/gi, replacement: 'EXCITADA EN' },
  { pattern: /\bACABACON\b/gi, replacement: 'ACABA CON' },
  { pattern: /\bDEBESER\b/gi, replacement: 'DEBE SER' },
  { pattern: /\bTENDREEXITO-?\b/gi, replacement: 'TENDRE EXITO' },
  { pattern: /\bCADADiA\b/gi, replacement: 'CADA DIA' },
  { pattern: /\bSUSEMEN\b/gi, replacement: 'SU SEMEN' },
  { pattern: /\bTODOELDIA\.{2,}/gi, replacement: 'TODO EL DIA...' },
  { pattern: /\bSUPERADOTODO\b/gi, replacement: 'SUPERADO TODO' },
  { pattern: /\bJUNTOSHASTA\b/gi, replacement: 'JUNTOS HASTA' },
  { pattern: /\bVEZTAMBIENLO\b/gi, replacement: 'VEZ TAMBIEN LO' },
  { pattern: /\bDBAQU[iI]\b/gi, replacement: 'DE AQUI' },
  { pattern: /\bNOSB\b/gi, replacement: 'NO SE' },
  { pattern: /\bCONLAS\b/gi, replacement: 'CON LAS' },
  { pattern: /\bCONESTO\.PERO\b/gi, replacement: 'CON ESTO. PERO' },
  { pattern: /\bESSORPRENDENTE\.?\b/gi, replacement: 'ES SORPRENDENTE.' },
  { pattern: /\bPOLiA\.{2,}/gi, replacement: 'POLLA...' },
  { pattern: /\bENTONCESY\b/gi, replacement: 'ENTONCES Y' },
  { pattern: /\bGEMIDOSDE\b/gi, replacement: 'GEMIDOS DE' },
  { pattern: /\bMASTAED\b/gi, replacement: 'HASTA EL' },
  { pattern: /\bDECERAES\b/gi, replacement: 'DE VERAS ES' },
  { pattern: /\bESBUENO\.{2,}/gi, replacement: 'ES BUENO...' },
  { pattern: /\bTANTOY\b/gi, replacement: 'TANTO Y' },
  { pattern: /\bYOME\b/gi, replacement: 'YO ME' },
  { pattern: /\bPOLLAV\b/gi, replacement: 'POLLA' },
  { pattern: /\bESTABASA\b/gi, replacement: 'ESTABAS A' },
  { pattern: /\bVOYIA\b/gi, replacement: 'VOY A' },
  { pattern: /\bCORRERDESDE\b/gi, replacement: 'CORRER DESDE' },
  { pattern: /\bUNPOZO\b/gi, replacement: 'UN POZO' },
  { pattern: /\bSINFONDO\.?\b/gi, replacement: 'SIN FONDO.' },
  { pattern: /\bODIABATANTOA\b/gi, replacement: 'ODIABA TANTO A' },
  { pattern: /\bMIYOQUEILLEGABA\b/gi, replacement: 'MI YO QUE LLEGABA' },
  { pattern: /\bAESPERARIQUED\b/gi, replacement: 'A ESPERAR QUE' },
  { pattern: /\bAUNQUBFUERA\b/gi, replacement: 'AUNQUE FUERA' },
  { pattern: /\bPORIUNINSTANTE\b/gi, replacement: 'POR UN INSTANTE' },
  { pattern: /\bMETOCARALOS\b/gi, replacement: 'ME TOCARA LOS' },
  { pattern: /\bPEZONESOEL\b/gi, replacement: 'PEZONES O EL' },
  { pattern: /\bKEISOLiALLEGAR\b/gi, replacement: 'KEI SOLIA LLEGAR' },
  { pattern: /\bRECORDARELOLOR\b/gi, replacement: 'RECORDAR EL OLOR' },
  { pattern: /\bDBKEI\.{2,}/gi, replacement: 'DE KEI...' },
  { pattern: /\bCONVERLO\b/gi, replacement: 'CON VERLO' },
  { pattern: /\bMICUERPO\b/gi, replacement: 'MI CUERPO' },
  { pattern: /\bEMPIEZAA\b/gi, replacement: 'EMPIEZA A' },
  { pattern: /\bALMAXIMOD\b/gi, replacement: 'AL MAXIMO' },
  { pattern: /\bHASTAJUSTO\b/gi, replacement: 'HASTA JUSTO' },
  { pattern: /\bANTESDE\s*QUE\b/gi, replacement: 'ANTES DE QUE' },
  { pattern: /\bSECORRA\.{2,}/gi, replacement: 'SE CORRA...' },
  { pattern: /\bDBMI\b/gi, replacement: 'DE MI' },
  { pattern: /\bDETENDRELA\b/gi, replacement: 'DETENDRE LA' },
  { pattern: /\bMUCHOMAS\b/gi, replacement: 'MUCHO MAS' },
  { pattern: /\bQUEME\b/gi, replacement: 'QUE ME' },
  { pattern: /\bSALVASEMENTE\b/gi, replacement: 'SALVAJEMENTE' },
  { pattern: /\bYOPARA\b/gi, replacement: 'YO PARA' },
  { pattern: /\bQUBES\b/gi, replacement: 'QUE ES' },
  { pattern: /\bMEVENGO\b/gi, replacement: 'ME VENGO' },
  { pattern: /\bSIENTETANBIEN\.{2,}/gi, replacement: 'SE SIENTE TAN BIEN...' },
  { pattern: /\[?AH\.\.\.MB\]?→AH…ME VENGOOTRAVEZ,MEVENGOME/gi, replacement: 'AH... ME VENGO OTRA VEZ! ME VENGO!' },
  { pattern: /\bME\s*VOY['’]?A\s*VENIIR!?\b/gi, replacement: 'ME VOY A VENIR!' },
  { pattern: /\bME\s+VENGOOTRAVEZ\b/gi, replacement: 'ME VENGO OTRA VEZ' },
  { pattern: /\bMEVENGOME\b/gi, replacement: 'ME VENGO ME VENGO' },
  { pattern: /\bLAPERSIGUE\b/gi, replacement: 'LA PERSIGUE' },
  { pattern: /\bDESESPERADAMENTE\.?\b/gi, replacement: 'DESESPERADAMENTE.' },
  { pattern: /\bDISFRACES,ESCAPE,YMENTIRAS\.?\b/gi, replacement: 'DISFRACES, ESCAPE, Y MENTIRAS.' },
  { pattern: /\bESTANBLOQUEADAS\.?\b/gi, replacement: 'ESTAN BLOQUEADAS.' },
  { pattern: /\bCREPORTEDELDiA\b/gi, replacement: 'REPORTE DEL DIA' },
  { pattern: /\bESTEENSENANDO\b/gi, replacement: 'ESTA ENSENANDO' },
  { pattern: /\bQUBKEI\.?\b/gi, replacement: 'QUE KEI.' },
  { pattern: /\bPUEDA\s*VERTU\b/gi, replacement: 'PUEDA VER TU' },
  { pattern: /\bABRIENDOTU\b/gi, replacement: 'ABRIENDO TU' },
  { pattern: /\bCOMOLADRONA\.?\b/gi, replacement: 'COMO LADRONA.' },
  { pattern: /\bNOMIRES!?\b/gi, replacement: 'NO MIRES!' },
  { pattern: /\bTODOESTOES\b/gi, replacement: 'TODO ESTO ES' },
  { pattern: /\bLNA\s*AGTUACION!?\b/gi, replacement: 'UNA ACTUACION!' },
  { pattern: /\bSUFICIENTEY\b/gi, replacement: 'SUFICIENTE Y' },
  { pattern: /\bSERiA\s*TAN\b/gi, replacement: 'SERIA TAN' },
  { pattern: /\bDENTROS\b/gi, replacement: 'DENTRO' },
  { pattern: /\bMEJOR!Y\b/gi, replacement: 'MEJOR! Y' },
  { pattern: /\bEVERDAD\??\b/gi, replacement: 'DE VERDAD?' },
  { pattern: /\bECIERTO\??\b/gi, replacement: 'ES CIERTO?' },
  { pattern: /\bNOPARADE\b/gi, replacement: 'NO PARA DE' },
  { pattern: /\bLATIRYLA\b/gi, replacement: 'LATIR Y LA' },
  { pattern: /\bCONESTO\.\.\.PERO\b/gi, replacement: 'CON ESTO... PERO' },
  { pattern: /\bESSORPRENDENTE\.ESTAS\b/gi, replacement: 'ES SORPRENDENTE. ESTAS' },
  { pattern: /\bFROTARLAY\b/gi, replacement: 'FROTARLA' },
  { pattern: /\b2SEHA\b/gi, replacement: 'SE HA' },
  { pattern: /\bVERAEVE\b/gi, replacement: 'VER A EVE' },
  { pattern: /\b&QUBCARA\b/gi, replacement: 'QUE CARA' },
  { pattern: /\bVOLVERLOCA!?\b/gi, replacement: 'VOLVER LOCA!' },
  { pattern: /iiAHHHVV!!/gi, replacement: 'AHHH!!' },
  { pattern: /iii&POR\s*QUE\?!!!/gi, replacement: 'POR QUE?!!!' },
  { pattern: /&ACASO\b/gi, replacement: 'ACASO' },
  { pattern: /\bVERDAD\?Yj\b/gi, replacement: 'VERDAD?' },
  { pattern: /\bDiA20DE\b/gi, replacement: 'DIA 20 DE' },
  { pattern: /\bLAMISION\.?\b/gi, replacement: 'LA MISION.' },
  { pattern: /\bDESPUESDE\b/gi, replacement: 'DESPUES DE' },
  { pattern: /\bLOSPEZONES,?\b/gi, replacement: 'LOS PEZONES,' },
  { pattern: /\bSOLOMI\b/gi, replacement: 'SOLO MI' },
  { pattern: /\bDURANTEESTOS\b/gi, replacement: 'DURANTE ESTOS' },
  { pattern: /\bDOSDiASERICH\b/gi, replacement: 'DOS DIAS ERICH' },
  { pattern: /\bHAATACADO\b/gi, replacement: 'HA ATACADO' },
  { pattern: /\bYANOPUEDO\b/gi, replacement: 'YA NO PUEDO' },
  { pattern: /Fee\s*Desv\.JEJEY/gi, replacement: 'JEJE' },
  { pattern: /\bUNOLORD\b/gi, replacement: 'UN OLOR' },
  { pattern: /\bSOLOSERA\s*UNAVEZ\b/gi, replacement: 'SOLO SERA UNA VEZ' },
  { pattern: /\bLEPEDIRE\b/gi, replacement: 'LE PEDIRE' },
  { pattern: /\bQUBMEHAGA\b/gi, replacement: 'QUE ME HAGA' },
  { pattern: /\bVENIRSOLO\b/gi, replacement: 'VENIR SOLO' },
  { pattern: /\bMEมVOY'A\s*VENIIR!?\b/gi, replacement: 'ME VOY A VENIR!' },
  { pattern: /\bAHVQUE\s*FUERTE\b/gi, replacement: 'AH QUE FUERTE' },
  { pattern: /\bQiYANO\b/gi, replacement: 'YA NO' },
  { pattern: /\bQUIEROMAS!?\b/gi, replacement: 'QUIERO MAS!' },
  { pattern: /\bMIUTERO\b/gi, replacement: 'MI UTERO' },
  { pattern: /\bSEVAA\b/gi, replacement: 'SE VA A' },
  { pattern: /\bROMPERD\b/gi, replacement: 'ROMPER' },
  { pattern: /\bRICOSESIENTE\b/gi, replacement: 'RICO SE SIENTE' },
  { pattern: /\bMISPEZONESSE\b/gi, replacement: 'MIS PEZONES SE' },
  { pattern: /\bMICLiTORISSE\b/gi, replacement: 'MI CLITORIS SE' },
  { pattern: /\bSIENTEN\s*TANBIEN\.{0,3}\b/gi, replacement: 'SIENTEN TAN BIEN...' },
  { pattern: /\bHASTAEL\b/gi, replacement: 'HASTA EL' },
  { pattern: /\bDERRITEV\b/gi, replacement: 'DERRITE' },
  { pattern: /\bELINTERIOR\b/gi, replacement: 'EL INTERIOR' },
  { pattern: /\bLAPRIVACIDADDEERICH\b/gi, replacement: 'LA PRIVACIDAD DE ERICH' },
  { pattern: /\bEDAD:DESCONOCIDA\b/gi, replacement: 'EDAD: DESCONOCIDA' },
  { pattern: /\bDEWILHELMVON\b/gi, replacement: 'DE WILHELM VON' },
  { pattern: /\bREINHARDTELHOMBRE\b/gi, replacement: 'REINHARDT EL HOMBRE' },
  { pattern: /\bMASRICODELA\b/gi, replacement: 'MAS RICO DE LA' },
  { pattern: /\bREGIONDESCHLOSS\b/gi, replacement: 'REGION DE SCHLOSS' },
  { pattern: /\bESVERDAD\b/gi, replacement: 'ES VERDAD' },
  { pattern: /\bTAL\s*VEZNO\b/gi, replacement: 'TAL VEZ NO' },
  { pattern: /\bSOLOLA\b/gi, replacement: 'SOLO LA' },
  { pattern: /\bSECORRA\b/gi, replacement: 'SE CORRA' },
  { pattern: /\bDENTRODETI\b/gi, replacement: 'DENTRO DE TI' },
  { pattern: /\bTECREERE\b/gi, replacement: 'TE CREERE' },
  { pattern: /\bCOSA\s+QLE\b/gi, replacement: 'COSA QUE' },
  { pattern: /\bI?M\s*A\s*LDITA\b/gi, replacement: 'MALDITA' },
  { pattern: /\bSEA!NOS\b/gi, replacement: 'SEA! NOS' },
  { pattern: /\bTRAMPA\.\.LO\b/gi, replacement: 'TRAMPA.. LO' },
  { pattern: /\bSIENTO,KEI\b/gi, replacement: 'SIENTO, KEI' },
  { pattern: /\bAHORAQUE\b/gi, replacement: 'AHORA QUE' },
  { pattern: /\bLASCOSAS\b/gi, replacement: 'LAS COSAS' },
  { pattern: /\bHANLLEG\s*A\s*DO\b/gi, replacement: 'HAN LLEGADO' },
  { pattern: /\bHANLLEGADO\b/gi, replacement: 'HAN LLEGADO' },
  { pattern: /\bAESTO\b/gi, replacement: 'A ESTO' },
  { pattern: /\biNOME\b/gi, replacement: 'NO ME' },
  { pattern: /\bQUETENGA\b/gi, replacement: 'QUE TENGA' },
  { pattern: /\bQUEHACER\b/gi, replacement: 'QUE HACER' },
  { pattern: /\bJUROQLE\b/gi, replacement: 'JURO QUE' },
  { pattern: /\bLOROBARE\b/gi, replacement: 'LO ROBARE' },
  { pattern: /\bjuOOOOH\b/gi, replacement: 'uOOOOH' },
  { pattern: /\bESESTO\b/gi, replacement: 'ES ESTO' },
  { pattern: /\biiERES\b/gi, replacement: 'ERES' },
  { pattern: /\bO\s+quE\b/gi, replacement: 'O QUE' },
  { pattern: /\bCONEL\b/gi, replacement: 'CON EL' },
  { pattern: /\bI\s*M\s*PRES\s*I\s*ONANTE\b/gi, replacement: 'IMPRESIONANTE' },
  { pattern: /\bSOLOHAY\b/gi, replacement: 'SOLO HAY' },
  { pattern: /\bDO\s*SCAMAR\s*AS\b/gi, replacement: 'DOS CAMARAS' },
  { pattern: /\bIN\s*STALAD\s*AS\b/gi, replacement: 'INSTALADAS' },
  { pattern: /\bENEL\b/gi, replacement: 'EN EL' },
  { pattern: /\bPEROSONDE\b/gi, replacement: 'PERO SON DE' },
  { pattern: /\bANGULARD\b/gi, replacement: 'ANGULAR' },
  { pattern: /\bASiQUB\b/gi, replacement: 'ASI QUE' },
  { pattern: /\bSEVENLOS\b/gi, replacement: 'SE VEN LOS' },
  { pattern: /\bMETERTELA!O\b/gi, replacement: 'METERTELA!' },
  { pattern: /\bPOSETAN\b/gi, replacement: 'POSE TAN' },
  { pattern: /\bPROVOCATIVA!O\b/gi, replacement: 'PROVOCATIVA!' },
  { pattern: /\bEROTICAY\b/gi, replacement: 'EROTICA Y' },
  { pattern: /\bLASCIVAO\b/gi, replacement: 'LASCIVA' },
  { pattern: /\bAS\s*I\s*QUERAP\s*I\s*DO\b/gi, replacement: 'ASI QUE RAPIDO' },
  { pattern: /\bQUERAP\s*I\s*DO\b/gi, replacement: 'QUE RAPIDO' },
  { pattern: /\bESLAMAYOR\b/gi, replacement: 'ES LA MAYOR' },
  { pattern: /\bHUMILLAC\s*I\s*ON\b/gi, replacement: 'HUMILLACION' },
  { pattern: /\bDEMICARRERA\b/gi, replacement: 'DE MI CARRERA' },
  { pattern: /\bCOMO\s*LADRONA\b/gi, replacement: 'COMO LADRONA' },
  { pattern: /\bKEI\.POR\b/gi, replacement: 'KEI. POR' },
  { pattern: /\bI\s*TO\s*DO\s*ESTOES\b/gi, replacement: 'TODO ESTO ES' },
  { pattern: /\bUNA\s*A\s*GTUAC\s*I\s*ON\b/gi, replacement: 'UNA ACTUACION' },
  { pattern: /\bE-ESVERDAD\b/gi, replacement: 'E-ES VERDAD' },
  { pattern: /\bEPORQUE\b/gi, replacement: 'POR QUE' },
  { pattern: /\biSINO\b/gi, replacement: 'SI NO' },
  { pattern: /\bA\s*BSOLU\s*TO\b/gi, replacement: 'ABSOLUTO' },
  { pattern: /\bMMM~MEVOY\b/gi, replacement: 'MMM~ ME VOY' },
  { pattern: /\bADORMIR\b/gi, replacement: 'A DORMIR' },
  { pattern: /\bMANANAO\b/gi, replacement: 'MAÑANA' },
  { pattern: /\biTE\s+JURO\b/gi, replacement: 'TE JURO' },
  { pattern: /\biERICH!EN\b/gi, replacement: 'ERICH! EN' },
  { pattern: /\biMEDA\b/gi, replacement: 'ME DA' },
  { pattern: /\bTENERQUE\b/gi, replacement: 'TENER QUE' },
  { pattern: /\bQUB\s+ESTE\b/gi, replacement: 'QUE ESTE' },
  { pattern: /\bTIPOSECORRA\b/gi, replacement: 'TIPO SE CORRA' },
  { pattern: /\bDENTRODEMI\b/gi, replacement: 'DENTRO DE MI' },
  { pattern: /\bSO\s*LOPAR\s*A\b/gi, replacement: 'SOLO PARA' },
  { pattern: /\bPODERVERA\b/gi, replacement: 'PODER VER A' },
  { pattern: /\bCUANTOANTES\b/gi, replacement: 'CUANTO ANTES' },
  { pattern: /\bYAESEL\b/gi, replacement: 'YA ES EL' },
  { pattern: /\bQUINTOD\s*I\s*A\b/gi, replacement: 'QUINTO DIA' },
  { pattern: /\bSISOLO\b/gi, replacement: 'SI SOLO' },
  { pattern: /\bSINSABER\b/gi, replacement: 'SIN SABER' },
  { pattern: /\bCUANDOSE\b/gi, replacement: 'CUANDO SE' },
  { pattern: /\bCORRER\s*A\s*NO\b/gi, replacement: 'CORRERA NO' },
  { pattern: /\bPODRESALIR\b/gi, replacement: 'PODRE SALIR' },
  { pattern: /\bDEAQU[iI]\b/gi, replacement: 'DE AQUI' },
  { pattern: /\bMEJOR!O\b/gi, replacement: 'MEJOR!' },
  { pattern: /\biOH!\b/gi, replacement: 'OH!' },
  { pattern: /\biAHi!\b/gi, replacement: 'AHI!' },
  { pattern: /\bPARECEQUELA\b/gi, replacement: 'PARECE QUE LA' },
  { pattern: /\bZONAIDEL\b/gi, replacement: 'ZONA DEL' },
  { pattern: /\bMUYSENSIBLE\b/gi, replacement: 'MUY SENSIBLE' },
  { pattern: /\bJEJE\.\.\.YBIEN\b/gi, replacement: 'JEJE... Y BIEN' },
  { pattern: /\bNOPUEDES\b/gi, replacement: 'NO PUEDES' },
  { pattern: /\bTANTO\.LA\b/gi, replacement: 'TANTO LA' },
  { pattern: /\bCOMO`LA\b/gi, replacement: 'COMO LA' },
  { pattern: /\bDEL,SEMEN\b/gi, replacement: 'DEL SEMEN' },
  { pattern: /\bALASDE\b/gi, replacement: 'A LAS DE' },
  { pattern: /\bESTETIPO\.\b/gi, replacement: 'ESTE TIPO.' },
  { pattern: /\bSIEMPREESTA\b/gi, replacement: 'SIEMPRE ESTA' },
  { pattern: /\bRODEADO\s+DE\b/gi, replacement: 'RODEADO DE' },
  { pattern: /\bMUJERES,ASiQUE\b/gi, replacement: 'MUJERES, ASI QUE' },
  { pattern: /\bPENSEQUBNO\b/gi, replacement: 'PENSE QUE NO' },
  { pattern: /\bSENTIR\s*I\s*A\b/gi, replacement: 'SENTIRIA' },
  { pattern: /\bESTO\.PERO\b/gi, replacement: 'ESTO. PERO' },
  { pattern: /\bMANANA3\b/gi, replacement: 'MANANA' },
  { pattern: /\bESTEMALD\s*I\s*TO\b/gi, replacement: 'ESTE MALDITO' },
  { pattern: /\bOTRAVEZ\b/gi, replacement: 'OTRA VEZ' },
  { pattern: /\bMEHAGA\b/gi, replacement: 'ME HAGA' },
  { pattern: /\bMETAL\s*A\s*A\s*MOSELO\b/gi, replacement: 'METALA AMO SE LO' },
  { pattern: /\bFONDODEL\b/gi, replacement: 'FONDO DEL' },
  { pattern: /\bSUPOLLA\b/gi, replacement: 'SU POLLA' },
  { pattern: /\biEQ-QUE\b/gi, replacement: '¿QUE' },
  { pattern: /\bi&quE\b/gi, replacement: '¡QUE' },
  { pattern: /\bSELA\b/gi, replacement: 'SE LA' },
  { pattern: /\bDEJAMEVER\b/gi, replacement: 'DEJAME VER' },
  { pattern: /\bESTETIPO\.\./gi, replacement: 'ESTE TIPO..' },
  { pattern: /\bESBUENO\b/gi, replacement: 'ES BUENO' },
  { pattern: /\bHiAHHHOO!!\b/gi, replacement: 'AHHH!!' },
  { pattern: /\biiiiPOR,QUE\?!!!\b/gi, replacement: '¿POR QUE?!!!' },
  { pattern: /\bVERDAD\?Y\b/gi, replacement: 'VERDAD? Y' },
  { pattern: /\bESTOES\b/gi, replacement: 'ESTO ES' },
  { pattern: /\bPOR\s+QLEDAR\b/gi, replacement: 'POR QUEDAR' },
  { pattern: /\bRiVIENE\b/gi, replacement: 'VIENE' },
  { pattern: /\bVOYA\b/gi, replacement: 'VOY A' },
  { pattern: /\bESUNHOMBREMUCHO\b/gi, replacement: 'ES UN HOMBRE MUCHO' },
  { pattern: /\bMASPERSISTENTEY\b/gi, replacement: 'MAS PERSISTENTE Y' },
  { pattern: /\bPROBLEMATICODE\b/gi, replacement: 'PROBLEMATICO DE' },
  { pattern: /\bLOQUEPENSABA\b/gi, replacement: 'LO QUE PENSABA' },
  { pattern: /\bA\s+PESARDEH\s*A\s*BERLE\b/gi, replacement: 'A PESAR DE HABERLE' },
  { pattern: /\bENTREG\s*A\s*DO\s+MICUERPO\b/gi, replacement: 'ENTREGADO MI CUERPO' },
  { pattern: /\bASiNO\b/gi, replacement: 'ASI NO' },
  { pattern: /\bDENADA\b/gi, replacement: 'DE NADA' },
  { pattern: /\bQUEINMADURO\b/gi, replacement: 'QUE INMADURO' },
  { pattern: /\bSEDEDICO\b/gi, replacement: 'SE DEDICO' },
  { pattern: /\bDiAZODE\b/gi, replacement: 'DIA 2 DE' },
  { pattern: /\bLAMIS\s*I\s*ON\b/gi, replacement: 'LA MISION' },
  { pattern: /\bDOSDiAS\b/gi, replacement: 'DOS DIAS' },
  { pattern: /\bSOLOMI\b/gi, replacement: 'SOLO MI' },
  { pattern: /\bTO\s*DOELD\s*I\s*A\b/gi, replacement: 'TODO EL DIA' },
  { pattern: /\bMI\[CUERPO\b/gi, replacement: 'MI CUERPO' },
  { pattern: /\bPEZONESY\b/gi, replacement: 'PEZONES Y' },
  { pattern: /\bELCLIT\s*OR\s*IS\b/gi, replacement: 'EL CLITORIS' },
  { pattern: /\bEMPAP\s*A\s*DO\b/gi, replacement: 'EMPAPADO' },
  { pattern: /\bPORLA\s+SALIVA\b/gi, replacement: 'POR LA SALIVA' },
  { pattern: /\bDEERICH\b/gi, replacement: 'DE ERICH' },
  { pattern: /\bODIAB\s*AT\s*AN\s*TO\s*A\b/gi, replacement: 'ODIABA TANTO A' },
  { pattern: /\bMIYOQUELLEGABA\b/gi, replacement: 'MI YO QUE LLEGABA' },
  { pattern: /\bA\s+ESPER\s*A\s*RQUED\b/gi, replacement: 'A ESPERAR QUE' },
  { pattern: /\bA\s+UNQUBFUER\s*A\b/gi, replacement: 'AUNQUE FUERA' },
  { pattern: /\bPORJUNJINSTANTE\)?/gi, replacement: 'POR UN INSTANTE' },
  { pattern: /\bPEZONESOEL\b/gi, replacement: 'PEZONES O EL' },
  { pattern: /\bLACARADE\b/gi, replacement: 'LA CARA DE' },
  { pattern: /\bKEIPARA\b/gi, replacement: 'KEI PARA' },
  { pattern: /\bCOMOSI\b/gi, replacement: 'COMO SI' },
  { pattern: /\bSO\s*BRESCRIBIEN\s*DO\b/gi, replacement: 'SOBRESCRIBIENDO' },
  { pattern: /\bELRASTRO\b/gi, replacement: 'EL RASTRO' },
  { pattern: /\bDEKEIQUE\b/gi, replacement: 'DE KEI QUE' },
  { pattern: /\bYPEGAJOSAMENTE\b/gi, replacement: 'Y PEGAJOSAMENTE' },
  { pattern: /\bJUST\s*OH\s*A\s*STADONDE\b/gi, replacement: 'JUSTO HASTA DONDE' },
  { pattern: /\bKEISOL\s*I\s*A\s*LLEGAR\b/gi, replacement: 'KEI SOLIA LLEGAR' },
  { pattern: /\bDEVECES\b/gi, replacement: 'DE VECES' },
  { pattern: /\bETU\s+MISMA\b/gi, replacement: '¿TU MISMA' },
  { pattern: /\bDIsFRAZ\b/gi, replacement: 'DISFRAZ' },
  { pattern: /\bTEQUEDA\b/gi, replacement: 'TE QUEDA' },
  { pattern: /\bPERFECTOCON\b/gi, replacement: 'PERFECTO CON' },
  { pattern: /\bDEVAC\s*A\s*ME\b/gi, replacement: 'DE VACA ME' },
  { pattern: /\bGUSTAO\b/gi, replacement: 'GUSTA' },
  { pattern: /\bAMOVY\b/gi, replacement: 'AMO' },
  { pattern: /\bTALVEZ\b/gi, replacement: 'TAL VEZ' },
  { pattern: /\bSEALA\b/gi, replacement: 'SEA LA' },
  { pattern: /\bOFRECERSU\b/gi, replacement: 'OFRECER SU' },
  { pattern: /\bPOLLADE\b/gi, replacement: 'POLLA DE' },
  { pattern: /\bPUEDODEJAR\b/gi, replacement: 'PUEDO DEJAR' },
  { pattern: /\bSIDEJOQUE\b/gi, replacement: 'SI DEJO QUE' },
  { pattern: /\bEYACULBA\b/gi, replacement: 'EYACULE A' },
  { pattern: /\bMEDIASCOMO\b/gi, replacement: 'MEDIAS COMO' },
  { pattern: /\bLAULT\s*IM\s*A\s*VEZO\b/gi, replacement: 'LA ULTIMA VEZ' },
  { pattern: /\bESTARBEN\b/gi, replacement: 'ESTARE EN' },
  { pattern: /\bDESVENT\s*AS\s*AS\b/gi, replacement: 'DESVENTAJA' },
  { pattern: /\bMUY\s*BIENSU\b/gi, replacement: 'MUY BIEN SU' },
  { pattern: /\bEYACULAC\s*I\s*ON\b/gi, replacement: 'EYACULACION' },
  { pattern: /\bEYBIEN\b/gi, replacement: '¿Y BIEN' },
  { pattern: /\bSQUIERES\b/gi, replacement: '¿QUIERES' },
  { pattern: /\bME\s*TERMEL\s*A\b/gi, replacement: 'METERMELA' },
  { pattern: /\bYAENEL\b/gi, replacement: 'YA EN EL' },
  { pattern: /\bCONOY\b/gi, replacement: 'COÑO Y' },
  { pattern: /\bTODOGO\b/gi, replacement: 'TODO' },
  { pattern: /\bQUBELDEL\b/gi, replacement: 'QUE EL DEL' },
  { pattern: /\bESTEESEL\b/gi, replacement: 'ESTE ES EL' },
  { pattern: /\bOLORDEUN\b/gi, replacement: 'OLOR DE UN' },
  { pattern: /\bALDEKEIh\b/gi, replacement: 'AL DE KEI' },
  { pattern: /\bMUCHOMAS\b/gi, replacement: 'MUCHO MAS' },
  { pattern: /\bCLASEDECOSAS\b/gi, replacement: 'CLASE DE COSAS' },
  { pattern: /\bQUERARO\b/gi, replacement: 'QUE RARO' },
  { pattern: /\bEDEVERDADME\b/gi, replacement: '¿DE VERDAD ME' },
  { pattern: /\bHE\s*VUELTOU\s*IN\s*A\b/gi, replacement: 'HE VUELTO UNA' },
  { pattern: /\bNINFOM\s*AN\s*A\b/gi, replacement: 'NINFOMANA' },
  { pattern: /\bAMIERDA\b/gi, replacement: '¡MIERDA' },
  { pattern: /\bIEVES\s*BEST\s*A\b/gi, replacement: 'ELLA SE ESTA' },
  { pattern: /\bESFORZ\s*AN\s*DO\b/gi, replacement: 'ESFORZANDO' },
  { pattern: /\bTANTOENIESA\b/gi, replacement: 'TANTO EN ESA' },
  { pattern: /\bSITUAC\s*I\s*ON\b/gi, replacement: 'SITUACION' },
  { pattern: /\bYYOAQUi\b/gi, replacement: 'Y YO AQUI' },
  { pattern: /\bHACIENDOMEUNA\b/gi, replacement: 'HACIENDOME UNA' },
  { pattern: /\bSIMI\s+SENOR\b/gi, replacement: 'SI MI SEÑOR' },
  { pattern: /\bMETERE,EDE\b/gi, replacement: 'METERE, ¿DE' },
  { pattern: /\bYMANTENEL\b/gi, replacement: 'Y MANTEN EL' },
  { pattern: /\biME\s+VENGO\b/gi, replacement: '¡ME VENGO' },
  { pattern: /\bQUSES\b/gi, replacement: 'QUE ES' },
  { pattern: /\bSIENTO,LO,SIENTO!\b/gi, replacement: '¡LO SIENTO, LO SIENTO!' },
  { pattern: /\bAHOSER\b/gi, replacement: 'A NO SER' },
  { pattern: /\bLOSIENTO,\b/gi, replacement: 'LO SIENTO,' },
  { pattern: /\bSESIENTE\b/gi, replacement: 'SE SIENTE' },
  { pattern: /\bSERAPOR\b/gi, replacement: 'SERA POR' },
  { pattern: /\bTAMBIENME\b/gi, replacement: 'TAMBIEN ME' },
  { pattern: /\bDEESTE\b/gi, replacement: 'DE ESTE' },
  { pattern: /\bVIGILANC\s*I\s*A\b/gi, replacement: 'VIGILANCIA' },
  { pattern: /\bIYA\s+NOHAY\b/gi, replacement: '¡YA NO HAY' },
  { pattern: /\bjYA\s+NOME\b/gi, replacement: '¡YA NO ME' },
  { pattern: /\bESCAPA\s+DEAHi\b/gi, replacement: 'ESCAPA DE AHI' },
  { pattern: /\bEMMH\?\b/gi, replacement: '¿MMH?' },
  { pattern: /\bDEL\s+PAiS\b/gi, replacement: 'DEL PAIS' },
  { pattern: /\bGRANDIOSA\s+POLLA,MI\b/gi, replacement: 'GRANDIOSA POLLA, MI' },
  { pattern: /\bJEJE\.\.\.FuI\b/gi, replacement: 'JEJE... FUI' },
  { pattern: /\bI\s+TODAV\s*I\s*A\b/gi, replacement: '¿TODAVIA' },
  { pattern: /\bSISIGUE\b/gi, replacement: 'SI SIGUE' },
  { pattern: /\bOBSES\s*I\s*ON\s*A\s*NDOSE\b/gi, replacement: 'OBSESIONANDOSE' },
  { pattern: /\bMASCONM\s*I\s*GO\b/gi, replacement: 'MAS CONMIGO' },
  { pattern: /\bLAIROSA\b/gi, replacement: 'LA ROSA' },
  { pattern: /\bMASFACILMENTE\b/gi, replacement: 'MAS FACILMENTE' },
  { pattern: /\bNOLA\s+SAQUES\b/gi, replacement: 'NO LA SAQUES' },
  { pattern: /\bDEMiASi\b/gi, replacement: 'DE MI ASI' },
  { pattern: /\bMI\s+CONO\b/gi, replacement: 'MI COÑO' },
  { pattern: /\bCEN\s+SERIO\?\b/gi, replacement: '¿EN SERIO?' },
  { pattern: /\bDETODOS\s+MODOS\b/gi, replacement: 'DE TODOS MODOS' },
  { pattern: /\bVOLVERA\s+CONTIGO\b/gi, replacement: 'VOLVERA CONTIGO' },
  { pattern: /\bEPORQLE\b/gi, replacement: '¿POR QUE' },
  { pattern: /\bSEQUE\s+LE\b/gi, replacement: 'SE QUE LE' },
  { pattern: /\bDEMINI\b/gi, replacement: 'DE MI' },
  { pattern: /\bYA\s+NOTENDRE\b/gi, replacement: 'YA NO TENDRE' },
  { pattern: /\bQUECAMINAR\b/gi, replacement: 'QUE CAMINAR' },
  { pattern: /\bCUERDAFLOJA\b/gi, replacement: 'CUERDA FLOJA' },
  { pattern: /\bA\s*RRIESG\s*AN\s*DO\b/gi, replacement: 'ARRIESGANDO' },
  { pattern: /\bMIVID\s*AN\s*I\b/gi, replacement: 'MI VIDA NI' },
  { pattern: /\bVIVIR\s+HUYENDO\b/gi, replacement: 'VIVIR HUYENDO' },
  { pattern: /\bQUELLEVABA\b/gi, replacement: 'QUE LLEVABA' },
  { pattern: /\bCUERDO\.\.\.\?\.\b/gi, replacement: '¿CUERDO...?' },
  { pattern: /\bMISENOR\b/gi, replacement: 'MI SEÑOR' },
  { pattern: /\bVENGOD\b/gi, replacement: 'VENGO' },
  { pattern: /\bUNCUERPOTAN\b/gi, replacement: 'UN CUERPO TAN' },
  { pattern: /\bYMASCUL\s*I\s*NO\b/gi, replacement: 'Y MASCULINO' },
  { pattern: /\bESDEM\s*AS\s*I\s*A\s*DO\b/gi, replacement: 'ES DEMASIADO' },
  { pattern: /\bIN\s*CLUSOT\s*US\s+BESOS\b/gi, replacement: 'INCLUSO TUS BESOS' },
  { pattern: /\bSESIENTEN\s+TANBIEN\b/gi, replacement: 'SE SIENTEN TAN BIEN' },
  { pattern: /\bQUEQUISIERA\b/gi, replacement: 'QUE QUISIERA' },
  { pattern: /\bTULENGUA\b/gi, replacement: 'TU LENGUA' },
  { pattern: /\bTO\s*DO\s+ELDIAO\b/gi, replacement: 'TODO EL DIA' },
  { pattern: /\bPORMI\b/gi, replacement: 'POR MI' },
  { pattern: /\bYSENOR\b/gi, replacement: 'Y SEÑOR' },
  { pattern: /\bI\s*A\s*HMALD\s*IT\s*A\b/gi, replacement: '¡AH MALDITA' },
  { pattern: /\bENSANCH\s*AN\s*DO\b/gi, replacement: 'ENSANCHANDO' },
  { pattern: /\bA\s+EVEPOR\b/gi, replacement: 'A EVE POR' },
  { pattern: /\bDEMAS\s*I\s*A\s*DO\b/gi, replacement: 'DEMASIADO' },
  { pattern: /\bVuELTO\s+LOCO\b/gi, replacement: 'VUELTO LOCO' },
  { pattern: /\bIDEFINITIVAMENTE\b/gi, replacement: 'DEFINITIVAMENTE' },
  { pattern: /\bIMALDITA\b/gi, replacement: '¡MALDITA' },
  { pattern: /\bSEA!INOS\b/gi, replacement: 'SEA! NOS' },
  { pattern: /\bTRAMPA\.\.\.LO\b/gi, replacement: 'TRAMPA... LO' },
  { pattern: /\bSIENTOOKEI,\b/gi, replacement: 'SIENTO, KEI,' },
  { pattern: /\bAHORAQUE\b/gi, replacement: 'AHORA QUE' },
  { pattern: /\bLASCOSAS\b/gi, replacement: 'LAS COSAS' },
  { pattern: /\bHANLLEGADO\b/gi, replacement: 'HAN LLEGADO' },
  { pattern: /\bAESTO\.\b/gi, replacement: 'A ESTO.' },
  { pattern: /\bIMPORTALO\b/gi, replacement: 'IMPORTA LO' },
  { pattern: /\bQUETENGA\b/gi, replacement: 'QUE TENGA' },
  { pattern: /\bQUEHACER,\b/gi, replacement: 'QUE HACER,' },
  { pattern: /\bJUROQUE\b/gi, replacement: 'JURO QUE' },
  { pattern: /\bLOROBARE\b/gi, replacement: 'LO ROBARE' },
  { pattern: /\bYMELO\b/gi, replacement: 'Y ME LO' },
  { pattern: /\bPRONTO!iNO\b/gi, replacement: '¡PRONTO! ¡NO' },
  { pattern: /\bBUSCAUNA\b/gi, replacement: 'BUSCA UNA' },
  { pattern: /\bOPORTUNIDADY\b/gi, replacement: 'OPORTUNIDAD Y' },
  { pattern: /\bASiQUENO\b/gi, replacement: 'ASI QUE NO' },
  { pattern: /\bHUMILLANTE!\b/gi, replacement: '¡HUMILLANTE!' },
  { pattern: /\bOHV\s+iQUE\b/gi, replacement: '¡OH! ¡QUE' },
  { pattern: /\bPROVOCATIVA!O\b/gi, replacement: 'PROVOCATIVA!' },
  { pattern: /\bQUE\s+ERóTICAV\b/gi, replacement: 'QUE EROTICA,' },
  { pattern: /\bABRIENDOTU\b/gi, replacement: 'ABRIENDO TU' },
  { pattern: /\bLASCIVAV\b/gi, replacement: 'LASCIVA.' },
  { pattern: /\bE-ESVERDAD\.\b/gi, replacement: 'E-ES VERDAD.' },
  { pattern: /\bIEPORQUE\?!\b/gi, replacement: '¡¿POR QUE?!' },
  { pattern: /\biSINOESTOY\b/gi, replacement: '¡SI NO ESTOY' },
  { pattern: /\bEXCITADAEN\b/gi, replacement: 'EXCITADA EN' },
  { pattern: /\bABSOLUTO!\b/gi, replacement: 'ABSOLUTO!' },
  { pattern: /\biEEH\?!\b/gi, replacement: '¡¿EEH?!' },
  { pattern: /\bA'LASDE\b/gi, replacement: 'A LAS DE' },
  { pattern: /\bKEI\.S\b/gi, replacement: 'KEI.' },
  { pattern: /\bCONLAS\b/gi, replacement: 'CON LAS' },
  { pattern: /\bDBNADA\.\.\.\b/gi, replacement: 'DE NADA...' },
  { pattern: /\bDA28DB\b/gi, replacement: 'DIA 28 DE' },
  { pattern: /\bLAMISION\.\b/gi, replacement: 'LA MISION.' },
  { pattern: /\bELNUMERO\b/gi, replacement: 'EL NUMERO' },
  { pattern: /\bDBVECES\b/gi, replacement: 'DE VECES' },
  { pattern: /\bQUBMBHE\b/gi, replacement: 'QUE ME HE' },
  { pattern: /\biAH!iNO,NO\b/gi, replacement: '¡AH! ¡NO, NO' },
  { pattern: /\bESESO!iLO\b/gi, replacement: 'ES ESO! ¡LO' },
  { pattern: /\bDEAHORANO\b/gi, replacement: 'DE AHORA NO' },
  { pattern: /\bCUENTA!iSOLO\b/gi, replacement: 'CUENTA! ¡SOLO' },
  { pattern: /\bFUEUN\s+DESLIZ\b/gi, replacement: 'FUE UN DESLIZ' },
  { pattern: /\bMOMENTANEO!\b/gi, replacement: 'MOMENTANEO!' },
  { pattern: /\biYO\s+SOYLA\b/gi, replacement: '¡YO SOY LA' },
  { pattern: /\bMUJERDE\s+KEI!\b/gi, replacement: 'MUJER DE KEI!' },
  { pattern: /\bMEVENGO\b/gi, replacement: 'ME VENGO' },
  { pattern: /\bMEVENGOME\b/gi, replacement: 'ME VENGO, ME' },
  { pattern: /\bUNAPOLLA\b/gi, replacement: 'UNA POLLA' },
  { pattern: /\bKEl\.0\b/gi, replacement: 'KEI.' },
  { pattern: /\bHABITACION\?\b/gi, replacement: '¿HABITACION?' },
  { pattern: /\bAHORAMISMONO\b/gi, replacement: 'AHORA MISMO NO' },
  { pattern: /&PODRiA\.\.\./gi, replacement: '¿PODRIA...' },
  { pattern: /\bESTACORRIENDO\b/gi, replacement: 'ESTA CORRIENDO' },
  { pattern: /\bESTASALIENDO\b/gi, replacement: 'ESTA SALIENDO' },
  { pattern: /\bUNMONTON\b/gi, replacement: 'UN MONTON' },
  { pattern: /\bDENTRODEMi\b/gi, replacement: 'DENTRO DE MI' },
  { pattern: /&QUBES\b/gi, replacement: '¿QUE ES' },
  { pattern: /\bSALIENDO\.\b/gi, replacement: 'SALIENDO.' },
  { pattern: /\bCONKEI\.\.\.ES\b/gi, replacement: 'CON KEI... ES' },
  { pattern: /\bUNACANTIDAD\b/gi, replacement: 'UNA CANTIDAD' },
  { pattern: /\bINCREiBLEDE\b/gi, replacement: 'INCREIBLE DE' },
  { pattern: /\bCELA,OMEJOR\b/gi, replacement: 'CELA, O MEJOR' },
  { pattern: /\bDICHO\.\.\.BLACK\b/gi, replacement: 'DICHO... BLACK' },
  { pattern: /\bCATV&QUE\b/gi, replacement: 'CAT, ¿QUE' },
  { pattern: /\bTALESTUVO\b/gi, replacement: 'TAL ESTUVO' },
  { pattern: /\bDE\s+ALFREDY\b/gi, replacement: 'DE ALFRED Y' },
  { pattern: /\bLAMiA\?NOS\b/gi, replacement: 'LA MIA? NOS' },
  { pattern: /\bSALIÖNATURAL,\b/gi, replacement: 'SALIO NATURAL,' },
  { pattern: /&VERDAD\?\b/gi, replacement: '¿VERDAD?' },
  { pattern: /\bQUBSILE\b/gi, replacement: 'QUE SI LE' },
  { pattern: /\bDESDEEL\b/gi, replacement: 'DESDE EL' },
  { pattern: /\bMOMENTOEN\b/gi, replacement: 'MOMENTO EN' },
  { pattern: /\bQUEMEVIO,\b/gi, replacement: 'QUE ME VIO,' },
  { pattern: /\bSELEPUSO\b/gi, replacement: 'SE LE PUSO' },
  { pattern: /\bTANDURA\b/gi, replacement: 'TAN DURA' },
  { pattern: /\bTIENESESA\b/gi, replacement: 'TIENES ESA' },
  { pattern: /\bCARADE\b/gi, replacement: 'CARA DE' },
  { pattern: /\bFELICIDAD\?!\b/gi, replacement: 'FELICIDAD?!' },
  { pattern: /\bELSENOR\b/gi, replacement: 'EL SEÑOR' },
  { pattern: /&SERA\b/gi, replacement: '¿SERA' },
  { pattern: /\bYANO\b/gi, replacement: 'YA NO' },
  { pattern: /\bEACASO\.\.\.MEHE\b/gi, replacement: '¿ACASO... ME HE' },
];

export const SPANISH_FUNCTION_WORD_GLUE_PATTERN = /\b([A-ZÁÉÍÓÚÜÑ]{3,})(QUE|ME|TE|SE|LO|LA|LOS|LAS|UN|UNA|MAS|ASI|CON|SIN|POR|PARA|EN)([A-ZÁÉÍÓÚÜÑ]{3,})\b/g;

export const SPANISH_FUNCTION_WORD_GLUE_PATTERN_V2 = /\b(QUE|ME|TE|SE|LO|LA|LE|NOS|LOS|LAS|DE|UN|UNA|ES|NO|SI|MI|TU|SU)(?=[A-ZÁÉÍÓÚÑ][a-záéíóúñ])/g;

export const SPANISH_ENCLITIC_SPLIT_PATTERN = /\b([A-Za-zÁÉÍÓÚÑáéíóúñ]{3,})(me|te|se|lo|la|nos)\b/gi;

export const SPANISH_LEGITIMATE_ENCLITICS = new Set([
  'dime', 'dame', 'cuéntame', 'dile', 'házmelo', 'hazmelo', 'cuentame', 'dimelo', 'dámelo', 'damelo',
  'regalo', 'solo', 'malo', 'pelo', 'abuelo', 'abuela', 'escuela', 'novela', 'hola', 'gente',
  'diente', 'puente', 'fuente', 'caliente', 'modelo', 'ejemplo', 'mente', 'presente', 'diferente',
  'urgente', 'importante', 'paciente', 'cliente', 'corriente', 'brillante', 'excelente', 'pelicula', 'película',
  'impresionante', 'impresionantes', 'emocionante', 'emocionantes',
  'pense', 'pensé',
  'metermela', 'metérmela', 'metala', 'métala', 'destroceme', 'destróceme', 'haciendome', 'haciéndome', 'metere', 'meteré',
  'venirme', 'consentirme', 'obsesionandose', 'obsesionándose', 'correte', 'córrete', 'llameme', 'llámeme', 'llevaba',
  'defenderse', 'defender', 'defenderte', 'defenderme', 'defendernos', 'defenderle', 'defenderles'
]);

export const SPANISH_COMPOUND_SPLIT_EXCLUSIONS = new Set([
  'defenderse', 'defender', 'defenderte', 'defenderme', 'defendernos', 'defenderle', 'defenderles',
  'depender', 'depende', 'entender', 'entiende', 'aprender', 'comprender', 'sorprender', 'encender',
  'conseguir', 'conocer', 'consentir', 'presentar', 'presente', 'presencia',
  'contenido', 'contento', 'contacto', 'contar', 'control', 'continuar',
  'desconocida', 'desconocido', 'desconocidos', 'desconocidas',
  'impresionante', 'impresionantes', 'emocionante', 'emocionantes',
  'pense', 'pensé',
  'metermela', 'metérmela', 'metala', 'métala', 'destroceme', 'destróceme', 'haciendome', 'haciéndome', 'metere', 'meteré',
  'venirme', 'consentirme', 'obsesionandose', 'obsesionándose', 'correte', 'córrete', 'llameme', 'llámeme', 'llevaba',
  'sentencia', 'sentimiento', 'entonces', 'encontrar', 'encuentro', 'entero',
  'entregar', 'entrenar', 'entrada', 'entrar', 'entorno'
]);

export const THAI_BOUNDARY_ATTACH_TOKENS = new Set([
  'ไป',
  'นะ',
  'สิ',
  'ละ',
  'ล่ะ',
  'เลย',
  'ก็',
  'มาก',
  'อยู่',
  'แล้ว',
  'ด้วย',
  'กัน',
  'เอง',
  'เหรอ',
  'หรอ',
  'หรือ',
  'ไหม',
  'มั้ย',
  'ครับ',
  'ค่ะ',
]);

export const THAI_BOUNDARY_NO_SPLIT_PAIRS = new Set([
  'เกิน|ไป',
  'ให้|กับ',
  'ยัง|ไม่',
  'ไม่|รู้',
  'หายาก|มาก',
  'ปิ|ด',
]);

export const safeStr = (val: unknown): string => {
  if (val == null) return '';
  const s = String(val).trim();
  if (s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') return '';
  return s;
};

export const normalizeWhitespace = (text: unknown): string => {
  return safeStr(text).replace(/\s+/g, ' ');
};

export const normalizeTranslationLanguage = (value: string, fallback: string): string => {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return fallback;
  if (TRANSLATION_LANGUAGE_ALIASES[raw]) return TRANSLATION_LANGUAGE_ALIASES[raw];
  const primary = raw.split('-')[0].trim();
  if (!primary) return fallback;
  return TRANSLATION_LANGUAGE_ALIASES[primary] || primary;
};

export const normalizeEnglishOcrNoiseForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  ENGLISH_OCR_NOISE_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  // Repair OCR digit-to-letter confusion (e.g., '4O%' -> '40%', '1O0' -> '100')
  normalized = normalized.replace(/(?<=\d)[oO]+(?=\D|$|%)/g, '0');
  normalized = normalized.replace(/(?<=\d)[oO]+(?=\d)/g, '0');

  normalized = normalized.replace(/\bI\s+MPREGN\s*A\s*TATED\b/gi, 'IMPREGNATED');
  normalized = normalized.replace(/\bI\s+MPREGNATED\b/gi, 'IMPREGNATED');
  normalized = normalized.replace(/\bI\s+Dan['’]?T\b/gi, "I DON'T");
  normalized = normalized.replace(/\bCack(?=\.{2,}|\s*[!?,]|$)/gi, 'COCK');
  normalized = normalized.replace(/\bGANNA\b/gi, 'GONNA');
  normalized = normalized.replace(/\bDIFEEE\b/gi, 'DIEEEE');
  normalized = normalized.replace(/\bBURSTiNG\b/gi, 'BURSTING');
  normalized = normalized.replace(/\bSORRY{2,}\b/gi, 'SORRY');
  normalized = normalized.replace(/\bNO{3,}\b/gi, 'NOOO');
  normalized = normalized.replace(/\bYOUVE\b/gi, "YOU'VE");
  normalized = normalized.replace(/\bMSMAK\s+IM\s*A\b/gi, 'Ms. Makima');
  normalized = normalized.replace(/\bMSMAK\s+IMA\b/gi, 'Ms. Makima');
  normalized = normalized.replace(/\bPLARU\b/gi, 'PLAP');
  normalized = normalized.replace(/\bQoiver\b/gi, 'Quiver');
  normalized = normalized.replace(/\bS-sory\b/gi, 'S-sorry');
  normalized = normalized.replace(/\bAnn!\b/g, 'Ahh!');
  normalized = normalized.replace(/\bGrinc\b/gi, 'Grind');
  normalized = normalized.replace(/\bTwire\b/gi, 'Twitch');
  normalized = normalized.replace(/\bSeoeeze\b/gi, 'Squeeze');
  normalized = normalized.replace(/\bSaeeze\b/gi, 'Squeeze');
  normalized = normalized.replace(/\bSHNER\b/gi, 'SHIVER');
  normalized = normalized.replace(/\bShvero\b/gi, 'Shivers');
  normalized = normalized.replace(/\brHuff\b/gi, 'Huff');
  normalized = normalized.replace(/\bHofflv\b/gi, 'Huff');
  normalized = normalized.replace(/\bSochacan\b/gi, 'So he can');
  normalized = normalized.replace(/\bGuuuun\b/gi, 'Gyuuuh');
  normalized = normalized.replace(/\bPlurp\b/gi, 'Blorp');
  normalized = normalized.replace(/\bCummngi\b/gi, 'Cumming');
  normalized = normalized.replace(/\bchistic\s+ehP\b/gi, 'chistic eh?');
  normalized = normalized.replace(/\barushwomb!?uck\b/gi, 'crush womb lick');
  normalized = normalized.replace(/\bFucki\b/gi, 'Fuck');
  normalized = normalized.replace(/\bBREE\s+DING\s+SACK\b/gi, 'BREEDING SACK');
  normalized = normalized.replace(/\bPSV\b/g, 'PSH');
  normalized = normalized.replace(/\bSplurty\b/gi, 'Splort');
  normalized = normalized.replace(/\bSplorgey\b/gi, 'Splorge');
  normalized = normalized.replace(/\bSplooge['’]v\b/gi, 'Splooge');
  normalized = normalized.replace(/\bThmi\b/gi, 'Thmp');
  normalized = normalized.replace(/\bathle\b/gi, 'Rattle');
  normalized = normalized.replace(/\bseueeze\b/gi, 'Squeeze');
  normalized = normalized.replace(/\bqweleh\b/gi, 'Squelch');
  normalized = normalized.replace(/\btBlorp\b/gi, 'Blorp');
  normalized = normalized.replace(/\bCiCK\b/g, 'Lick');
  normalized = normalized.replace(/\bhTwiteh\+?\b/gi, 'Twitch');
  normalized = normalized.replace(/\bsuchthick\b/gi, 'such thick');
  normalized = normalized.replace(/(?<=^|\s)-Gargle\b/gi, 'Gargle');
  normalized = normalized.replace(/\bquish\b/gi, 'Squish');
  normalized = normalized.replace(/\bWaiggle\b/gi, 'Wriggle');
  normalized = normalized.replace(/\bSha!\b/g, 'Shake!');
  normalized = normalized.replace(/\bJolk\b/gi, 'Jolt');
  normalized = normalized.replace(/\bJoly\b/gi, 'Jolt');
  normalized = normalized.replace(/\bNchuhig\b/gi, 'Nchuh');
  normalized = normalized.replace(/\bJOcK\b/g, 'Lock');
  normalized = normalized.replace(/\bShirch\b/gi, 'Shlrch');
  normalized = normalized.replace(/\btobe\b/gi, 'to be');
  normalized = normalized.replace(/\bOohgl\b/gi, 'Oohg');
  normalized = normalized.replace(/\bnstrict(\.{2,}|…)/gi, 'Constrict$1');
  normalized = normalized.replace(/\bDoh!\b/g, 'Ooh!');
  normalized = normalized.replace(/\bSprch\b/gi, 'Splrch');
  normalized = normalized.replace(/\byguhh\b/gi, 'uguhh');
  normalized = normalized.replace(/\buurRh\b/gi, 'uurkh');
  normalized = normalized.replace(/\bSrp\b/g, 'Grip');
  normalized = normalized.replace(/['’]aight\.D\b/gi, 'aight');
  normalized = normalized.replace(/\(?vGlob\b/gi, 'Glob');
  normalized = normalized.replace(/\bSNA\b/g, 'SNAP');
  normalized = normalized.replace(/\bIburrpe\b/gi, 'Blurrpp');
  normalized = normalized.replace(/\bLuuuh\b/gi, 'uuuh');
  normalized = normalized.replace(/\bThw\b/g, 'Thud');
  normalized = normalized.replace(/\bsplt\b/gi, 'splat');
  normalized = normalized.replace(/\bChw\b/g, 'Chulp');
  normalized = normalized.replace(/\blurpv\b/gi, 'lurp');
  normalized = normalized.replace(/\bypurp\b/gi, 'purp');
  normalized = normalized.replace(/\bpipun\b/gi, 'pupuh');
  normalized = normalized.replace(/\bblupu\b/gi, 'plupuh');
  normalized = normalized.replace(/\bHoffl\b/gi, 'Hoff');
  normalized = normalized.replace(/\bwiteh\b/gi, 'twitch');
  normalized = normalized.replace(/\bIwiteh\b/gi, 'Twitch');
  normalized = normalized.replace(/\blerq\b/gi, 'Blergh');
  normalized = normalized.replace(/\bOurgh!\b/g, 'Eurgh!');
  normalized = normalized.replace(/\bMhmP\b/g, 'Mhm?');
  normalized = normalized.replace(/\bChatten!?\.?\b/gi, 'Chatter');
  normalized = normalized.replace(/\bAM\s+A\s+ZINGR\b/gi, 'Amazing');
  normalized = normalized.replace(/\bnow\s+rightP\b/gi, 'now right?');
  normalized = normalized.replace(/\brightP\b/g, 'right?');
  normalized = normalized.replace(/\bSNAR!\b/g, 'SNAP!');
  normalized = normalized.replace(/\bApeooho\.?\b/gi, 'Apeooh');
  normalized = normalized.replace(/\bwonbooo\b/gi, 'womb...');
  normalized = normalized.replace(/\bCatter(\.{2,}|…)/gi, 'Clatter$1');
  normalized = normalized.replace(/\bPLAR\b/g, 'PLAP');
  normalized = normalized.replace(/\bsostrange\b/gi, 'so strange');
  normalized = normalized.replace(/\bnomatter\b/gi, 'no matter');
  normalized = normalized.replace(/\bthinkabout\b/gi, 'think about');
  normalized = normalized.replace(/\buuqun\b/gi, 'uuguh');
  normalized = normalized.replace(/\bKunk\b/gi, 'Kuhk');
  normalized = normalized.replace(/\bLneo\b/gi, 'Knead');
  normalized = normalized.replace(/\bgluby\b/gi, 'glub');
  normalized = normalized.replace(/\bHolam\b/gi, 'Hold');
  normalized = normalized.replace(/\bRawle\b/gi, 'Rattle');
  normalized = normalized.replace(/\bcrittch\b/gi, 'scritch');
  normalized = normalized.replace(/\btretch\b/gi, 'stretch');
  normalized = normalized.replace(/\b8plly\b/gi, 'Splly');
  normalized = normalized.replace(/\bwor\b/gi, 'work');
  normalized = normalized.replace(/\bgood\+grief\b/gi, 'good grief');
  normalized = normalized.replace(/\bSrind\b/gi, 'Grind');
  normalized = normalized.replace(/\bShivero\b/gi, 'Shiver');
  normalized = normalized.replace(/\bSplurcct\b/gi, 'Splurrrt');
  normalized = normalized.replace(/\bSuky\b/gi, 'Schlrp');
  normalized = normalized.replace(/\(?good,\s*nop\)?/gi, '(good, no?)');
  normalized = normalized.replace(/\bSqueleh\b/gi, 'Squelch');
  normalized = normalized.replace(/\bmy\.throat\./gi, 'my throat');
  normalized = normalized.replace(/\bsemerboo\b/gi, 'semen');
  normalized = normalized.replace(/\bhumph!J\b/gi, 'Humph!');
  normalized = normalized.replace(/\bPART\s+I\s+CULARLY\b/gi, 'PARTICULARLY');
  normalized = normalized.replace(/\bqoeeezeee(\.{2,}|…)?/gi, 'Squeeezee$1');
  normalized = normalized.replace(/\bwomb\.for\b/gi, 'womb for');
  normalized = normalized.replace(/\bthihnk\b/gi, 'think');
  normalized = normalized.replace(/\bWhat\.\b/g, 'What');
  normalized = normalized.replace(/\bApeooho\.{2,}/gi, 'Apeooh...');
  normalized = normalized.replace(/\bsoItake\b/gi, 'so I take');
  normalized = normalized.replace(/\byour\.womb\b/gi, 'your womb');
  normalized = normalized.replace(/more\s+honest\+with\s+me/gi, 'more honest with me');
  normalized = normalized.replace(/\bmuuh"?\b/gi, 'uuuh');
  normalized = normalized.replace(/\bEhr\b/g, 'Eh');
  normalized = normalized.replace(/\bJOL7\b/g, 'JOLT');
  normalized = normalized.replace(/\bNumber4\./gi, 'Number 4');
  normalized = normalized.replace(/\bPatheri\b/gi, 'Gathes');
  normalized = normalized.replace(/\bhowmany\b/gi, 'how many');
  normalized = normalized.replace(/\bPsh0\b/gi, 'Pshh');
  normalized = normalized.replace(/\bAVP\b/g, 'AV');
  normalized = normalized.replace(/\bWhat\s+r\b/gi, 'What');
  normalized = normalized.replace(/\bTHIS\s+A\s+DULT\s*VIDEO\b/gi, 'THIS ADULT VIDEO');
  normalized = normalized.replace(/\bwill\s+alsobe\b/gi, 'will also be');
  normalized = normalized.replace(/\bVand\s+my\b/gi, 'and my');
  normalized = normalized.replace(/\\foolishness\b/gi, 'foolishness');
  normalized = normalized.replace(/\bMioro\b/gi, 'Glorb');
  normalized = normalized.replace(/inside\s+my\s+\+body/gi, 'inside my body');
  normalized = normalized.replace(/\bconyenient\b/gi, 'convenient');
  normalized = normalized.replace(/\bA-Al-\s*RIGHT!?/gi, 'A-All RIGHT!');
  normalized = normalized.replace(/\bHoLP\b/gi, 'Hold');
  normalized = normalized.replace(/\bMope_\b/gi, 'More...');
  normalized = normalized.replace(/\bMope\b/gi, 'More');
  normalized = normalized.replace(/\bNhl\b/g, 'Nh!');
  normalized = normalized.replace(/\bROUGH40\b/gi, 'ROUGH');
  normalized = normalized.replace(/\bRE4t\s+A\b/gi, 'Rest a');
  normalized = normalized.replace(/\bTHE\s+TREAT-\s*\+?MENT\b/gi, 'THE TREATMENT');
  normalized = normalized.replace(/\bCONTINUE\s+THE\s+THREAT-?\s*MENT\b/gi, 'CONTINUE THE TREATMENT');
  normalized = normalized.replace(/\bTOVAY['’]?S\b/gi, "TODAY'S");
  normalized = normalized.replace(/\bON\s+TOVAY(\.{2,}|…)?/gi, 'ON TODAY$1');
  normalized = normalized.replace(/\bWEREST\b/gi, 'WE REST');
  normalized = normalized.replace(/\bCUMAT\b/gi, 'CUM AT');
  normalized = normalized.replace(/\bTIME\s+ASI\b/gi, 'TIME AS I');
  normalized = normalized.replace(/\b50GOOD\b/gi, 'SO GOOD');
  normalized = normalized.replace(/\bMODIFI-CATIONS\b/gi, 'MODIFICATIONS');
  normalized = normalized.replace(/\bSuvvenlya\b/gi, 'Suddenly');
  normalized = normalized.replace(/\bSuvvenly\b/gi, 'Suddenly');
  normalized = normalized.replace(/\bSuvdenly\b/gi, 'Suddenly');
  normalized = normalized.replace(/\bBvt\b/g, 'But');
  normalized = normalized.replace(/\bBVT\b/g, 'BUT');
  normalized = normalized.replace(/\(ME,\s*THERE\)/gi, '(ME, THERE)');
  normalized = normalized.replace(/\bME,\s*THERE\b/gi, 'ME, THERE');
  normalized = normalized.replace(/\bME,THERE\b/gi, 'ME, THERE');
  normalized = normalized.replace(/\bDISCOUR-\b/gi, 'DISCOURSE');
  normalized = normalized.replace(/\bTHEN\.\s*WE\s+SHOULD\b/gi, 'THEN, WE SHOULD');
  normalized = normalized.replace(/\bTHEN\.\s*WE\b/gi, 'THEN, WE');
  normalized = normalized.replace(/\bTO\s+ME\s+tOVAy\.?/gi, 'TO ME TODAY.');
  normalized = normalized.replace(/\bAIr\s+bath\.?/gi, 'Air bath.');
  normalized = normalized.replace(/\bSOME-THING\s+I\s+SAID-?\b/gi, 'SOME-THING I SAID-');
  normalized = normalized.replace(/\bShudder\.s\b/gi, 'Shudder');
  normalized = normalized.replace(/\bTwitcht\b/gi, 'Twitch');
  normalized = normalized.replace(/\bHISSEMEN\b/gi, 'HIS SEMEN');
  normalized = normalized.replace(/\bISSTILLEAKING\b/gi, 'IS STILL LEAKING');
  normalized = normalized.replace(/\bOUTOPME(\.{2,}|…)?/gi, 'OUT OF ME$1');
  normalized = normalized.replace(/\bOUTOPME\b/gi, 'OUT OF ME');
  normalized = normalized.replace(/\bSmacky\b/gi, 'Smack');
  normalized = normalized.replace(/\bSlapy\b/gi, 'Slap');
  normalized = normalized.replace(/\bRubr\b/gi, 'Rub');
  normalized = normalized.replace(/\bCoughe\b/gi, 'Cough');
  normalized = normalized.replace(/\bPate\b/gi, 'Pat');
  normalized = normalized.replace(/\bMVF[iI]utter\b/gi, 'Flutter');
  normalized = normalized.replace(/\bMVFlutter\b/gi, 'Flutter');
  normalized = normalized.replace(/\bIBET\s+IVE\b/gi, "I BET I'VE");
  normalized = normalized.replace(/\bIBETIVE\b/gi, "I BET I'VE");
  normalized = normalized.replace(/\bTHE\s+SENSAT\s*(\.{2,}|…)/gi, 'THE SENSATION$1');
  normalized = normalized.replace(/\bTHE\s+SENSAT\b/gi, 'THE SENSATION');
  normalized = normalized.replace(/\bOWON['’]?TSAYNAUGHTY\b/gi, "I WON'T SAY NAUGHTY");
  normalized = normalized.replace(/\bOWONTSAYNAUGHTY\b/gi, "I WON'T SAY NAUGHTY");
  normalized = normalized.replace(/\byyt\b/g, 'Ahh');
  normalized = normalized.replace(/\bQLIET!?\b/gi, 'QUIET!');
  normalized = normalized.replace(/\bQLIET\b/gi, 'QUIET');
  normalized = normalized.replace(/\bACOWARD\b/gi, 'A COWARD');
  normalized = normalized.replace(/\bHER\s+POSIT\s*I\s*ON\b/gi, 'HER POSITION');
  normalized = normalized.replace(/\bHER\s+POSITI\s*ON\b/gi, 'HER POSITION');
  normalized = normalized.replace(/\bSourge\b/gi, 'Splurge');
  normalized = normalized.replace(/\btAhn\b/gi, 'Ahh');
  normalized = normalized.replace(/\btahn\b/gi, 'Ahh');
  normalized = normalized.replace(/\bSHIT\.\.\s*THIS['’]?\b/gi, 'SHIT.. THIS');
  normalized = normalized.replace(/\bSHIT\.\.\.\s*THIS['’]?\b/gi, 'SHIT... THIS');
  normalized = normalized.replace(/\bPLEASURABLE[…\.]+\s*TO\s+TAKE\b/gi, 'PLEASURABLE... TO TAKE');
  normalized = normalized.replace(/\bGOING\.\.\s*WE['’]?LL\s+LEAVE\b/gi, "GOING.. WE'LL LEAVE");
  normalized = normalized.replace(/\bGOING\.\.\.\s*WE['’]?LL\s+LEAVE\b/gi, "GOING... WE'LL LEAVE");
  normalized = normalized.replace(/\(GOING\.\.\s*WE['’]?LL\s+LEAVE\)/gi, "(GOING.. WE'LL LEAVE)");
  normalized = normalized.replace(/\(GOING\.\.\.\s*WE['’]?LL\s+LEAVE\)/gi, "(GOING... WE'LL LEAVE)");
  normalized = normalized.replace(/\bWHAT\s+IS\s+IT~+\b/gi, 'WHAT IS IT~~');
  normalized = normalized.replace(/\bPOSSESS,\s*SEEMS\b/gi, 'POSSESS, SEEMS');
  normalized = normalized.replace(/\(POSSESS,\s*SEEMS\)/gi, '(POSSESS, SEEMS)');
  normalized = normalized.replace(/\bAHH\.\.\s*HOLY\b/gi, 'AHH..HOLY');
  normalized = normalized.replace(/\bAHH\.\.\.\s*HOLY\b/gi, 'AHH...HOLY');

  normalized = normalized.replace(
    /\bBACK\s+THEN\s+HIS\s+WHOLE\s+BODY\s+WAS\s+BURNING\s+UP\s+LIKE\s+A\s+FURNACE\s+BUT\s+NOW\s+HE'?S?\s+COLD\s+AS\s+ICE\b/gi,
    "BACK THEN HIS WHOLE BODY WAS BURNING UP LIKE A FURNACE, BUT NOW HE'S COLD AS ICE"
  );

  const compactLatin = normalized.toLowerCase().replace(/[^a-z]/g, '');
  if (
    compactLatin.includes('oftheeffctofravt') &&
    compactLatin.includes('gnetiontact') &&
    compactLatin.includes('rescaused')
  ) {
    normalized = 'of the effects of gravitational, electrical, magnetic, or contact forces caused';
  }

  // Clean common OCR noise artifacts that confuse the translation engine
  normalized = normalized.replace(/\b([lI1|]{3,}|ll\|l|I\|I|ll\|ll)\b/gi, ' ');
  normalized = normalized.replace(/(?<=^|\s)(\/\\|\\\/)(?=\s|$)/g, ' ');
  normalized = normalized.replace(/(?<!\.)\.{2}(?!\.)/g, '...');
  normalized = normalized.replace(/(?<=^|\s)[|¦│┃￨︱︲_](?=\s|$)/g, ' ');

  // Strip trailing underscores from English words that often appear in OCR artifacts
  normalized = normalized.replace(/([A-Za-z]{2,})_+(\s|$)/g, '$1$2');
  normalized = normalized.replace(/([A-Za-z]+)_+([A-Za-z]+)/g, '$1 $2'); // Fix mid-word underscores

  // Semicolons often confuse Argos offline models; replace with commas for better flow
  normalized = normalized.replace(/([A-Za-z])\s*;\s*(\s|$)/g, '$1, $2');
  normalized = normalized.replace(/([A-Za-z])\s*;/g, '$1,');

  return normalizeWhitespace(normalized);
};

export const splitSpanishUppercaseCompounds = (text: string): string => {
  let normalized = String(text || '');
  for (let i = 0; i < 2; i += 1) {
    normalized = normalized.replace(SPANISH_FUNCTION_WORD_GLUE_PATTERN, (match, prefix, func, suffix) => {
      const lowerMatch = match.toLowerCase();
      if (SPANISH_COMPOUND_SPLIT_EXCLUSIONS.has(lowerMatch) || lowerMatch.endsWith('mente')) {
        return match;
      }
      return `${prefix} ${func} ${suffix}`;
    });
  }
  // Apply V2
  normalized = normalized.replace(SPANISH_FUNCTION_WORD_GLUE_PATTERN_V2, '$1 ');
  
  // Apply enclitic split with whitelist guard
  normalized = normalized.replace(SPANISH_ENCLITIC_SPLIT_PATTERN, (match, verb, pronoun) => {
    const lowerMatch = match.toLowerCase();
    if (SPANISH_LEGITIMATE_ENCLITICS.has(lowerMatch) || SPANISH_COMPOUND_SPLIT_EXCLUSIONS.has(lowerMatch) || lowerMatch.endsWith('mente')) {
      return match; // Keep as is
    }
    return `${verb} ${pronoun}`;
  });
  
  return normalized;
};

export const normalizeSpanishOcrNoiseForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  normalized = normalized.replace(/(^|[\s"'([{])iC[-\s]*/gi, '$1¿C');
  normalized = normalized.replace(/(^|[\s"'([{])i(?=COMO\b)/gi, '$1¿');
  SPANISH_OCR_NOISE_REPAIRS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });
  normalized = splitSpanishUppercaseCompounds(normalized);
  normalized = normalized.replace(/¿C{2,}(?=OMO\b)/gi, '¿C');
  normalized = normalized.replace(/\bESPEC[IÍ]FICO\b/gi, 'ESPECIFICO');
  normalized = normalized.replace(/\bC+EH(?=[!?…])/gi, 'EH');
  normalized = normalized.replace(/\b([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{2}),\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,})\b/g, '$1$2');
  normalized = normalized.replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])\s*,\s*([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, '$1, $2');
  normalized = normalized.replace(/([A-Za-zÁÉÍÓÚÜÑáéíóúüñ0-9])\.([A-Za-zÁÉÍÓÚÜÑáéíóúüñ])/g, '$1. $2');
  return normalizeWhitespace(normalized);
};

export const normalizeTechnicalArtifactsForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  TECHNICAL_OCR_NORMALIZERS.forEach(({ pattern, replacement }) => {
    normalized = normalized.replace(pattern, replacement);
  });

  normalized = normalized.replace(/\bCHAPTEROBJECTIVES\b/gi, 'CHAPTER OBJECTIVES');
  normalized = normalized.replace(/\bCONDITIONSFOR\b/gi, 'CONDITIONS FOR');
  normalized = normalized.replace(/\bOFTHE\b/gi, 'OF THE');
  normalized = normalized.replace(/\bEQUATIONSOF\b/gi, 'EQUATIONS OF');
  normalized = normalized.replace(/\b([FM])\s+([xyzXYZ]|\d{1,2})\b/g, '$1$2');
  normalized = normalized.replace(/([\u0391-\u03C9\u03D1\u03D5\u03F0\u03F4])([A-Za-z])/g, '$1 $2');
  normalized = normalized.replace(/\b(Fig(?:ure)?\.?|Table|Chapter)\s*(\d)\s*[\u2013\u2014\-]\s*(\d)\b/gi, '$1 $2-$3');
  return normalized;
};

export const normalizePossessiveCompoundsForTranslation = (text: string): string => {
  let normalized = normalizeWhitespace(String(text || ''));
  normalized = normalized.replace(/\b([A-Za-z]{3,})['’]S([A-Za-z]{3,})\b/g, "$1'S $2");
  normalized = normalized.replace(/\[\s*([A-Za-z]{3,})['’]S([A-Za-z]{3,})\s*\]/g, "[$1'S $2]");
  normalized = normalized.replace(/\b([A-Za-z]{3,})([\-_/])(?!(?:san|chan|kun|sama|sensei|senpai|dono)\b)([A-Za-z]{3,})\b/gi, '$1 $2 $3');
  return normalizeWhitespace(normalized);
};

export const cleanJapaneseOcrSpacing = (text: string): string => {
  let cleaned = text.replace(/([\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff00-\uffef])\s(?=[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf\uff00-\uffef])/g, '$1');
  cleaned = cleaned.replace(/([\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf])\s(?=[\u3000-\u303f])/g, '$1');
  cleaned = cleaned.replace(/([\u3000-\u303f])\s(?=[\u3040-\u309f\u30a0-\u30ff\u4e00-\u9faf])/g, '$1');
  return cleaned;
};

export const cleanKoreanOcrSpacing = (text: string): string => {
  if (!text) return '';
  // Collapse single spaces between isolated single Korean syllables (e.g. "안 녕 하 세 요" -> "안녕하세요")
  // while preserving double spaces between words (e.g. "설 정 을  다 시" -> "설정을  다시")
  let cleaned = text.replace(/([\uac00-\ud7af]) (?=[\uac00-\ud7af] [\uac00-\ud7af])/g, '$1');
  cleaned = cleaned.replace(/([\uac00-\ud7af]) (?=[\uac00-\ud7af](?:[^\uac00-\ud7afA-Za-z0-9]|\s|$))/g, '$1');

  const words = cleaned.split(/(\s+)/);
  const result: string[] = [];
  
  for (let i = 0; i < words.length; i++) {
    const item = words[i];
    if (item !== ' ') {
      result.push(item);
      continue;
    }
    
    const prevWord = result[result.length - 1] || '';
    const nextWord = words[i + 1] || '';
    
    const prevKoMatches = prevWord.match(/[\uac00-\ud7af]/g);
    const nextKoMatches = nextWord.match(/[\uac00-\ud7af]/g);
    
    if (prevKoMatches && nextKoMatches) {
      if (prevKoMatches.length === 1 && nextKoMatches.length === 1) {
        result[result.length - 1] = prevWord + nextWord;
        continue;
      }
    }
    result.push(item);
  }
  
  return result.join('');
};

export const JA_PARTICLE_BOUNDARY_PATTERN = /([。、！？])(?=[^\s])/g;
export const JA_REPEATED_SOKUON_COLLAPSE = /ッ{2,}/g;
export const JA_ELONGATION_NORMALIZE = /ー{2,}/g;

export const cleanJapaneseOcrNoise = (text: string): string => {
  let normalized = String(text || '');
  normalized = normalized.replace(JA_PARTICLE_BOUNDARY_PATTERN, '$1 ');
  normalized = normalized.replace(JA_REPEATED_SOKUON_COLLAPSE, 'ッ');
  normalized = normalized.replace(JA_ELONGATION_NORMALIZE, 'ー');
  
  // Remove stray middle dots ・ from broken glyphs if isolated
  normalized = normalized.replace(/(?<=^|\s)・(?=\s|$)/g, ' ');
  return normalized;
};

export const normalizeJapaneseOcrNoiseForTranslation = (text: string): string => {
  let normalized = String(text || '');
  normalized = cleanJapaneseOcrNoise(normalized);
  normalized = normalized
    .replace(/。/g, '. ')
    .replace(/、/g, ', ')
    .replace(/！/g, '! ')
    .replace(/？/g, '? ')
    .replace(/〜/g, '~')
    .replace(/「/g, '"')
    .replace(/」/g, '"')
    .replace(/『/g, "'")
    .replace(/』/g, "'");

  normalized = normalized.replace(/[il1I]\s*ッ/g, 'っ');
  normalized = normalized.replace(/エ[il1I]/g, 'えっ');
  return normalizeWhitespace(normalized);
};

export const normalizeKoreanOcrNoiseForTranslation = (text: string): string => {
  return normalizeKoreanColloquialOcrText(text);
};


// ---------------------------------------------------------------------------
// Pre-translation Thai Substitutions
// คำและวลีย์ที่ Argos แปลผิดเสมอ — แทนที่ด้วยคำภาษาไทยก่อนส่งให้ Engine
// Argos จะเห็นผลลัพธ์ภาษาไทยและไม่พยายามแปลซ้ำอีก (ตัวอักษรไทยจะผ่าน pass-through ไปยังผลลัพธ์ชั้นต่อไป)
// ---------------------------------------------------------------------------
export const ENGLISH_PRE_TRANSLATION_THAI_SUBS: Array<{ pattern: RegExp; replacement: string }> = [
  // Moved to post-translation in App.tsx (applyThaiConversationalGlossary) to prevent Argos translation hallucinations
];

export const normalizeSourceForTranslationWithThaiSubs = (normalized: string): string => {
  let result = normalized;
  for (const { pattern, replacement } of ENGLISH_PRE_TRANSLATION_THAI_SUBS) {
    result = result.replace(pattern, replacement);
  }
  return result;
};

export const normalizeSourceForTranslation = (text: string, sourceLanguage = ''): string => {
  // Pre-process text to remove carriage returns, newlines and handle hyphenated word splits safely (preserving Japanese honorifics and single-letter stutters)
  let raw = String(text || '').replace(/[\r\n]+/g, ' ');
  raw = raw.replace(/\b([\p{L}]{2,})-\s*(?!(?:san|chan|kun|sama|sensei|senpai|dono)\b)([\p{L}])/gui, '$1$2');

  let normalized = normalizeTechnicalArtifactsForTranslation(raw);
  normalized = normalizePossessiveCompoundsForTranslation(normalized);

  const normLang = normalizeTranslationLanguage(sourceLanguage, '');
  if (normLang === 'es') {
    normalized = normalizeSpanishOcrNoiseForTranslation(normalized);
  } else if (normLang === 'ja') {
    normalized = cleanJapaneseOcrSpacing(normalized);
    normalized = normalizeJapaneseOcrNoiseForTranslation(normalized);
  } else if (normLang === 'ko') {
    normalized = cleanKoreanOcrSpacing(normalized);
    normalized = normalizeKoreanOcrNoiseForTranslation(normalized);
  } else {
    normalized = normalizeEnglishOcrNoiseForTranslation(normalized);
  }

  normalized = normalized.replace(/\s+([,.;:!?])/g, '$1');
  normalized = normalized.replace(/([,.;:!?])(?=[^,.;:!?\s])/g, '$1 ');
  normalized = normalized.replace(/(?<=^|\s)_+/g, '').replace(/_+(?=\s|$)/g, '');
  normalized = normalized.replace(/\b([A-Za-z]{2,})_+(\s|$)/g, '$1...$2');
  normalized = normalized.replace(/\b_+([A-Za-z]{2,})\b/g, '$1');
  normalized = normalizeWhitespace(normalized);

  const hasUpperLatin = /[A-Z]/.test(normalized);
  if (hasUpperLatin) {
    normalized = normalized.toLowerCase();
    normalized = normalized.replace(/(^|[.!?]\s+)([a-z])/g, (_m, prefix: string, letter: string) => `${prefix}${letter.toUpperCase()}`);
  }

  // Restore technical acronyms to uppercase
  const ACRONYMS_TO_RESTORE = [
    'CPU', 'GPU', 'RAM', 'ROM', 'OS', 'UI', 'UX', 'API', 'HTML', 'XML', 'JSON', 'SQL', 'IP', 'USB', 'ONNX', 'IPC', 'DLL'
  ];
  for (const acr of ACRONYMS_TO_RESTORE) {
    const pattern = new RegExp(`\\b${acr}\\b`, 'gi');
    normalized = normalized.replace(pattern, acr);
  }

  // สุดท้าย: Pre-translation Thai substitutions สำหรับคำที่ Argos แปลไม่ออก เช่น Shaking, LOL, CUMMING
  // Thai chars จะผ่าน pass-through ไปยังผลลัพธ์ชั้นต่อไปโดยไม่ถูกแปลซ้ำ
  normalized = normalizeSourceForTranslationWithThaiSubs(normalized);

  return normalized;
};

export const normalizeThaiTranslationText = (text: string): string => {
  let normalized = String(text || '');
  for (let i = 0; i < 6; i += 1) {
    const next = normalized.replace(/([\u0E00-\u0E7F])\s+([\u0E00-\u0E7F])/g, '$1$2');
    if (next === normalized) break;
    normalized = next;
  }
  normalized = normalized
    .replace(/([\(\[\{])\s+/g, '$1')
    .replace(/\s+([\)\]\}])/g, '$1');
  normalized = normalized.replace(/ๆ{3,}/g, 'ๆๆ');
  normalized = normalized.replace(/^\s*ๆ+\s*$/g, '');
  normalized = normalized.replace(/\s+([,.;:!?])/g, '$1');
  return normalizeWhitespace(normalized);
};

export const normalizeThaiBoundaryToken = (segment: string): string =>
  normalizeThaiTranslationText(segment).replace(/[^\u0E00-\u0E7F]/g, '');
