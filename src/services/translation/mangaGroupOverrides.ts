import { lookupShortPhraseTh } from './offlineTranslationService';

export interface TranslatableLineLike {
  text?: string;
  [key: string]: any;
}

/**
 * จับคู่ข้อความกลุ่มบอลลูนมังงะหลายบรรทัดกับตาราง Override ภาษาไทย
 * หากตรงตามเงื่อนไข จะคืนค่า Array ของข้อความแปลแยกรายบรรทัด (per-line strings)
 * หากไม่ตรง จะคืนค่า null เพื่อให้ระบบแปลตามปกติ
 */
export function matchMangaGroupLineOverrides(
  compactCombined: string,
  lines: TranslatableLineLike[]
): string[] | null {
  if (!compactCombined || !lines || lines.length === 0) {
    return null;
  }

  // 1. CUM- MING -> ทะ- / ทะลักออกมาแล้ววว!
  if (compactCombined.includes('CUMMING') && compactCombined.replace(/[^A-Z]/g, '').length <= 25) {
    const overrideLines: string[] = [];
    lines.forEach((_, lineOffset) => {
      if (lineOffset === 0) {
        overrideLines.push('ทะ-');
      } else if (lineOffset === 1) {
        overrideLines.push('ทะลักออกมาแล้ววว!');
      } else {
        overrideLines.push('');
      }
    });
    return overrideLines;
  }

  // 2. IT FELT WAY TOO GOOD -> ดีเกินไป
  if (compactCombined.includes('ITFELTWAYTOOGOOD')) {
    const overrideLines: string[] = [];
    lines.forEach((_, lineOffset) => {
      if (lineOffset === 0) {
        overrideLines.push('ดีเกินไป');
      } else {
        overrideLines.push('');
      }
    });
    return overrideLines;
  }

  // 3. NOT NEC- ESSARY -> ไม่สำคัญ
  if (compactCombined.includes('NOTNECESSARY')) {
    const overrideLines: string[] = [];
    lines.forEach((_, lineOffset) => {
      if (lineOffset === 0) {
        overrideLines.push('ไม่สำคัญ');
      } else {
        overrideLines.push('');
      }
    });
    return overrideLines;
  }

  // 4. COO + OOO + OCKS / COO + OCKS / COOOOOOOCKS -> ควยย ยยย ยพวกนี้ / โดย ควยย ยยย ยเหล่านี้
  const isCocksGroup = (() => {
    const normalizedCombined = compactCombined
      .replace(/[07QDZ]/g, 'O')
      .replace(/G/g, 'C')
      .replace(/5/g, 'S');
    return /CO+C?KS/i.test(normalizedCombined) || /C[O0]{2,}CKS/i.test(compactCombined);
  })();

  if (isCocksGroup) {
    const overrideLines: string[] = [];
    let foundMain = false;
    lines.forEach((line) => {
      const lineTextClean = String(line.text || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const isCocksLinePart = (() => {
        const clean = lineTextClean.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (!clean) return false;
        if (/^[O0QD7]{2,}$/.test(clean)) return true;
        const normalized = clean
          .replace(/[07QDZ]/g, 'O')
          .replace(/G/g, 'C')
          .replace(/5/g, 'S');
        return /^[CO]*C?KS$/.test(normalized) || /^[CO]{2,}$/.test(normalized) || /^[CO]+C?K?S?$/.test(normalized);
      })();

      if (lineTextClean === 'BY') {
        overrideLines.push('โดย');
      } else if (isCocksLinePart) {
        if (!foundMain) {
          overrideLines.push('ควยย ยยย ยพวกนี้');
          foundMain = true;
        } else {
          overrideLines.push('');
        }
      } else {
        overrideLines.push(String(line.text || ''));
      }
    });
    return overrideLines;
  }

  // 5. BY HAVING SEX WITH A WOMAN -> โดยการ / มีเพศสัมพันธ์กับ / ผู้หญิง
  if (compactCombined.includes('BYHAVINGSEXWITHAWOMAN') || compactCombined.includes('HAVINGSEXWITHAWOMAN')) {
    const overrideLines: string[] = [];
    if (lines.length === 3) {
      overrideLines.push('โดยการ', 'มีเพศสัมพันธ์กับ', 'ผู้หญิง');
    } else {
      lines.forEach((_, lineOffset) => {
        if (lineOffset === 0) overrideLines.push('โดยการมีเพศสัมพันธ์กับผู้หญิง');
        else overrideLines.push('');
      });
    }
    return overrideLines;
  }

  // 6. IT'S MORE EFFICIENT AND PRODUCES HIGH QUALITY SPERM -> วิธีนี้มีประสิทธิภาพมากกว่าและได้อสุจิคุณภาพสูง
  if (compactCombined.includes('MOREEFFICIENT') && compactCombined.includes('SPERM')) {
    const overrideLines: string[] = [];
    if (lines.length === 6) {
      overrideLines.push('วิธีนี้มี', 'ประสิทธิภาพ', 'มากกว่าและ', 'ได้', 'อสุจิคุณภาพสูง', '');
    } else {
      lines.forEach((_, lineOffset) => {
        if (lineOffset === 0) overrideLines.push('วิธีนี้มีประสิทธิภาพมากกว่าและได้อสุจิคุณภาพสูง');
        else overrideLines.push('');
      });
    }
    return overrideLines;
  }

  // 7. What the hell kind of convenient straight out of an ero-manga disease is that...!?
  if (
    compactCombined.includes('WHATTHEHELL') &&
    (compactCombined.includes('EROMANGA') ||
      compactCombined.includes('CONVENIENT') ||
      compactCombined.includes('CONYENIENT') ||
      compactCombined.includes('DISEASE'))
  ) {
    const overrideLines: string[] = [];
    if (lines.length >= 5) {
      overrideLines.push('โรคอะไรวะเนี่ย', 'โรคที่สะดวกสบาย', 'เหมือนหลุดออกมาจาก', 'มังงะอีโรติก', 'เลย...!?');
      for (let i = 5; i < lines.length; i++) {
        overrideLines.push('');
      }
    } else {
      lines.forEach((_, lineOffset) => {
        if (lineOffset === 0) overrideLines.push('โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?');
        else overrideLines.push('');
      });
    }
    return overrideLines;
  }

  // 8. IT'S A DISEASE IN WHICH YOU HAVE TO RELEASE A LOT OF SPERM OR IT COULD BE FATAL
  if (
    compactCombined.includes('RELEASEALOTOFSPERM') ||
    (compactCombined.includes('SPERM') && compactCombined.includes('FATAL'))
  ) {
    const overrideLines: string[] = [];
    if (lines.length === 6) {
      overrideLines.push(
        'พูดอีกอย่างก็คือ',
        'มันคือโรคที่',
        'คุณจำเป็นต้อง',
        'หลั่งน้ำอสุจิ',
        'ออกมาเป็นจำนวนมาก',
        'มิเช่นนั้นอาจถึงตายได้'
      );
    } else if (lines.length === 5) {
      overrideLines.push(
        'มันคือโรคที่',
        'คุณจำเป็นต้อง',
        'หลั่งน้ำอสุจิ',
        'ออกมาเป็นจำนวนมาก',
        'มิเช่นนั้นอาจถึงตายได้'
      );
    } else {
      lines.forEach((_, lineOffset) => {
        if (lineOffset === 0) overrideLines.push('นี่เป็นโรคที่คุณต้องหลั่งอสุจิออกมาเป็นจำนวนมาก มิเช่นนั้นอาจถึงแก่ชีวิตได้');
        else overrideLines.push('');
      });
    }
    return overrideLines;
  }

  // 9. SEXUAL INTERCOURSE DEFICIENCY OF THE GENITALS DISEASE
  if (
    compactCombined.includes('SEXUALINTERCOURSEDEFICIENCY') ||
    (compactCombined.includes('GENITALS') && compactCombined.includes('DISEASE'))
  ) {
    const overrideLines: string[] = [];
    if (lines.length === 5) {
      overrideLines.push('โรค', 'ความบกพร่อง', 'ทางเพศสัมพันธ์', 'ของอวัยวะเพศ', '');
    } else if (lines.length === 4) {
      overrideLines.push('โรคความบกพร่อง', 'ทางเพศสัมพันธ์', 'ของอวัยวะเพศ', '');
    } else {
      lines.forEach((_, lineOffset) => {
        if (lineOffset === 0) overrideLines.push('โรคความบกพร่องทางเพศของอวัยวะเพศ');
        else overrideLines.push('');
      });
    }
    return overrideLines;
  }

  // 10. COME ON! CRY EVEN MORE LIKE THE PIG YOU ARE !!
  if (
    compactCombined.includes('THEPIGYOUARE') ||
    compactCombined.includes('LIKETHEPIGYOUARE') ||
    compactCombined.includes('LIKEAPIGYOUARE') ||
    (compactCombined.includes('CRY') && compactCombined.includes('PIG')) ||
    (compactCombined.includes('COME') && compactCombined.includes('PIG')) ||
    (compactCombined.includes('EVEN') && compactCombined.includes('PIG'))
  ) {
    const overrideLines: string[] = [];
    lines.forEach((line) => {
      const raw = String(line.text || '').trim();
      const clean = raw.toUpperCase().replace(/[^A-Z0-9!?,]/g, '');
      if (clean === 'COME') overrideLines.push('เร็ว');
      else if (clean === 'ON!' || clean === 'ON') overrideLines.push('เข้า!');
      else if (clean === 'COMEON!' || clean === 'COMEON') overrideLines.push('เร็วเข้า!');
      else if (clean === 'CRY' || clean === 'CRY!') overrideLines.push('ร้องไห้');
      else if (clean === 'EVEN') overrideLines.push('ออกมา');
      else if (clean === 'MORE') overrideLines.push('อีก');
      else if (clean === 'EVENMORE') overrideLines.push('ยิ่งกว่าเดิม');
      else if (clean === 'LIKE') overrideLines.push('ให้เหมือน');
      else if (clean === 'LIKEAPIG') overrideLines.push('เหมือนหมู');
      else if (clean === 'THE') overrideLines.push('ไอ้');
      else if (clean === 'PIG') overrideLines.push('หมูตอน');
      else if (clean === 'THEPIG') overrideLines.push('ไอ้หมูตอน');
      else if (clean === 'YOU') overrideLines.push('อย่าง');
      else if (clean === 'ARE') overrideLines.push('แก!');
      else if (clean === 'YOUARE') overrideLines.push('อย่างแก!');
      else if (clean === 'THEPIGYOUARE') overrideLines.push('ไอ้หมูตอนอย่างแก!');
      else if (clean === 'LIKETHEPIGYOUARE') overrideLines.push('เหมือนไอ้หมูตอนอย่างแก!');
      else if (clean === '!!' || clean === '!') overrideLines.push(raw);
      else {
        const dict = lookupShortPhraseTh(raw) || lookupShortPhraseTh(raw.replace(/[^A-Za-z0-9]/g, ''));
        if (dict) {
          overrideLines.push(dict);
          return;
        }
        const words = raw.split(/\s+/);
        const thWords = words
          .map((w) => {
            const wClean = w.toUpperCase().replace(/[^A-Z0-9!?,]/g, '');
            if (wClean === 'A' || wClean === 'AN') return '';
            if (wClean === 'THE') return 'ไอ้';
            if (wClean === 'PIG') return 'หมูตอน';
            if (wClean === 'YOU') return 'อย่าง';
            if (wClean === 'ARE') return 'แก!';
            if (wClean === 'LIKE') return 'เหมือน';
            if (wClean === 'COME') return 'เร็ว';
            if (wClean === 'ON' || wClean === 'ON!') return 'เข้า!';
            if (wClean === 'CRY') return 'ร้องไห้';
            if (wClean === 'MORE') return 'อีก';
            if (wClean === 'EVEN') return 'ออกมา';
            return lookupShortPhraseTh(w) || w;
          })
          .filter(Boolean);
        overrideLines.push(thWords.join(' '));
      }
    });
    return overrideLines;
  }

  // 10b. COME ON! CRY EVEN MORE LIKE ...
  if (
    (compactCombined.includes('COMEON') && compactCombined.includes('CRY')) ||
    (compactCombined.includes('CRY') && compactCombined.includes('EVENMORE')) ||
    (compactCombined.includes('CRY') && compactCombined.includes('MORE')) ||
    (compactCombined.includes('COME') && compactCombined.includes('CRY') && compactCombined.includes('LIKE'))
  ) {
    const overrideLines: string[] = [];
    lines.forEach((line) => {
      const raw = String(line.text || '').trim();
      const clean = raw.toUpperCase().replace(/[^A-Z0-9!?,]/g, '');
      if (clean === 'COME') overrideLines.push('เร็ว');
      else if (clean === 'ON!' || clean === 'ON') overrideLines.push('เข้า!');
      else if (clean === 'COMEON!' || clean === 'COMEON') overrideLines.push('เร็วเข้า!');
      else if (clean === 'CRY' || clean === 'CRY!') overrideLines.push('ร้องไห้');
      else if (clean === 'EVEN') overrideLines.push('ออกมา');
      else if (clean === 'MORE') overrideLines.push('อีก');
      else if (clean === 'EVENMORE') overrideLines.push('ยิ่งกว่าเดิม');
      else if (clean === 'LIKE') overrideLines.push('เหมือนหมูตอนอย่างแก!');
      else if (clean === 'THE') overrideLines.push('ไอ้');
      else if (clean === 'PIG') overrideLines.push('หมูตอน');
      else if (clean === 'YOU') overrideLines.push('อย่าง');
      else if (clean === 'ARE') overrideLines.push('แก!');
      else if (clean === '!!' || clean === '!') overrideLines.push(raw);
      else {
        overrideLines.push(lookupShortPhraseTh(raw) || raw);
      }
    });
    return overrideLines;
  }

  // 10c. HAHAHA! YOU'RE STARTING TO SOUND LIKE A PIG, PRINCESS KNIGHT
  if (
    (compactCombined.includes('STARTING') && compactCombined.includes('PIG')) ||
    (compactCombined.includes('SOUND') && compactCombined.includes('PIG')) ||
    (compactCombined.includes('PRINCESS') && compactCombined.includes('KNIGHT') && compactCombined.includes('PIG'))
  ) {
    const overrideLines: string[] = [];
    lines.forEach((line) => {
      const raw = String(line.text || '').trim();
      const clean = raw.toUpperCase().replace(/[^A-Z0-9!?,]/g, '');
      if (clean.includes('HAHA')) overrideLines.push('ฮ่าๆๆ!');
      else if (clean.includes('YOURE') || clean.includes("YOU'RE")) overrideLines.push('เจ้าเริ่ม');
      else if (clean.includes('STARTING')) overrideLines.push('จะส่งเสียง');
      else if (clean.includes('TOSOUND') || clean.includes('SOUND')) overrideLines.push('ร้อง');
      else if (clean.includes('LIKEAPIG') || clean.includes('LIKE') || clean.includes('PIG')) overrideLines.push('เหมือนหมูแล้วนะ,');
      else if (clean.includes('PRINCESS')) overrideLines.push('ท่านหญิง');
      else if (clean.includes('KNIGHT')) overrideLines.push('อัศวิน!');
      else {
        overrideLines.push(lookupShortPhraseTh(raw) || raw);
      }
    });
    return overrideLines;
  }

  // 10d. THE PIG YOU ARE / LIKE A PIG / PIG YOU ARE
  if (
    compactCombined.includes('PIGYOUARE') ||
    (compactCombined.includes('PIG') &&
      (compactCombined.includes('YOU') || compactCombined.includes('ARE') || compactCombined.includes('LIKE')))
  ) {
    const overrideLines: string[] = [];
    lines.forEach((line) => {
      const raw = String(line.text || '').trim();
      const clean = raw.toUpperCase().replace(/[^A-Z0-9!?,]/g, '');
      if (clean === 'THE') overrideLines.push('ไอ้');
      else if (clean === 'PIG') overrideLines.push('หมูตอน');
      else if (clean === 'THEPIG') overrideLines.push('ไอ้หมูตอน');
      else if (clean === 'YOU') overrideLines.push('อย่าง');
      else if (clean === 'ARE') overrideLines.push('แก!');
      else if (clean === 'YOUARE') overrideLines.push('อย่างแก!');
      else if (clean === 'THEPIGYOUARE') overrideLines.push('ไอ้หมูตอนอย่างแก!');
      else if (clean === 'LIKE') overrideLines.push('เหมือน');
      else if (clean === 'LIKEAPIG') overrideLines.push('เหมือนหมู');
      else if (clean === 'LIKETHEPIG') overrideLines.push('เหมือนไอ้หมู');
      else if (clean === 'LIKETHEPIGYOUARE') overrideLines.push('เหมือนไอ้หมูตอนอย่างแก!');
      else {
        overrideLines.push(lookupShortPhraseTh(raw) || raw);
      }
    });
    return overrideLines;
  }

  // 11. OH, MY LOVE, WE'RE GOING.. WE'LL LEAVE THE TWO OF YOU TO HAVE FUN
  if (
    compactCombined.includes('GOING') &&
    (compactCombined.includes('LEAVE') ||
      compactCombined.includes('WELLLEAVE') ||
      compactCombined.includes('WELEAVE'))
  ) {
    const overrideLines: string[] = [];
    if (lines.length === 5) {
      overrideLines.push('โอ้ ที่', 'รักเราทำ', 'ไปกันเถอะ.. เราจะปล่อยให้', 'สองคนสนุก', 'ดีกว่า');
    } else {
      lines.forEach((line) => {
        const lineClean = String(line.text || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
        if (lineClean.includes('GOING') || lineClean.includes('LEAVE')) {
          overrideLines.push('ไปกันเถอะ.. เราจะปล่อยให้');
        } else {
          overrideLines.push(lookupShortPhraseTh(line.text || '') || String(line.text || ''));
        }
      });
    }
    return overrideLines;
  }

  // 12. HAHAHA! YOU'VE GOT A NICELY PLOWED WET PUSSY, DON'T YOU? HOW MUCH DID YOU DO IT WITH THE BARBARIANS
  if (
    compactCombined.includes('BARBARIANS') &&
    (compactCombined.includes('PLOWED') || compactCombined.includes('WETPUSSY') || compactCombined.includes('HAHAHA'))
  ) {
    const overrideLines: string[] = [];
    lines.forEach((line) => {
      const raw = String(line.text || '').trim();
      const clean = raw.toUpperCase().replace(/[^A-Z0-9!?,]/g, '');
      if (clean === 'HAHAHA!' || clean === 'HAHAHA') overrideLines.push('ฮ่าฮ่าฮ่า!');
      else if (clean === "YOU'VEGOTA" || clean === "YOUVEGOTA" || clean === "YOUVEGOT" || clean === "YOU'VE") overrideLines.push('เธอมี');
      else if (clean === 'NICELYPLOWED' || clean === 'NICELY' || clean === 'PLOWED') overrideLines.push('ที่ถูกไถอย่างดีแล้ว');
      else if (clean === 'WETPUSSY,' || clean === 'WETPUSSY' || clean === 'PUSSY') overrideLines.push('ช่องคลอดเปียกๆ');
      else if (clean === "DON'TYOU?" || clean === "DONTYOU?" || clean === "DONTYOU" || clean === "DON'TYOU") overrideLines.push('ใช่ไหม?');
      else if (clean === 'HOWMUCH' || clean === 'HOW' || clean === 'MUCH') overrideLines.push('เธอทำไปเท่าไหร่');
      else if (clean === 'DIDYOUDO' || clean === 'DIDYOU' || clean === 'YOUDO') overrideLines.push('กับพวก');
      else if (clean === 'ITWITHTHE' || clean === 'WITHTHE' || clean === 'WITH') overrideLines.push('กับพวก');
      else if (clean === 'BARBARIANS' || clean === 'BARBARIAN') overrideLines.push('คนป่าเถื่อน');
      else {
        overrideLines.push(lookupShortPhraseTh(raw) || raw);
      }
    });
    return overrideLines;
  }

  // 13. AAAH, FUCK! YOUR BITCH MOANS ARE FORCING THE NEXT LOAD OUT!
  if (
    (compactCombined.includes('LOADOUT') || compactCombined.includes('THENEXT') || compactCombined.includes('FORCING')) &&
    (compactCombined.includes('BITCH') || compactCombined.includes('MOANS') || compactCombined.includes('AAAH') || compactCombined.includes('FUCK'))
  ) {
    const overrideLines: string[] = [];
    lines.forEach((line) => {
      const raw = String(line.text || '').trim();
      const clean = raw.toUpperCase().replace(/[^A-Z0-9!?,]/g, '');
      if (clean.startsWith('AAAH') || clean === 'AAAH,' || clean === 'AAAH!') overrideLines.push('อ๊าก!');
      else if (clean === 'FUCK!' || clean === 'FUCK') overrideLines.push('เหี้ย!');
      else if (clean.includes('YOURBITCH') || clean === 'YOURBITCH' || clean === 'BITCH') overrideLines.push('เสียงครางร่านๆของเธอ');
      else if (clean.includes('MOANS') || clean === 'MOANSARE' || clean === 'MOANS') overrideLines.push('กำลังบังคับ');
      else if (clean.includes('FORCING') || clean === 'FORCING') overrideLines.push('ให้');
      else if (clean.includes('THENEXT') || clean === 'NEXT' || clean === 'THE') overrideLines.push('เตรียมก๊อก');
      else if (clean.includes('LOADOUT') || clean === 'LOAD' || clean === 'OUT') overrideLines.push('ถัดไป!');
      else {
        overrideLines.push(lookupShortPhraseTh(raw) || raw);
      }
    });
    return overrideLines;
  }

  return null;
}
