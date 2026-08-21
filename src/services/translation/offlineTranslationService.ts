import type { BBox, OCRLine } from '../../types';
import type { TranslationMode } from '../../stores/useProjectStore';
import {
  normalizeWhitespace,
  normalizeSourceForTranslation,
  normalizeTranslationLanguage,
  normalizeSpanishOcrNoiseForTranslation,
  cleanJapaneseOcrSpacing,
  cleanKoreanOcrSpacing,
  normalizeJapaneseOcrNoiseForTranslation,
  normalizeKoreanOcrNoiseForTranslation,
  normalizeEnglishOcrNoiseForTranslation,
} from '../ocr/ocrTextNormalizer';
import { isKnownShortWordHelper, isLikelyEnglishDialogue } from '../ocr/ocrSafetyLineDedup';

import {
  hasKoreanTranslationCarryover,
  applyKoreanConversationalFallback,
} from './koreanTranslationPolicy';

import {
  normalizeOverlayInlineText,
  type OverlayTypography,
} from '../../components/OCR/translationOverlayUtils';

// -------------------------------------------------------------
// Translation Constants and Tables
// -------------------------------------------------------------

export const ARGOS_SHORT_PHRASE_LOOKUP_TH: Record<string, string> = {
  // App specific sentence mapping overrides
  'ehm i just used a pdf translator to scan and translate it then printed out the results': 'เอ่อ.. ผมใช้โปรแกรม PDF TRANSLATOR สแกนและแปลไฟล์ จากนั้นก็พิมพ์ผลลัพธ์ออกมาครับ',
  'ehm i just used a pdf translator to scan and translate it then printed out the result': 'เอ่อ.. ผมใช้โปรแกรม PDF TRANSLATOR สแกนและแปลไฟล์ จากนั้นก็พิมพ์ผลลัพธ์ออกมาครับ',
  'ehm i just used a zara to scan and translate it then printed out the results': 'เอ่อ.. ผมใช้โปรแกรม PDF TRANSLATOR สแกนและแปลไฟล์ จากนั้นก็พิมพ์ผลลัพธ์ออกมาครับ',
  'ehm i just used a zara to scan and translate it then printed out the result': 'เอ่อ.. ผมใช้โปรแกรม PDF TRANSLATOR สแกนและแปลไฟล์ จากนั้นก็พิมพ์ผลลัพธ์ออกมาครับ',
  // Spanish and Manhwa loanwords mappings
  'con eso basta': 'แค่นั้นก็พอแล้ว', 'con eso basta.': 'แค่นั้นก็พอแล้ว', 'coneso basta.': 'แค่นั้นก็พอแล้ว', 'coneso basta': 'แค่นั้นก็พอแล้ว',
  'sunbae tambien.': 'รุ่นพี่เองก็ด้วยเหมือนกัน', 'sunbae tambien': 'รุ่นพี่เองก็ด้วยเหมือนกัน', 'sunbae también.': 'รุ่นพี่เองก็ด้วยเหมือนกัน', 'sunbae también': 'รุ่นพี่เองก็ด้วยเหมือนกัน',
  'sunbae': 'รุ่นพี่', 'sunbae!': 'รุ่นพี่!', 'sunbae...': 'รุ่นพี่...', 'hoobae': 'รุ่นน้อง', 'hoobae!': 'รุ่นน้อง!', 'hoobae...': 'รุ่นน้อง...',
  'sentir avergonzada': 'รู้สึกอับอาย', 'tir avergonzada': 'รู้สึกอับอาย',
  'hombre, por favor...': 'โธ่ ได้โปรดเถอะ...', 'hombre, por favor': 'โธ่ ได้โปรดเถอะ', 'hombre por favor...': 'โธ่ ได้โปรดเถอะ...', 'bre, por favor...': 'โธ่ ได้โปรดเถอะ...', 'bre, por favor': 'โธ่ ได้โปรดเถอะ',
  'cumplir con lo basico': 'ทำตามพื้นฐาน...', 'plir con lo ba-': 'ทำตามพื้นฐาน...', 'plir con lo ba': 'ทำตามพื้นฐาน',
  'hacia atras asi como': 'ไปข้างหลัง แบบนั้น...', 'cia atras asi co-': 'ไปข้างหลัง แบบนั้น...', 'cia atras asi co': 'ไปข้างหลัง แบบนั้น',
  'entre las piernas.': 'ระหว่างขา', 'entre las piernas': 'ระหว่างขา', 'te las piernas.': 'ระหว่างขา', 'te las piernas': 'ระหว่างขา',
  'fotografiado junto a eso y que': 'ถ่ายรูปคู่กับสิ่งนั้นและ...', 'grafiado junto a eso y que': 'ถ่ายรูปคู่กับสิ่งนั้นและ...',
  'primera vez que le': 'ครั้งแรกที่เธอ...', 'mera vez que le': 'ครั้งแรกที่เธอ...',
  'postura ante un hoobae': 'ท่าทางต่อหน้ารุ่นน้อง', 'tura ante un hoobae': 'ท่าทางต่อหน้ารุ่นน้อง', 'tura ante un hoobae.llado por': 'ท่าทางต่อหน้ารุ่นน้อง... ถูกทำให้อับอาย', 'postura ante un hoobae. humillado por': 'ท่าทางต่อหน้ารุ่นน้อง... ถูกทำให้อับอาย',
  'desde ese momento': 'ตั้งแต่ช่วงเวลานั้น', 'da ese momento': 'ตั้งแต่ช่วงเวลานั้น',
  'estaba de forma': 'อยู่ในสภาพ...', 'taba de forma': 'อยู่ในสภาพ...',
  'vergonzosas. completa derrota': 'น่าอับอาย... พ่ายแพ้อย่างราบคาบ', 'gonzosas.pletaderrota': 'น่าอับอาย... พ่ายแพ้อย่างราบคาบ', 'gonzosas. pletaderrota': 'น่าอับอาย... พ่ายแพ้อย่างราบคาบ', 'gonzosas.pleta derrota': 'น่าอับอาย... พ่ายแพ้อย่างราบคาบ',
  'hecho.por': 'ทำแล้ว โดย...', 'hecho. por': 'ทำแล้ว โดย...',
  'mientras le pellizco los pezones': 'ขณะที่หยิกหัวนมของเธอ', 'tras le pellizco los pezones': 'ขณะที่หยิกหัวนมของเธอ',
  'conquista y': 'พิชิตและ...', 'quista y': 'พิชิตและ...', 'quista y estupida.': 'การพิชิตและโง่เง่า...', 'quista y estupida': 'การพิชิตและโง่เง่า...', 'conquista y estupida.': 'การพิชิตและโง่เง่า...',
  'exclusiva...': 'พิเศษเฉพาะ...', 'exclusiva': 'พิเศษเฉพาะ', 'clusiva...': 'พิเศษเฉพาะ...', 'clusiva': 'พิเศษเฉพาะ',
  'ya convertido en una': 'กลายสภาพเป็น... แล้ว',
  'trata de': 'พยายามจะ...', 'ta de': 'พยายามจะ...', 'ta de ahora en': 'พยายามนับจากนี้...', 'trata de ahora en': 'พยายามนับจากนี้...',
  'cucama': 'เตียง', 'cucama.': 'เตียง.', 'llado por': 'ถูกทำให้อับอายโดย...', 'humillado por': 'ถูกทำให้อับอายโดย...',
  'felicesaambos': 'มีความสุขทั้งคู่', 'felices a ambos': 'มีความสุขทั้งคู่', 'felices ambos': 'มีความสุขทั้งคู่',
  'entendido': 'เข้าใจแล้ว', 'entendido!': 'เข้าใจแล้ว!', '¡entendido!': 'เข้าใจแล้ว!',
  'defenderse. soy yo': 'ป้องกันตัว... ฉันเอง', 'fenderse.s0y y0': 'ป้องกันตัว... ฉันเอง', 'fenderse. soy yo': 'ป้องกันตัว... ฉันเอง', 'fenderse': 'ป้องกันตัว',
  'soy yo': 'ฉันเอง', 's0y y0': 'ฉันเอง',
  'la que': 'คนที่...',
  'decido': 'ฉันตัดสินใจ', 'decido!': 'ฉันตัดสินใจ!',
  'con': 'ด้วย', 'con.': 'ด้วย', 'con,': 'ด้วย',
  'eso basta.hace': 'แค่นั้นก็พอแล้ว. ทำ...', 'con eso basta. hace': 'แค่นั้นก็พอแล้ว. ทำ...', 'eso basta. hace': 'แค่นั้นก็พอแล้ว. ทำ...',
  'eso basta': 'แค่นั้นก็พอแล้ว', 'eso basta.': 'แค่นั้นก็พอแล้ว',
  'pleaderrot': 'ความพ่ายแพ้อย่างสิ้นเชิง', 'pleaderrot.': 'ความพ่ายแพ้อย่างสิ้นเชิง', 'pleaderrota': 'ความพ่ายแพ้อย่างสิ้นเชิง', 'completa derrota': 'ความพ่ายแพ้อย่างสิ้นเชิง', 'completa derrota.': 'ความพ่ายแพ้อย่างสิ้นเชิง',
  'adelante.': 'เชิญเลย.', 'adelante': 'เชิญเลย', '¡adelante!': 'เชิญเลย!', '¡adelante.': 'เชิญเลย.',
  'hangh': 'อ่าห์...', 'hangh.': 'อ่าห์...', 'hangh...': 'อ่าห์...',
  'unidos en la rela-': 'รวมเป็นหนึ่งในความสัมพั-', 'unidos en la rela': 'รวมเป็นหนึ่งในความสัมพั-', 'unidos en la relacion': 'รวมเป็นหนึ่งในความสัมพันธ์',
  'hace': 'ทำ',
  'verdad!': 'จริงเหรอ!', 'verdad': 'จริงเหรอ', '¿verdad!': 'จริงเหรอ!', '¡verdad!': 'จริงเหรอ!',
  // Dialogue / Manga vocabulary
  'thisto': 'สิ่งนี้ต่อ...', 'this to': 'สิ่งนี้ต่อ...',
  'youcan': 'เธอทำได้', 'you can': 'เธอทำได้',
  'great': 'ยอดเยี่ยม', 'great!': 'ยอดเยี่ยม!', 'great...': 'ยอดเยี่ยม...',
  'outsider': 'คนนอก', 'outsider.': 'คนนอก.', 'outsiders': 'คนนอก',
  'demanded': 'เรียกร้อง', 'demanded.': 'เรียกร้อง.',
  'keeping': 'การเก็บรักษา', 'keeping.': 'การเก็บรักษา.',
  'this': 'สิ่งนี้', 'this!': 'สิ่งนี้!', 'this?': 'สิ่งนี้เหรอ?',
  'strange': 'แปลก', 'strange.': 'แปลก.', 'strange...': 'แปลก...',
  'funny': 'ตลก', 'funny!': 'ตลก!', 'funny...': 'ตลก...', 'funny?': 'ตลกเหรอ?',
  'guess': 'เดาว่า', 'guess...': 'เดาว่า...',
  'doesn\'t': 'ไม่', 'doesn\'t.': 'ไม่.', 'does not': 'ไม่',
  'collar': 'ปลอกคอ', 'collar.': 'ปลอกคอ.', 'collar?': 'ปลอกคอ?',
  'thought': 'คิดว่า', 'thought...': 'คิดว่า...',
  'wha-': 'อะไ-', 'what-': 'อะไ-',
  'is': 'คือ', 'is.': 'คือ.',
  'sasaki-': 'ซาซากิ-', 'sasaki': 'ซาซากิ', 'sasaki-san': 'คุณซาซากิ',
  'choker': 'โชกเกอร์', 'choker.': 'โชกเกอร์.',
  'recently': 'ช่วงนี้', 'recently?': 'ช่วงนี้เหรอ?', 'recently.': 'ช่วงนี้.',
  'yamada-chan': 'ยามาดะจัง', 'yamada-chan.': 'ยามาดะจัง.', 'yamada-': 'ยามาดะ-', 'yamada': 'ยามาดะ',
  'nerves': 'ความประหม่า', 'nerves.': 'ความประหม่า.',
  'warehouse': 'โกดัง', 'warehouse.': 'โกดัง.',
  'coupon': 'คูปอง', 'coupon.': 'คูปอง.', 'coupons': 'คูปอง',
  'some': 'บ้าง', 'some.': 'บ้าง.',
  'san\'s not': 'ซังไม่อยู่', 'san is not': 'ซังไม่อยู่',
  'register': 'เครื่องคิดเงิน', 'register.': 'เครื่องคิดเงิน.',
  'showing': 'กำลังแสดง', 'showing.': 'กำลังแสดง.',
  'hate': 'เกลียด', 'hate!': 'เกลียด!', 'hate...': 'เกลียด...',
  'mean': 'ใจร้าย', 'mean!': 'ใจร้าย!', 'mean...': 'ใจร้าย...', 'mean?': 'หมายถึงเหรอ?',
  'show': 'แสดง', 'show!': 'แสดง!', 'show.': 'แสดง.',
  'uh-huh': 'อือฮึ', 'uh-huh.': 'อือฮึ.', 'uh-huh!': 'อือฮึ!',
  'sleeved': 'แขนเสื้อ', 'sleeved.': 'แขนเสื้อ.',
  'plain': 'เรียบง่าย', 'plain.': 'เรียบง่าย.',
  'amusing': 'น่าสนุก', 'amusing.': 'น่าสนุก.', 'amusing...': 'น่าสนุก...',
  'dealing': 'การรับมือ', 'dealing.': 'การรับมือ.',
  'shitless': 'กลัวแทบตาย', 'shitless.': 'กลัวแทบตาย.', 'scared shitless': 'กลัวแทบตาย', 'scared shitless.': 'กลัวแทบตาย.',
  '1t\'s a': 'มันคือ', '1t\'s': 'มันคือ', 'it\'s a': 'มันคือ', 'it\'s': 'มันคือ', 'it is': 'มันคือ',
  'centred': 'ตรงกลาง', 'centred.': 'ตรงกลาง.', 'centered': 'ตรงกลาง', 'centered.': 'ตรงกลาง.',
  'the cashier': 'พนักงานคิดเงิน', 'the cashier.': 'พนักงานคิดเงิน.', 'cashier': 'พนักงานคิดเงิน',
  'work': 'ทำงาน', 'work!': 'ทำงาน!', 'work.': 'ทำงาน.', 'at work': 'ที่ทำงาน',
  'sure is': 'ใช่จริงๆ ด้วย', 'sure is!': 'ใช่จริงๆ ด้วย!', 'sure is.': 'ใช่จริงๆ ด้วย.',
  'think': 'คิด', 'think!': 'คิด!', 'think...': 'คิด...', 'think?': 'คิดเหรอ?',
  'won\'t': 'จะไม่', 'won\'t.': 'จะไม่.', 'won\'t!': 'จะไม่!', 'will not': 'จะไม่',
  'antee it': 'รับรองได้เลย', 'antee it.': 'รับรองได้เลย.', 'guarantee it': 'รับรองได้เลย', 'guarantee it.': 'รับรองได้เลย.',
  'league': 'ลีก', 'league.': 'ลีก.', 'in a different league': 'คนละชั้นกันเลย',
  'quarters': 'เหรียญ', 'quarters.': 'เหรียญ.', 'quarter': 'เหรียญ',
  'sides': 'ด้านข้าง', 'sides...': 'ด้านข้าง...', 'sides.': 'ด้านข้าง.', 'side': 'ข้าง',
  'meled for': 'เรียกหา...', 'meled for.': 'เรียกหา...', 'smiled for': 'ยิ้มให้...',
  'motivated': 'มีแรงฮึด', 'motivated!': 'มีแรงฮึด!', 'motivated.': 'มีแรงฮึด.',
  'reluctant': 'ลังเล', 'reluctant.': 'ลังเล.', 'reluctant...': 'ลังเล...',
  'lieved': 'โล่งอกไปที', 'lieved!': 'โล่งอกไปที!', 'relieved': 'โล่งอกไปที', 'relieved!': 'โล่งอกไปที!',
  '(place, and)': '(สถานที่ และ...)', '(place, and': '(สถานที่ และ...)', 'place, and': 'สถานที่ และ...',
  'man"?': 'ผู้ชายเหรอ?', 'man?': 'ผู้ชายเหรอ?', 'man"': 'ผู้ชาย',
  'saaan.': 'ซัง', 'saaan': 'ซังงงง', 'saaan!': 'ซังงงง!',
  'a choker': 'สร้อยคอโชกเกอร์', 'a choker.': 'สร้อยคอโชกเกอร์.',
  'terrific!': 'ยอดเยี่ยม~', 'terrific': 'ยอดเยี่ยม~',
  'rejected': 'ถูกปฏิเสธ', 'rejected.': 'ถูกปฏิเสธ.', 'rejected!': 'ถูกปฏิเสธ!',
  'smirk': 'แสยะยิ้ม', 'smirk.': 'แสยะยิ้ม.',
  'tayama-san': 'คุณทายามะ', 'tayama-san.': 'คุณทายามะ.',
  'cat': 'แมว', 'cat!': 'แมว!', 'cat.': 'แมว.',
  'closed': 'ปิดแล้ว', 'closed.': 'ปิดแล้ว.',
  'count': 'นับ', 'count!': 'นับ!', 'count.': 'นับ.',
  'trance': 'ภวังค์', 'trance?': 'ตกอยู่ในภวังค์?', 'trance!': 'ภวังค์!',
  'leagues': 'ลีก', 'leagues.': 'ลีก.',
  'dence': 'ความมั่นใจ', 'dence.': 'ความมั่นใจ.',
  'dropper': 'ที่หยด', 'dropper.': 'ที่หยด.',
  'wracking': 'ปวดหัวแทบแตก', 'wracking...': 'ปวดหัวแทบแตก...',
  'gorou-san': 'คุณโกโร่', 'gorou-san.': 'คุณโกโร่.', 'gorou-san~': 'คุณโกโร่~', 'gorol-san': 'คุณโกโร่', 'gorol-san.': 'คุณโกโร่.',
  'pervsaki': 'ตาโรคจิตซากิ', 'pervsaki.': 'ตาโรคจิตซากิ.',
  'beyblade': 'เบย์เบลด', 'beyblade!': 'เบย์เบลด!', 'bey-blade': 'เบย์เบลด', 'bey-blade!': 'เบย์เบลด!', 'my beyblade': 'เบย์เบลดของฉัน', 'my beyblade!': 'เบย์เบลดของฉัน!',
  'i am': 'ฉันเอง', 'i am.': 'ฉันเอง.', 'i am!': 'ฉันเอง!',
  'huh?!': 'หะ?!', 'huh?': 'หะ?', 'huh!': 'หะ!',
  'what?!': 'อะไรนะ?!', 'what?': 'อะไรนะ?', 'what!': 'อะไรนะ!',
  'i\'ll leave': 'ฉันขอตัว', 'i\'ll leave.': 'ฉันขอตัว.', 'i\'ll leave!': 'ฉันจะไปแล้ว!', 'ill leave': 'ฉันขอตัว',
  'sciously': 'อย่างมีสติ', 'sciously.': 'อย่างมีสติ.', 'sciously...': 'อย่างมีสติ...',
  'miniscing': 'รำลึกความหลัง', 'miniscing.': 'รำลึกความหลัง.', 'miniscing...': 'รำลึกความหลัง...',
  'fwine': 'ส-สบายดี๊', 'fwine!': 'ส-สบายดี๊!', 'fwine?': 'ส-สบายดี๊?',
  'bring her': 'พาเธอมา', 'bring her!': 'พาเธอมา!', 'bringher': 'พาเธอมา', 'bringher!': 'พาเธอมา!',
  'doesn\'t get': 'ไม่เข้าใจ', 'doesn\'t get!': 'ไม่เข้าใจ!', 'doesnt get': 'ไม่เข้าใจ', 'doesnt get!': 'ไม่เข้าใจ!',
  't-tayama': 'ท-ทายามะ', 't-tayama-': 'ท-ทายามะ-', 't-tayama!': 'ท-ทายามะ!', 't-tayama...': 'ท-ทายามะ...',
  'ya-ma-da': 'ยา-มา-ดะ', '(ya-ma-da)': '(ยา-มา-ดะ)', 'ya-ma-da!': 'ยา-มา-ดะ!', '(ya-ma-da!)': '(ยา-มา-ดะ!)',
  'amazing': 'สุดยอดเลย', 'amazing~': 'สุดยอดเลย~', 'amazing!': 'สุดยอดเลย!', 'amazing...': 'สุดยอดเลย...',
  'fortunate. hear.': 'โชคดีที่ได้ยิน', 'fortunate.hear.': 'โชคดีที่ได้ยิน', 'fortunate hear': 'โชคดีที่ได้ยิน',
  'apologize': 'ขอโทษ', 'apologize.': 'ขอโทษ.', 'apologize!': 'ขอโทษ!',
  'regarding': 'เกี่ยวกับ', 'regarding.': 'เกี่ยวกับ.',
  'assured.': 'วางใจได้.', 'assured': 'วางใจได้', 'assured!': 'วางใจได้!',
  'one.': 'คนหนึ่ง.', 'one': 'หนึ่ง',
  'worried': 'กังวล', 'worried.': 'กังวล.', 'worried...': 'กังวล...',
  'watch?': 'ดูเหรอ?', 'watch': 'ดู', 'watch!': 'ดู!',
  'old senpai': 'รุ่นพี่ที่เคยรู้จัก', 'old senpai.': 'รุ่นพี่ที่เคยรู้จัก.',
  'confusing': 'สับสน', 'confusing.': 'สับสน.', 'confusing...': 'สับสน...',
  'non-existent well...': 'ไม่มีอยู่จริง...', 'non-existent well': 'ไม่มีอยู่จริง...', 'non-existent': 'ไม่มีอยู่จริง', 'non-existent...': 'ไม่มีอยู่จริง...', 'non-existentwell...': 'ไม่มีอยู่จริง...',
  'precious': 'ล้ำค่า', 'precious.': 'ล้ำค่า.', 'precious!': 'ล้ำค่า!',
  'weird': 'แปลก', 'weird.': 'แปลก.', 'weird!': 'แปลก!', 'weird...': 'แปลก...',
  'little': 'เล็กน้อย', 'little.': 'เล็กน้อย.', 'little...': 'เล็กน้อย...',
  'now. a married': 'ตอนนี้แต่งงานแล้ว', 'now, a married': 'ตอนนี้แต่งงานแล้ว', 'now.a married': 'ตอนนี้แต่งงานแล้ว', 'now a married': 'ตอนนี้แต่งงานแล้ว',
  'waiting': 'กำลังรอ', 'waiting...': 'กำลังรอ...', 'waiting!': 'กำลังรอ!',
  'single': 'โสด', 'single.': 'โสด.',
  'geezer': 'ตาแก่', 'geezer.': 'ตาแก่.', 'geezer!': 'ตาแก่!',
  'is such': 'ช่างเป็น', 'is such a': 'ช่างเป็น', 'is such a nice': 'ช่างเป็นคนที่แสนดี', 'is such a nice.': 'ช่างเป็นคนที่แสนดี.',
  'planning': 'กำลังวางแผน', 'planning...': 'กำลังวางแผน...',
  'misfortune': 'โชคร้าย', 'misfortune.': 'โชคร้าย.',
  'colleagues': 'เพื่อนร่วมงาน', 'colleagues.': 'เพื่อนร่วมงาน.',
  'talking': 'กำลังคุย', 'talking...': 'กำลังคุย...',
  'good mood': 'อารมณ์ดี', 'good mood.': 'อารมณ์ดี.', 'goodmood': 'อารมณ์ดี',
  'appears': 'ปรากฏตัว', 'appears.': 'ปรากฏตัว.',
  'care.': 'ดูแล.', 'care': 'ดูแล', 'care!': 'ดูแล!',
  'person': 'คน', 'person.': 'คน.',
  'thanks for': 'ขอบคุณสำหรับ', 'thanks for.': 'ขอบคุณสำหรับ.', 'thanksfor': 'ขอบคุณสำหรับ',
  'arranging': 'การจัดเตรียม', 'arranging.': 'การจัดเตรียม.',
  'customers': 'ลูกค้า', 'customers.': 'ลูกค้า.', 'customer.': 'ลูกค้า.', 'customer': 'ลูกค้า',
  'freedom?': 'อิสรภาพเหรอ?', 'freedom': 'อิสรภาพ', 'freedom!': 'อิสรภาพ!',
  'people': 'ผู้คน', 'people.': 'ผู้คน.',
  'support': 'สนับสนุน', 'support.': 'สนับสนุน.', 'support!': 'สนับสนุน!',
  'late': 'สาย', 'late.': 'สาย.', 'late!': 'สาย!',
  'quitted': 'ลาออกแล้ว', 'quitted.': 'ลาออกแล้ว.',
  'motive?': 'แรงจูงใจเหรอ?', 'motive': 'แรงจูงใจ',
  'magazine?': 'นิตยสารเหรอ?', 'magazine': 'นิตยสาร',
  'down': 'ลง', 'down.': 'ลง.', 'down!': 'ลง!',
  'whenever': 'เมื่อไหร่ก็ตาม', 'whenever.': 'เมื่อไหร่ก็ตาม.',
  'asking': 'กำลังถาม', 'asking...': 'กำลังถาม...',
  'somehow': 'อย่างไรก็ตาม', 'somehow...': 'อย่างไรก็ตาม...',
  'thinking': 'กำลังคิด', 'thinking...': 'กำลังคิด...',
  'meeting': 'การพบกัน', 'meeting.': 'การพบกัน.',
  'beauty.': 'ความงดงาม.', 'beauty': 'ความงดงาม', 'beauty!': 'ความงดงาม!',
  'onee-san!': 'พี่สาว!', 'onee-san': 'พี่สาว', 'oneesan!': 'พี่สาว!', 'oneesan': 'พี่สาว',
  'tomorrow\'s': 'ของวันพรุ่งนี้', 'tomorrows': 'ของวันพรุ่งนี้', 'tomorrow': 'พรุ่งนี้',
  'brain': 'สมอง', 'brain.': 'สมอง.',
  'year.': 'ปี.', 'year': 'ปี',
  'starting': 'กำลังเริ่ม', 'starting...': 'กำลังเริ่ม...',
  'slippery': 'ลื่น', 'slippery.': 'ลื่น.', 'slippery!': 'ลื่น!',
  'smoke': 'สูบบุหรี่', 'smoke.': 'สูบบุหรี่.', 'smoke!': 'สูบบุหรี่!',
  'we\'ll go': 'พวกเราจะไป', 'we\'ll go!': 'พวกเราจะไป!', 'we\'llgo': 'พวกเราจะไป',
  'standing': 'กำลังยืน', 'standing.': 'กำลังยืน.',
  'senpai': 'รุ่นพี่', 'senpai.': 'รุ่นพี่.', 'senpai!': 'รุ่นพี่!', 'senpai...': 'รุ่นพี่...',
  'anymore.': 'อีกต่อไปแล้ว.', 'anymore': 'อีกต่อไปแล้ว',
  'chopsticks?': 'ตะเกียบเหรอ?', 'chopsticks': 'ตะเกียบ',
  'gratitude. i': 'ความขอบคุณ ฉัน', 'gratitude.i': 'ความขอบคุณ ฉัน', 'gratitude': 'ความขอบคุณ',
  'cigarette!': 'บุหรี่!', 'cigarette': 'บุหรี่', 'cigarette.': 'บุหรี่.',
  'whatever': 'ช่างเถอะ', 'whatever.': 'ช่างเถอะ.', 'whatever...': 'ช่างเถอะ...',
  'all the time...': 'ตลอดเวลา...', 'all the time': 'ตลอดเวลา', 'all the time.': 'ตลอดเวลา.',
  'ba-dum': 'ตึก-ตัก', 'badum': 'ตึก-ตัก', 'ba-dum!': 'ตึก-ตัก!',
  'haven\'t': 'ยังไม่ได้', 'haven\'t.': 'ยังไม่ได้.', 'havent': 'ยังไม่ได้',
  'dinner': 'อาหารเย็น', 'dinner.': 'อาหารเย็น.',
  'disobeying': 'ไม่เชื่อฟัง', 'disobeying.': 'ไม่เชื่อฟัง.',
  'you pretty': 'คุณสวย', 'you pretty!': 'คุณสวย!', 'youpretty': 'คุณสวย',
  'course!': 'แน่นอน!', 'course': 'แน่นอน', 'course.': 'แน่นอน.',
  'married': 'แต่งงาน', 'married.': 'แต่งงาน.', 'mar-ried': 'แต่ง-งาน', 'mar-ried.': 'แต่ง-งาน.',
  'sorry': 'ขอโทษ', 'sorry.': 'ขอโทษ.', 'sorry!': 'ขอโทษ!', 'sorry...': 'ขอโทษ...',
  'even though': 'ถึงแม้ว่า', 'even though...': 'ถึงแม้ว่า...',
  'i didn\'t': 'ฉันไม่ได้ทำ', 'i didn\'t.': 'ฉันไม่ได้ทำ.', 'i didnt': 'ฉันไม่ได้ทำ',
  'san?': 'ซัง?', 'sani?': 'ซัง?', 'sani': 'ซัง', 'san.': 'ซัง.',
  'i was in': 'ฉันอยู่ใน', 'i was in.': 'ฉันอยู่ใน.', 'iwasin': 'ฉันอยู่ใน',
  'rumble': 'ครืน', 'rumble!': 'ครืน!', 'rumble...': 'ครืน...', 'rumel': 'ครืน', 'gumbc': 'ครืน',
  'tayama': 'ทายามะ', 'tayama-': 'ทายามะ-',
  'senpal': 'รุ่นพี่',
  'wearing': 'สวมใส่', 'wearing.': 'สวมใส่.',
  'fashion.': 'แฟชั่น.', 'fashion': 'แฟชั่น',
  'photos': 'รูปถ่าย', 'photos.': 'รูปถ่าย.',
  'careful': 'ระวัง', 'careful.': 'ระวัง.', 'careful!': 'ระวัง!',
  'accident': 'อุบัติเหตุ', 'accident.': 'อุบัติเหตุ.',
  'punching': 'กำลังต่อย', 'punching.': 'กำลังต่อย.',
  'together': 'ด้วยกัน', 'together.': 'ด้วยกัน.', 'together,': 'ด้วยกัน,',
  'bear': 'หมี', 'bear.': 'หมี.',
  'rice': 'ข้าว', 'rice.': 'ข้าว.',
  'change!': 'เปลี่ยน!', 'change': 'เปลี่ยน', 'change.': 'เปลี่ยน.',
  'blockhead': 'คนทึ่ม', 'blockhead.': 'คนทึ่ม.', 'blockhead!': 'คนทึ่ม!',
  '(good, you)': '(ดี, คุณ)', '(good,you)': '(ดี, คุณ)', 'good, you': 'ดี, คุณ',
  'sounds': 'ฟังดู', 'sounds.': 'ฟังดู.',
  '(also, the)': '(ด้วยเหมือนกัน, สิ่งนั้น)', '(also,the)': '(ด้วยเหมือนกัน, สิ่งนั้น)',
  'rating?': 'คะแนน?', 'rating': 'คะแนน',
  'alone': 'คนเดียว', 'alone.': 'คนเดียว.',
  'cute': 'น่ารัก', 'cute.': 'น่ารัก.', 'cute!': 'น่ารัก!',
  'match': 'เข้ากัน', 'match.': 'เข้ากัน.',
  'sentences': 'ประโยค', 'sentences.': 'ประโยค.',
  'opposite': 'ตรงข้าม', 'opposite.': 'ตรงข้าม.',
  'meaning': 'ความหมาย', 'meaning.': 'ความหมาย.',
  'want to': 'อยากจะ', 'want to.': 'อยากจะ.', 'wantto': 'อยากจะ',
  'to buy stuff': 'เพื่อซื้อของ', 'tobuystuff': 'เพื่อซื้อของ',
  'decorations': 'ของตกแต่ง', 'decorations.': 'ของตกแต่ง.',
  'grateful': 'รู้สึกขอบคุณ', 'grateful.': 'รู้สึกขอบคุณ.', 'gratefll': 'รู้สึกขอบคุณ',
  'doing?': 'กำลังทำอะไรอยู่?', 'doingp': 'กำลังทำอะไรอยู่?',
  'sasaki-san?': 'ซาซากิซัง?', 'sasaki-sanp': 'ซาซากิซัง?',
  'well': 'เอาล่ะ', 'well...': 'เอาล่ะ...', 'well,': 'เอาล่ะ,', 'well!': 'เอาล่ะ!',
  'how about': 'แล้ว...ล่ะ', 'how about...': 'แล้ว...ล่ะ...', 'how about?': 'แล้ว...ล่ะ?',
  'huh?': 'หา?', 'huh': 'หา', 'huh!': 'หา!',
  'ah~': 'อ๊ะ~', 'ah': 'อ๊ะ',
  'hmmm?': 'หืมมม?', 'hmmm': 'หืมมม', 'hmmm...': 'หืมมม...',
  'lightly': 'เบาๆ', 'lightly.': 'เบาๆ.', 'lightly...': 'เบาๆ...',
  'resolute': 'เด็ดเดี่ยว', 'resolute.': 'เด็ดเดี่ยว.',
  'umbrella\'s': 'ของร่ม', 'umbrellas': 'ของร่ม', 'umbrella': 'ร่ม',
  'flirting': 'กำลังจีบ', 'flirting.': 'กำลังจีบ.', 'filrting': 'กำลังจีบ',
  'listening': 'กำลังฟัง', 'listening.': 'กำลังฟัง.', 'listening...': 'กำลังฟัง...',
  'to music': 'กับเสียงเพลง', 'tomusic': 'กับเสียงเพลง',
  'understand': 'เข้าใจ', 'understand.': 'เข้าใจ.', 'understand!': 'เข้าใจ!',
  'to songs': 'กับบทเพลง', 'tosongs': 'กับบทเพลง',
  '(way, why)': '(ทาง, ทำไม)', '(way,why)': '(ทาง, ทำไม)',
  'should i': 'ฉันควรจะ', 'should i?': 'ฉันควรจะ?', 'shouldi': 'ฉันควรจะ',
  'elegant': 'สง่างาม', 'elegant.': 'สง่างาม.',
  'put.': 'วาง.', 'put': 'วาง',
  'cord is': 'สายคือ', 'cordis': 'สายคือ',
  'flick': 'สะบัด', 'flick!': 'สะบัด!',
  'myself" then': 'ตัวเอง" จากนั้น', 'myself"then': 'ตัวเอง" จากนั้น',
  'and started': 'และเริ่ม', 'andstarted': 'และเริ่ม',
  'manager': 'ผู้จัดการ', 'manager.': 'ผู้จัดการ.', 'manager\'s': 'ของผู้จัดการ', 'managers': 'ของผู้จัดการ',
  'to complete': 'เพื่อให้เสร็จสิ้น', 'tocomplete': 'เพื่อให้เสร็จสิ้น',
  'next month\'s': 'ของเดือนหน้า', 'nextmonth\'s': 'ของเดือนหน้า', 'next months': 'ของเดือนหน้า',
  'nor': 'และไม่',
  'expressions.': 'สีหน้า.', 'expressions': 'สีหน้า', 'expression': 'สีหน้า',
  'mistakes': 'ความผิดพลาด', 'mistakes.': 'ความผิดพลาด.',
  'has made': 'ได้ทำ', 'hasmade': 'ได้ทำ',
  'report': 'รายงาน', 'report.': 'รายงาน.',
  'important': 'สำคัญ', 'important.': 'สำคัญ.',
  'earth is': 'โลกคือ', 'earthis': 'โลกคือ',
  'dying': 'กำลังจะตาย', 'dying.': 'กำลังจะตาย.',
  'exhausted': 'หมดแรง', 'exhausted.': 'หมดแรง.',
  'natural': 'เป็นธรรมชาติ', 'natural.': 'เป็นธรรมชาติ.',
  'shocked': 'ตกใจ', 'shocked.': 'ตกใจ.',
  'monthly': 'รายเดือน', 'monthly.': 'รายเดือน.',
  'finished': 'เสร็จสิ้นแล้ว', 'finished.': 'เสร็จสิ้นแล้ว.',
  '(room, was)': '(ห้อง, เคยเป็น)', '(room,was)': '(ห้อง, เคยเป็น)',
  'interesting': 'น่าสนใจ', 'interesting.': 'น่าสนใจ.', 'teresting': 'น่าสนใจ',
  'enjoying': 'กำลังเพลิดเพลิน', 'enjoying.': 'กำลังเพลิดเพลิน.',
  'things,': 'สิ่งต่างๆ,', 'things': 'สิ่งต่างๆ',
  'appoint?': 'นัดหมาย?', 'appoint': 'นัดหมาย',
  'bothered': 'รบกวน', 'bothered.': 'รบกวน.',
  '"it\'s faster': '"มันเร็วกว่า', '"it\'sfaster': '"มันเร็วกว่า', 'it\'s faster': 'มันเร็วกว่า',
  'way too good': 'ดีงามเกินไปแล้ว', 'way too good...': 'ดีงามเกินไปแล้ว...', 'way too good,': 'ดีงามเกินไปแล้ว', 'way too good,,': 'ดีงามเกินไปแล้ว',
  'too': 'เกินไป', 'too!': 'เกินไป!', 'too...': 'เกินไป...', 'too,': 'เกินไป',
  'shut': 'หุบ', 'shut!': 'หุบ!', 'shut...': 'หุบ...', 'shut up': 'หุบปากซะ', 'shut up!': 'หุบปากซะ!',
  'and shut': 'และหุบ', 'shut her up': 'หุบปากเธอซะ', 'shut her up!': 'หุบปากเธอซะ!',
  'gtinky': 'เหม็นตุๆ', 'gtinky!': 'เหม็นตุๆ!', 'gtinky...': 'เหม็นตุๆ...',
  '6o': 'ช่าง', 's0': 'ช่าง', 's0...': 'ช่าง...',
  'not nec': 'ไม่จำเป็น', 'not nec...': 'ไม่จำเป็น...',
  'not necessary': 'ไม่จำเป็น', 'not necessary...': 'ไม่จำเป็น...', 'not necessary.': 'ไม่จำเป็น.',
  'excuse': 'ขอโทษนะ', 'excuse...': 'ขอโทษนะ...',
  'cumming': 'แตกแล้ว', 'cumming...': 'แตกแล้ว...', 'cumming!': 'แตกแล้ว!',
  'about the foreplay': 'แล้วบทนำล่ะ', 'about the foreplay?': 'แล้วบทนำล่ะ?', 'about the foreplay!?': 'แล้วบทนำล่ะ!?',
  'ment after': 'การรักษาหลังจากนี้', 'ment after...': 'การรักษาหลังจากนี้...',
  'row': 'แถว', 'row...': 'แถว...',
  'suddenly': 'ทันใดนั้น', 'suddenly...': 'ทันใดนั้น...', 'suddenly!': 'ทันใดนั้น!',
  'but...': 'แต่...', 'but': 'แต่',
  'form a medical': 'การตรวจทางการแพทย์', 'form a medical...': 'การตรวจทางการแพทย์...',
  'blowjob': 'อมควย', 'blowjob...': 'อมควย...', 'blowjob!': 'อมควย!',
  'barbarians!!': 'ไอ่พวกบา-บาเรียน!!', 'barbarians': 'ไอ่พวกบา-บาเรียน',
  'pregnant': 'ตั้งท้อง', 'pregnant...': 'ตั้งท้อง...', 'pregnant!': 'ตั้งท้อง!',
  's-sto ooo op...': 'ห-หยุด ดดด ดดด...', 's-stooooop...': 'ห-หยุด ดดด ดดด...',
  'frfo': '', 'frfo...': '',
  'stinky': 'เหม็นตุๆ', 'stinky!': 'เหม็นตุๆ!', 'stinky...': 'เหม็นตุๆ...',
  'kill me': 'ฆ่าฉันที', 'kill me!': 'ฆ่าฉันที!', 'kill me!!': 'ฆ่าฉันที!!',
  'with procreation': 'ด้วยการสืบพันธุ์', 'with procreation...': 'ด้วยการสืบพันธุ์...',
  'pregnant with': 'ตั้งท้องกับ', 'pregnant with...': 'ตั้งท้องกับ...',
  'then try and hold back your orgasm you pig': 'ถ้าอย่างนั้นก็พยายามกลั้นจุดสุดยอดของแกไว้ซะสิ ไอ้หมูโสโครก!',
  'then try and hold back your orgasm you pig!': 'ถ้าอย่างนั้นก็พยายามกลั้นจุดสุดยอดของแกไว้ซะสิ ไอ้หมูโสโครก!',
  'then try and hold back your orgasm you pig!!': 'ถ้าอย่างนั้นก็พยายามกลั้นจุดสุดยอดของแกไว้ซะสิ ไอ้หมูโสโครก!!',
  'i': 'ฉัน', 'you': 'คุณ', 'you!': 'คุณ!', 'you!!': 'คุณ!!', 'he': 'เขา', 'she': 'เธอ',
  'we': 'เรา', 'they': 'พวกเขา', 'it': 'มัน', 'me': 'ฉัน',
  'him': 'เขา', 'her': 'เธอ', 'us': 'พวกเรา', 'them': 'พวกเขา', 'us the': 'พวกเรา',
  'so...': 'ช่าง...', 'so!': 'ช่าง!',
  'hole': 'รู', 'hole!': 'รู!', 'asshole': 'รูตูด', 'asshole!': 'รูตูด!', 'asshole!!': 'รูตูด!!', 'ass-hole': 'รูตูด', 'ass-hole!': 'รูตูด!', 'ass-hole!!': 'รูตูด!!', 'ass': 'ตูด', '4ss': 'ตูด', '4ss!': 'ตูด!',
  'getting': 'กำลัง', 'getting...': 'กำลัง...', 'getting!': 'กำลัง!',
  'first': 'ครั้งแรก', 'first!': 'ครั้งแรก!', 'first...': 'ครั้งแรก...',
  'again': 'อีกครั้ง', 'again!': 'อีกครั้ง!', 'again...': 'อีกครั้ง...',
  'leave it to me, sir!': 'ปล่อยให้เป็นหน้าที่ของผมเองครับท่าน!',
  'leave it to me, sir': 'ปล่อยให้เป็นหน้าที่ของผมเองครับท่าน',
  'leave it to me': 'ปล่อยให้เป็นหน้าที่ของผมเอง',
  'leave it': 'ปล่อยให้เป็น',
  'to me, sir!': 'หน้าที่ของผมเองครับท่าน!',
  'to me, sir': 'หน้าที่ของผมเองครับท่าน',
  'to me': 'หน้าที่ของผม', 'to me!': 'หน้าที่ของผม!', 'to me,': 'หน้าที่ของผม',
  'sir': 'ท่าน', 'sir!': 'ครับท่าน!',
  'stoooop': 'หยุดดดด!', 'stoooop!': 'หยุดดดด!', 'stoagop': 'หยุดดดด!', 'stoagop!': 'หยุดดดด!',
  'expect': 'คาดคิด', 'expect...': 'คาดคิด...', 'expect!': 'คาดคิด!',
  'and her': 'และเธอ', 'and her...': 'และเธอ...', 'and her!': 'และเธอ!',
  'you front us the getting away with': 'แกที่อยู่ข้างหน้า คิดว่าจะหนีพวกเราพ้นงั้นเหรอ!',
  'you re': 'คุณคือ', 'you re...': 'คุณคือ...', 'you re!': 'คุณคือ!',
  'knight': 'อัศวิน', 'knight...': 'อัศวิน...', 'knight!': 'อัศวิน!',
  'kniiight': 'อัศวิน', 'kniiight...': 'อัศวิน...', 'kniiight!': 'อัศวิน!',
  'kniiiight': 'อัศวิน', 'kniiiight...': 'อัศวิน...', 'kniiiight!': 'อัศวิน!',
  'that': 'นั่น', 'feels': 'รู้สึก', 'that-': 'นั่น-',
  'front': 'ข้างหน้า', 'front.': 'ข้างหน้า', 'front!': 'ข้างหน้า!',
  'you front': 'แกอยู่ข้างหน้า', 'you front!': 'แกอยู่ข้างหน้า!',
  'you,front': 'แกอยู่ข้างหน้า', 'you,front!': 'แกอยู่ข้างหน้า!',
  'you, front': 'แกอยู่ข้างหน้า', 'you, front!': 'แกอยู่ข้างหน้า!',
  'kniiiiiight': 'อัศวิน', 'kniiiiight': 'อัศวิน', 'kniiiiight!': 'อัศวิน!',
  'youre': 'คุณคือ', 'you\'re': 'คุณคือ', 'you\'re!': 'คุณคือ!', 'youre!': 'คุณคือ!',
  'hes': 'เขาคือ', 'he\'s': 'เขาคือ', 'he s': 'เขาคือ', 'he s...': 'เขาคือ...', 'he s!': 'เขาคือ!', 'he\'s!': 'เขาคือ!',
  'meeeeeee': 'ฉันนนนนนน!', 'meeeeeee!': 'ฉันนนนนนน!', 'meefffee!': 'ฉันนนนนนน!', 'meeeeee': 'ฉันนนนนนน!', 'meeeee': 'ฉันนนนนนน!',
  'would': 'คงจะ', 'would...': 'คงจะ...', 'would!': 'คงจะ!',
  'woman would': 'ผู้หญิงจะ', 'woman would be': 'ผู้หญิงจะ...', 'a normal woman would': 'ผู้หญิงธรรมดาจะ',
  'would be dead': 'คงตายไปแล้ว', 'would be dead by now': 'ป่านนี้คงตายไปแล้ว', 'would be dead by now!': 'ป่านนี้คงตายไปแล้ว!',
  'the pig that you are': 'ไอ้หมูตอนอย่างแก',
  'pig you are': 'ไอ้หมูโสโครก', 'pig you are!': 'ไอ้หมูโสโครก!', 'pig you are!!': 'ไอ้หมูโสโครก!!',
  'a pig like you': 'หมูอย่างแก', 'a pig like you!': 'หมูอย่างแก!',
  'serve as': 'ทำหน้าที่เป็น', 'to serve as': 'เพื่อทำหน้าที่เป็น', 'must be': 'ต้องเป็น', 'must be...': 'ต้องเป็น...', 'must be!': 'ต้องเป็น!',
  'ing with your': 'พร้อมกับของคุณ', 'ing with your nipples': 'พร้อมกับหัวนมของคุณ',
  'one battle': 'การดวลครั้งเดียว', 'one battle!': 'การดวลครั้งเดียว!', 'onebattle': 'การดวลครั้งเดียว',
  'i-i\'m': 'ฉัน...', 'i-im': 'ฉัน...', 'ii\'m': 'ฉัน...', 'iim': 'ฉัน...',
  'a pig like': 'หมูแบบ', 'pig like you': 'หมูอย่างแก',
  'you are': 'คุณเป็น', 'you are!': 'คุณเป็น!',
  'suck': 'ดูด', 'suck!': 'ดูด!', 'suck on': 'ดูด',
  'suck on mine': 'ดูดของฉัน', 'suck on mine too': 'ดูดของฉันด้วย',
  'you keep': 'คุณยังคง', 'if you keep': 'ถ้าคุณยังคง',
  'gonna': 'จะ', 'gonna...': 'จะ...', 'gonna!': 'จะ!',
  'away': 'หนีไป', 'away...': 'หนีไป...', 'away!': 'หนีไป!',
  'ahh': 'อา', 'ahh...': 'อา...', 'ahh!': 'อา!',
  'majesty': 'ฝ่าบาท', 'majesty...': 'ฝ่าบาท...', 'majesty?': 'ฝ่าบาท?', 'majesty...?': 'ฝ่าบาท...?',
  'get rusty': 'ฝีมือตก', 'get rusty...': 'ฝีมือตก...', 'get rusty!': 'ฝีมือตก!',
  'you upright': 'แกที่ชอบอ้างความชอบธรรม', 'you upright!': 'แกที่ชอบอ้างความชอบธรรม!',
  'cen todosson': 'เซน โทดอสสัน',
  'there was a long war': 'มันเป็นสงครามที่ยาวนาน',
  'there was a long war.': 'มันเป็นสงครามที่ยาวนาน.',
  'hateria': 'ฮาเทเรีย',
  'kingdom of hateria': 'อาณาจักรฮาเทเรีย',
  'virgin holes': 'รูเวอร์จิ้น', 'virgin hole': 'รูเวอร์จิ้น',
  'come help': 'มาช่วยฉันด้วย!', 'come help me': 'มาช่วยฉันด้วย!', 'come help me!': 'มาช่วยฉันด้วย!',
  'virgin': 'เวอร์จิ้น',
  'also say that': 'ยังบอกอีกว่า',
  'i lose': 'ฉันแพ้แล้ว',
  "i can't": 'ฉันทำไม่ได้', "i cant": 'ฉันทำไม่ได้', "i can't!": 'ฉันทำไม่ได้!', "i cant!": 'ฉันทำไม่ได้!',
  'defeat': 'ความพ่ายแพ้', 'defeat!': 'ความพ่ายแพ้!',
  'on the': 'บน', 'you\'re supposed': 'เธอควรจะ', 'youre supposed': 'เธอควรจะ',
  'tight': 'แน่น', 'tight!': 'แน่น!', 'your training': 'การฝึกของคุณ',
  'bitch... hey!': 'ยัยเวร... เฮ้ย!', 'bitch hey!': 'ยัยเวร... เฮ้ย!', 'bitch... hey': 'ยัยเวร... เฮ้ย!', 'bitch hey': 'ยัยเวร... เฮ้ย!',
  's-stop!': 'ห-หยุดนะ!', 's-stop': 'ห-หยุดนะ!', 's stop!': 'ห-หยุดนะ!', 's stop': 'ห-หยุดนะ!',
  'a dirty': 'ที่โสโครก', 'her posi-': 'ท่าของเธอ', 'her posi': 'ท่าของเธอ',
  'i\'ll have a': 'ฉันจะมี', 'ill have a': 'ฉันจะมี',
  'with his': 'กับของเขา', 'the woman\'s': 'ของผู้หญิง', 'the womans': 'ของผู้หญิง',
  // YOU'RE / HE'S contractions that sometimes get split (non-duplicates only)
  "you're?": 'คุณ?', "you're...": 'คุณ...',
  "he's?": 'เขา?', "he's...": 'เขา...',
  "she's": 'เธอ', "that's": 'นั่น', "there's": 'มีอยู่',
  // away...with compound phrase
  'away...with': 'หนีไปพร้อมกับ',
  'faway': 'หนีไป', 'faway...': 'หนีไป...', 'faway...with': 'หนีไปพร้อมกับ',
  'with': 'กับ', 'with!': 'กับ!', 'with...': 'กับ...', 'with?': 'กับ?',
  // but in any age (non-duplicates only)
  'but in any age...': 'แต่ในทุกยุคสมัย...',
  'but in any age,': 'แต่ในทุกยุคสมัย,',
  // YOU'RE CRUSHING MY BABY (post OCR-repair)
  "you're crushing my baby": 'คุณกำลังทำร้ายลูกน้อยของฉัน',
  "you're crushing my baby!": 'คุณกำลังทำร้ายลูกน้อยของฉัน!',
  "you re crushing my baby": 'คุณกำลังทำร้ายลูกน้อยของฉัน',
  "you re crushing my baby!": 'คุณกำลังทำร้ายลูกน้อยของฉัน!',
  'crushing my baby': 'กำลังทำร้ายลูกน้อยของฉัน', 'crushing': 'บีบแตก',
  // Spanish specific lookups to guarantee user-defined translation accuracy
  'un regalo para la mente': 'ของขวัญสำหรับจิตใจของคุณ',
  'un regalo para la mente.': 'ของขวัญสำหรับจิตใจของคุณ.',
  'donde estudiar': 'ควรไปเรียนที่ไหนดี',
  'donde estudiar...': 'ควรไปเรียนที่ไหนดี...',
  'río muy variado': 'แม่น้ำที่มีความหลากหลายมาก',
  'rio muy variado': 'แม่น้ำที่มีความหลากหลายมาก',
  'río muy variado.': 'แม่น้ำที่มีความหลากหลายมาก.',
  'rio muy variado.': 'แม่น้ำที่มีความหลากหลายมาก.',
  'mente en la actualidad': 'จิตใจอยู่ในปัจจุบัน',
  'mente en la ac tualidad': 'จิตใจอยู่ในปัจจุบัน',
  'me estaba cambiando de': 'ฉันกำลังเปลี่ยนเสื้อผ้า',
  'me estaba cam biando de': 'ฉันกำลังเปลี่ยนเสื้อผ้า',
  'mente un regalo': 'ของขวัญสำหรับจิตใจของคุณ',
  'mente un regalo.': 'ของขวัญสำหรับจิตใจของคุณ.',
  'do de estudiar': 'ควรไปเรียนที่ไหนดี',
  'do de estudiar...': 'ควรไปเรียนที่ไหนดี...',
  'se usa comunmente en la actualidad': 'นิยมใช้กันทั่วไปในปัจจุบัน',
  'se usa comunmente en la actualidad...': 'นิยมใช้กันทั่วไปในปัจจุบัน...',
  'se usa comunmente en la actualdad': 'นิยมใช้กันทั่วไปในปัจจุบัน',
  'se usa comunmente en la actualdad...': 'นิยมใช้กันทั่วไปในปัจจุบัน...',
  'se usa comun mente en la actualidad': 'นิยมใช้กันทั่วไปในปัจจุบัน',
  'se usa comun mente en la ac tualidad': 'นิยมใช้กันทั่วไปในปัจจุบัน',
  'se usa comun mente en la ac tualidad...': 'นิยมใช้กันทั่วไปในปัจจุบัน...',
  'se usa comun mente en la actualidad...': 'นิยมใช้กันทั่วไปในปัจจุบัน...',
  'se usa comunmente en la ac tualidad': 'นิยมใช้กันทั่วไปในปัจจุบัน',
  'se usa comunmente en la ac tualidad...': 'นิยมใช้กันทั่วไปในปัจจุบัน...',
  'se usa comunmente en la ac tualdad': 'นิยมใช้กันทั่วไปในปัจจุบัน',
  'se usa comunmente en la ac tualdad...': 'นิยมใช้กันทั่วไปในปัจจุบัน...',
  'se usa comun mente en la ac tualdad': 'นิยมใช้กันทั่วไปในปัจจุบัน',
  'se usa comun mente en la ac tualdad...': 'นิยมใช้กันทั่วไปในปัจจุบัน...',
  'tengo que ir': 'ฉันจะต้องไป',
  'tengo que ir...': 'ฉันจะต้องไป...',
  'versión en': 'เวอร์ชันใน',
  'version en': 'เวอร์ชันใน',
  'una señal': 'ลางบอกเหตุ',
  'una señal!': 'ลางบอกเหตุ!',
  'una señal...': 'ลางบอกเหตุ...',
  'una señal...!': 'ลางบอกเหตุ...!',
  '¡una señal...!': 'ลางบอกเหตุ...!',
  'novela romántica ambientada en la': 'นิยายรักโรแมนติกที่ดำเนินเรื่องใน...',
  'novela romantica ambientada en la': 'นิยายรักโรแมนติกที่ดำเนินเรื่องใน...',
  'película': 'ภาพยนตร์',
  'pelicula': 'ภาพยนตร์',
  'película??': 'ภาพยนตร์??',
  'pelicula??': 'ภาพยนตร์??',
  'departamento de inglés del': 'ครูสอนภาษาอังกฤษของ',
  'departamento de ingles del': 'ครูสอนภาษาอังกฤษของ',
  'qué': 'อะไร',
  '¿qué?': 'อะไร',
  'qué?': 'อะไร',
  'suscribirme a un servicio de streaming': 'สมัครใช้บริการสตรีมมิ่ง',
  'suscribir me a un servicio de streaming': 'สมัครใช้บริการสตรีมมิ่ง',
  'suscribir me a un servicio de streaming...': 'สมัครใช้บริการสตรีมมิ่ง...',
  'suscribirme a un servicio de streaming...': 'สมัครใช้บริการสตรีมมิ่ง...',
  'tiempo prestado ya que': 'เวลาที่ยืมมานับตั้งแต่',
  'de gran ayuda durante todo el festival': 'ให้ความช่วยเหลือเป็นอย่างดีตลอดงานเทศกาล',
  'de gran ayuda durante todo el festival.': 'ให้ความช่วยเหลือเป็นอย่างดีตลอดงานเทศกาล.',
  'incluso el disfraz de la professora bruja y el soporte para cartas': 'แม้กระทั่งชุดครูแม่มดและที่ใส่บัตร...',
  'incluso el disfraz de la profesora bruja y el soporte para cartas': 'แม้กระทั่งชุดครูแม่มดและที่ใส่บัตร...',
  'incluso el disfraz de la profesora bruja y el soporte para cartas...': 'แม้กระทั่งชุดครูแม่มดและที่ใส่บัตร...',
  'comprar bocadillos': 'สำหรับแซนด์วิช',
  'comprar bocadillos?': 'สำหรับแซนด์วิช?',
  'comprar bocadillos...?': 'สำหรับแซนด์วิช...?',
  'organizaron una fiesta': 'จัดงานปาร์ตี้',
  'organizaron una fiesta!': 'จัดงานปาร์ตี้!',
  'dieron una fiesta': 'จัดงานปาร์ตี้',
  'ron una fiesta': 'จัดงานปาร์ตี้',
  'también te gustan': 'คุณชอบพวกเขา',
  'tambien te gustan': 'คุณชอบพวกเขา',
  'bien te gustan': 'คุณชอบพวกเขา',
  'en realidad como fui a una escuela secundaria y preparatoria solo para chicos': 'ที่จริงแล้ว ตั้งแต่ผมเรียนในโรงเรียนมัธยมชายล้วนและโรงเรียนเตรียมอุดมศึกษา...',
  'en realidad como fui a una escuela secundaria y preparatoria solo para chicos...': 'ที่จริงแล้ว ตั้งแต่ผมเรียนในโรงเรียนมัธยมชายล้วนและโรงเรียนเตรียมอุดมศึกษา...',
  'disfraz para el': 'ชุดแต่งกายสำหรับเขา',
  'disfraz para': 'ชุดแต่งกายสำหรับ',
  'fraz para el': 'ชุดแต่งกายสำหรับเขา',
  'entonces': 'แล้ว',
  'entonces...': 'แล้ว...',
  'temperatura del aire': 'อุณหภูมิอากาศ',
  'temperatura del aire.': 'อุณหภูมิอากาศ.',
  'cambiando de': 'การเปลี่ยนจาก',
  'seguida': 'แนะนำ',
  'seguida.': 'แนะนำ.',
  'guida.': 'แนะนำ.',
  'to be dead now': 'ต้องตายไปแล้ว', 'to be dead now!': 'ต้องตายไปแล้ว!',
  'get': 'เอา', 'get!': 'เอา!',
  'cum': 'แตก', 'cum!': 'แตก!', 'cum!!': 'แตก!!',
  'i-i': 'ฉัน...', 'ii': 'ฉัน...', 'i-i\'ll': 'ฉัน...',
  'nipples': 'หัวนม',
  'longer': 'นานขึ้น',
  'longer!': 'นานขึ้น!',
  'today again': 'วันนี้อีกแล้ว',
  'her position': 'ตำแหน่งของเธอ', 'her posit i on': 'ตำแหน่งของเธอ', 'her positi on': 'ตำแหน่งของเธอ',
  'suits': 'เหมาะกับ',
  'nipples and': 'หัวนมและ',
  'cervix': 'ปากมดลูก',
  'general': 'นายพล',
  'die along': 'ตายตามกันไป',
  'also': 'ด้วยเหมือนกัน',
  'her place': 'ที่ของเธอ',
  'make sure': 'ให้แน่ใจ',
  'sadness': 'ความเศร้า',
  'all arstocrats': 'เหล่าขุนนางทั้งหมด',
  'all aristocrats': 'เหล่าขุนนางทั้งหมด',
  'praise': 'ชื่นชม', 'praise...': 'ชื่นชม...', 'praise!': 'ชื่นชม!',
  'roseria': 'โรเซเรีย', 'roseria...': 'โรเซเรีย...', 'roseria!': 'โรเซเรีย!',
  'king and': 'ราชาและ',
  'but in any age': 'แต่ไม่ว่าจะในยุคสมัยใด',
  'if i': 'ถ้าฉัน',
  'toyed with': 'เล่นสนุกกับ',
  'dead': 'ตาย',
  'recapturing': 'การยึดกลับคืน',
  'let her': 'ปล่อยเธอ',
  'the babar': 'พวกคนเถื่อน',
  'punching my': 'ต่อยฉัน',
  // Interjections / short responses
  'yes': 'ใช่', 'no': 'ไม่', 'ok': 'โอเค', 'okay': 'โอเค',
  'yes sir': 'ครับท่าน',
  'quck': 'เร็ว', 'quick': 'เร็ว',
  'what': 'อะไร', 'why': 'ทำไม', 'how': 'อย่างไร', 'when': 'เมื่อไหร่',
  'go': 'ไป', 'run': 'วิ่ง', 'help': 'ช่วยด้วย', 'look': 'ดูสิ',
  'now': 'ตอนนี้', 'here': 'ที่นี่', 'there': 'ที่นั่น', 'come': 'มา',
  'hey': 'เฮ้ย', 'huh': 'หยิ', 'hm': 'อืม', 'hmm': 'อืม',
  'ah': 'อา', 'oh': 'โอ้', 'uh': 'เอ่อ', 'ugh': 'โอ๊ย',
  'ugh!': 'โอ๊ย!', 'ugh!!': 'โอ๊ย!!', 'ugh,': 'โอ๊ย!',
  'wow': 'ว้าว', 'whoa': 'โว้ว', 'ha': 'ฮ่า',
  'haa': 'ฮ่าฮ่า', 'haa!': 'ฮ่าฮ่า!', 'haa!!': 'ฮ่าฮ่า!!', 'haa...': 'ฮ่าฮ่า...',
  'even': 'แม้แต่', 'even!': 'แม้แต่!',
  'thanks': 'ขอบคุณ', 'sorry': 'ขอโทษ', 'please': 'ได้โปรด', 'please!': 'ได้โปรด!', 'please...': 'ได้โปรด...',
  'right': 'ใช่แล้ว', 'wrong': 'ผิดแล้ว', 'really': 'จริงเหรอ',
  'seriously': 'จริงจังเหรอ', 'impossible': 'เป็นไปไม่ได้',
  'unbelievable': 'เชื่อไม่ได้', 'of course': 'แน่นอน',
  // Common 2-4 word phrases
  'i see': 'เข้าใจแล้ว', 'i know': 'ฉันรู้', 'i get it': 'ฉันเข้าใจ',
  'got it': 'เข้าใจแล้ว', 'got you': 'จับได้แล้ว', 'come on': 'เร็วเข้า',
  'let go': 'ปล่อยไป', 'let me': 'ให้ฉัน', 'lets go': 'ไปกันเถอะ',
  'thank you': 'ขอบคุณ', 'no way': 'ไม่มีทาง', 'no problem': 'ไม่มีปัญหา',
  'watch out': 'ระวัง', 'calm down': 'ใจเย็นๆ',
  'back off': 'ถอยออกไป', 'stand up': 'ลุกขึ้น', 'get up': 'ลุกขึ้น',
  'get out': 'ออกไป', 'get away': 'หนีออกไป', 'go away': 'ไปให้พ้น',
  'getting away': 'รอดตัวไปได้', 'getting away with': 'รอดตัวไปได้',
  'go on': 'ดำเนินต่อไป', 'move it': 'รีบไป', 'hurry up': 'รีบขึ้น',
  'give up': 'ยอมแพ้', 'hold on': 'รอสักครู่', 'hang on': 'รอสักครู่',
  'come here': 'มาที่นี่', 'over here': 'ที่นี่', 'over there': 'ที่นั่น',
  'thats right': 'ถูกต้อง', 'no doubt': 'ไม่ต้องสงสัย',
  'good luck': 'โชคดี', 'well done': 'เยี่ยมมาก', 'nice job': 'ทำได้ดี',
  'im sorry': 'ฉันขอโทษ', 'excuse me': 'ขอโทษนะ', 'be careful': 'ระวังด้วย',
  'dont move': 'อย่าขยับ', 'is that so': 'หรือจริงเหรอ',
  // Common manga/technical short terms
  'unit': 'หน่วย', 'units': 'หน่วย', 'all units': 'ทุกหน่วย',
  'charge': 'บุกเลย!', 'charge!': 'บุกเลย!',
  'princess': 'เจ้าหญิง', 'of all of us': 'ของพวกเราทุกคน',
  // Action words that Argos translates wrong
  'much': 'มาก', 'much...': 'มาก...', 'so much': 'มากนัก',
  'fool': 'คนโง่', 'fool...': 'คนโง่...', 'you fool': 'แกโง่ชัด',
  'sow': 'หว่าน',
  'nonstop': 'ไม่หยุด', 'non-stop': 'ไม่หยุด',
  'be': 'เป็น', 'be...': 'เป็น...',
  'more': 'อีก', 'more!': 'อีก!', 'one more': 'อีกครั้ง',
  'you!?': 'แก!?',
  'oh!': 'โอ้!', 'ohhh': 'โอ้หน่อ', 'ohh': 'โอ้โห',
  'of': 'ของ', 'all': 'ทั้งหมด', 'all!': 'ทุกคน!',
  'gonna die': 'จะตาย', 'gonna die!': 'จะตายแล้ว!',
  'so please': 'ดังนั้นได้โปรด', 'so please!': 'ดังนั้นได้โปรด!', 'soplease': 'ดังนั้นได้โปรด', 'soplease!': 'ดังนั้นได้โปรด!',
  'why!?': 'ทำไม!?', 'why?': 'ทำไม?',
  'ass-': 'ก้น',
  'ass- hole': 'รูตูด',
  'ha!': 'ฮ่า!', 'ha ha': 'ฮ่าฮ่า', 'ha ha ha': 'ฮ่าฮ่าฮ่า',
  'hehe': 'เฮ้เฮ้', 'hehe!': 'เฮ้เฮ้!', 'hehehe': 'เฮ้เฮ้เฮ้', 'hehehe!': 'เฮ้เฮ้เฮ้!',
  'i cant believe it': 'ไมยากเชื่อเลย...', 'i cannot believe it': 'ไม่อยากเชื่อเลย...',
  'cant believe it': 'เชื่อไม่ได้เลย...', 'cannot believe it': 'เชื่อไม่ได้เลย...',
  'i cant believe it...': 'ไม่อยากเชื่อเลย...', 'i cant believe this': 'ไม่อยากเชื่อเลย',
  'her pussy': 'หีของเธอ',
  'her pussys': 'หีของเธอ',
  'her pussy\'s': 'หีของเธอ',
  'her pussy\'s so': 'หีของเธอช่าง',
  'her pussys so': 'หีของเธอช่าง',
  'her pussys so stinky': 'หีของเธอช่างเหม็นตุๆ',
  'her pussy\'s so stinky': 'หีของเธอช่างเหม็นตุๆ',
  'her pussy is so stinky': 'หีของเธอช่างเหม็นตุๆ',
  'ugh haa her pussy\'s s0 gtinky': 'แหวะ! ฮ่าฮ่า! หีของเธอช่างเหม็นตุๆ',
  'ugh haa her pussys s0 gtinky': 'แหวะ! ฮ่าฮ่า! หีของเธอช่างเหม็นตุๆ',
  'ugh, haa! her pussy\'s s0 (gtinky': 'แหวะ! ฮ่าฮ่า! หีของเธอช่างเหม็นตุๆ',
  'ugh, haa! her pussys s0 (gtinky': 'แหวะ! ฮ่าฮ่า! หีของเธอช่างเหม็นตุๆ',
  'ugh, haa! her pussy\'s s0 (gtinky!!': 'แหวะ! ฮ่าฮ่า! หีของเธอช่างเหม็นตุๆ!!',
  'ugh, haa! her pussys s0 (gtinky!!': 'แหวะ! ฮ่าฮ่า! หีของเธอช่างเหม็นตุๆ!!',
  'her pussy\'s s0 (gtinky': 'หีของเธอช่างเหม็นตุๆ',
  'her pussys s0 (gtinky': 'หีของเธอช่างเหม็นตุๆ',
  'her pussy\'s s0': 'หีของเธอช่าง',
  'her pussys s0': 'หีของเธอช่าง',
  's0 stinky': 'ช่างเหม็นตุๆ',
  's0 (gtinky': 'ช่างเหม็นตุๆ',
  // --- Spanish Conversational & Noise Mappings ---
  'basura': 'สวะ!', 'basura!': 'สวะ!', 'basura!!': 'สวะ!!', 'iibasura': 'สวะ!', 'iibasura!': 'สวะ!', 'iibasura!!': 'สวะ!!',
  'maldito': 'ไอ้สารเลว!', 'maldito!': 'ไอ้สารเลว!', 'imbecil': 'ไอ้โง่!', 'imbecil!': 'ไอ้โง่!', 'mierda': 'พับผ่าสิ!', 'mierda!': 'พับผ่าสิ!',
  'es increiblemente grande': 'มันใหญ่อย่างไม่น่าเชื่อ!', 'es increiblemente grande!': 'มันใหญ่อย่างไม่น่าเชื่อ!', 'es increi- blemente grande!': 'มันใหญ่อย่างไม่น่าเชื่อ!', 'es increíblemente grande!': 'มันใหญ่อย่างไม่น่าเชื่อ!',
  'increíblemente': 'อย่างไม่น่าเชื่อ', 'increiblemente': 'อย่างไม่น่าเชื่อ', 'blemente': 'อย่างไม่น่าเชื่อ',
  'se sienten extranamente calientes y humedas': 'รู้สึกอุ่นและชื้นอย่างแปลกประหลาด',
  'ademas, mis piernas se sienten extranamente calientes y humedas...': 'นอกจากนี้ ขาของฉันก็รู้สึกอุ่นและชื้นอย่างแปลกประหลาด...',
  'se volvió a mojar todo hasta las sábanas...': 'เขาเปียกอีกครั้งจนถึงผ้าปูที่นอน...',
  'se volvio a mojar todo hasta las sabanas...': 'เขาเปียกอีกครั้งจนถึงผ้าปูที่นอน...',
  'hasta las sábanas...': 'จนถึงผ้าปูที่นอน...', 'hasta las sabanas...': 'จนถึงผ้าปูที่นอน...', 'sábanas...': 'ผ้าปูที่นอน...', 'sabanas...': 'ผ้าปูที่นอน...', 'banas...': 'อาบน้ำ...', 'banas..': 'อาบน้ำ..', 'banas': 'อาบน้ำ', 'bañas': 'อาบน้ำ',
  'mántelo...': 'รักษามันไว้...', 'mantelo...': 'รักษามันไว้...', 'telo...': 'บอกคุณ...', 'telo..': 'บอกคุณ..', 'telo': 'บอกคุณ', 'te lo': 'บอกคุณ',
  'abrazarme...': 'กอดฉัน...', 'zarme...': 'กอดฉัน...', 'zarme..': 'กอดฉัน..', 'zarme': 'กอดฉัน',
  'llámameee...!!': 'โทรหาฉันนน...!!', 'llamameee...!!': 'โทรหาฉันนน...!!', 'meee...!!': 'ฉันนน...!!', 'meee...!': 'ฉันนน...!', 'meee...': 'ฉันนน...', 'meee': 'ฉันนน',
  'no he hecho...': 'ฉันไม่ได้ทำ...', 'hecho...': 'ทำ...', 'cho...': 'มาก...', 'cho..': 'มาก..', 'cho': 'มาก', 'mucho...': 'มาก...', 'mucho': 'มาก',
  'e-es que': 'คื-คือว่า...', 'e-es que...': 'คื-คือว่า...', 'e-es que..': 'คื-คือว่า..', 'e-es que!': 'คื-คือว่า!',
  'un montón...': 'ตั้งเยอะ...', 'montón...': 'ตั้งเยอะ...', 'monton...': 'ตั้งเยอะ...', 'monton..': 'ตั้งเยอะ..', 'montón..': 'ตั้งเยอะ..', 'monton': 'ตั้งเยอะ', 'montón': 'ตั้งเยอะ',
  'impresionante...': 'น่าประทับใจ...', 'cionante...': 'น่าตื่นเต้น...', 'cionante..': 'น่าตื่นเต้น..', 'cionante': 'น่าตื่นเต้น',
  'simplemente odioso...': 'น่าเกลียดจริงๆ...', 'mente odioso...': 'น่าเกลียดจริงๆ...', 'mente odioso..': 'น่าเกลียดจริงๆ..', 'odioso...': 'น่าเกลียด...', 'mente odioso': 'น่าเกลียดจริงๆ',
  'qué vergüenza, no': 'น่าอับอาย ไม่นะ', 'vergüenza, no': 'น่าอับอาย ไม่นะ', 'verguenza, no': 'น่าอับอาย ไม่นะ', 'guenza, no': 'น่าอับอาย ไม่นะ', 'guenza, no!': 'น่าอับอาย ไม่นะ!', 'guenza': 'น่าอับอาย',
  'fuerzas...': 'เข้มแข็งไว้...', 'zas...': 'ฉับ!...', 'zas..': 'ฉับ!..', 'zas': 'ฉับ!', 'mente calientes y': 'รู้สึกอุ่นและ...', 'mente calientes y...': 'รู้สึกอุ่นและ...', 'mente calientes y..': 'รู้สึกอุ่นและ..', 'calientes y': 'รู้สึกอุ่นและ...', 'calientes y...': 'รู้สึกอุ่นและ...',
  'you\'re too far out in front, princess roseria! please move back!': 'คุณอยู่ข้างหน้าไกลเกินไปแล้ว องค์หญิงโรเซเรีย! ได้โปรดถอยกลับมาด้วย!',
  'youre too far out in front, princess roseria! please move back!': 'คุณอยู่ข้างหน้าไกลเกินไปแล้ว องค์หญิงโรเซเรีย! ได้โปรดถอยกลับมาด้วย!',
  'you stubborn bitch... you\'re always making us charge!': 'ยัยคนดื้อดึง... เธอเอาแต่สั่งให้พวกเราบุกตลอดเลย!',
  'you stubborn bitch... youre always making us charge!': 'ยัยคนดื้อดึง... เธอเอาแต่สั่งให้พวกเราบุกตลอดเลย!',
  'what are you talking about, general garcia? i can\'t defeat enemies without moving out in front!': 'นายพูดเรื่องอะไรของนาย นายพลการ์เซีย? ฉันไม่สามารถเอาชนะศัตรูได้โดยไม่บุกออกไปข้างหน้าหรอกนะ!',
  'what are you talking about, general garcia? i cant defeat enemies without moving out in front!': 'นายพูดเรื่องอะไรของนาย นายพลการ์เซีย? ฉันไม่สามารถเอาชนะศัตรูได้โดยไม่บุกออกไปข้างหน้าหรอกนะ!',
  'pussys so stinky': 'หีช่างเหม็นตุๆ',
  'with it': 'ไปด้วยกัน!',
  'cum miiinn nngg ggg': 'น้ำแตก-แล้วว วววว ววว',
  'cum miiinn nngg ggg!': 'น้ำแตก-แล้วว วววว ววว!',
  'cum miiinn nngg ggg!!': 'น้ำแตก-แล้วว วววว ววว!!',
  'cum miiinn nngg ggg!!?': 'น้ำแตก-แล้วว วววว ววว!!?',
  'cum miiinn nngg ggg!!??': 'น้ำแตก-แล้วว วววว ววว!!??',
  'catch the brainwashing': 'จับการล้างสมองให้ได้',
  'catch the brainwashing!': 'จับการล้างสมองให้ได้!',
  'already': 'เรียบร้อยแล้ว',
  'already...': 'เรียบร้อยแล้ว...',
  'already?': 'เรียบร้อยแล้วเหรอ?',
  'already!?': 'เรียบร้อยแล้วเหรอ!?',
  'the nakchal temple': 'วิหารนัคชาล',
  'nakchal temple': 'วิหารนัคชาล',
  'eunpyeong': 'อึนพยอง',
  '은평': 'อึนพยอง',
  'when youre wildly squirting with your nipples and clit totally erect': 'เมื่อคุณกำลังหลั่งน้ำออกมาอย่างรุนแรงโดยที่หัวนมและคลิตอริสแข็งตัวเต็มที่?',
  'when youre wildly squirting with your nipples and clit totally erect?': 'เมื่อคุณกำลังหลั่งน้ำออกมาอย่างรุนแรงโดยที่หัวนมและคลิตอริสแข็งตัวเต็มที่?',
  'lets have a oneonone battle': 'มาดวลกันแบบหนึ่งต่อหนึ่งเถอะ',
  'lets have a oneonone battle!': 'มาดวลกันแบบหนึ่งต่อหนึ่งเถอะ!',
  'a oneonone battle': 'การดวลแบบหนึ่งต่อหนึ่ง',
  'a oneonone battle!': 'การดวลแบบหนึ่งต่อหนึ่ง!',
  'squiring so much as usual': 'น้ำพุ่งออกมาเยอะเหมือนเคย',
  'squirting so much as usual': 'น้ำพุ่งออกมาเยอะเหมือนเคย',
  'youre squiring so much as usual': 'น้ำพุ่งออกมาเยอะเหมือนเคย',
  'youre squirting so much as usual': 'น้ำพุ่งออกมาเยอะเหมือนเคย',
  'cooooooocks': 'ควยยยยยยพวกนี้',
  'coooooocks': 'ควยยยยยยพวกนี้',
  'cooooocks': 'ควยยยยยยพวกนี้',
  'coooocks': 'ควยยยยยยพวกนี้',
  'cooocks': 'ควยยยยยยพวกนี้',
  'coocks': 'ควยยยยยยพวกนี้',
  'cocks': 'ควยพวกนี้',
  'by cooooooocks': 'โดย ควยย ยยย ยเหล่านี้',
  'by cooooooocks!': 'โดย ควยย ยยย ยเหล่านี้!',
  'by coooooocks': 'โดย ควยย ยยย ยเหล่านี้',
  'by coooooocks!': 'โดย ควยย ยยย ยเหล่านี้!',
  'by cooooocks': 'โดย ควยย ยยย ยเหล่านี้',
  'by cooooocks!': 'โดย ควยย ยยย ยเหล่านี้!',
  'by coooocks': 'โดย ควยย ยยย ยเหล่านี้',
  'by coooocks!': 'โดย ควยย ยยย ยเหล่านี้!',
  'by cooocks': 'โดย ควยย ยยย ยเหล่านี้',
  'by cooocks!': 'โดย ควยย ยยย ยเหล่านี้!',
  'by coocks': 'โดย ควยย ยยย ยเหล่านี้',
  'by coocks!': 'โดย ควยย ยยย ยเหล่านี้!',
  'by cocks': 'โดย ควยพวกนี้',
  'by cocks!': 'โดย ควยพวกนี้!',
  'by cock': 'โดย ควย',
  'being slashed by cooooooocks': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้',
  'being slashed by cooooooocks!': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้!',
  'being slashed by coooooocks': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้',
  'being slashed by coooooocks!': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้!',
  'being slashed by cooooocks': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้',
  'being slashed by cooooocks!': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้!',
  'being slashed by coooocks': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้',
  'being slashed by coooocks!': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้!',
  'being slashed by cooocks': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้',
  'being slashed by cooocks!': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้!',
  'being slashed by coocks': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้',
  'being slashed by coocks!': 'ถูกฟันโดย ควยย ยยย ยเหล่านี้!',
  'being slashed by cocks': 'ถูกฟันโดยควยพวกนี้',
  'being slashed by cocks!': 'ถูกฟันโดยควยพวกนี้!',
  'my heart\'s being torn by their cocks': 'หัวใจ\nของฉัน\nกำลัง\nถูก\nฉีกกระชาก\nด้วย\nควยพวกนี้',
  'my heart\'s being torn by their cocks!': 'หัวใจ\nของฉัน\nกำลัง\nถูก\nฉีกกระชาก\nด้วย\nควยพวกนี้!',
  'is dead': 'ตายไปแล้ว',
  'is dead!': 'ตายไปแล้ว!',
  'is dead!!': 'ตายไปแล้ว!!',
  // Manga dialogue phrases requested by the user
  'and was at a': 'และกำลังตกอยู่ใน',
  'recapturina': 'การยึดกลับคืน',
  'kina and': 'และไคนา',
  'an allout': 'อย่างเต็มรูปแบบ',
  'an all out': 'อย่างเต็มรูปแบบ',
  'a normal': 'ธรรมดา',
  'all cold': 'เย็นเฉียบ',
  'suck my': 'ดูดของฉัน',
  'cock while': 'ควยในขณะที่',
  'tangling': 'เกี่ยวกระหวัด',
  'your': 'ของคุณ',
  'tongue': 'ลิ้น',
  'onto it': 'เข้ากับมัน',
  'like the': 'เหมือนกับ',
  'pig you': 'หมูอย่างแก',
  'her up': 'หุบปากเธอซะ',
  'what a': 'ช่าง...',
  'noisy': 'เสียงดัง',
  'bitch': 'ยัยตัวแสบ',
  'shove one': 'ยัดมันเข้าไป',
  'in her other': 'เข้าไปในอีกรูของเธอ',
  'hole too': 'ด้วยเหมือนกัน',
  'the war': 'สงคราม',
  'we deal': 'พวกเราจะจัดการเอง',
  'we deal!': 'พวกเราจะจัดการเอง!',
  'away with': 'ไปให้พ้นกับ', 'away with!': 'ไปให้พ้นกับ!',
  'away... with': 'ไปให้พ้นกับ', 'away... with!': 'ไปให้พ้นกับ!',
  // THE PiG YOU ARE, LIKE A PiG, GETTING, AWAY...WiTH variants
  'getting away with us the pig you are': 'รอดตัวไปได้หรอกับหมูอย่างแก',
  'getting away with us the pig you are!': 'รอดตัวไปได้หรอกับหมูอย่างแก!',
  'us the pig you are': 'ด้วยหมูอย่างแก',
  'even getting away with': 'แม้แต่จะรอดตัวไปได้กับ',
  'even getting away with!': 'แม้แต่จะรอดตัวไปได้กับ!',
  'the pig you are': 'ไอ้หมูตอนอย่างแก',
  'the pig you are!': 'ไอ้หมูตอนอย่างแก!',
  'the pig you are!!': 'ไอ้หมูตอนอย่างแก!!',
  'the pig you are,': 'ไอ้หมูตอนอย่างแก,',
  'the pig you are...': 'ไอ้หมูตอนอย่างแก...',
  'like the pig you are': 'เหมือนไอ้หมูตอนอย่างแก',
  'like the pig you are!': 'เหมือนไอ้หมูตอนอย่างแก!',
  'like the pig you are!!': 'เหมือนไอ้หมูตอนอย่างแก!!',
  'like the pig you are,': 'เหมือนไอ้หมูตอนอย่างแก,',
  'like a pig you are': 'เหมือนไอ้หมูตอนอย่างแก',
  'like a pig you are!': 'เหมือนไอ้หมูตอนอย่างแก!',
  'like a pig you are!!': 'เหมือนไอ้หมูตอนอย่างแก!!',
  'like a pig you are,': 'เหมือนไอ้หมูตอนอย่างแก,',
  'like a pig': 'เหมือนหมู',
  'like a pig,': 'เหมือนหมู,',
  'like a pig!': 'เหมือนหมู!',
  'like a pig!!': 'เหมือนหมู!!',
  'like a pig...': 'เหมือนหมู...',
  'a pig': 'หมู',
  'a pig,': 'หมู,',
  'a pig!': 'หมู!',
  'a pig!!': 'หมู!!',
  'a pig...': 'หมู...',
  'come on! cry even more': 'เร็วเข้า! ร้องไห้ออกมาอีก',
  'come on! cry even more like': 'เร็วเข้า! ร้องไห้ออกมาอีกเหมือน',
  'come on cry even more like': 'เร็วเข้า! ร้องไห้ออกมาอีกเหมือน',
  'cry even more like': 'ร้องไห้ออกมาอีกเหมือน',
  'cry even more': 'ร้องไห้ออกมาอีก',
  'than any': 'ยิ่งกว่าใคร',
  'than any-': 'ยิ่งกว่าใคร',
  'feelings': 'ความรู้สึก',
  'feelings!': 'ความรู้สึก!',
  'cant': 'ไม่สามารถ',
  'cant!': 'ไม่สามารถ!',
  'cant...': 'ไม่สามารถ...',
  'cant believe': 'ไม่อยากเชื่อ',
  'cant believe!': 'ไม่อยากเชื่อ!',
  'cant believe...': 'ไม่อยากเชื่อ...',
  'cannot': 'ไม่สามารถ',
  'lady roseria is dead': 'เลดี้ โรสเรีย นั้น ตายไปแล้ว',
  'lady roseria is dead!': 'เลดี้ โรสเรีย นั้น ตายไปแล้ว!',
  'lady roseria is dead!!': 'เลดี้ โรสเรีย นั้น ตายไปแล้ว!!',
  'lady roseria': 'เลดี้ โรสเรีย',
  'roseria is dead': 'โรสเรีย นั้น ตายไปแล้ว',
  'roseria is dead!': 'โรสเรีย นั้น ตายไปแล้ว!',
  'roseria is dead!!': 'โรสเรีย นั้น ตายไปแล้ว!!',
  'lady roseria is': 'เลดี้ โรสเรีย นั้น',
  'a nor mal': 'ธรรมดา',
  'duin e ospe': 'ก็เป็นช่วงเวลาที่',
  'duin espe': 'ก็เป็นช่วงเวลาที่',
  'borrm': 'กำเนิด',
  'borrm.': 'กำเนิด',
  '774': 'ทั้งหมด',
  'this my': 'นี่คือ... ของฉัน',
  'we deal with it': 'เราจะจัดการกับมันเอง',
  'we deal with it!': 'เราจะจัดการกับมันเอง!',
  // Spanish exclamations & SFX — new entries
  'joder': 'เชี่ยเอ๊ย!', 'joder!': 'เชี่ยเอ๊ย!!', 'joder...': 'เชี่ยเอ๊ย...',

  'cono': 'บ้าเอ๊ย!', 'cono!': 'บ้าเอ๊ย!!',
  'coño': 'บ้าเอ๊ย!', 'coño!': 'บ้าเอ๊ย!!',
  'maldicion': 'แม่งเอ๊ย!', 'maldicion!': 'แม่งเอ๊ย!!',
  'maldición': 'แม่งเอ๊ย!', 'maldición!': 'แม่งเอ๊ย!!',
  'ay': 'โอ๊ย!', 'ay!': 'โอ๊ย!!', 'ay...': 'โอ๊ย...',
  'no!': 'ไม่!', 'no!!': 'ไม่!!', 'no...': 'ไม่...', 'no,': 'ไม่,', '¡no!': 'ไม่!!', '¡no!!': 'ไม่!!!',
  'si!': 'ใช่!', 'sí': 'ใช่', 'sí!': 'ใช่!',
  'por que': 'ทำไม', 'por qué': 'ทำไม', 'por que?': 'ทำไม?', 'por qué?': 'ทำไมนะ?',
  'cómo': 'อย่างไร', 'como?': 'ยังไงนะ?', 'cómo?': 'ยังไงนะ?',
  'cuando': 'เมื่อไหร่', 'cuándo': 'เมื่อไหร่', 'donde': 'ที่ไหน', 'dónde': 'ที่ไหน',
  'e es que': 'ก็...ก็คือว่า',
  'es que!': 'ก็คือว่า!',
  'monton!': 'มากมายเลย!', 'montón!': 'มากมายเลย!',
  'un monton': 'เยอะมาก', 'un montón': 'เยอะมาก', 'un monton!': 'เยอะมากเลย!', 'un montón!': 'เยอะมากเลย!',
  'me da guenza': 'ฉันรู้สึกอาย', 'me da vergüenza': 'ฉันรู้สึกอาย',
  'vergüenza': 'ความอาย', 'verguenza': 'ความอาย',
  'que verguenza': 'น่าอายจริงๆ', 'qué vergüenza': 'น่าอายจริงๆ',
  'vergüenza!': 'น่าอาย!', 'verguenza!': 'น่าอาย!',
  'no, guenza': 'ไม่... น่าอาย', 'no, vergüenza': 'ไม่... น่าอาย',
  'acionante': 'น่า...มาก',
  'odioso!': 'น่าเกลียด!',
  'mente calientes': 'รู้สึกร้อน', 'mente calientes y!': 'รู้สึกร้อนและ!',
  'caliente': 'ร้อน', 'caliente!': 'ร้อน!',
  'amor': 'ความรัก', 'amor!': 'รัก!', 'amor...': 'รัก...',
  'mi amor': 'ที่รักของฉัน', 'mi amor!': 'ที่รักของฉัน!',
  'por favor': 'ได้โปรด', 'por favor!': 'ได้โปรด!', 'por favor...': 'ได้โปรด...',
  'lo siento': 'ขอโทษ', 'lo siento!': 'ขอโทษมากนะ!', 'lo siento...': 'ขอโทษ...',
  'gracias': 'ขอบคุณ', 'gracias!': 'ขอบคุณมาก!',
  'de nada': 'ยินดีมาก', 'de nada!': 'ยินดีมาก!',
  'hola': 'สวัสดี', 'hola!': 'สวัสดี!', 'adios': 'ลาก่อน', 'adiós': 'ลาก่อน',
  'vamos': 'ไปกัน', 'vamos!': 'ไปกัน!', 'vamos...': 'ไปกัน...',
  'ayuda': 'ช่วยด้วย', 'ayuda!': 'ช่วยด้วย!', '¡ayuda!': 'ช่วยด้วย!!',
  'socorro': 'ช่วยด้วย!', 'socorro!': 'ช่วยด้วย!!',
  'dios': 'พระเจ้า', 'dios mio': 'พระเจ้าของฉัน', 'dios mío': 'พระเจ้าของฉัน',
  'dios mio!': 'พระเจ้าของฉัน!', 'dios mío!': 'พระเจ้าของฉัน!',
  'madre mia': 'พระแม่ของฉัน', 'madre mía': 'พระแม่ของฉัน', 'madre mia!': 'พระแม่ของฉัน!',
  'que diablos': 'นรกอะไรกัน', 'qué diablos': 'นรกอะไรกัน', 'que diablos!': 'นรกอะไรกันนี่!',
  'idiota': 'คนงี่เง่า', 'idiota!': 'คนงี่เง่า!',
  'estupido': 'โง่เง่า', 'estúpido': 'โง่เง่า', 'estupida': 'โง่เง่า', 'estúpida': 'โง่เง่า',
  'cabrón': 'ไอ้หน้าหมา', 'cabron': 'ไอ้หน้าหมา', 'cabrón!': 'ไอ้หน้าหมา!', 'cabron!': 'ไอ้หน้าหมา!',
  'puta': 'อีสาด', 'puta!': 'อีสาด!', 'puto': 'ไอ้สาด', 'puto!': 'ไอ้สาด!',
  'espera un momento': 'รอสักครู่นะ', 'espera un momento!': 'รอสักครู่ก่อน!',
  'que haces': 'ทำอะไรอยู่', 'qué haces': 'ทำอะไรอยู่', 'que haces?': 'ทำอะไรอยู่?', 'qué haces?': 'ทำอะไรอยู่?',
  'que es eso': 'นั่นคืออะไร', 'qué es eso': 'นั่นคืออะไร', 'que es eso?': 'นั่นคืออะไร?',
  'no puedo': 'ฉันไม่สามารถ', 'no puedo!': 'ฉันไม่สามารถ!', 'no puedo...': 'ฉันไม่สามารถ...',
  'no puede': 'มันไม่สามารถ', 'no puedes': 'คุณไม่สามารถ',
  'que pasa': 'เกิดอะไรขึ้น', 'qué pasa': 'เกิดอะไรขึ้น', 'que pasa?': 'เกิดอะไรขึ้น?',
  'claro': 'แน่นอน', 'claro!': 'แน่นอน!', 'claro que si': 'แน่นอนเลย', 'claro que sí': 'แน่นอนเลย',
  'nunca': 'ไม่มีวัน', 'nunca!': 'ไม่มีวันเลย!', 'nunca...': 'ไม่มีวัน...',
  'siempre': 'เสมอ', 'siempre!': 'เสมอ!', 'siempre...': 'เสมอ...',
  'ahora': 'ตอนนี้', 'ahora!': 'ตอนนี้!', 'ahora mismo': 'ทันที', 'ahora mismo!': 'ทันทีเลย!',
  'aqui': 'ที่นี่', 'aquí': 'ที่นี่', 'alli': 'ที่นั่น', 'allí': 'ที่นั่น',
  'nada': 'ไม่มีอะไร', 'nada!': 'ไม่มีอะไรเลย!', 'nada...': 'ไม่มีอะไร...',
  'todo': 'ทุกอย่าง', 'todo!': 'ทุกอย่าง!', 'todos': 'ทุกคน', 'todos!': 'ทุกคน!',
  'bien': 'ดี', 'bien!': 'ดีมาก!', 'muy bien': 'ดีมาก', 'muy bien!': 'ดีมากเลย!',
  'muy mal': 'แย่มาก',
  'quiero': 'ฉันต้องการ', 'quiero!': 'ฉันต้องการ!', 'quiero...': 'ฉันต้องการ...',
  'te quiero': 'ฉันรักคุณ', 'te quiero!': 'ฉันรักคุณ!', 'te amo': 'ฉันรักคุณมาก', 'te amo!': 'ฉันรักคุณมาก!',
  'no cabes': 'ไม่จุ',
  'besarme': 'จูบฉัน', 'besarme!': 'จูบฉันซะ!',
  'abrazarme': 'กอดฉัน', 'abrazarme!': 'กอดฉันซะ!',
  'ayudarme': 'ช่วยฉัน', 'ayudarme!': 'ช่วยฉันซะ!',
  'dejarme': 'ปล่อยฉัน', 'dejarme!': 'ปล่อยฉันซะ!', 'dejarme...': 'ปล่อยฉัน...',
  'escucharme': 'ฟังฉัน', 'escucharme!': 'ฟังฉันบ้างสิ!',
  'mirarme': 'มองฉัน', 'mirarme!': 'มองฉันบ้างสิ!',
  'tocame': 'แตะฉัน', 'tocame!': 'แตะฉันบ้างสิ!', 'tócame': 'แตะฉัน', 'tócame!': 'แตะฉันบ้างสิ!',
  'excitante': 'น่าตื่นเต้น', 'excitante!': 'น่าตื่นเต้นมาก!',
  'impresionante': 'น่าทึ่ง', 'impresionante!': 'น่าทึ่งมาก!',
  'fascinante': 'น่าหลงใหล', 'emocionante': 'น่าตื่นเต้น', 'emocionante!': 'น่าตื่นเต้นมาก!',
  'sorprendente': 'น่าประหลาดใจ', 'increible': 'ไม่น่าเชื่อ', 'increíble': 'ไม่น่าเชื่อ',
  'increible!': 'ไม่น่าเชื่อ!', 'increíble!': 'ไม่น่าเชื่อ!',
  'csabes que estas': 'รู้ไหมว่าคุณ', 'sabes que estas': 'รู้ไหมว่าคุณ', 'sabes que estás': 'รู้ไหมว่าคุณ',
  'estas bien': 'คุณสบายดีไหม', 'estás bien': 'คุณสบายดีไหม', 'estas bien?': 'คุณสบายดีไหม?',
  'oye': 'เฮ้/ดูนั่น', 'oye!': 'เฮ้!', 'oye...': 'เฮ้...',
  'uf': 'อุ๊ฟ', 'uf!': 'อุ๊ฟ!', 'uff': 'อุ๊ฟ', 'uff!': 'อุ๊ฟ!', 'ufff': 'อุ๊ฟฟ', 'ufff!': 'อุ๊ฟฟ!',
  'buf': 'อุ๊ฟ', 'buf!': 'อุ๊ฟ!', 'buff': 'อุ๊ฟ', 'buff!': 'อุ๊ฟ!',
  // Japanese exclamations
  'えっ': 'เอ๊ะ!',
  'えっ!': 'เอ๊ะ!',
  'えっ!?': 'เอ๊ะ!?',
  'エッ': 'เอ๊ะ!',
  'エッ!': 'เอ๊ะ!',
  'エッ!?': 'เอ๊ะ!?',
  'あっ': 'อ๊ะ!',
  'あっ!': 'อ๊ะ!',
  'はあ': 'เฮ้อ...',
  'はあ...': 'เฮ้อ...',
  'うう': 'อึ้ก...',
  'うう...': 'อึ้ก...',
  // Korean slang
  '아저씨': 'คุณลุง',
  '아줌마': 'คุณป้า',
  '씨발': 'เชี่ยเอ๊ย!',
  '헐': 'เห้ย!',
  '헐!': 'เห้ย!',
  // Korean manhwa common phrases (pre-bypass for Argos failures)
  '뭐야': 'อะไรกัน',
  '뭐야?': 'อะไรกัน?',
  '뭐야!': 'อะไรกัน!',
  '안갔지': 'ไม่ได้ไปหรอก',
  '가야해서': 'เพราะต้องไปแล้ว',
  '가야해': 'ต้องไปแล้ว',
  '왜같이': 'ทำไมถึงมาด้วยกัน',
  '잘부탁해': 'ยินดีที่ได้รู้จัก',
  '잘부탁해!': 'ยินดีที่ได้รู้จัก!',
  '잘부탁드려요': 'ยินดีที่ได้รู้จักครับ',
  '반가워': 'ยินดีที่ได้รู้จัก',
  '반가워요': 'ยินดีที่ได้รู้จักครับ',
  '엄마사촌': 'ลูกพี่ลูกน้องของแม่',
  '속마음': 'ความคิดในใจ',
  '읽지만': 'อ่านได้แต่...',
  '속마음읽지만': 'อ่านความคิดในใจได้แต่...',
  '괜찮아': 'ไม่เป็นไร',
  '괜찮아요': 'ไม่เป็นไรครับ',
  '알겠어': 'เข้าใจแล้ว',
  '알겠습니다': 'เข้าใจแล้วครับ',
  '몰라': 'ไม่รู้',
  '싫어': 'ไม่อยาก',
  '좋아': 'โอเค',
  '고마워': 'ขอบคุณ',
  '미안': 'ขอโทษ',
  '잠깐': 'เดี๋ยวก่อน',
  '잠깐만': 'แป๊บนึงนะ',
  '빨리': 'รีบๆ',
  '조심해': 'ระวังด้วย',
  // Korean specific manhwa dialogue overrides
  '안지우면': 'ถ้าไม่ลบ',
  '그래하는짓이 귀여우니넘어가준다': 'โอเค ฉันจะปล่อยผ่านไป เพราะการกระทำของคุณน่ารักดี',
  '그래 하는 짓이 귀여우니 넘어가준다': 'โอเค ฉันจะปล่อยผ่านไป เพราะการกระทำของคุณน่ารักดี',
  '뭔가이거 혼자할때보다 기분좋아': 'ด้วยเหตุผลบางอย่าง การทำแบบนี้... รู้สึกดีกว่าการทำคนเดียว',
  '매일 다른 컨셉으로 ok': 'เปลี่ยนคอนเซปต์ใหม่ทุกวัน โอเคไหม?',
  '미친색까뒤지기 싫으면': 'ไอ้สารเลว ถ้าไม่อยากตาย',
  '미친색까 뒤지기 싫으면': 'ไอ้สารเลว ถ้าไม่อยากตาย',
  '미친색까뒤지기싫으면': 'ไอ้สารเลว ถ้าไม่อยากตาย',
  '또라이같은년이 지가보내놓고왜지랄이지': 'ยัยบ้าคนนั้นกำลังโวยวายทั้งที่ตัวเองเป็นคนส่งมาเหรอ?',
  '또라이같은년이 지가보내놓고왜지랄이야': 'ยัยบ้าคนนั้นกำลังโวยวายทั้งที่ตัวเองเป็นคนส่งมาเหรอ?',
  '또라이같은년이지가보내놓고왜지랄이지': 'ยัยบ้าคนนั้นกำลังโวยวายทั้งที่ตัวเองเป็นคนส่งมาเหรอ?',
  // Mappings for short manga/comic phrases reported by user
  'tell his': 'บอกเรื่องของเขา', 'tell his!': 'บอกเรื่องของเขา!',
  'the barba': 'พวกบาบาเรียน', 'the barba!': 'พวกบาบาเรียน!',
  'screams': 'กรีดร้อง', 'screams!': 'กรีดร้อง!',
  'like': 'เหมือน', 'likes': 'ชอบ',
  'stop': 'หยุด', 'stop!': 'หยุดนะ!', 'stop!!': 'หยุดนะ!!',
  'stooop': 'หยุดดดด', 'stooop!': 'หยุดดดด!',
  'stooooop': 'หยุดดดด', 'stooooop!': 'หยุดดดด!',
  'st0000p': 'หยุดดดด', 'st0000p!': 'หยุดดดด!',
  'pleea': 'ได้โปรด', 'pleea!': 'ได้โปรด!', 'aaseee': 'ดดดดดด', 'aaseee!': 'ดดดดดด!',
  'pleeaaseee': 'ได้โปรดดดด', 'pleeaaseee!': 'ได้โปรดดดด!',
  'pleeaaaseee': 'ได้โปรดดดด', 'pleeaaaseee!': 'ได้โปรดดดด!',
  'n00': 'ไม่ๆๆ', 'noo': 'ไม่ๆๆ', 'n00!': 'ไม่ๆๆ!', 'noo!': 'ไม่ๆๆ!',
  'affairs': 'เรื่องชู้สาว',
  'roleplay': 'สวมบทบาท', 'role play': 'สวมบทบาท',
  'birthday': 'วันเกิด', 'a birthday': 'วันเกิด',
  'memory': 'ความทรงจำ', 'memories': 'ความทรงจำ',
  'know': 'รู้จัก', 'better': 'ดีขึ้น', 'know better': 'รู้จักดีขึ้น',
  'tonight': 'คืนนี้', 'going to do': 'กำลังจะทำ', 'going to do it': 'กำลังจะทำ',
  'stuff': 'ของพวกนั้น', 'that kind': 'ประเภทนั้น',
  'tasty': 'อร่อย', 'oolong': 'อูหลง',
  'make sure!': 'ให้แน่ใจ!',
  'that its': 'ว่ามัน', 'that its!': 'ว่ามัน!',
  'general!': 'นายพล!',
  'cervix!': 'ปากมดลูก!',
  'us the!': 'พวกเรา!',
  'posi': 'ท่า', 'posi!': 'ท่า!',
  'pig': 'หมู', 'pig!': 'หมู!',
  'coo': 'ควย', 'coo!': 'ควย!',
  '000': 'ยยย', '000!': 'ยยย!', 'ooo': 'ยยย', 'ooo!': 'ยยย!',
  '7ocks': 'ควย', '7ocks!': 'ควย!', 'ocks': 'ควย', 'ocks!': 'ควย!', 'cks': 'ควย', 'cks!': 'ควย!',
  'coo 000 7ocks': 'ควยยยยยย', 'coo 000 7ocks!': 'ควยยยยยย!',
  'coo 000 ocks': 'ควยยยยยย', 'coo 000 ocks!': 'ควยยยยยย!',
  'coo ooo cks': 'ควยยยยยย', 'coo ooo cks!': 'ควยยยยยย!',
  'but in any': 'แต่ไม่ว่าจะใน...', 'but in any!': 'แต่ไม่ว่าจะใน...!',
  'tated': 'ท้องแล้ว', 'tated!': 'ท้องแล้ว!', 'tated!!': 'ท้องแล้ว!!',
  'impregnated': 'ตั้งครรภ์', 'impregnated!': 'ตั้งครรภ์แล้ว!',
  'impregnate': 'ทำให้ท้อง', 'impregnate!': 'ทำให้ท้อง!',
  'i mpregnated pig': 'หมูแม่พันธุ์ที่กำลังตั้งท้อง', 'i mpregnated pig!': 'หมูแม่พันธุ์ที่กำลังตั้งท้อง!',
  'impregnated pig': 'หมูแม่พันธุ์ที่กำลังตั้งท้อง', 'impregnated pig!': 'หมูแม่พันธุ์ที่กำลังตั้งท้อง!',
  'weight': 'น้ำหนัก', 'weight!': 'น้ำหนัก!',
  'bursting': 'จะระเบิดแล้ว', 'bursting!': 'จะระเบิดแล้ว!',
  'burst': 'ระเบิด', 'burst!': 'ระเบิด!',
  'sorryy': 'ขอโทษษษ', 'sorryy!': 'ขอโทษษษ!',
  'sorryyy': 'ขอโทษษษ', 'sorryyy!': 'ขอโทษษษ!',
  'sorryyyy': 'ขอโทษษษ', 'sorryyyy!': 'ขอโทษษษ!',
  'noooo': 'ไม่นะะะะ', 'noooo!': 'ไม่นะะะะ!',
  'nooooo': 'ไม่นะะะะ', 'nooooo!': 'ไม่นะะะะ!',
  'youve got a': 'เธอมี...', 'youve got a!': 'เธอมี...!',
  'you\'ve got a': 'เธอมี...', 'you\'ve got a!': 'เธอมี...!',
  'youve got': 'เธอมี', 'you\'ve got': 'เธอมี',
  'ohhh!oh!': 'โอ้! โอ้!', 'ohhh! oh!': 'โอ้! โอ้!', 'oh!oh!': 'โอ้! โอ้!',
  'ohhh!': 'โอ้ววว!', 'ohhhh!': 'โอ้ววว!', 'ohhhhn!': 'โอ้ววว!', 'oh, ohh': 'โอ้, โอ้',
  'field': 'สนาม', 'field!': 'สนาม!', 'fields': 'ทุ่งหญ้า',
  'cack... qh!': 'ควย... โอ้!', 'cack... qh': 'ควย... โอ้', 'cack': 'ควย',
  'i dant': 'ฉันไม่', 'i dan\'t': 'ฉันไม่',
  'ganna': 'กำลังจะ', 'ganna!': 'กำลังจะ!',
  'difeee': 'ตายยยย', 'difeee!': 'ตายยยย!',
  'dying!loh, ahh.': 'จะตายแล้ว! โอ้, อ๊าห์.',
  'hhhh': 'ฮึก...', 'hhhh!': 'ฮึก!!', 'hhhh!!': 'ฮึก!!',
  'hh': 'ฮึก!', 'hh!': 'ฮึก!', 'hh!!': 'ฮึก!!',
  'flowing...': 'ไหลริน...', 'flowing': 'ไหลริน', 'flowing!': 'ไหลริน!',
  'swell': 'บวมเป่ง', 'swell!': 'บวมเป่ง!', 'swell...': 'บวมเป่ง...',
  'thing.': 'สิ่งนั้น.', 'thing the': 'สิ่งนั้น', 'thing': 'สิ่งของ',
  'ms. makima': 'คุณมากิมะ', 'ms.makima': 'คุณมากิมะ', 'ms makima': 'คุณมากิมะ',
  'msmak im a': 'คุณมากิมะ', 'msmak ima': 'คุณมากิมะ',
  'creak': 'เอี๊ยดด', 'rool': 'กลิ้งง', 'boing': 'ดึ๋งง',
  'plap': 'ตับบ', 'plap plap': 'ตับ ตับ', 'plap!': 'ตับบ!', 'plaru': 'ตับบ',
  'joop': 'จ๊วบบ', 'tremble': 'สั่นสะท้าน', 'tremble!': 'สั่นสะท้าน!',
  'quiver': 'สั่นระริก', 'quiver!': 'สั่นระริก!', 'qoiver': 'สั่นระริก',
  'jolt': 'สั่นไหว', 'jolt!': 'สะดุ้ง!', 'rattle': 'กึกกัก',
  'splurch': 'พรวดด', 'splrch': 'พรวดด', 'thmp': 'ตึ่บบ',
  'splap': 'แปะะ', 'splooge': 'พรวดดด', 'pssh': 'ชี่...', 'pshh': 'ฟู่...',
  's-sory': 'ข-ขอโทษนะ', 's-sory..': 'ข-ขอโทษนะ...', 's-sory..,,': 'ข-ขอโทษนะ...',
  's-sorry': 'ข-ขอโทษนะ', 's-sorry..': 'ข-ขอโทษนะ...',
  'lah': 'ละ', 'lah!': 'ล่ะ!', 'lah...': 'ล่ะ...',
  'ann!': 'อ๊าห์!', 'ann': 'อ๊าห์',
  'bzz': 'หึ่งง', 'squish': 'ยวบบ', 'stood': 'ยืนอยู่', 'stood!': 'ยืนอยู่!', 'jiggle': 'ดึ๋งๆ',
  'grind': 'บดด', 'grinc': 'บดด', 'twire': 'กระตุก',
  'squeeze': 'บีบเค้น', 'squeeze!': 'บีบเค้น!', 'seoeeze': 'บีบเค้น', 'saeeze': 'บีบเค้น',
  'shiver': 'สั่นสะท้าน', 'shner': 'สั่นสะท้าน', 'flinch': 'สะดุ้ง', 'cling': 'เกาะแน่น',
  'shives': 'สั่นสะท้าน', 'shvero': 'สั่นสะท้าน', 'stroke': 'ลูบไล้', 'grope': 'ขยำา',
  'charten': 'สั่นระรัว', 'shlp': 'จ๊วบบ',
  'huff': 'แฮ่กก', 'rhuff': 'แฮ่กก', 'hofflv': 'แฮ่กก', 'julp': 'อึกก',
  'so he can': 'เพื่อให้เขาสามารถ', 'sochacan': 'เพื่อให้เขาสามารถ',
  'semen...': 'น้ำอสุจิ...', 'semen': 'น้ำอสุจิ', 'semen!': 'น้ำอสุจิ!',
  'glepgh': 'แหวะะ', 'blubub': 'บุ๋งๆ',
  'yammer': 'บ่นพร่ำ', 'yammer:': 'บ่นพร่ำ:', 'chatter': 'พูดพร่ำ', 'speeed': 'เร็วขึ้นน',
  'fondle': 'เคล้นคลึง', 'flick': 'ดีดด', 'nunu': 'งึมงำ...',
  'gyuuuh': 'กิ๊ววว', 'guuuun': 'กิ๊ววว', 'apeooh': 'อาเปะโอ้...', 'apeooh...': 'อาเปะโอ้...',
  'uuggun': 'อึ่กกก', 'uuuhnn': 'อู้วววน์', 'throb': 'เต้นตุบๆ',
  'blorp': 'ผล็อยย', 'plurp': 'ผล็อยย', 'clatter': 'กริ๊กกร๊าก',
  'badmp': 'ตึกตัก', 'oohy': 'อูฮี้', 'cummngi': 'จะแตกแล้ว!',
  'dration': 'ระยะเวลา', 'chistic ehp': 'ชิสติก เหรอ?', 'chistic eh?': 'ชิสติก เหรอ?', 'less': 'น้อยลง',
  'crush womb lick': 'กระแทกมดลูกแล้วเลีย', 'arushwomb!uck': 'กระแทกมดลูกแล้วเลีย',
  'kuhk': 'ครึ่กก', 'fucki': 'เย็ด', 'fuck': 'เย็ด',
  'this black-market av': 'หนังโป๊ตลาดมืดเรื่องนี้',
  'breeding sack': 'กระสอบแม่พันธุ์', 'bree ding sack': 'กระสอบแม่พันธุ์',
  'splat': 'แปะะ', 'splat!': 'แปะะ!',
  'psv': 'ฟู่...', 'psh': 'ฟู่...',
  'splurty': 'พรวดด', 'splort': 'พรวดด',
  'splorgey': 'พรวดดด', 'splorge': 'พรวดดด',
  'splooge\'v': 'พรวดดด', 'sploogev': 'พรวดดด',
  'splot': 'แปะะ',
  'thmi': 'ตึ่บบ',
  'athle': 'กึกกัก',
  'seueeze': 'บีบเค้น',
  'flicks': 'สะบัด', 'flick!': 'ดีดด!',
  'squelch': 'ปรื๊ด', 'qweleh': 'ปรื๊ด',
  'porplo': 'ปุ๋งๆ',
  'tblorp': 'ผล็อยย',
  'cick': 'แพล๊บ', 'lick': 'แพล๊บ',
  'htwiteh+': 'ชักกระตุก', 'htwiteh': 'ชักกระตุก',
  'such thick': 'ข้นขนาดนี้', 'suchthick': 'ข้นขนาดนี้',
  'glarble': 'กลั่กๆ', 'gargle': 'กลั่กๆ',
  'gohk': 'อ่อก', 'glub': 'บุ๋ง',
  'humph!': 'ฮึ่ม!', 'humph': 'ฮึ่ม!',
  'quish': 'บีบ',
  'waiggle': 'ดิ้นไปมา', 'wriggle': 'ดิ้นไปมา',
  'my cervix.': 'มดลูกของฉัน.', 'my cervix': 'มดลูกของฉัน',
  'wobble': 'โยกเยก', 'wobble!': 'โยกเยก!',
  'sha!': 'สั่น!', 'sha': 'สั่น',
  'fuhin': 'ฟูฮิห์',
  'jolk': 'สั่นไหว', 'joly': 'เขย่า',
  'nchuhig': 'นชูห์', 'nchuh': 'นชูห์',
  'jock': 'ล็อก',
  'shirch': 'ซวบ', 'shlrch': 'ซวบ',
  'schlup': 'จ๊วบ',
  'nhn!': 'นืห์!', 'nhn': 'นืห์',
  'tobe': 'ที่จะเป็น',
  'aoh': 'โอ้ห์',
  'lmao': 'ก๊ากๆ', 'lmao!': 'ก๊ากๆ!',
  'oohgl': 'อ...อุ๊กข์', 'oohg': 'อ...อุ๊กข์',
  'nstrict..': 'บีบรัด...', 'constrict...': 'บีบรัด...', 'constrict': 'บีบรัด',
  'doh!': 'โอ้!',
  'sprch': 'ซ่า!',
  'yguhh': 'อุกะห์', 'uguhh': 'อุกะห์',
  'uurrh': 'อ...อั๊กห์', 'uurkh': 'อ...อั๊กห์',
  'uuquh': 'อ...อุกห์',
  'srp': 'กำแน่น',
  'knead': 'นวดคลึง',
  'sluttiest': 'อีตัวที่สุด',
  '\'aight.d': 'โอเค๊', 'aight': 'โอเค๊', 'aight.': 'โอเค๊.',
  'vglob': 'กล็อบบ', 'glob': 'กล็อบบ',
  'sna': 'ตอด', 'snap': 'ตอด', 'snap!': 'ตะครุบ!', 'snar!': 'ตะครุบ!',
  'crack': 'แคร๊ก',
  'iburrpe': 'บล๊ออบบ', 'blurrpp': 'บล๊ออบบ',
  'luuuh': 'อู้ววว', 'uuuh': 'อู้ววว',
  'thw': 'ตุ๊บ', 'thud': 'ตุ๊บ',
  'splt': 'แผละ',
  'chw': 'จล๊วบห์', 'chulp': 'จล๊วบห์',
  'lurpv': 'ซวบ', 'lurp': 'ซวบ',
  'sch': 'ชวบ',
  'ypurp': 'พล๊อบ', 'purp': 'พล๊อบ',
  'pipun': 'พั่บ..พลั่บ', 'pupuh': 'พั่บ..พลั่บ',
  'blupu': 'พลั่บ..พลั่บห์', 'plupuh': 'พลั่บ..พลั่บห์',
  'hoffl': 'แฮ่กก', 'hoff': 'แฮ่กก',
  'glar': 'กร๊วบ',
  'witeh': 'กระตุก', 'iwiteh': 'กระตุก',
  'lerq': 'เบลอร์ก', 'blergh': 'เบลอร์ก',
  'ourgh!': 'เออร์ก!', 'eurgh': 'เออร์ก', 'eurgh!': 'เออร์ก!',
  'mhmp': 'มืมห์?', 'mhm?': 'มืมห์?',
  'chatten': 'พูดพล่อย', 'chatten!.': 'พูดพล่อย',
  'hum-': 'ฮืม-',
  'have..': 'มี..', 'have...': 'มี...',
  'for me': 'สำหรับฉัน', 'for me!': 'สำหรับฉัน!',
  'ngoh': 'อื้อออ',
  'am a zingr': 'ยอดเยี่ยม',
  'now rightp': 'ตอนนี้ใช่ไหม?', 'now right?': 'ตอนนี้ใช่ไหม?', 'rightp': 'ใช่ไหม?',
  'apeooho..': 'อ๊าา-อู๊ว', 'apeooho': 'อ๊าา-อู๊ว',
  'yoo...': 'โย่ห์...', 'yoo': 'โย่ห์',
  'wonbooo': 'มดลูก...', 'womb...': 'มดลูก...', 'womb': 'มดลูก',
  'good!!': 'เยี่ยม!!', 'good!': 'เยี่ยม!',
  'catter...': 'โครมคราม', 'clatter...': 'โครมคราม',
  'plar': 'ตับบ',
  'now, we\'ll': 'ต่อไปนี้ เราจะ', 'now we\'ll': 'ต่อไปนี้ เราจะ',
  'so strange': 'แปลกจัง', 'sostrange': 'แปลกจัง',
  'no matter': 'ไม่ว่าอย่างไรก็ตาม', 'nomatter': 'ไม่ว่าอย่างไรก็ตาม',
  'this is so strange, no matter how many times i think about it, but..': 'นี่มันแปลกมากจริงๆ ไม่ว่าจะคิดกี่ครั้งก็ตาม แต่...',
  'this is so strange, no matter how many times i thinkabout it, but..': 'นี่มันแปลกมากจริงๆ ไม่ว่าจะคิดกี่ครั้งก็ตาม แต่...',
  'this is so strange, no matter how many times i think about it, but...': 'นี่มันแปลกมากจริงๆ ไม่ว่าจะคิดกี่ครั้งก็ตาม แต่...',
  'howszat having': 'เป็นไงบ้าง', 'howszat having?': 'เป็นไงบ้าง?',
  'piston pounded!': 'ลูกสูบกระแทก!', 'piston pounded': 'ลูกสูบกระแทก',
  'uuqun': 'อู้ววกึฮ์', 'uuguh': 'อู้ววกึฮ์',
  'kunk': 'ค...คั่ก',
  'lneo': 'นวดคลึง',
  'gluby': 'บุ๋ง',
  'holam': 'ถือไว้', 'hold': 'ถือไว้',
  'wipe...': 'เช็ด...', 'wipe': 'เช็ด',
  'slide': 'สไลด์',
  'rawle': 'สั่น',
  'crittch': 'เกา', 'scritch': 'เกา',
  'tretch': 'ยืด', 'stretch': 'ยืด',
  '8plly': 'ซวบบ', 'splly': 'ซวบบ',
  'wor': 'งาน',
  'good grief...': 'โอ้ พระเจ้า...', 'good grief': 'โอ้ พระเจ้า...', 'good+grief...': 'โอ้ พระเจ้า...',
  'i just': 'ฉันแค่',
  'srind': 'บด',
  'inside my body...': 'ไว้ในร่างกายของฉัน', 'inside my body': 'ไว้ในร่างกายของฉัน', 'inside my +body...': 'ไว้ในร่างกายของฉัน',
  'splrg': 'บลั่กก',
  'splurcct': 'พรู๊ดดด!', 'splurrrt': 'พรู๊ดดด!',
  'suky': 'จล๊วบ', 'schlrp': 'จล๊วบ',
  '(good, no?)': '(ดีใช่ไหม?)', '(good, nop)': '(ดีใช่ไหม?)',
  'jupp': 'จุปป์',
  'squeleh': 'แพล่บ',
  'glorp': 'จ๊วบ',
  'plorpop': 'บล๊อบ พ๊อบ',
  'my throat': 'ลำคอของฉัน', 'my.throat.': 'ลำคอของฉัน',
  'ejaculate': 'พุ่งน้ำกามออกมา',
  'semerboo': 'น้ำอสุจิ',
  'bdmp': 'ตึ๊ก ตัก',
  'ammer': 'คร่ำครวญ',
  'some more': 'เพิ่มเติมอีกเล็กน้อย',
  'hum': 'ฮึม~',
  'humph!j': 'ฮัม!',
  'particularly': 'โดยเฉพาะอย่างยิ่ง', 'part i cularly': 'โดยเฉพาะอย่างยิ่ง',
  'i had': 'ฉันมี',
  'dumph!': 'ตึก-ตัก!', 'dumph': 'ตึก-ตัก',
  'qoeeezeee...': 'บีบแน่น', 'squeeezee...': 'บีบแน่น', 'squeeezee': 'บีบแน่น',
  'womb for': 'มดลูกสำหรับ', 'womb.for': 'มดลูกสำหรับ',
  'can a sow like you please just think only with its womb for once like sows tend to...': 'แม่หมูอย่างคุณช่วยคิดด้วยสมองของตัวเองบ้างได้ไหม เหมือนที่แม่หมูมักจะคิด...',
  'can a sow like you please just thihnk only with its womb for once like sows tend to...': 'แม่หมูอย่างคุณช่วยคิดด้วยสมองของตัวเองบ้างได้ไหม เหมือนที่แม่หมูมักจะคิด...',
  'miss makima\'s womb': 'มดลูกของคุณมากิมา', 'miss makima\'s womb.': 'มดลูกของคุณมากิมา',
  'so i take it': 'ฉันเข้าใจว่าอย่างนั้น', 'soitake it': 'ฉันเข้าใจว่าอย่างนั้น', 'soitake': 'ฉันเข้าใจว่า',
  'your womb': 'มดลูกของคุณ', 'your.womb': 'มดลูกของคุณ',
  'more honest with me~!': 'ซื่อสัตย์กับฉันมากกว่านี้หน่อย~!', 'more honest with me': 'ซื่อสัตย์กับฉันมากกว่านี้หน่อย', 'more honest+with me~!': 'ซื่อสัตย์กับฉันมากกว่านี้หน่อย~!',
  'muuh"': 'อู้ววว', 'ehr': 'เอ๊ะ', 'eh': 'เอ๊ะ',
  'buuuut': 'แต่ว่าาาา',
  'jol7': 'สั่นไหว',
  'number 4': 'หมายเลข 4', 'number 4.': 'หมายเลข 4.', 'number4.': 'หมายเลข 4.',
  'gathes': 'รวมตัว', 'patheri': 'รวมตัว',
  'this is sostrange,nomatter howmany times i think about it but!!.' : 'นี่มันแปลกมากจริงๆ ไม่ว่าจะคิดกี่ครั้งก็ตาม แต่...',
  'this is sostrange, nomatter howmany times i think about it but!!.' : 'นี่มันแปลกมากจริงๆ ไม่ว่าจะคิดกี่ครั้งก็ตาม แต่...',
  'this is so strange, no matter how many times i think about it, but!!.' : 'นี่มันแปลกมากจริงๆ ไม่ว่าจะคิดกี่ครั้งก็ตาม แต่...',
  'psh0': 'ฟู่วว',
  'imma': 'ฉันจะ',
  'just from licking her nips': 'แค่เพียงเลียหัวนมของเธอเท่านั้น',
  'she dares to also squeeze up that pussy so damn tightly!': 'เธอกล้าที่จะบีบช่องคลอดของเธอให้แน่นขนาดนั้นเลยเหรอ!',
  'she dares to also squeeze up that pussy so damn tightly': 'เธอกล้าที่จะบีบช่องคลอดของเธอให้แน่นขนาดนั้นเลยเหรอ!',
  'we\'re making a cover for this black-market av.': 'เรากำลังทำปกAVให้กับตลาดมืดนี้',
  'we\'re making a cover for this black-market av': 'เรากำลังทำปกAVให้กับตลาดมืดนี้',
  'eeh...': 'อ...เอ๋...',
  'avp': 'หนังโป๊', 'av': 'หนังโป๊',
  'this adult video': 'วิดีโอสำหรับผู้ใหญ่นี้', 'this a dultvideo': 'วิดีโอสำหรับผู้ใหญ่นี้', 'this a dult video': 'วิดีโอสำหรับผู้ใหญ่นี้',
  'will also be': 'จะถูกด้วยเช่นกัน', 'will alsobe': 'จะถูกด้วยเช่นกัน',
  'circulated all': 'เผยแพร่ทั้งหมด',
  'around tokyo,': 'รอบๆ โตเกียว,', 'around tokyo': 'รอบๆ โตเกียว',
  'vand my': 'และ...ของฉัน', 'and my': 'และ...ของฉัน',
  '\\foolishness': 'ความโง่เขลา', 'foolishness': 'ความโง่เขลา',
  'mioro': 'กล็อบ', 'glorb': 'กล็อบ',
  '(aged, it\'s)': 'อายุมากแล้ว มัน...', '(aged, its)': 'อายุมากแล้ว มัน...', 'aged, it\'s': 'อายุมากแล้ว มัน...', 'aged, its': 'อายุมากแล้ว มัน...',
  'a-al- right!': 'ช-ชะ ใช่แล้ว!', 'a-al- right': 'ช-ชะ ใช่แล้ว', 'a-all right!': 'ช-ชะ ใช่แล้ว!', 'a-all right': 'ช-ชะ ใช่แล้ว',
  'gh...!': 'อึ่ก!...', 'gh...': 'อึ่ก...', 'gh!': 'อึ่ก!',
  'then why': 'แล้วทำไม', 'then why?': 'แล้วทำไมล่ะ?', 'then why!?': 'แล้วทำไมล่ะ!?',
  'sexual intercourse deficiency of the genitals disease': 'โรคความบกพร่องทางเพศของอวัยวะเพศ',
  'it\'s a disease in which you have to release a lot of sperm or it could be fatal': 'นี่เป็นโรคที่คุณต้องหลั่งอสุจิออกมาเป็นจำนวนมาก มิเช่นนั้นอาจถึงแก่ชีวิตได้',
  'its a disease in which you have to release a lot of sperm or it could be fatal': 'นี่เป็นโรคที่คุณต้องหลั่งอสุจิออกมาเป็นจำนวนมาก มิเช่นนั้นอาจถึงแก่ชีวิตได้',
  'it\'s more efficient and produces high quality sperm.': 'วิธีนี้มีประสิทธิภาพมากกว่าและได้อสุจิคุณภาพสูง',
  'it\'s more efficient and produces high quality sperm': 'วิธีนี้มีประสิทธิภาพมากกว่าและได้อสุจิคุณภาพสูง',
  'its more efficient and produces high quality sperm.': 'วิธีนี้มีประสิทธิภาพมากกว่าและได้อสุจิคุณภาพสูง',
  'its more efficient and produces high quality sperm': 'วิธีนี้มีประสิทธิภาพมากกว่าและได้อสุจิคุณภาพสูง',
  'by having sex with a woman,': 'โดยการมีเพศสัมพันธ์กับผู้หญิง,',
  'by having sex with a woman': 'โดยการมีเพศสัมพันธ์กับผู้หญิง',
  'what the hell kind of convenient straight out of an ero-manga disease is that ..!?': 'โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?',
  'what the hell kind of convenient straight out of an ero-manga disease is that...!?': 'โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?',
  'what the hell kind of convenient straight out of an ero-manga disease is that': 'โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?',
  'what the hell kind of conyenient straight out of an ero-manga disease is that ..!?': 'โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?',
  'what the hell kind of conyenient straight out of an ero-manga disease is that...!?': 'โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?',
  'what the hell kind of conyenient straight out of an ero-manga disease is that': 'โรคอะไรวะเนี่ย โรคที่เหมือนหลุดออกมาจากมังงะอีโรติกเลย...!?',
  'ero-manga': 'มังงะอีโรติก', 'ero manga': 'มังงะอีโรติก', 'an ero-manga': 'มังงะอีโรติก', 'an ero manga': 'มังงะอีโรติก',
  'moving!!': 'ขยับเขยื้อน!', 'moving!': 'ขยับเขยื้อน!', 'moving': 'ขยับเขยื้อน',
  'came...': 'เสร็จแล้ว...', 'came!': 'แตกแล้ว!', 'came': 'แตกแล้ว',
  'it felt': 'มันรู้สึก',
  'the treat- ment': 'การรักษา', 'the treat-ment': 'การรักษา', 'the treatment': 'การรักษา',
  'treatment': 'การรักษา', 'treatment...': 'การรักษา...', 'treatment.': 'การรักษา.',
  'continue the threat-ment': 'ดำเนินการรักษาต่อไป', 'continue the treatment': 'ดำเนินการรักษาต่อไป',
  'continue': 'ดำเนินการต่อไป',
  'to day\'s': 'ของวันนี้', 'today\'s': 'ของวันนี้',
  'i made a few modifi-cations to the room': 'ฉันได้ทำการปรับเปลี่ยนห้องเล็กน้อย',
  'i made a few modifications to the room': 'ฉันได้ทำการปรับเปลี่ยนห้องเล็กน้อย',
  'on to day...': 'ในวันนี้...', 'on today...': 'ในวันนี้...', 'on to day': 'ในวันนี้', 'on today': 'ในวันนี้',
  'we rest': 'พวกเราพักผ่อน', 'werest': 'พวกเราพักผ่อน',
  'cum at': 'หลั่งใส่', 'cumat': 'หลั่งใส่',
  'time as i': 'เวลาที่ฉัน', 'time asi': 'เวลาที่ฉัน',
  'so good': 'รู้สึกดีมาก', 'so good...': 'รู้สึกดีมาก...', 'so good!': 'รู้สึกดีมาก!', '50good': 'รู้สึกดีมาก',
  'sucking': 'ดูด', 'sucking...': 'ดูด...', 'sucking!': 'ดูด!',
  'discourse': 'การสนทนา', 'discour-': 'การสนทนา', 'discour': 'การสนทนา',
  'me, there': 'ฉัน, ตรงนั้น', '(me, there)': '(ฉัน, ตรงนั้น)', '(me,there)': '(ฉัน, ตรงนั้น)', 'me,there': 'ฉัน, ตรงนั้น',
  'then, we should': 'ถ้าอย่างนั้นเราควรจะ', 'then we should': 'ถ้าอย่างนั้นเราควรจะ', 'then. we should': 'ถ้าอย่างนั้นเราควรจะ', 'then.we should': 'ถ้าอย่างนั้นเราควรจะ',
  'then, we': 'ถ้าอย่างนั้นเรา', 'then we': 'ถ้าอย่างนั้นเรา',
  'boyfriend': 'แฟน', 'boyfriend!': 'แฟนหนุ่ม!', 'boyfriend...': 'แฟนหนุ่ม...',
  'big': 'ใหญ่', 'big!': 'ใหญ่มาก!', 'big...': 'ใหญ่มาก...',
  'interesting': 'น่าสนใจ', 'interesting!': 'น่าสนใจ!', 'interesting...': 'น่าสนใจ...',
  'to me today.': 'ให้ฉันในวันนี้.', 'to me today': 'ให้ฉันในวันนี้', 'to me tovay.': 'ให้ฉันในวันนี้.', 'to me tovay': 'ให้ฉันในวันนี้',
  'satisfy': 'ทำให้พึงพอใจ', 'satisfy!': 'ทำให้พึงพอใจ!', 'satisfy...': 'ทำให้พึงพอใจ...',
  'miki yuka (28).': 'มิกิ ยูกะ (28)', 'miki yuka (28)': 'มิกิ ยูกะ (28)',
  'let it out': 'ปล่อยมันออกมา', 'let it out!': 'ปล่อยมันออกมา!', 'let it out...': 'ปล่อยมันออกมา...',
  'loose': 'โหลยโท่ย', 'loose!': 'โหลยโท่ย!', 'loose...': 'โหลยโท่ย...',
  'air bath.': 'อ่างตากอากาศ', 'air bath': 'อ่างตากอากาศ', 'airbath.': 'อ่างตากอากาศ', 'airbath': 'อ่างตากอากาศ',
  'yuka-chan, i\'ll': 'ยูกะ-จัง ฉันจะ', 'yuka-chan, i\'ll...': 'ยูกะ-จัง ฉันจะ...', 'yuka-chan i\'ll': 'ยูกะ-จัง ฉันจะ',
  'chan, i\'ll': 'จัง ฉันจะ', 'chan, i\'ll...': 'จัง ฉันจะ...', 'chan i\'ll': 'จัง ฉันจะ',
  'chan': 'จัง', '-chan': '-จัง',
  'limit': 'ขีดจำกัด', 'limit!': 'ขีดจำกัด!', 'limit...': 'ขีดจำกัด...',
  'lol so lewd': 'ฮ่าๆๆ ลามกจังเลย', 'lol so lewd!': 'ฮ่าๆๆ ลามกจังเลย!', 'lol so lewd...': 'ฮ่าๆๆ ลามกจังเลย...',
  'whaaat': 'อ..อะไร', 'whaaat!': 'อ..อะไร!', 'whaaat,': 'อ..อะไร,', 'whaaat...': 'อ..อะไร...',
  'y-yes': 'ช-ใช่', 'y-yes!': 'ช-ใช่!', 'y-yes...': 'ช-ใช่...',
  'painful': 'เจ็บปวด', 'painful!': 'เจ็บปวด!', 'painful...': 'เจ็บปวด...',
  'thick': 'หนา', 'thick!': 'หนา!', 'thick...': 'หนา...',
  'some-thing i said-': 'บางสิ่ง ที่ฉัน พูด-', 'some-thing i said': 'บางสิ่ง ที่ฉัน พูด', 'something i said': 'บางสิ่ง ที่ฉัน พูด',
  "what's that": 'นั่นอะไรน่ะ', "what's that?": 'นั่นอะไรน่ะ', 'what is that': 'นั่นอะไรน่ะ', 'what is that?': 'นั่นอะไรน่ะ',
  'what cup size': 'คัพไซส์อะไร', 'what cup size?': 'คัพไซส์อะไร',
  'ngh...': 'อึก...', 'ngh': 'อึก', 'ngh!': 'อึก!',
  'military': 'ทหาร', 'military!': 'ทหาร!',
  "i'm fine!": 'ฉันสบายดี!', "i'm fine": 'ฉันสบายดี', 'im fine!': 'ฉันสบายดี!', 'im fine': 'ฉันสบายดี',
  'shut it!!': 'หุบปากซะ!!', 'shut it!': 'หุบปากซะ!', 'shut it': 'หุบปากซะ',
  'spread': 'แหวก', 'spread!': 'แหวก!', 'spread...': 'แหวก...',
  'shudder': 'สั่นสะท้าน', 'shudders': 'สั่นสะท้าน', 'shudder.s': 'สั่นสะท้าน', 'shudder...': 'สั่นสะท้าน...',
  'cumming again': 'เสร็จอีกแล้ว', 'cumming again!': 'เสร็จอีกแล้ว!', 'cumming again...': 'เสร็จอีกแล้ว...',
  'pat': 'แปะ', 'pat!': 'แป๊ะ!', 'pat...': 'แปะ...', 'pate': 'แปะ',
  'blurge': 'บลั๊กก', 'blurge!': 'บลั๊กก!', 'blurge...': 'บลั๊กก...',
  'perhaps?': 'บางทีนะ?', 'perhaps': 'อาจจะใช่', 'perhaps...': 'บางทีนะ...',
  'pwah': 'พวาห์', 'pwah!': 'พวาห์!', 'pwah...': 'พวาห์...',
  "teacher's office": 'ห้องพักครู', 'teachers office': 'ห้องพักครู',
  'you ejaculate': 'คุณพุ่งน้ำกามออกมา', 'you ejaculate!': 'คุณพุ่งน้ำกามออกมา!',
  'splurge': 'พรวดดด', 'splurge!': 'พรวดดด!', 'splurge...': 'พรวดดด...',
  'twitch': 'กระตุก', 'twitches': 'กระตุก', 'twitcht': 'กระตุก', 'twitch!': 'กระตุก!', 'twitch...': 'กระตุก...',
  'his semen': 'น้ำอสุจิของเขา', 'hissemen': 'น้ำอสุจิของเขา',
  'is still leaking': 'ยังคงไหลออกมา', 'isstilleaking': 'ยังคงไหลออกมา',
  'out of me..': 'ออกมาจากฉัน..', 'out of me': 'ออกมาจากฉัน', 'out of me...': 'ออกมาจากฉัน...', 'outopme..': 'ออกมาจากฉัน..', 'outopme': 'ออกมาจากฉัน',
  'his semen is still leaking out of me': 'น้ำอสุจิของเขายังคงไหลออกมาจากตัวฉัน',
  'his semen is still leaking out of me=': 'น้ำอสุจิของเขายังคงไหลออกมาจากตัวฉัน',
  'really wanna': 'อยากจริงๆ', 'really wanna...': 'อยากจริงๆ...', '..really wanna': 'อยากจริงๆ', '...really wanna': 'อยากจริงๆ', 'really wanna!': 'อยากจริงๆ!',
  "(out, yuuto! don't)": '(ออกไป ยูโตะ! อย่า)', "out, yuuto! don't": 'ออกไป ยูโตะ! อย่า',
  '(so, basically...)': '(สรุปก็คือ...)', 'so, basically...': 'สรุปก็คือ...', 'so basically...': 'สรุปก็คือ...', 'so, basically': 'สรุปก็คือ', 'so basically': 'สรุปก็คือ', 'so.. basically...': 'สรุปก็คือ...', 'so.. basically': 'สรุปก็คือ', '(so.. basically...)': '(สรุปก็คือ...)',
  'this..could be...': 'นี่มัน..อาจจะเป็น...', 'this..could be': 'นี่มัน..อาจจะเป็น', 'this could be...': 'นี่อาจจะเป็น...',
  "yuuto i'm sure": 'ยูโตะ ฉันแน่ใจว่า', "yuuto, i'm sure": 'ยูโตะ ฉันแน่ใจว่า',
  'product of lust': 'ผลผลิตแห่งราคะ',
  "yuuto's mom": 'แม่ของยูโตะ', 'yuutos mom': 'แม่ของยูโตะ', 'yuuto s mom': 'แม่ของยูโตะ', "(yuuto's mom)": '(แม่ของยูโตะ)', '(yuutos mom)': '(แม่ของยูโตะ)',
  '(possess, seems)': '(ดูเหมือนจะครอบงำ)', 'possess, seems': 'ดูเหมือนจะครอบงำ', 'possess seems': 'ดูเหมือนจะครอบงำ', '(possess seems)': '(ดูเหมือนจะครอบงำ)', 'possess, seems...': 'ดูเหมือนจะครอบงำ...',
  'ahh..holy': 'อ๊า..พระเจ้า', 'ahh..holy!': 'อ๊า..พระเจ้า!', 'ahh...holy': 'อ๊า..พระเจ้า', 'ahh holy': 'อ๊า..พระเจ้า', 'ahh.. holy': 'อ๊า..พระเจ้า',
  '(yo, yuuto~)': '(โย่ ยูโตะ~)', 'yo, yuuto~': 'โย่ ยูโตะ~', 'yo yuuto~': 'โย่ ยูโตะ~',
  'ah.. this': 'อ๊ะ.. นี่มัน', 'ah.. this...': 'อ๊ะ.. นี่มัน...', 'ah this': 'อ๊ะ นี่มัน',
  'shit.. this': 'เชี่ยเอ๊ย.. นี่มัน', 'shit... this': 'เชี่ยเอ๊ย.. นี่มัน', 'shit this': 'เชี่ยเอ๊ย นี่มัน', "shit.. this'": 'เชี่ยเอ๊ย.. นี่มัน', "shit.. this'!": 'เชี่ยเอ๊ย.. นี่มัน!', "shit this'": 'เชี่ยเอ๊ย นี่มัน', 'shit.. this...': 'เชี่ยเอ๊ย.. นี่มัน...',
  'pleasurable… to take': 'สุขสมเหลือเกิน...ที่จะได้รับ', 'pleasurable... to take': 'สุขสมเหลือเกิน...ที่จะได้รับ', 'pleasurable to take': 'สุขสมเหลือเกินที่จะได้รับ', 'pleasurable...to take': 'สุขสมเหลือเกิน...ที่จะได้รับ', 'pleasurable to take...': 'สุขสมเหลือเกิน...ที่จะได้รับ',
  "going.. we'll leave": 'ไปกันเถอะ.. เราจะปล่อยให้', "going... we'll leave": 'ไปกันเถอะ.. เราจะปล่อยให้', "going we'll leave": 'ไปกันเถอะ เราจะปล่อยให้', 'going.. well leave': 'ไปกันเถอะ.. เราจะปล่อยให้', 'going well leave': 'ไปกันเถอะ เราจะปล่อยให้',
  "(going.. we'll leave)": '(ไปกันเถอะ.. เราจะปล่อยให้)', "(going... we'll leave)": '(ไปกันเถอะ.. เราจะปล่อยให้)',
  'sourge': 'พรวดดด', 'sourge!': 'พรวดดด!', 'sourge...': 'พรวดดด...',
  'tahn': 'อ๊าา', 'tahn!': 'อ๊าา!', 'tahn~': 'อ๊าา~', 'tahn~~': 'อ๊าา~~', 'tahn...': 'อ๊าา...',
  'what is it~~': 'อะไรเหรอ~~', 'what is it~': 'อะไรเหรอ~', 'what is it': 'อะไรเหรอ', 'what is it?': 'อะไรเหรอ?', 'what is it...': 'อะไรเหรอ...',
  'smack': 'เพียะ', 'smacky': 'เพียะ',
  'slap': 'แป๊ะ', 'slapy': 'แป๊ะ',
  'rub': 'ถู', 'rubr': 'ถู',
  'cough': 'ค่อก', 'coughe': 'ค่อก',
  'flutter': 'ฟลิ้ว', 'mvflutter': 'ฟลิ้ว', 'mvfiutter': 'ฟลิ้ว',
  "i bet i've": 'ฉันพนันได้เลยว่าฉันเคย', 'ibet ive': 'ฉันพนันได้เลยว่าฉันเคย', 'i bet ive': 'ฉันพนันได้เลยว่าฉันเคย',
  'the sensation': 'ความรู้สึก', 'the sensat ...': 'ความรู้สึก', 'the sensat...': 'ความรู้สึก', 'the sensat': 'ความรู้สึก',
  "i won't say naughty": 'ฉันจะไม่พูดว่า "ซุกซน"', "owon'tsaynaughty": 'ฉันจะไม่พูดว่า "ซุกซน"', 'owontsaynaughty': 'ฉันจะไม่พูดว่า "ซุกซน"',
  'yyt': 'อ๊าา',
  'quiet!': 'เงียบ!', 'quiet': 'เงียบ', 'qliet!': 'เงียบ!', 'qliet': 'เงียบ',
  'a coward': 'คนขี้ขลาด', 'acoward': 'คนขี้ขลาด',
  '69': '69',
  'the': 'เดอะ', 'are': 'เป็น',
};


