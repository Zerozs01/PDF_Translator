/**
 * SFX Dictionary Service — ระบบจัดการและแปลเสียงเอฟเฟกต์ (SFX)
 *
 * รองรับ:
 *   1. คลังเสียงเอฟเฟกต์เริ่มต้น (JP/EN/KO)
 *   2. การค้นหาแบบ Exact Match และ Fuzzy Match (Levenshtein Similarity)
 *   3. การผสานคำที่ผู้ใช้เพิ่ม/แก้ไขเอง (User Dict) ผ่าน LocalStorage
 */

import { useGlossaryStore } from '../../stores/useGlossaryStore';

export interface SFXDictionaryEntry {
  source: string;
  target: string;
  notes?: string;
}

export type SFXLanguage = 'en' | 'jp' | 'ko' | 'es';

export interface SFXDictionary {
  version: string;
  data: Record<SFXLanguage, SFXDictionaryEntry[]>;
}

// ── คลังคำเสียงเอฟเฟกต์เริ่มต้น (Default Dictionary) ──────────────────
export const DEFAULT_SFX_DICTIONARY: SFXDictionary = {
  version: '1.0',
  data: {
    jp: [
      { source: 'ドン', target: 'ตึง!', notes: 'เสียงกระแทกหนักๆ หรือเสียงหัวใจเต้นแรง' },
      { source: 'ガーン', target: 'ช็อก!', notes: 'เสียงตกใจ ตะลึง' },
      { source: 'ドキドキ', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้นตื่นเต้น' },
      { source: 'ニコ', target: 'ยิ้ม', notes: 'เสียงหน้ายิ้มแย้ม' },
      { source: 'ハッ', target: 'เฮือก!', notes: 'เสียงสะดุ้ง ตื่นตระหนก' },
      { source: 'コソコソ', target: 'ซุบซิบ', notes: 'เสียงกระซิบกระซาบ' },
      { source: 'ザワザワ', target: 'ซู่ซ่า', notes: 'เสียงจอแจ อื้ออึง' },
      { source: 'キャー', target: 'กรี๊ด!', notes: 'เสียงกรีดร้องด้วยความตกใจหรือชื่นชม' },
      { source: 'シーン', target: 'เงียบ...', notes: 'เสียงความเงียบสงัด' },
      { source: 'ゴゴゴ', target: 'ครืนนน', notes: 'เสียงบรรยากาศกดดัน ครืนๆ' },
      { source: 'バサッ', target: 'พรึ่บ!', notes: 'เสียงขยับปีก หรือคลี่กระดาษอย่างรวดเร็ว' },
      { source: 'フッ', target: 'หึ...', notes: 'เสียงหัวเราะในลำคอเบาๆ' },
      { source: 'エッ', target: 'เอ๊ะ!', notes: 'เสียงตกใจ' },
      { source: 'えっ', target: 'เอ๊ะ!', notes: 'เสียงตกใจ' },
      { source: 'あっ', target: 'อ๊ะ!', notes: 'เสียงร้องอุทาน' },
      { source: 'あ', target: 'อ๊ะ!', notes: 'เสียงร้องอุทานสั้น' },
      { source: 'ッ', target: '', notes: 'Isolated glottal stop, suppress standalone' },
      { source: 'はあ', target: 'แฮ่ก...', notes: 'เสียงหายใจเหนื่อย/คราง' },
      { source: 'はあ...', target: 'แฮ่ก...', notes: 'เสียงหายใจเหนื่อย' },
      { source: 'ゴクリ', target: 'อึก...', notes: 'เสียงกลืนน้ำลาย' },
      { source: 'うう', target: 'อือออ...', notes: 'เสียงครางอึดอัด' },
      { source: 'うう...', target: 'อือออ...', notes: 'เสียงครางอึดอัด' },
      { source: 'ん', target: 'อืม...', notes: 'เสียงตอบรับสั้น' },
      { source: 'ん...', target: 'อืม...', notes: 'เสียงตอบรับ' },
    ],
    en: [
      { source: 'CRASH', target: 'โครม!', notes: 'เสียงสิ่งของชนหรือพังทลายอย่างรุนแรง' },
      { source: 'BOOM', target: 'ตูม!', notes: 'เสียงระเบิดกระแทก' },
      { source: 'BANG', target: 'ปัง!', notes: 'เสียงปืนหรือเสียงกระแทกดัง' },
      { source: 'SLAM', target: 'ปัง!', notes: 'เสียงปิดประตูกระแทกดัง' },
      { source: 'THUD', target: 'ตุ้บ!', notes: 'เสียงของหนักตกพื้น' },
      { source: 'TAP', target: 'แปะ!', notes: 'เสียงเคาะเบาๆ' },
      { source: 'SWIPE', target: 'ฟึ่บ!', notes: 'เสียงปัดกวาดอย่างรวดเร็ว' },
      { source: 'SIGH', target: 'เฮ้อ...', notes: 'เสียงถอนหายใจ' },
      { source: 'GASP', target: 'เฮือก!', notes: 'เสียงสูดหายใจด้วยความตกใจ' },
      { source: 'SMASH', target: 'เพล้ง!', notes: 'เสียงกระจกหรือภาชนะแตกพัง' },
      { source: 'GULP', target: 'อึก...', notes: 'เสียงกลืนน้ำลายด้วยความตึงเครียด' },
      { source: 'RUMBLE', target: 'ครืนนน', notes: 'เสียงฟ้าร้องหรือพื้นสั่นสะเทือน' },
      { source: 'WHOOSH', target: 'ฟิ้ววว', notes: 'เสียงลมพัดผ่านอย่างรวดเร็ว' },
      { source: 'WHACK', target: 'ผลัวะ!', notes: 'เสียงฟาดหรือตีเข้าอย่างจัง' },
      { source: 'STARE', target: 'จ้อง...', notes: 'เสียงจ้องเขม็ง' },
      { source: 'CLICK', target: 'คลิก!', notes: 'เสียงกดสวิตช์ หรือเสียงเมาส์' },
      { source: 'SHOCK', target: 'ช็อก!', notes: 'อาการตื่นตะลึง' },
      { source: 'PANT', target: 'แฮ่ก... แฮ่ก...', notes: 'เสียงหอบเหนื่อย' },
      { source: 'Pinchy', target: 'หยิก', notes: 'เสียงหยิกหรือบีบดึง' },
      { source: 'Pinch', target: 'หยิก', notes: 'เสียงหยิกหรือบีบดึง' },
      { source: 'Smack', target: 'ตั่บ', notes: 'เสียงกระทบกัน ตั่บ' },
      { source: 'SmackV', target: 'ตั่บ', notes: 'เสียงกระทบกัน ตั่บ (OCR trailing V variant)' },
      { source: 'Smack Smack Smack', target: 'ตั่บ ตั่บ ตั่บ', notes: 'เสียงกระทบกัน ตั่บ ตั่บ ตั่บ' },
      { source: 'Smack Smack', target: 'ตั่บ ตั่บ', notes: 'เสียงกระทบกัน ตั่บ ตั่บ' },
      { source: 'Poke', target: 'กระทุ้ง', notes: 'เสียงกระทุ้งหรือจิ้ม' },
      { source: 'Badum', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้น' },
      { source: 'Badumm', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้น (variant)' },
      // Fwoooshh variants — ต้องใส่ครบเพื่อให้ fuzzy match จับได้ทุกรูปแบบการสะกด
      { source: 'Fwoooshh', target: 'ฟู่ววว', notes: 'เสียงลมพัดหรือพลังพวยพุ่ง' },
      { source: 'Fwoosh', target: 'ฟู่ววว', notes: 'เสียงลมพัด' },
      { source: 'Fwooosh', target: 'ฟู่ววว', notes: 'เสียงลมพัด (3o variant)' },
      { source: 'Fwooshh', target: 'ฟู่ววว', notes: 'เสียงลมพัด (2h variant)' },
      { source: 'Fwoooshhh', target: 'ฟู่ววว', notes: 'เสียงลมพัดยาว (3h variant)' },
      { source: 'Fwsshhh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่านหรือเสียงทะเล' },
      { source: 'Fwsshh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่าน (2h variant)' },
      { source: 'Fwssh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่าน (1h variant)' },
      { source: 'Fsssshhh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่านแบบลากยาวมาก' },
      { source: 'Fwsssshh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่าน (w-s variant)' },
      { source: 'Fwsshhh...', target: 'ฟซซซ์ชชช...', notes: 'เสียงลมผ่านยาว' },
      { source: 'Fwsssshhh', target: 'ฟซซซ์ชชช', notes: 'เสียงลมผ่านลากยาว' },
      { source: 'Phew', target: 'ฟิ้ววว', notes: 'เสียงถอนหายใจหรือโล่งอก' },
      { source: 'Phew...', target: 'ฟิ้ววว...', notes: 'เสียงถอนหายใจ (ยาว)' },
      { source: 'Gxp', target: 'บีบ', notes: 'เสียงกำหรือบีบ (Grip)' },
      { source: 'Grip', target: 'บีบ', notes: 'เสียงกำหรือบีบ' },
      // เสียงคราง/ร้องรับ — ตรงตาม Mapping Table ของผู้ใช้
      { source: 'Aan', target: 'อ่าห์...', notes: 'OCR variant ของ Anh เสียงคราง' },
      { source: 'Anh', target: 'อ่าห์...', notes: 'เสียงคราง อาห์' },
      { source: 'Haa', target: 'ฮ่า...', notes: 'เสียงหายใจขาดห้วงกระชั้น' },
      { source: 'Haa...', target: 'ฮ่า...', notes: 'เสียงหายใจขาดห้วงกระชั้น (ยาว)' },
      { source: 'Hah', target: 'ฮ่าห์!', notes: 'เสียงหลุดจังหวะพีก' },
      { source: 'Aaah', target: 'อ่าห์...', notes: 'เสียงคราง อ่าห์ ลากยาว' },
      { source: 'Aaah...', target: 'อ่าห์... อาห์...', notes: 'เสียงคราง ลากยาว ต่อเนื่อง' },
      { source: 'Ah...', target: 'อ่าห์...', notes: 'เสียงครางผ่อนคลาย' },
      { source: 'Ah', target: 'อ่าห์...', notes: 'เสียงคราง' },
      { source: 'Oon', target: 'อือออ...', notes: 'เสียงร้องครางเบาๆ' },
      { source: 'Oon...', target: 'อือออ...', notes: 'เสียงร้องคราง (variant)' },
      { source: 'Mm...', target: 'อื้ม...', notes: 'เสียงครางในลำคอออดอ้อน' },
      { source: 'Mmm', target: 'อื้ม...', notes: 'เสียงคราง in ลำคอ' },
      { source: 'Mm', target: 'อื้ม...', notes: 'เสียงครางในลำคอ (สั้น)' },
      { source: 'Nnh...', target: 'อื้อ...', notes: 'เสียงครางกลั้นสะท้าน' },
      { source: 'Nnh', target: 'อื้อ...', notes: 'เสียงครางกลั้น' },
      { source: 'Ngh', target: 'อึก...', notes: 'เสียงครางสั่นสะท้านอัดอั้น' },
      { source: 'Ngh...', target: 'อึก...', notes: 'เสียงครางกลั้นสั่นสะท้าน' },
      { source: 'Nn...', target: 'อื้อ...', notes: 'เสียงครางกลั้น (nn variant)' },
      { source: 'Oh!', target: 'อ๊าห์!', notes: 'เสียงอุทานตกใจ/ตื่นเต้น' },
      { source: 'Ooh', target: 'โอ้...', notes: 'เสียงอุทานพึงพอใจ' },
      { source: 'Oh', target: 'โอ้...', notes: 'เสียงอุทาน' },
      { source: 'Shaking', target: 'เขย่า', notes: 'อาการหรือเสียงสั่นสะเทือน/เขย่า' },
      { source: 'SO SO FTYETFIRM', target: 'นุ่มมาก...แต่ก็แน่นกระชับ', notes: 'SO SOFT.. YET FIRM' },
      { source: 'SO SOFT.. YET FIRM', target: 'นุ่มมาก...แต่ก็แน่นกระชับ', notes: 'คำบรรยายความรู้สึก' },
      { source: 'FTTITATERASE', target: 'นุ่มมาก...แต่ก็แน่นกระชับ', notes: 'SO SOFT YET FIRM OCR variant' },
      { source: 'Smacky', target: 'ตั่บ', notes: 'เสียงกระทบกัน ตั่บ (Smack variant)' },
      { source: 'Smacke', target: 'ตั่บ', notes: 'เสียงกระทบกัน ตั่บ (Smack OCR variant)' },
      { source: 'Shmacki Patv', target: 'ปั๊ก แต๊บ', notes: 'เสียงเอวกระแทกร่องสะกดเพี้ยน' },
      { source: 'Shmack Pat', target: 'ปั๊ก แต๊บ', notes: 'เสียงเอวกระแทกร่อง' },
      { source: 'EJACULATED', target: 'หลั่งน้ำอสุจิ', notes: 'เสียงอุทาน/กริยาอนาจาร' },
      { source: 'INTO...', target: 'เข้าไปข้างใน...', notes: 'คำบรรยายทิศทาง' },
      { source: 'Gloop', target: 'กลูป', notes: 'เสียงน้ำหนืด/ของเหลวข้น' },
      { source: 'Twitches', target: 'กระตุก', notes: 'เสียงหรืออาการกระตุก' },
      { source: 'Twitchesd', target: 'กระตุก', notes: 'เสียงหรืออาการกระตุก (OCR variant)' },
      { source: 'LIKE A TOY', target: 'เหมือนของเล่น', notes: 'ประโยคเปรียบเทียบ' },
      { source: 'LikBatoyd', target: 'เหมือนของเล่น', notes: 'LIKE A TOY OCR variant' },
      { source: 'FUCK TOY', target: 'ของเล่นทางเพศ', notes: 'คำสังขม แปลตรงตามบริบท' },
      { source: 'LOL', target: 'ฮ่าๆ', notes: 'เสียงขำ Laughing Out Loud' },
      { source: 'AHH ITS COMING', target: 'อ๊าห์... มันกำลังจะมาแล้ว... ♥', notes: 'AHH IT’S COMING' },
      { source: "AHH IT'S COMING", target: 'อ๊าห์... มันกำลังจะมาแล้ว... ♥', notes: 'เสียงร้อง/อุทานทางเพศ' },
      { source: 'AHH ITS COMINGO', target: 'อ๊าห์... มันกำลังจะมาแล้ว... ♥', notes: 'OCR trailing O variant' },
      { source: 'CUMING CUMMING CUMMING', target: 'จะเสร็จ...จ-จะเสร็จ...จะแตกแล้ว... ♥', notes: 'เสียงสมมุติผู้ใหญ่' },
      { source: 'CUMMINNGGG', target: 'แตกกออกมาแล้ววว...♥', notes: 'เสียงสมมุติลากเสียงยาว' },
      { source: 'CUMMINNGGGO', target: 'แตกกออกมาแล้ววว...♥', notes: 'OCR trailing O variant' },
      { source: 'YOU', target: 'คุณ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'FRONT', target: 'ข้างหน้า', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'FRONT.', target: 'ข้างหน้า', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'KNiiiiiGHT', target: 'อัศวิน', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'KNiiiiight', target: 'อัศวิน', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'KNiiiiIGHT', target: 'อัศวิน', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'YOU\'RE', target: 'คุณคือ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'YOURE', target: 'คุณคือ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'US THE', target: 'พวกเรา', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'HE\'S', target: 'เขาคือ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'HES', target: 'เขาคือ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'TO BE DEAD NOW', target: 'ต้องตายไปแล้ว', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'TO BE DEAD NOW!', target: 'ต้องตายไปแล้ว!', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'GET', target: 'เอา', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'CUM', target: 'แตก', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'CUM!', target: 'แตก!', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'CUM!!', target: 'แตก!!', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'NIPPLES', target: 'หัวนม', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'LONGER', target: 'นานขึ้น', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'LONGER!', target: 'นานขึ้น!', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'TODAY AGAIN', target: 'วันนี้อีกแล้ว', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'HER POSI', target: 'ท่าของเธอ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'HER POSITION', target: 'ท่าของเธอ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'SUITS', target: 'เหมาะกับ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'SO', target: 'มาก', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'NIPPLES AND', target: 'หัวนมและ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'CERVIX', target: 'ปากมดลูก', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'GENERAL', target: 'นายพล', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'DIE ALONG', target: 'ตายตามกันไป', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'ALSO', target: 'ด้วยเหมือนกัน', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'HER PLACE', target: 'ที่ของเธอ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'MAKE SURE', target: 'ให้แน่ใจ', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'SADNESS', target: 'ความเศร้า', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'ALL ARSTOCRATS', target: 'เหล่าขุนนางทั้งหมด', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'ALL ARISTOCRATS', target: 'เหล่าขุนนางทั้งหมด', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'BUT IN ANY AGE', target: 'แต่ไม่ว่าจะในยุคสมัยใด', notes: 'คำสั้นกรณีหลุดกลุ่ม SFX' },
      { source: 'Creak', target: 'เอี๊ยดด', notes: 'เสียงไม้ลั่น/เตียงลั่น' },
      { source: 'rool', target: 'กลิ้งง', notes: 'เสียงกลิ้ง/ครืนน' },
      { source: 'Boing', target: 'ดึ๋งง', notes: 'เสียงเด้งดึ๋ง' },
      { source: 'PLAP', target: 'ตับบ', notes: 'เสียงกระแทก 20+' },
      { source: 'PLAP PLAP', target: 'ตับ ตับ', notes: 'เสียงกระแทก 20+' },
      { source: 'Joop', target: 'จ๊วบบ', notes: 'เสียงดูด/จ๊วบ' },
      { source: 'Tremble', target: 'สั่นสะท้าน', notes: 'อาการสั่นเทา' },
      { source: 'Quiver', target: 'สั่นระริก', notes: 'อาการสั่นระริก' },
      { source: 'Qoiver', target: 'สั่นระริก', notes: 'Quiver OCR variant' },
      { source: 'Jolt', target: 'สะดุ้ง!', notes: 'เสียงสะดุ้ง/กระตุก' },
      { source: 'Jolt!', target: 'สะดุ้ง!', notes: 'เสียงสะดุ้ง' },
      { source: 'Rattle', target: 'กึกกัก', notes: 'เสียงสั่นกึกกัก' },
      { source: 'SPLURCH', target: 'พรวดด', notes: 'เสียงของเหลวทะลัก' },
      { source: 'Splrch', target: 'พรวดด', notes: 'SPLURCH variant' },
      { source: 'THMP', target: 'ตึ่บบ', notes: 'เสียงกระแทก/หัวใจเต้น' },
      { source: 'SPLAP', target: 'แปะะ', notes: 'เสียงตบ/กระแทก' },
      { source: 'Splooge', target: 'พรวดดด', notes: 'เสียงของเหลวพุ่งทะลัก' },
      { source: 'Pssh', target: 'ชี่...', notes: 'เสียงฟู่/ชี่' },
      { source: 'Pshh', target: 'ฟู่...', notes: 'เสียงฟู่' },
      { source: 'Bzz', target: 'หึ่งง', notes: 'เสียงหึ่ง/ช็อต' },
      { source: 'Squish', target: 'ยวบบ', notes: 'เสียงยวบ/แฉะ' },
      { source: 'Jiggle', target: 'ดึ๋งๆ', notes: 'เสียงเด้งสั่นกระเพื่อม' },
      { source: 'Grind', target: 'บดด', notes: 'เสียงบดเบียด' },
      { source: 'Grinc', target: 'บดด', notes: 'Grind OCR variant' },
      { source: 'Twitch', target: 'กระตุก', notes: 'อาการกระตุก' },
      { source: 'TWitch', target: 'กระตุก', notes: 'Twitch case variant' },
      { source: 'Squeeze', target: 'บีบเค้น', notes: 'อาการบีบเค้น' },
      { source: 'SHIVER', target: 'สั่นสะท้าน', notes: 'อาการหนาวสั่น' },
      { source: 'SHNER', target: 'สั่นสะท้าน', notes: 'SHIVER OCR variant' },
      { source: 'Shives', target: 'สั่นสะท้าน', notes: 'Shiver variant' },
      { source: 'Shvero', target: 'สั่นสะท้าน', notes: 'Shiver OCR variant' },
      { source: 'Flinch', target: 'สะดุ้ง', notes: 'อาการสะดุ้งผงะ' },
      { source: 'Cling', target: 'เกาะแน่น', notes: 'เสียงกริ๊ง/เกาะแน่น' },
      { source: 'Stroke', target: 'ลูบไล้', notes: 'อาการลูบไล้/รูด' },
      { source: 'Grope', target: 'ขยำา', notes: 'อาการลูบคลำ/ขยำ' },
      { source: 'Shlp', target: 'จ๊วบบ', notes: 'เสียงเลีย/ดูด' },
      { source: 'Huff', target: 'แฮ่กก', notes: 'เสียงหอบ' },
      { source: 'Julp', target: 'อึกก', notes: 'เสียงกลืนน้ำลาย' },
      { source: 'Glepgh', target: 'แหวะะ', notes: 'เสียงสำรอก/ของเหลว' },
      { source: 'Blubub', target: 'บุ๋งๆ', notes: 'เสียงฟองอากาศปุดๆ' },
      { source: 'Fondle', target: 'เคล้นคลึง', notes: 'อาการเคล้นคลึง' },
      { source: 'Flick', target: 'ดีดด', notes: 'เสียงดีดสะบัด' },
      { source: 'throb', target: 'ตุบๆ', notes: 'อาการเต้นตุบๆ' },
      { source: 'Blorp', target: 'ผล็อยย', notes: 'เสียงของเหลวหยด/ผล็อย' },
      { source: 'Plurp', target: 'ผล็อยย', notes: 'Blorp OCR variant' },
      { source: 'Badmp', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้น' },
      { source: 'Kuhk', target: 'ค...คั่ก', notes: 'เสียงกระอัก/ขำในคอ' },
      { source: 'SPlAT', target: 'แปะะ', notes: 'เสียงตบ/กระแทกของเหลว' },
      { source: 'Splat', target: 'แปะะ', notes: 'เสียงตบ/กระแทกของเหลว' },
      { source: 'PSH', target: 'ฟู่...', notes: 'เสียงลม/ฟู่' },
      { source: 'Splort', target: 'พรวดด', notes: 'เสียงของเหลวพุ่ง' },
      { source: 'Splorge', target: 'พรวดดด', notes: 'เสียงของเหลวทะลัก' },
      { source: 'Splot', target: 'แปะะ', notes: 'เสียงหยด/กระเด็น' },
      { source: 'Thmp', target: 'ตึ่บบ', notes: 'เสียงกระแทก' },
      { source: 'Squelch', target: 'ปรื๊ด', notes: 'เสียงแฉะ/ลื่น' },
      { source: 'porplo', target: 'ปุ๋งๆ', notes: 'เสียงฟองอากาศ' },
      { source: 'Lick', target: 'แพล๊บ', notes: 'เสียงเลีย' },
      { source: 'Glarble', target: 'กลั่กๆ', notes: 'เสียงสำลัก/กลั้วคอ' },
      { source: 'Gargle', target: 'กลั่กๆ', notes: 'เสียงกลั้วคอ' },
      { source: 'Gohk', target: 'อ่อก', notes: 'เสียงติดคอ/สำลัก' },
      { source: 'Glub', target: 'บุ๋ง', notes: 'เสียงจมน้ำ' },
      { source: 'humph!', target: 'ฮึ่ม!', notes: 'เสียงอุทานฮึดฮัด' },
      { source: 'Wriggle', target: 'ดิ้นไปมา', notes: 'อาการดิ้นไปมา' },
      { source: 'Wobble', target: 'โยกเยก', notes: 'อาการโยกเยก' },
      { source: 'Fuhin', target: 'ฟูฮิห์', notes: 'เสียงคราง/หัวเราะ' },
      { source: 'Nchuh', target: 'นชูห์', notes: 'เสียงคราง' },
      { source: 'Shlrch', target: 'ซวบ', notes: 'เสียงสอดใส่' },
      { source: 'Schlup', target: 'จ๊วบ', notes: 'เสียงดูด' },
      { source: 'Nhn!', target: 'นืห์!', notes: 'เสียงครางกลั้น' },
      { source: 'aoh', target: 'โอ้ห์', notes: 'เสียงคราง' },
      { source: 'Oohg', target: 'อ...อุ๊กข์', notes: 'เสียงครางจุก' },
      { source: 'uguhh', target: 'อุกะห์', notes: 'เสียงคราง' },
      { source: 'uurkh', target: 'อ...อั๊กห์', notes: 'เสียงครางจุก' },
      { source: 'uuquh', target: 'อ...อุกห์', notes: 'เสียงคราง' },
      { source: 'kuhk', target: 'ค...คั่ก', notes: 'เสียงครางกระอัก' },
      { source: 'Knead', target: 'นวดคลึง', notes: 'อาการนวดคลึง' },
      { source: 'Glob', target: 'กล็อบบ', notes: 'เสียงของเหลวข้น' },
      { source: 'SNAP', target: 'ตอด', notes: 'เสียงตอด/เปรี๊ยะ' },
      { source: 'CRACK', target: 'แคร๊ก', notes: 'เสียงลั่น/แคร๊ก' },
      { source: 'Blurrpp', target: 'บล๊ออบบ', notes: 'เสียงของเหลวหนืด' },
      { source: 'uuuh', target: 'อู้ววว', notes: 'เสียงคราง' },
      { source: 'Thud', target: 'ตุ๊บ', notes: 'เสียงของหนักกระแทก' },
      { source: 'Chulp', target: 'จล๊วบห์', notes: 'เสียงจ๊วบ' },
      { source: 'lurp', target: 'ซวบ', notes: 'เสียงดูด/ซวบ' },
      { source: 'Sch', target: 'ชวบ', notes: 'เสียงเสียดสี/สอดใส่' },
      { source: 'purp', target: 'พล๊อบ', notes: 'เสียงหยด/พล๊อบ' },
      { source: 'pupuh', target: 'พั่บ..พลั่บ', notes: 'เสียงกระแทกซ้ำ' },
      { source: 'plupuh', target: 'พลั่บ..พลั่บห์', notes: 'เสียงกระแทกซ้ำ' },
      { source: 'Hoff', target: 'แฮ่กก', notes: 'เสียงหอบ' },
      { source: 'Glar', target: 'กร๊วบ', notes: 'เสียงขย้ำ/เคี้ยว' },
      { source: 'Blergh', target: 'เบลอร์ก', notes: 'เสียงสำรอก/แหวะ' },
      { source: 'Eurgh', target: 'เออร์ก', notes: 'เสียงร้องอึดอัด' },
      { source: 'Eurgh!', target: 'เออร์ก!', notes: 'เสียงร้องอึดอัด' },
      { source: 'Mhm?', target: 'มืมห์?', notes: 'เสียงครางถามในคอ' },
      { source: 'Hum-', target: 'ฮืม-', notes: 'เสียงฮัมในคอ' },
      { source: 'NGOH', target: 'อื้อออ', notes: 'เสียงครางลึก' },
      { source: 'Apeooh', target: 'อ๊าา-อู๊ว', notes: 'เสียงร้องคราง' },
      { source: 'Yoo...', target: 'โย่ห์...', notes: 'เสียงทักทาย' },
      { source: 'Clatter...', target: 'โครมคราม', notes: 'เสียงของกระทบกัน' },
      { source: 'uuguh', target: 'อู้ววกึฮ์', notes: 'เสียงคราง' },
      { source: 'Wipe...', target: 'เช็ด...', notes: 'อาการเช็ด' },
      { source: 'Slide', target: 'สไลด์', notes: 'อาการเลื่อน/สไลด์' },
      { source: 'Shiver', target: 'สั่น', notes: 'อาการสั่น' },
      { source: 'Rawle', target: 'สั่น', notes: 'อาการสั่น' },
      { source: 'scritch', target: 'เกา', notes: 'เสียงขูด/เกา' },
      { source: 'stretch', target: 'ยืด', notes: 'อาการยืด' },
      { source: 'Splly', target: 'ซวบบ', notes: 'เสียงเสียดสี' },
      { source: '8plly', target: 'ซวบบ', notes: 'เสียงเสียดสี' },
      { source: 'SPLRG', target: 'บลั่กก', notes: 'เสียงของเหลว' },
      { source: 'Shivero', target: 'สั่นสะท้าน', notes: 'อาการสั่นสะท้าน' },
      { source: 'Splurrrt', target: 'พรู๊ดดด!', notes: 'เสียงพุ่งทะลัก' },
      { source: 'Splurcct', target: 'พรู๊ดดด!', notes: 'เสียงพุ่งทะลัก' },
      { source: 'Schlrp', target: 'จล๊วบ', notes: 'เสียงดูดเลีย' },
      { source: 'Suky', target: 'จล๊วบ', notes: 'เสียงดูด' },
      { source: 'Jupp', target: 'จุปป์', notes: 'เสียงจูบ/ดูด' },
      { source: 'Joop', target: 'จู๊ป', notes: 'เสียงจูบ/ดูด' },
      { source: 'Glorp', target: 'จ๊วบ', notes: 'เสียงดูดกลืน' },
      { source: 'plorpop', target: 'บล๊อบ พ๊อบ', notes: 'เสียงปุดๆ' },
      { source: 'porplo', target: 'บล๊อบ', notes: 'เสียงปุดๆ' },
      { source: 'plop', target: 'บ๊อบ', notes: 'เสียงหยด/ตกกระทบ' },
      { source: 'bdmp', target: 'ตึ๊ก ตัก', notes: 'เสียงหัวใจเต้น' },
      { source: 'Yammer', target: 'คร่ำครวญ', notes: 'อาการบ่น/คร่ำครวญ' },
      { source: 'Hum', target: 'ฮึม~', notes: 'เสียงฮัม' },
      { source: 'Humph!', target: 'ฮัม!', notes: 'เสียงฮึดฮัด' },
      { source: 'DUMPH!', target: 'ตึก-ตัก!', notes: 'เสียงหัวใจเต้นแรง' },
      { source: 'Squeeezee...', target: 'บีบแน่น', notes: 'อาการบีบแน่น' },
      { source: 'Apeooh...', target: 'ฮ๊าา-อู้วว!', notes: 'เสียงคราง' },
      { source: 'Yeah!', target: 'ใช่!', notes: 'คำอุทาน' },
      { source: 'Glorb', target: 'กล็อบ', notes: 'เสียงของเหลว' },
      { source: 'GH...!', target: 'อึ่ก!...', notes: 'เสียงร้องอึ่กจุก' },
      { source: 'GH...', target: 'อึ่ก...', notes: 'เสียงร้องอึ่ก' },
      { source: 'GH!', target: 'อึ่ก!', notes: 'เสียงร้องอึ่ก' },
      { source: 'MOVING!!', target: 'ขยับเขยื้อน!', notes: 'อาการขยับเขยื้อน' },
      { source: 'MOVING!', target: 'ขยับเขยื้อน!', notes: 'อาการขยับเขยื้อน' },
      { source: 'MOVING', target: 'ขยับเขยื้อน', notes: 'อาการขยับเขยื้อน' },
      { source: 'CAME...', target: 'เสร็จแล้ว...', notes: 'กริยาหลั่งน้ำกาม' },
      { source: 'CAME!', target: 'แตกแล้ว!', notes: 'กริยาหลั่งน้ำกาม' },
      { source: 'CAME', target: 'แตกแล้ว', notes: 'กริยาหลั่งน้ำกาม' },
      { source: 'Nhl', target: 'นืห์!', notes: 'เสียงคราง Nh! OCR variant' },
      { source: 'Nh!', target: 'นืห์!', notes: 'เสียงคราง' }
    ],
    ko: [
      { source: '쿵', target: 'ตึง!', notes: 'เสียงของหนักกระแทกพื้น' },
      { source: '두근두근', target: 'ตึกตัก', notes: 'เสียงหัวใจเต้นตื่นเต้น' },
      { source: '하하', target: 'ฮ่าๆ', notes: 'เสียงหัวเราะอย่างร่าเริง' },
      { source: '헉', target: 'เฮือก!', notes: 'เสียงสะดุ้งหรือตกใจ' },
      { source: '슥', target: 'ฟึ่บ!', notes: 'เสียงเฉียดผ่านเบาๆ' },
      { source: '쾅', target: 'ปัง!', notes: 'เสียงกระแทกดังรุนแรง' },
      { source: '아', target: 'อา...', notes: 'เสียงอุทานเจ็บ/เข้าใจ' },
      { source: '아아', target: 'อา...', notes: 'เสียงอุทานลากยาว' },
      { source: '씨발', target: 'เชี่ยเอ๊ย!', notes: 'คำสบถเกาหลี' },
      { source: '헐', target: 'เห้ย!', notes: 'คำอุทานตกใจ/ไม่เชื่อ' },
      { source: '앗', target: 'อ๊ะ!', notes: 'คำอุทานกระทันหัน' },
      { source: '윽', target: 'อึ้ก!', notes: 'เสียงสะอึกหรือเจ็บ' },
    ],
    es: [
      { source: 'ZAS', target: 'ฉับ!', notes: 'เสียงฟัน/ตัด/พุ่งฟึ่บ' },
      { source: 'ZAS...', target: 'ฉับ!...', notes: 'เสียงฟัน/ตัด/พุ่ง' },
      { source: 'ZAS!', target: 'ฉับ!', notes: 'เสียงฟัน/ตัด/พุ่ง' },
      { source: '¡ZAS!', target: 'ฉับ!', notes: 'เสียงฟัน/ตัด/พุ่ง' },
      { source: '¡ZAS...!', target: 'ฉับ!...', notes: 'เสียงฟัน/ตัด/พุ่ง' },
      { source: 'BANG', target: 'ปัง!', notes: 'เสียงปืนหรือเสียงกระแทก' },
      { source: 'BOOM', target: 'ตูม!', notes: 'เสียงระเบิด' },
      { source: 'POW', target: 'ผัวะ!', notes: 'เสียงชกกระแทก' },
      { source: 'CLACK', target: 'คลิ๊ก!', notes: 'เสียงกระทบ' },
      { source: 'MEEE', target: 'ฉันนน!', notes: 'คำร้องอุทานสเปน' },
      { source: 'MEEE...!!', target: 'ฉันนน...!!', notes: 'คำร้องอุทานสเปน' },
      { source: '¡MEEE...!!', target: 'ฉันนน...!!', notes: 'คำร้องอุทานสเปน' },
      { source: 'AHH', target: 'อ๊าห์...', notes: 'เสียงอุทาน' },
      { source: 'UGH', target: 'อึ้ก...', notes: 'เสียงร้องอึ้ก' },
    ],
  },
};

const USER_DICT_STORAGE_KEY = 'pdf_translator_user_sfx_dict';

// ── Helper Algorithms ──────────────────────────────────────────────
/** คำนวณ Levenshtein Distance เพื่อหาจำนวนครั้งในการแก้ไขตัวหนังสือ (ใช้ 1D TypedArray เพื่อประสิทธิภาพสูงสุด) */
export function getLevenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const aLen = a.length;
  const bLen = b.length;
  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  let prevRow = new Int32Array(bLen + 1);
  let currRow = new Int32Array(bLen + 1);

  for (let j = 0; j <= bLen; j++) {
    prevRow[j] = j;
  }

  for (let i = 1; i <= aLen; i++) {
    currRow[0] = i;
    const charA = a.charCodeAt(i - 1);
    for (let j = 1; j <= bLen; j++) {
      const cost = charA === b.charCodeAt(j - 1) ? 0 : 1;
      currRow[j] = Math.min(
        prevRow[j] + 1,       // deletion
        currRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost // substitution
      );
    }
    const temp = prevRow;
    prevRow = currRow;
    currRow = temp;
  }

  return prevRow[bLen];
}

/** คำนวณหาความคล้ายคลึงกัน (Similarity score: 0.0 - 1.0) */
export function getStringSimilarity(a: string, b: string): number {
  const normA = a.trim().toLowerCase();
  const normB = b.trim().toLowerCase();
  if (normA === normB) return 1.0;
  
  const maxLen = Math.max(normA.length, normB.length);
  if (maxLen === 0) return 1.0;
  
  const distance = getLevenshteinDistance(normA, normB);
  return (maxLen - distance) / maxLen;
}

// ── In-Memory Memoization & Fast O(1) Lookup Maps ──────────────────
let cachedMergedDict: SFXDictionary | null = null;
let cachedExactMap: Record<SFXLanguage, Map<string, string>> | null = null;
let lastUserDictRaw: string | null = null;
let lastGlossaryEntriesRef: any = null;

export function invalidateSFXCache(): void {
  cachedMergedDict = null;
  cachedExactMap = null;
  lastUserDictRaw = null;
  lastGlossaryEntriesRef = null;
}

// ── Dictionary Actions ─────────────────────────────────────────────
/** ดึงข้อมูล User Dictionary จาก LocalStorage */
export function getUserDictionary(): Record<SFXLanguage, SFXDictionaryEntry[]> {
  try {
    const raw = localStorage.getItem(USER_DICT_STORAGE_KEY);
    if (!raw) return { en: [], jp: [], ko: [], es: [] };
    const parsed = JSON.parse(raw);
    return { en: [], jp: [], ko: [], es: [], ...parsed };
  } catch (e) {
    console.error('Failed to parse User SFX Dictionary from localStorage', e);
    return { en: [], jp: [], ko: [], es: [] };
  }
}

/** บันทึกข้อมูล User Dictionary ลงใน LocalStorage */
export function saveUserDictionary(userDict: Record<SFXLanguage, SFXDictionaryEntry[]>): void {
  try {
    localStorage.setItem(USER_DICT_STORAGE_KEY, JSON.stringify(userDict));
    invalidateSFXCache();
  } catch (e) {
    console.error('Failed to save User SFX Dictionary to localStorage', e);
  }
}

/** ผสานคลังคำเริ่มต้นร่วมกับคลังคำของผู้ใช้ (พร้อมระบบแคช In-Memory) */
export function getMergedDictionary(): SFXDictionary {
  let currentUserDictRaw: string | null = null;
  try {
    currentUserDictRaw = localStorage.getItem(USER_DICT_STORAGE_KEY);
  } catch {
    currentUserDictRaw = null;
  }

  let currentGlossaryEntries: any = null;
  try {
    currentGlossaryEntries = useGlossaryStore.getState().entries;
  } catch {
    currentGlossaryEntries = null;
  }

  // Fast cache hit check
  if (
    cachedMergedDict &&
    cachedExactMap &&
    currentUserDictRaw === lastUserDictRaw &&
    currentGlossaryEntries === lastGlossaryEntriesRef
  ) {
    return cachedMergedDict;
  }

  const userDict = getUserDictionary();
  
  // Fetch custom SFX entries from useGlossaryStore
  let customSfxEntries: SFXDictionaryEntry[] = [];
  if (Array.isArray(currentGlossaryEntries)) {
    customSfxEntries = currentGlossaryEntries
      .filter((e: any) => e.isActive && e.type === 'SFX' && e.sourceText.trim())
      .map((e: any) => ({
        source: e.sourceText.trim(),
        target: e.targetText.trim(),
        notes: 'คำแปลจากพจนานุกรมส่วนตัว (Custom Glossary)',
      }));
  }
  
  const merged: SFXDictionary = {
    version: '1.0',
    data: {
      en: [...customSfxEntries, ...(userDict.en || []), ...(DEFAULT_SFX_DICTIONARY.data.en || [])],
      jp: [...customSfxEntries, ...(userDict.jp || []), ...(DEFAULT_SFX_DICTIONARY.data.jp || [])],
      ko: [...customSfxEntries, ...(userDict.ko || []), ...(DEFAULT_SFX_DICTIONARY.data.ko || [])],
      es: [...customSfxEntries, ...(userDict.es || []), ...(DEFAULT_SFX_DICTIONARY.data.es || [])],
    },
  };
  
  // ลบตัวซ้ำ (กรณีผู้ใช้แก้คำทับคำเดิม) โดยอิงตาม source
  const deduplicate = (entries: SFXDictionaryEntry[]) => {
    const seen = new Set<string>();
    return entries.filter(e => {
      const key = e.source.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };

  merged.data.en = deduplicate(merged.data.en);
  merged.data.jp = deduplicate(merged.data.jp);
  merged.data.ko = deduplicate(merged.data.ko);
  merged.data.es = deduplicate(merged.data.es);

  // สร้าง O(1) Exact Map Cache สำหรับทุกลำดับภาษา
  const exactMap: Record<SFXLanguage, Map<string, string>> = {
    en: new Map(),
    jp: new Map(),
    ko: new Map(),
    es: new Map(),
  };

  const populateMap = (lang: SFXLanguage) => {
    const list = merged.data[lang] || [];
    for (const item of list) {
      const key = item.source.trim().toLowerCase();
      if (key && !exactMap[lang].has(key)) {
        exactMap[lang].set(key, item.target);
      }
    }
  };

  populateMap('en');
  populateMap('jp');
  populateMap('ko');
  populateMap('es');

  cachedMergedDict = merged;
  cachedExactMap = exactMap;
  lastUserDictRaw = currentUserDictRaw;
  lastGlossaryEntriesRef = currentGlossaryEntries;

  return merged;
}

/**
 * แปลเสียงเอฟเฟกต์ (SFX) จากพจนานุกรม
 * ค้นหาแบบ Exact match ก่อน (O(1)) หากไม่พบจะค้นหาแบบ Fuzzy match ภายใต้เกณฑ์ที่กำหนด
 */
export function translateSFX(
  text: string,
  lang: SFXLanguage,
  fuzzyThreshold = 0.75,
  _isEnFallback = false
): string | null {
  const normalizedInput = text.trim().toLowerCase();
  if (!normalizedInput) return null;

  const dict = getMergedDictionary();
  const exactMap = cachedExactMap?.[lang];

  // 1st Phase: Exact match (O(1) Map Lookup)
  if (exactMap && exactMap.has(normalizedInput)) {
    return exactMap.get(normalizedInput)!;
  }

  const entries = dict.data[lang] || [];

  // 2nd Phase: Fuzzy match
  let bestMatch: SFXDictionaryEntry | null = null;
  let highestScore = 0;

  // Protect short sound effects from false positives (e.g. ZOOM vs BOOM has 0.75 similarity, but different meaning)
  const effectiveThreshold = normalizedInput.length <= 4
    ? Math.max(fuzzyThreshold, 0.85)
    : fuzzyThreshold;

  const inputLen = normalizedInput.length;

  for (const entry of entries) {
    const entrySourceNorm = entry.source.trim().toLowerCase();
    const entryLen = entrySourceNorm.length;
    const maxLen = Math.max(entryLen, inputLen);
    if (maxLen === 0) continue;

    // Pruning: ถ้าความยาวต่างกันมากเกินไปจนเป็นไปไม่ได้ที่จะได้ score >= effectiveThreshold ให้ข้ามทันที
    const minPossibleScore = (maxLen - Math.abs(entryLen - inputLen)) / maxLen;
    if (minPossibleScore < effectiveThreshold || minPossibleScore <= highestScore) {
      continue;
    }

    const distance = getLevenshteinDistance(entrySourceNorm, normalizedInput);
    const score = (maxLen - distance) / maxLen;
    if (score > highestScore && score >= effectiveThreshold) {
      highestScore = score;
      bestMatch = entry;
    }
  }

  if (bestMatch) return bestMatch.target;

  // 3rd Phase: English Fallback
  // หากไม่พบในภาษาหลัก และข้อความเป็นตัวอักษรละติน ให้ค้นหาในพจนานุกรมภาษาอังกฤษแทน
  // (เช่น มังงะญี่ปุ่น/เกาหลีแต่มีเสียงเอฟเฟกต์ภาษาอังกฤษ เช่น Smack, Boom, Shaking)
  if (lang !== 'en' && !_isEnFallback && /[a-zA-Z]/.test(text)) {
    return translateSFX(text, 'en', fuzzyThreshold, true);
  }

  return null;
}