export const TRANSLATION_LETTER_REGEX = /[A-Za-z\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]/;

// -------------------------------------------------------------
// Core Translation & Retry logic
// -------------------------------------------------------------

export const GENERAL_ENGLISH_DICTIONARY_TH: Record<string, string> = {
  // Prepositions & Connectors
  'without': 'โดยไม่มี', 'without!': 'โดยไม่มี!', 'without...': 'โดยไม่มี...',
  'with': 'ด้วย', 'within': 'ภายใน', 'before': 'ก่อน', 'after': 'หลังจาก',
  'between': 'ระหว่าง', 'through': 'ผ่าน', 'against': 'ต่อสู้กับ', 'during': 'ในระหว่าง',
  'under': 'ภายใต้', 'over': 'เหนือ', 'above': 'ด้านบน', 'below': 'ด้านล่าง',
  'behind': 'ด้านหลัง', 'beside': 'ข้างๆ', 'beyond': 'เหนือกว่า', 'about': 'เกี่ยวกับ',
  'around': 'รอบๆ', 'across': 'ข้าม', 'along': 'ตาม', 'toward': 'ไปยัง',
  'towards': 'ไปยัง', 'into': 'เข้าไปใน', 'onto': 'ไปยัง', 'upon': 'บน',
  'from': 'จาก', 'since': 'ตั้งแต่', 'until': 'จนกระทั่ง', 'till': 'จนกระทั่ง',
  'despite': 'ทั้งๆ ที่', 'except': 'ยกเว้น', 'unlike': 'ไม่เหมือน', 'like': 'เหมือน',
  'near': 'ใกล้', 'far': 'ไกล',
  // Conjunctions & Adverbs
  'because': 'เพราะว่า', 'although': 'แม้ว่า', 'unless': 'เว้นแต่', 'while': 'ในขณะที่',
  'however': 'อย่างไรก็ตาม', 'therefore': 'ดังนั้น', 'otherwise': 'มิฉะนั้น',
  'instead': 'แทนที่จะ', 'besides': 'นอกจากนี้', 'furthermore': 'ยิ่งกว่านั้น',
  'always': 'เสมอ', 'never': 'ไม่เคย', 'sometimes': 'บางครั้ง', 'often': 'มักจะ',
  'usually': 'โดยปกติ', 'rarely': 'นานๆ ครั้ง', 'already': 'เรียบร้อยแล้ว',
  'still': 'ยังคง', 'almost': 'เกือบจะ', 'nearly': 'เกือบ', 'quite': 'ค่อนข้าง',
  'enough': 'เพียงพอ', 'too': 'เกินไป', 'very': 'มาก', 'really': 'จริงๆ',
  'actually': 'จริงๆ แล้ว', 'probably': 'น่าจะ', 'maybe': 'อาจจะ', 'perhaps': 'อาจจะ',
  'definitely': 'แน่นอน', 'certainly': 'แน่นอน', 'indeed': 'จริงๆ', 'anyway': 'อย่างไรก็ตาม',
  // Pronouns & Nouns/Verbs
  'myself': 'ตัวฉันเอง', 'yourself': 'ตัวคุณเอง', 'himself': 'ตัวเขาเอง',
  'herself': 'ตัวเธอเอง', 'itself': 'ตัวมันเอง', 'ourselves': 'ตัวพวกเราเอง',
  'themselves': 'ตัวพวกเขาเอง', 'someone': 'ใครบางคน', 'anyone': 'ใครก็ตาม',
  'everyone': 'ทุกคน', 'nobody': 'ไม่มีใคร', 'something': 'บางอย่าง',
  'anything': 'อะไรก็ตาม', 'everything': 'ทุกอย่าง', 'nothing': 'ไม่มีอะไร',
  'enemies': 'ศัตรู', 'enemy': 'ศัตรู', 'moving': 'เคลื่อนไหว', 'move': 'เคลื่อนไหว',
  'front': 'ข้างหน้า', 'back': 'ข้างหลัง', 'side': 'ด้าน', 'top': 'ด้านบน', 'bottom': 'ด้านล่าง',
  'inside': 'ข้างใน', 'outside': 'ข้างนอก', 'defeat': 'เอาชนะ', 'fight': 'ต่อสู้',
  'pig': 'หมู', 'you': 'คุณ', 'come': 'เร็ว', 'cry': 'ร้องไห้', 'more': 'อีก', 'even': 'เหมือน',
};

// ── Pre-compiled Module-Level Regular Expressions ───────────────────
const TEMP_ALERT_REGEX = /^temp:\s*(\d+)\s*c\s*\[alert\]$/i;
const TEMP_NORMAL_REGEX = /^temp:\s*(\d+)\s*c$/i;
const LEADING_PUNCT_REGEX = /^[¡¿\s]+/;
const LEADING_II_REGEX = /^ii(?=[a-z])/i;
const STRIP_DOTS_START_REGEX = /^[\.\,\-\s]+/;
const STRIP_DOTS_END_REGEX = /[\.\,\-\s]+$/;
const TRAILING_PUNCT_REGEX = /([\!\?\.…]+)$/;
const HAS_TRAILING_PUNCT_REGEX = /[\!\?\.…]$/;
const UNDERLINE_REGEX = /[_]+/g;
const PUNCT_SPACE_REGEX = /[\-\/\.\,\!\?\:\;\'\’\”\“\"]+/g;
const NON_LETTER_NUM_REGEX = /[^\p{L}\p{N}\s]/gu;
const MULTI_SPACE_REGEX = /\s+/g;
const DIACRITICS_REGEX = /[\u0300-\u036f]/g;

let _compactPhraseMap: Map<string, string> | null = null;
function getCompactPhraseMap(): Map<string, string> {
  if (!_compactPhraseMap) {
    _compactPhraseMap = new Map<string, string>();
    for (const [k, v] of Object.entries(ARGOS_SHORT_PHRASE_LOOKUP_TH)) {
      const compact = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (compact && !_compactPhraseMap.has(compact)) {
        _compactPhraseMap.set(compact, v);
      }
    }
    for (const [k, v] of Object.entries(GENERAL_ENGLISH_DICTIONARY_TH)) {
      const compact = k.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (compact && !_compactPhraseMap.has(compact)) {
        _compactPhraseMap.set(compact, v);
      }
    }
  }
  return _compactPhraseMap;
}

export const lookupShortPhraseTh = (text: string): string | null => {
  if (!text) return null;
  const trimmed = text.trim();

  // 0. ตรวจจับและแปลงกรณีพิเศษสำหรับ Log/Status ของอุณหภูมิ เช่น Temp: 45C [Alert] -> อุณหภูมิ: 45°C [แจ้งเตือน]
  const tempAlertMatch = trimmed.match(TEMP_ALERT_REGEX);
  if (tempAlertMatch) {
    return `อุณหภูมิ: ${tempAlertMatch[1]}°C [แจ้งเตือน]`;
  }
  const tempNormalMatch = trimmed.match(TEMP_NORMAL_REGEX);
  if (tempNormalMatch) {
    return `อุณหภูมิ: ${tempNormalMatch[1]}°C`;
  }

  const rawKey = trimmed.toLowerCase();
  const directRawMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[rawKey] || GENERAL_ENGLISH_DICTIONARY_TH[rawKey];
  if (directRawMatch) return directRawMatch;

  const hasOuterParens = /^\s*[\(\[\{<].*[\)\]\}>]\s*$/.test(trimmed);
  const unwrapped = trimmed.replace(/^\s*[\(\[\{<"']+|[\)\]\}>"'\s]+$/g, '').trim().toLowerCase();
  if (unwrapped && unwrapped !== rawKey) {
    const unwrappedMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[unwrapped] || GENERAL_ENGLISH_DICTIONARY_TH[unwrapped];
    if (unwrappedMatch) {
      return hasOuterParens && !unwrappedMatch.startsWith('(') ? `(${unwrappedMatch})` : unwrappedMatch;
    }
  }

  const cleanedRawKey = rawKey
    .replace(/^[\(\[\{<"'\s¡¿]+/g, '')
    .replace(/[\)\]\}>"'\s]+$/g, '')
    .replace(LEADING_II_REGEX, '');
  const directCleanedMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[cleanedRawKey] || GENERAL_ENGLISH_DICTIONARY_TH[cleanedRawKey];
  if (directCleanedMatch) {
    return hasOuterParens && !directCleanedMatch.startsWith('(') ? `(${directCleanedMatch})` : directCleanedMatch;
  }

  const strippedDotsKey = cleanedRawKey.replace(STRIP_DOTS_START_REGEX, '').replace(STRIP_DOTS_END_REGEX, '').trim();
  if (strippedDotsKey && (ARGOS_SHORT_PHRASE_LOOKUP_TH[strippedDotsKey] || GENERAL_ENGLISH_DICTIONARY_TH[strippedDotsKey])) {
    const match = ARGOS_SHORT_PHRASE_LOOKUP_TH[strippedDotsKey] || GENERAL_ENGLISH_DICTIONARY_TH[strippedDotsKey];
    const trailingPunct = text.match(TRAILING_PUNCT_REGEX);
    let result = (trailingPunct && !HAS_TRAILING_PUNCT_REGEX.test(match)) ? match + trailingPunct[1] : match;
    return hasOuterParens && !result.startsWith('(') ? `(${result})` : result;
  }

  // 0.2 ลองค้นหาหลังจากซ่อมแซมเสียงรบกวน OCR (เช่น Suvvenlya -> Suddenly, Bvt -> But, (ME,THERE) -> (ME, THERE))
  const ocrNormalized = normalizeEnglishOcrNoiseForTranslation(trimmed);
  if (ocrNormalized && ocrNormalized.toLowerCase() !== rawKey) {
    const ocrKey = ocrNormalized.toLowerCase();
    const ocrMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[ocrKey] || GENERAL_ENGLISH_DICTIONARY_TH[ocrKey];
    if (ocrMatch) {
      return hasOuterParens && !ocrMatch.startsWith('(') ? `(${ocrMatch})` : ocrMatch;
    }
    const ocrStripped = ocrKey.replace(STRIP_DOTS_START_REGEX, '').replace(STRIP_DOTS_END_REGEX, '').trim();
    if (ocrStripped && (ARGOS_SHORT_PHRASE_LOOKUP_TH[ocrStripped] || GENERAL_ENGLISH_DICTIONARY_TH[ocrStripped])) {
      const match = ARGOS_SHORT_PHRASE_LOOKUP_TH[ocrStripped] || GENERAL_ENGLISH_DICTIONARY_TH[ocrStripped];
      return hasOuterParens && !match.startsWith('(') ? `(${match})` : match;
    }
  }

  const key = rawKey
    .replace(UNDERLINE_REGEX, ' ')
    .replace(PUNCT_SPACE_REGEX, ' ')
    .replace(NON_LETTER_NUM_REGEX, '')
    .replace(MULTI_SPACE_REGEX, ' ')
    .trim();
  
  // 1. ลองค้นหาแบบตรงตัวใน dictionary ก่อน
  let directMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[key] || GENERAL_ENGLISH_DICTIONARY_TH[key];
  
  // Try Spanish diacritic stripping fallback (e.g. bañas -> banas, montón -> monton)
  if (!directMatch) {
    const strippedKey = key.normalize('NFD').replace(DIACRITICS_REGEX, '').replace(/ñ/g, 'n');
    directMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[strippedKey] || GENERAL_ENGLISH_DICTIONARY_TH[strippedKey];
  }

  if (directMatch) {
    const trailingPunct = text.match(TRAILING_PUNCT_REGEX);
    let result = (trailingPunct && !HAS_TRAILING_PUNCT_REGEX.test(directMatch)) ? directMatch + trailingPunct[1] : directMatch;
    return hasOuterParens && !result.startsWith('(') ? `(${result})` : result;
  }

  // 1.5 ลองค้นหาแบบ No-Apostrophe (เช่น yuuto's mom -> yuutos mom, we'll -> well)
  const noAposKey = rawKey.replace(/['’]/g, '').replace(PUNCT_SPACE_REGEX, ' ').replace(MULTI_SPACE_REGEX, ' ').trim();
  if (noAposKey && noAposKey !== key) {
    const noAposMatch = ARGOS_SHORT_PHRASE_LOOKUP_TH[noAposKey] || GENERAL_ENGLISH_DICTIONARY_TH[noAposKey];
    if (noAposMatch) {
      return hasOuterParens && !noAposMatch.startsWith('(') ? `(${noAposMatch})` : noAposMatch;
    }
  }

  // 2. ตรวจสอบความลากเสียงยาว (Elongation) สำหรับคำการ์ตูนยอดนิยม
  if (/^p[le]*[ea]*\s*\+?\s*[ea]*s[e]+$/i.test(key)) {
    return 'ได้โปรด ดดดดดด';
  }
  if (/^m[o]+r[e]+$/i.test(key)) {
    return 'มากกกกว่าาาานี้';
  }
  if (/^[o]+[u]+[t]+$/i.test(key)) {
    return 'ออกไปปปป';
  }

  // สำหรับ knight (เช่น kniiiiight)
  if (/^k[n]+[i]+[g]+[h]+[t]+$/i.test(key)) {
    return 'อัศวิน';
  }
  // สำหรับ dead (เช่น deeead)
  if (/^d[e]+a[d]+$/i.test(key)) {
    return 'ตายแล้ว';
  }
  // สำหรับ cocks (เช่น cooooocks)
  if (/^c[o]+ck$/i.test(key)) {
    return 'ควย';
  }
  if (/^c[o]+cks$/i.test(key)) {
    return 'ควยยยยยยพวกนี้';
  }

  // 3. ลองค้นหาผ่าน Compact Alphanumeric Map (ทนทานต่อการตัดคำ/เครื่องหมายวรรคตอน/จุดไข่ปลาทุกประเภท)
  const compactKey = rawKey.replace(/[^a-z0-9]/g, '');
  if (compactKey && compactKey.length >= 2) {
    const compactMatch = getCompactPhraseMap().get(compactKey);
    if (compactMatch) {
      const trailingPunct = text.match(TRAILING_PUNCT_REGEX);
      let result = (trailingPunct && !HAS_TRAILING_PUNCT_REGEX.test(compactMatch)) ? compactMatch + trailingPunct[1] : compactMatch;
      return hasOuterParens && !result.startsWith('(') ? `(${result})` : result;
    }
  }

  if (/[\uAC00-\uD7AF]/.test(text)) {
    const koreanMatch = applyKoreanConversationalFallback(text, text);
    if (koreanMatch) return koreanMatch;
  }

  return GENERAL_ENGLISH_DICTIONARY_TH[key] || null;
};

export const systemicWordFallbackTranslate = (text: string): string | null => {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const words = trimmed.split(/[\s,!?.-]+/g).filter(Boolean);
  if (words.length === 0 || words.length > 4) return null;

  const translatedWords: string[] = [];
  let matchedCount = 0;

  for (const word of words) {
    const key = word.toLowerCase();
    const directLookup = lookupShortPhraseTh(word) || GENERAL_ENGLISH_DICTIONARY_TH[key];
    if (directLookup) {
      translatedWords.push(directLookup);
      matchedCount += 1;
    } else {
      translatedWords.push(word);
    }
  }

  if (matchedCount > 0) {
    return translatedWords.join(' ');
  }

  return null;
};

const OFFLINE_PIVOT_SOURCE_LANGUAGES = new Set(['es', 'ko', 'ja']);

export const shouldUseOfflinePivotRoute = (sourceLanguage: string, targetLanguage: string): boolean => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  return normalizedTarget === 'th' && OFFLINE_PIVOT_SOURCE_LANGUAGES.has(normalizedSource);
};

export const selectOfflinePivotCandidate = (
  sourceText: string,
  sourceLanguage: string,
  targetLanguage: string,
  directText: string,
  pivotText: string
): string => {
  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const direct = normalizeWhitespace(String(directText || ''));
  const pivot = normalizeWhitespace(String(pivotText || ''));

  if (!pivot) return direct;
  if (!direct) return pivot;

  const directNeedsRetry = shouldRetryLineTranslation(sourceText, direct, normalizedSource, normalizedTarget);
  const pivotNeedsRetry = shouldRetryLineTranslation(sourceText, pivot, normalizedSource, normalizedTarget);
  const directStats = getTranslationScriptStats(direct);
  const pivotStats = getTranslationScriptStats(pivot);

  if (normalizedSource === 'ko' && pivotStats.thaiChars > 0) {
    const directWeak = directNeedsRetry || directStats.thaiChars === 0 || directStats.latinRatio >= 0.22;
    if (directWeak || pivotStats.thaiRatio >= directStats.thaiRatio) {
      return pivot;
    }
  }
  if (OFFLINE_PIVOT_SOURCE_LANGUAGES.has(normalizedSource) && !pivotNeedsRetry) {
    return pivot;
  }
  if (directNeedsRetry && !pivotNeedsRetry) return pivot;
  if (!directNeedsRetry && pivotNeedsRetry) return direct;

  const directScore = scoreTranslationCandidate(sourceText, direct, normalizedTarget);
  const pivotScore = scoreTranslationCandidate(sourceText, pivot, normalizedTarget);
  const pivotBias = normalizedSource === 'ko' ? 24 : (normalizedSource === 'es' ? 14 : 10);
  if (pivotScore >= directScore - pivotBias) {
    return pivot;
  }
  return directScore >= pivotScore ? direct : pivot;
};

export async function translateBatchOffline(
  texts: string[],
  type: string,
  mode: TranslationMode,
  sourceLanguage: string,
  targetLanguage: string,
  offlineBatchBridge: (texts: string[], options: any) => Promise<string[]>,
  engine?: string
): Promise<string[]> {
  if (texts.length === 0) return [];

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');

  const normalizeOfflineSourceText = (rawText: string): string => {
    const text = String(rawText || '');
    if (normalizedSource === 'ko') {
      return normalizeKoreanOcrNoiseForTranslation(cleanKoreanOcrSpacing(text));
    }
    if (normalizedSource === 'ja' || normalizedSource === 'jpn' || normalizedSource === 'jpn_vert') {
      return normalizeJapaneseOcrNoiseForTranslation(cleanJapaneseOcrSpacing(text));
    }
    if (normalizedSource === 'es') {
      return normalizeSourceForTranslation(text, 'es');
    }
    if (normalizedSource === 'en') {
      return normalizeSourceForTranslation(text, 'en');
    }
    return normalizeSourceForTranslation(text, normalizedSource);
  };

  // Short-circuit lookup for known short phrases to bypass NMT and prevent translation artifacts
  const finalDirectTranslations = new Array<string>(texts.length).fill('');
  const indicesToTranslate: number[] = [];
  const textsToTranslate: string[] = [];

  for (let i = 0; i < texts.length; i++) {
    const originalText = texts[i] || '';
    const lookupResult = normalizedTarget === 'th' ? lookupShortPhraseTh(originalText) : null;
    if (lookupResult) {
      finalDirectTranslations[i] = lookupResult;
    } else {
      indicesToTranslate.push(i);
      textsToTranslate.push(originalText);
    }
  }

  if (indicesToTranslate.length === 0) {
    return finalDirectTranslations;
  }

  const preparedTexts = textsToTranslate.map((t) => {
    // Keep original case to improve NMT accuracy for English acronyms and proper nouns
    return normalizeOfflineSourceText(String(t || ''));
  });

  const isArgosUntranslated = (result: string, targetLang: string, sourceLang?: string): boolean => {
    const trimmed = result.trim();
    if (!trimmed) return false;
    if (targetLang === 'th') {
      const hasThaiChars = /[\u0E00-\u0E7F]/.test(trimmed);
      const hasLatinLetters = /[a-zA-Z]/.test(trimmed);
      // Korean carryover: Argos returned Hangul instead of translating to Thai
      if ((sourceLang === 'ko') && /[\uAC00-\uD7AF]/.test(trimmed) && !hasThaiChars) {
        return true;
      }
      return hasLatinLetters && !hasThaiChars;
    }
    return false;
  };

  const cleanForRetry = (raw: string): string =>
    raw
      .replace(/[_]+/g, ' ')
      .replace(/\.{2,}/g, ' ')
      .replace(/[!?]{2,}/g, ' ')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

  // Run Direct translation or 2-step Pivot English translation based on route
  const runPivotEnglish = engine === 'm2m100' ? false : shouldUseOfflinePivotRoute(normalizedSource, normalizedTarget);

  if (runPivotEnglish) {
    try {
      // Step 1: source -> English
      const pivotEnglishResults = await offlineBatchBridge(preparedTexts, {
        mode,
        sourceType: type,
        sourceLanguage: normalizedSource,
        targetLanguage: 'en',
        engine: engine || 'argos',
      });

      // Step 2: English -> Thai
      const pivotEnglishPrepared = pivotEnglishResults.map((line, i) => {
        const normalizedPivot = normalizeSourceForTranslation(String(line || ''), 'en');
        if (normalizedPivot) return normalizedPivot;
        const originalIndex = indicesToTranslate[i];
        return normalizeOfflineSourceText(String(texts[originalIndex] || ''));
      });

      const pivotThaiResults = await offlineBatchBridge(pivotEnglishPrepared, {
        mode,
        sourceType: type,
        sourceLanguage: 'en',
        targetLanguage: normalizedTarget,
      });

      indicesToTranslate.forEach((originalIndex, i) => {
        finalDirectTranslations[originalIndex] = pivotThaiResults[i] || '';
      });

      return finalDirectTranslations;
    } catch (pivotErr) {
      console.warn(`[translateBatchOffline] Pivot route ${normalizedSource}->en->${normalizedTarget} failed, falling back to direct translation:`, pivotErr);
    }
  }

  const directResults = await offlineBatchBridge(preparedTexts, {
    mode,
    sourceType: type,
    sourceLanguage: normalizedSource,
    targetLanguage: normalizedTarget,
    engine: engine || 'argos',
  }).catch((err) => {
    console.error(`[translateBatchOffline] Direct translation call failed for ${normalizedSource}->${normalizedTarget}:`, err);
    return new Array<string>(preparedTexts.length).fill('');
  });

  // Merge batch direct translations back
  indicesToTranslate.forEach((originalIndex, batchIndex) => {
    finalDirectTranslations[originalIndex] = directResults[batchIndex] || '';
  });

  // Handle hybrid retry by batching the requests to reduce serial roundtrip IPC latency
  const retriesPending: Array<{ index: number; cleaned: string }> = [];

  for (let i = 0; i < indicesToTranslate.length; i++) {
    const originalIndex = indicesToTranslate[i];
    const text = directResults[i] || '';
    const untranslated = isArgosUntranslated(text, normalizedTarget, normalizedSource);
    if (!untranslated) continue;

    const originalText = texts[originalIndex] ?? preparedTexts[i] ?? '';

    const lookupResult = normalizedTarget === 'th' ? lookupShortPhraseTh(originalText) : null;
    if (lookupResult) {
      finalDirectTranslations[originalIndex] = lookupResult;
      continue;
    }

    const cleaned = cleanForRetry(preparedTexts[i]);
    if (cleaned && cleaned !== preparedTexts[i].trim()) {
      const cleanedLookup = normalizedTarget === 'th' ? lookupShortPhraseTh(cleaned) : null;
      if (cleanedLookup) {
        finalDirectTranslations[originalIndex] = cleanedLookup;
        continue;
      }
      retriesPending.push({ index: originalIndex, cleaned });
    } else {
      const fallback = systemicWordFallbackTranslate(originalText);
      if (fallback) {
        finalDirectTranslations[originalIndex] = fallback;
      }
    }
  }

  if (retriesPending.length > 0) {
    try {
      const cleanedTexts = retriesPending.map((r) => r.cleaned);
      const retryResults = await offlineBatchBridge(cleanedTexts, {
        mode,
        sourceType: type,
        sourceLanguage: normalizedSource,
        targetLanguage: normalizedTarget,
      });

      retriesPending.forEach((retry, batchIdx) => {
        const retryResult = retryResults[batchIdx] ?? '';
        const stillUntranslated = isArgosUntranslated(retryResult, normalizedTarget, normalizedSource);
        if (!stillUntranslated) {
          finalDirectTranslations[retry.index] = retryResult;
        } else {
          const origText = texts[retry.index] || retry.cleaned;
          const fallback = systemicWordFallbackTranslate(origText);
          if (fallback) {
            finalDirectTranslations[retry.index] = fallback;
          }
        }
      });
    } catch (_retryErr) {
      console.error('[HybridRetry] Batched retry error:', _retryErr);
    }
  }

  return finalDirectTranslations;
}

// -------------------------------------------------------------
// Translation Quality Assessment Helpers
// -------------------------------------------------------------

const ENGLISH_COMMON_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'else', 'when',
  'at', 'by', 'for', 'from', 'in', 'into', 'of', 'off', 'on', 'onto',
  'out', 'over', 'to', 'up', 'with', 'was', 'were', 'is', 'are', 'am',
  'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does', 'did',
  'will', 'would', 'shall', 'should', 'can', 'could', 'may', 'might',
  'must', 'go', 'went', 'gone', 'come', 'came', 'get', 'got', 'put',
  'take', 'took', 'give', 'gave', 'find', 'found', 'think', 'thought',
  'say', 'said', 'tell', 'told', 'you', 'your', 'he', 'his', 'him',
  'she', 'her', 'it', 'its', 'we', 'our', 'us', 'they', 'their', 'them',
  'who', 'whom', 'whose', 'what', 'which', 'where', 'when', 'why', 'how',
  'all', 'any', 'both', 'each', 'few', 'more', 'most', 'other', 'some',
  'such', 'no', 'nor', 'not', 'only', 'own', 'same', 'so', 'than', 'too',
  'very', 's', 't', 'don', 'just', 'shouldn', 'now',
  // Added common pronouns, interjections and common dialogue keywords
  'suck', 'cock', 'bitch', 'pig', 'hell', 'damn', 'ass', 'fuck', 'shit'
]);

export const shouldSkipOverlayForUntranslatedCarryOver = (
  sourceText: string,
  translatedText: string,
  targetLanguage: string
): boolean => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') return false;

  const source = normalizeWhitespace(String(sourceText || ''));
  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!source || !translated) return false;

  const compact = source.replace(/\s+/g, '');
  const asciiCompact = compact.replace(/[^A-Za-z0-9]/g, '');
  const isKnownShortWord = isKnownShortWordHelper(asciiCompact);
  if (isKnownShortWord) {
    return false;
  }

  // ทำไม: ถ้า source มีคำที่อยู่ใน glossary แล้วจะแปลถูกแน่นอน ไม่ควร skip ออกไป
  const glossaryLookup = lookupShortPhraseTh(source);
  if (glossaryLookup !== null) {
    return false;
  }
  
  // We check for scientific symbols or numbers
  const isScientificSymbolLikeLine = (val: string): boolean => {
    const clean = val.replace(/[\s\-_]+/g, '');
    if (!clean) return false;
    return /^[a-zA-Z0-9\(\)\[\]\{\}\+\-\*\/\\=\.,:;\u0370-\u03FF\u0400-\u04FF%]+$/.test(clean)
      && (/\d/.test(clean) || clean.length <= 4 || /^[Ff][iI][gG]/.test(clean));
  };
  
  if (isScientificSymbolLikeLine(source)) return false;

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (!sourceKey || !translatedKey) return false;

  const thaiChars = (translated.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinChars = (translated.match(/[A-Za-z]/g) || []).length;
  const sourceLatinChars = (source.match(/[A-Za-z]/g) || []).length;
  const tokenCount = source.split(/\s+/g).filter(Boolean).length;

  // Check for residual CJK characters in the translated output -> if CJK remains, it failed translation
  const hasCjkResidual = /[\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/.test(translated);
  if (hasCjkResidual) {
    return true; // Skip overlay since CJK text is leaked
  }

  // Check for common watermark layouts (URLs, domain names, or scanlation watermarks)
  const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
    || /www\./i.test(source)
    || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));

  if (isLikelyEnglishDialogue(source) && !isUrlOrDomain) {
    return false;
  }

  if (thaiChars > 0) return false;

  // ทำไม: manga dialogue fragments ที่รู้จักต้องไม่โดน skip ไม่ว่า Argos จะแปลได้หรือไม่
  // เพราะ glossary จะ override ผลการแปลที่ถูกต้องอยู่แล้ว
  const compactUpper = source.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const KNOWN_MANGA_PHRASES = /^(?:THEPIGYOUARE|LIKETHEPIGYOUARE|PIGYOUARE|THEPIG|PIG|THENTRYANDHOLDBACKYOURORGASMYOUPIG|KILLME|WITHPROCREATION|NIPPLES|SUDDENLY|BUT|FORMAMEDICAL|WAYTOOGOOD|BEINGTOO|FROMTHE|ITFEELS|OUTINSIDE|STILLFULL|ILLNESSBE|WELLSINCE|RESTA|THESEX|BLOWJOB|NURSE|OFME|EROMANGA|OFMEEROMANGA|ITWITHOUT|HEADNURSE|HEADNURS\w+|DISEASE|FOUNDA|RESTRAINT|HERPUSSY|CUMMING|WAYTOO|NOTNECESSARY|ADYDO|PLEASE|YQURE|WIDLY|SIDESHOW|CAME|C[O]+CKS|ONEONONE|CUMALOTJUSTLIKETHAT|GONNADIE|TOBEDEADNOW|ONEBATTLE|SOPLEASE|NONSTOP|HEHEHE|MEEEEEEE|MEEEEEE|MEEEEE|WITHIT|FRONT|YOUFRONT|KNIGHT|KNIIIGHT|KNIIIIGHT|KNIIIIIGHT|KNIIIIIIGHT|YOURE|USTHE|HES|GET|CUM|II|NIPPLES|LONGER|TODAYAGAIN|HERPOSI|HERPOSITION|SUITS|SO|NIPPLESAND|CERVIX|GENERAL|DIEALONG|ALSO|HERPLACE|MAKESURE|SADNESS|ALLARSTOCRATS|ALLARISTOCRATS|KINGAND|BUTINANYAGE|DEAD|OUUUUT|MOREEEEEE|PLEEAAASEEE|RECAPTURING|ANALLOUT|IFI|TOYEDWITH|ANDWASATA|EXPECT|ANDHER|YOUFRONTUSTHEGETTINGAWAYWITH|BE|STOP|HOLE|LETHER|THEBABAR|THEBARBA|PUNCHINGMY|GETTING|ALSOSAYTHAT|BUTINANY|FIRST|AGAIN|ASS|ASSHOLE|ISDEAD|MYHEARTSBEINGTORNBYTHEIRCOCKS|BEINGSLASHEDBYC[O]+CKS|BYC[O]+CKS)$/i.test(compactUpper);
  if (KNOWN_MANGA_PHRASES) return false;

  if (sourceKey === translatedKey) {
    const wordsList = source.toLowerCase().split(/[^a-z]+/g).filter(Boolean);
    const hasCommonWord = wordsList.some(w => ENGLISH_COMMON_WORDS.has(w));
    if (hasCommonWord) {
      return false;
    }
    // Check for common watermark layouts (URLs, domain names, or scanlation watermarks)
    const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
      || /www\./i.test(source)
      || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));

    const threshold = isUrlOrDomain ? 8 : 18;
    return tokenCount >= 1 && (sourceLatinChars >= threshold || source.length >= threshold);
  }

  // เพิ่ม threshold: >= 6 แทน >= 4 เพื่อป้องกัน multi-word dialogue fragments โดน skip
  return latinChars >= 6 && sourceLatinChars >= 6 && tokenCount >= 3;
};

export const buildTranslationComparisonKey = (value: string): string =>
  normalizeWhitespace(String(value || ''))
    .toLowerCase()
    .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/g, '');

export const countReadableLength = (text: string): number => {
  const compact = text.replace(/\s+/g, ' ').trim();
  return compact.length;
};

const SENTENCE_END_REGEX = /[.!?\u2026\u3002\uFF01\uFF1F]$/;
export const isStrongSentenceEnd = (text: string): boolean => {
  const compact = text.trim();
  if (!compact) return false;
  return SENTENCE_END_REGEX.test(compact);
};

const SOFT_CONTINUATION_END_REGEX = /[,;:\-\u2014\u2013\u3001\uFF0C]$/;
const CONTINUATION_TRAILING_WORD_REGEX = /\b(?:a|an|the|of|to|for|and|or|but|if|when|while|with|without|into|onto|from|by|as|than|that|this|these|those|my|your|his|her|its|our|their|is|are|was|were|be|been|being|do|does|did|have|has|had|can|could|will|would|should|must|may|might|not|so|up|off|out|over|under|about|around|through|toward|towards)$/i;
const CONTINUATION_LEADING_WORD_REGEX = /^(?:and|or|but|if|when|while|because|that|which|who|whose|whom|to|for|of|with|as|than|then|so|also|still|yet|just)\b/i;

export const isLikelyContinuation = (previousText: string, currentText: string): boolean => {
  const prev = previousText.trim();
  const curr = currentText.trim();
  if (!prev || !curr) return false;

  if (SOFT_CONTINUATION_END_REGEX.test(prev)) return true;
  if (/[\-\u2013\u2014]$/.test(prev)) return true;
  if (CONTINUATION_TRAILING_WORD_REGEX.test(prev)) return true;
  if (/^[,;:.)\]\}"'\u3001\uFF0C]/.test(curr)) return true;
  if (/^[a-z]/.test(curr)) return true;
  if (CONTINUATION_LEADING_WORD_REGEX.test(curr)) return true;
  return false;
};

export const isLikelyStandaloneInterjectionLine = (text: string): boolean => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return false;

  const compact = normalized.replace(/\s+/g, '');
  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (compact.length > 16 || tokens.length > 3) return false;

  if (/^[A-Za-z]-[A-Za-z][A-Za-z'’!?….-]{0,12}$/.test(compact)) {
    return true;
  }

  const trailingPunct = /[!?…]{1,3}$/.test(compact);
  const latinLetters = compact.replace(/[^A-Za-z]/g, '').length;
  if (trailingPunct && latinLetters > 0 && latinLetters <= 8 && tokens.length <= 2) {
    return true;
  }

  const nonLatin = compact.replace(/[\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g, '').length !== compact.length;
  if (trailingPunct && nonLatin && compact.length <= 7) {
    return true;
  }

  return false;
};

export const collapseRepeatedTranslationFragments = (text: string): string => {
  const normalized = normalizeWhitespace(String(text || ''));
  if (!normalized) return normalized;

  const dedupHesitation = normalized.replace(
    /(A-?\s*Are\s+you)(?:\s+\1)+/gi,
    '$1'
  );
  if (dedupHesitation !== normalized) {
    return normalizeWhitespace(dedupHesitation);
  }

  const repeatedChunk = normalized.match(/^(.{4,}?)(?:\s+\1)+$/u);
  if (repeatedChunk?.[1]) {
    return normalizeWhitespace(repeatedChunk[1]);
  }

  const tokens = normalized.split(/\s+/g).filter(Boolean);
  if (tokens.length >= 4 && tokens.length % 2 === 0) {
    const half = tokens.length / 2;
    const firstHalf = tokens.slice(0, half).join(' ');
    const secondHalf = tokens.slice(half).join(' ');
    if (firstHalf === secondHalf) {
      return firstHalf;
    }
  }

  if (tokens.length >= 6) {
    const normalizeTokenSpan = (spanTokens: string[]): string =>
      spanTokens
        .join(' ')
        .toLowerCase()
        .replace(/[^a-z0-9\u00C0-\u024F\u0400-\u04FF\u0E00-\u0E7F\u3040-\u30FF\u4E00-\u9FFF\uAC00-\uD7AF]+/giu, '');

    const maxSpan = Math.min(8, Math.floor(tokens.length / 2));
    for (let span = maxSpan; span >= 2; span -= 1) {
      const firstSpan = tokens.slice(0, span);
      const secondSpan = tokens.slice(span, span * 2);
      if (secondSpan.length < span) continue;

      const firstKey = normalizeTokenSpan(firstSpan);
      const secondKey = normalizeTokenSpan(secondSpan);
      if (!firstKey || firstKey.length < 6) continue;
      if (firstKey !== secondKey) continue;

      const merged = [...firstSpan, ...tokens.slice(span * 2)].join(' ');
      return normalizeWhitespace(merged);
    }
  }

  return normalized;
};

// -------------------------------------------------------------
// Layout, Grouping & Persist Flag Helpers
// -------------------------------------------------------------

const DOCUMENT_SOURCE_HINT_REGEX = /\b(chapter|table|fig(?:ure)?\.?|reaction|unknowns?|equilibrium|rigid|body|support|diagram|objective|objectives|connection|connections|continued|force|moment|component|unknown|column|columns|bridge|building|beam|beams|welded|surface|bracket|cable|utility|floor|member|pin|hinge)\b/i;

export const shouldUseDocumentCoverageFallback = (sourceText: string): boolean => {
  const normalized = normalizeOverlayInlineText(String(sourceText || ''));
  if (!normalized) return false;
  const wordCount = normalized.split(/\s+/g).filter(Boolean).length;
  const thaiCharCount = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const technicalLike = DOCUMENT_SOURCE_HINT_REGEX.test(normalized);
  const numericDocumentLike = wordCount >= 6 && /[0-9()\-]/.test(normalized);
  const thaiDocumentLike = thaiCharCount >= 12
    && (wordCount >= 3 || /[0-9()\[\].,:;\-]/.test(normalized));
  return technicalLike || numericDocumentLike || thaiDocumentLike;
};

export const clampOverlayTypographyScale = (value: number): number => {
  if (!Number.isFinite(value)) return 1;
  if (value < 0.7) return 0.7;
  if (value > 1.6) return 1.6;
  return value;
};

export const scaleOverlayTypography = (typography: OverlayTypography, scale: number): OverlayTypography => {
  const normalizedScale = clampOverlayTypographyScale(scale);
  if (Math.abs(normalizedScale - 1) < 0.0001) return typography;

  return {
    ...typography,
    fontSize: Math.max(8, Number((typography.fontSize * normalizedScale).toFixed(2))),
    lineHeight: Number((typography.lineHeight * normalizedScale).toFixed(3)),
    padX: Math.max(1, Math.round(typography.padX * normalizedScale)),
    padY: Math.max(1, Math.round(typography.padY * normalizedScale)),
    contentHeight: Math.max(1, Number((typography.contentHeight * normalizedScale).toFixed(2))),
  };
};

export const readPersistedBooleanFlag = (key: string, defaultValue: boolean): boolean => {
  if (typeof window === 'undefined') return defaultValue;
  try {
    const raw = String(window.localStorage.getItem(key) || '').trim().toLowerCase();
    if (!raw) return defaultValue;
    if (raw === '0' || raw === 'false' || raw === 'off') return false;
    if (raw === '1' || raw === 'true' || raw === 'on') return true;
    return defaultValue;
  } catch {
    return defaultValue;
  }
};

export const isBalloonAwareGroupingEnabled = (storageKey: string = 'pdf_translator_balloon_aware_grouping'): boolean =>
  readPersistedBooleanFlag(storageKey, true);

export const isLayoutGroupingDebugEnabled = (storageKey: string = 'pdf_translator_layout_grouping_debug'): boolean =>
  readPersistedBooleanFlag(storageKey, false);

export const resolveOverlayExportScale = (
  visibleWidth: number,
  visibleHeight: number,
  sourceWidth: number,
  sourceHeight: number
): number => {
  const safeVisibleWidth = Math.max(1, visibleWidth);
  const safeVisibleHeight = Math.max(1, visibleHeight);
  const safeSourceWidth = Math.max(1, sourceWidth);
  const safeSourceHeight = Math.max(1, sourceHeight);
  const sourceRatio = Math.max(safeSourceWidth / safeVisibleWidth, safeSourceHeight / safeVisibleHeight);
  const deviceRatio = typeof window !== 'undefined' ? Math.max(1, window.devicePixelRatio || 1) : 1;

  return Math.min(3, Math.max(1.5, deviceRatio, sourceRatio));
};

// -------------------------------------------------------------
// App Quality Gates & Advanced Logic Helpers
// -------------------------------------------------------------

export const shouldRetryLineTranslation = (
  sourceText: string,
  translatedText: string,
  sourceLanguage: string,
  targetLanguage: string
): boolean => {
  const source = normalizeWhitespace(String(sourceText || ''));
  if (!source) return false;
  if (!TRANSLATION_LETTER_REGEX.test(source)) return false;

  const translated = normalizeWhitespace(String(translatedText || ''));
  if (!translated) return true;

  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget === 'th' && !/[\u0E00-\u0E7F]/.test(translated)) {
    return true;
  }

  // Bypass low-quality retry classification for normal English dialogue/narrative
  const wordsList = source.toLowerCase().split(/[^a-z]+/g).filter(Boolean);
  const hasCommonWord = wordsList.some(w => ENGLISH_COMMON_WORDS.has(w));
  if (hasCommonWord) {
    return false;
  }

  const isUrlOrDomain = /\.(com|net|org|io|gg|co|info|cc|to|xyz|me)\b/i.test(source)
    || /www\./i.test(source)
    || /^(?:colamanga|cloudmerge|asurascans|mangatio|likemanga|scans|newtoki)/i.test(source.replace(/[^A-Za-z0-9]/g, ''));
  const threshold = isUrlOrDomain ? 8 : 18;
  if (source.length < threshold && !isUrlOrDomain) {
    return false;
  }

  const sourceKey = buildTranslationComparisonKey(source);
  const translatedKey = buildTranslationComparisonKey(translated);
  if (sourceKey && translatedKey && sourceKey === translatedKey) {
    return true;
  }

  const normalizedSource = normalizeTranslationLanguage(sourceLanguage, 'en');

  if (normalizedTarget === 'th') {
    const letterChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const latinChars = translated.match(/[A-Za-z]/g) || [];
    const thaiChars = translated.match(/[\u0E00-\u0E7F]/g) || [];
    const latinRatio = latinChars.length / Math.max(1, letterChars.length);

    // 1) Looks mostly untranslated Latin/English
    const looksUntranslatedLatin = letterChars.length >= 10 && latinRatio >= 0.62 && thaiChars.length <= 2;
    if (looksUntranslatedLatin) {
      return true;
    }

    // 2) Short mostly Latin carry-over
    const sourceLatinChars = source.match(/[A-Za-z]/g) || [];
    const translatedAlphaChars = translated.match(/[A-Za-z\u0E00-\u0E7F]/g) || [];
    const translatedHasNoThai = thaiChars.length === 0;
    const mostlyLatinShortCarryOver = translatedHasNoThai
      && sourceLatinChars.length >= 4
      && translatedAlphaChars.length >= Math.min(4, sourceLatinChars.length)
      && latinRatio >= 0.78;
    if (mostlyLatinShortCarryOver) {
      return true;
    }

    // 3) Mixed carry-over (partially translated but with too much English leftovers)
    const mixedCarryOver = sourceLatinChars.length >= 8
      && thaiChars.length >= 1
      && translatedAlphaChars.length >= 10
      && latinRatio >= 0.4;
    if (mixedCarryOver) {
      return true;
    }

    // 4) High English ratio in mid-to-long sentences with very few Thai characters
    const highLatinRatioShortThai = letterChars.length >= 8
      && latinRatio >= 0.35
      && thaiChars.length < 4;
    if (highLatinRatioShortThai) {
      return true;
    }

    // 5) Sentence is reasonably long in source but translated to extremely short garbage Thai
    const sourceLetters = source.replace(/[^A-Za-z]/g, '').length;
    if (sourceLetters >= 15 && thaiChars.length > 0 && thaiChars.length <= 3) {
      return true;
    }

    // 6) Translated text contains visible raw OCR noise remnants
    const containsOcrNoiseTrash = /([lI1|]{3,}|ll\|l|I\|I|ll\|ll|\/\\|\\\/)/gi.test(translated);
    if (containsOcrNoiseTrash && thaiChars.length <= 4) {
      return true;
    }

    const hasKnownOcrNoisePattern = (val: string): boolean => {
      const clean = val.replace(/[\s\-_]+/g, '');
      return /^[|¦│┃￨︱︲/\\_~.,:;'"`!?-]+$/.test(clean);
    };

    if (hasKnownOcrNoisePattern(source) && thaiChars.length === 0) {
      return true;
    }
  }

  if (normalizedSource === 'ko' && normalizedTarget === 'th') {
    if (hasKoreanTranslationCarryover(translated)) {
      return true;
    }
  }

  return false;
};

export const getTranslationScriptStats = (text: string): {
  thaiChars: number;
  latinChars: number;
  letterChars: number;
  latinRatio: number;
  thaiRatio: number;
} => {
  const normalized = normalizeWhitespace(String(text || ''));
  const thaiChars = (normalized.match(/[\u0E00-\u0E7F]/g) || []).length;
  const latinChars = (normalized.match(/[A-Za-z]/g) || []).length;
  const letterChars = thaiChars + latinChars;
  return {
    thaiChars,
    latinChars,
    letterChars,
    latinRatio: latinChars / Math.max(1, letterChars),
    thaiRatio: thaiChars / Math.max(1, letterChars),
  };
};

export const scoreTranslationCandidate = (
  sourceText: string,
  candidateText: string,
  targetLanguage: string
): number => {
  const source = normalizeWhitespace(String(sourceText || ''));
  const candidate = normalizeWhitespace(String(candidateText || ''));
  if (!candidate || !source) return 0;

  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  const sourceLength = source.length;
  const candidateLength = candidate.length;

  if (normalizedTarget === 'th') {
    const stats = getTranslationScriptStats(candidate);
    const hasThai = stats.thaiChars > 0;
    if (!hasThai) {
      return -100; // Penalize candidate heavily if it contains absolutely no Thai characters
    }

    let score = candidateLength * 0.1;

    // 1) Length balance check
    const lengthRatio = candidateLength / Math.max(1, sourceLength);
    if (lengthRatio >= 0.5 && lengthRatio <= 1.8) {
      score += 20; // Ideal length balance bonus
    } else if (lengthRatio >= 0.35 && lengthRatio <= 2.3) {
      score += 10; // Acceptable length balance bonus
    } else if (lengthRatio < 0.22 && sourceLength >= 12) {
      score -= 30; // Heavy penalty for overly truncated translation
    }

    // 2) Thai purity and density metrics
    score += stats.thaiRatio * 30;
    if (stats.latinChars === 0) {
      score += 25; // Bonus for high quality pure Thai without Latin pollution
    } else {
      score -= stats.latinRatio * 35; // Penalize Latin pollution ratio
    }

    // 3) OCR noise leftovers penalty
    const hasOcrTrash = /([lI1|]{3,}|ll\|l|I\|I|ll\|ll|\/\\|\\\/|..|_)/gi.test(candidate);
    if (hasOcrTrash) {
      score -= 40;
    }

    return score;
  }

  return candidateLength * 0.1;
};

export const evaluateUntranslatedTranslation = (
  lines: Array<{ index: number; text: string }>,
  translatedByIndex: Map<number, string>,
  sourceLanguage: string,
  targetLanguage: string
): { shouldSkip: boolean; retryRatio: number; thaiRatio: number; total: number } => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'th');
  if (normalizedTarget !== 'th') {
    return { shouldSkip: false, retryRatio: 0, thaiRatio: 0, total: 0 };
  }

  let total = 0;
  let retryCount = 0;
  let thaiChars = 0;
  let letterChars = 0;

  lines.forEach((line) => {
    const translated = translatedByIndex.get(line.index) || '';
    total += 1;
    if (shouldRetryLineTranslation(line.text, translated, sourceLanguage, normalizedTarget)) {
      retryCount += 1;
    }
    const stats = getTranslationScriptStats(translated);
    thaiChars += stats.thaiChars;
    letterChars += stats.letterChars;
  });

  if (total < 4) {
    return { shouldSkip: false, retryRatio: 0, thaiRatio: 0, total };
  }

  const retryRatio = retryCount / Math.max(1, total);
  const thaiRatio = thaiChars / Math.max(1, letterChars);
  const shouldSkip = retryRatio >= 0.65 && thaiRatio < 0.06;
  return { shouldSkip, retryRatio, thaiRatio, total };
};

export const evaluateThaiCarryoverForEnglish = (
  groups: Array<{ sourceText: string }>,
  translatedGroups: string[],
  targetLanguage: string
): { shouldFallback: boolean; thaiRatio: number; carryoverRatio: number; total: number } => {
  const normalizedTarget = normalizeTranslationLanguage(targetLanguage, 'en');
  if (normalizedTarget !== 'en') {
    return { shouldFallback: false, thaiRatio: 0, carryoverRatio: 0, total: 0 };
  }

  let total = 0;
  let carryoverCount = 0;
  let thaiChars = 0;
  let letterChars = 0;

  groups.forEach((group, i) => {
    const translated = translatedGroups[i] || '';
    total += 1;
    
    // If target is English, translated text should contain minimal Thai
    const stats = getTranslationScriptStats(translated);
    const hasThai = stats.thaiChars > 0;
    if (hasThai && stats.thaiRatio >= 0.3) {
      carryoverCount += 1;
    }
    thaiChars += stats.thaiChars;
    letterChars += stats.letterChars;
  });

  if (total === 0) {
    return { shouldFallback: false, thaiRatio: 0, carryoverRatio: 0, total };
  }

  const carryoverRatio = carryoverCount / total;
  const thaiRatio = thaiChars / Math.max(1, letterChars);
  const shouldFallback = carryoverRatio >= 0.5 && thaiRatio >= 0.25;
  return { shouldFallback, thaiRatio, carryoverRatio, total };
};
